/**
 * Handler tests: real seeded catalog (local Postgres) + a fake Telegram API (grammY transformer that records every
 * outgoing call and returns canned results). No network access to Telegram; bot info is provided up front.
 * Artwork comes from a fake media store (null → generated placeholder) to keep the suite fast and S3-independent.
 */
import "../src/env.js";
import { createPrismaClient, type PrismaClient } from "@app/db";
import { GrammyError, InputFile } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBot, type CreatedBot } from "../src/bot.js";
import { PrismaCatalog } from "../src/catalog.js";
import { encode, uuidToShort } from "../src/lib/callback.js";
import { MemoryKV } from "../src/lib/kv.js";
import type { MediaStore } from "../src/lib/media.js";

const WEB = "https://boxphim.test";
const BOT_INFO = {
  id: 4242, is_bot: true, first_name: "BoxPhim", username: "boxphim_test_bot", can_join_groups: true,
  can_read_all_group_messages: false, supports_inline_queries: true, can_connect_to_business: false, has_main_web_app: false,
} as unknown as UserFromGetMe;
const USER = { id: 1001, is_bot: false, first_name: "Đạt", language_code: "vi" };
const CHAT = { id: 1001, type: "private" as const, first_name: "Đạt" };

interface Call { method: string; payload: Record<string, any> }

let dbOk = false;
let prisma: PrismaClient;
try {
  prisma = createPrismaClient(process.env.DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  console.warn("local Postgres unavailable → skipping bot handler tests");
}

const nullMedia: MediaStore = { get: async () => null, close: () => {} };

describe.skipIf(!dbOk)("bot handlers (fake Telegram API, seeded DB)", () => {
  let created: CreatedBot;
  let calls: Call[];
  let failNext: Map<string, { code: number; description: string }>;
  let updateId = 1;
  let msgId = 100;
  let fileSeq = 0;
  let playable: { id: string; slug: string; name: string };
  let notPlayable: { id: string; slug: string };

  const photoMsg = (id = 77) => ({
    message_id: id, date: 1, chat: CHAT, from: BOT_INFO, caption: "x",
    photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 50 }, { file_id: "big", file_unique_id: "b", width: 1280, height: 720 }],
  });

  function result(method: string, payload: Record<string, any>) {
    switch (method) {
      case "sendPhoto":
      case "editMessageMedia": {
        const media = method === "sendPhoto" ? payload.photo : payload.media.media;
        const fid = typeof media === "string" ? media : `fid-${++fileSeq}`;
        return {
          message_id: method === "sendPhoto" ? ++msgId : payload.message_id, date: 1, chat: CHAT, caption: method === "sendPhoto" ? payload.caption : payload.media.caption,
          photo: [{ file_id: `${fid}-thumb`, file_unique_id: "t", width: 90, height: 51 }, { file_id: fid, file_unique_id: "u", width: 1280, height: 720 }],
        };
      }
      case "sendMessage":
        return { message_id: ++msgId, date: 1, chat: CHAT, text: payload.text };
      default:
        return true;
    }
  }

  const send = (u: Omit<Update, "update_id">) => created.bot.handleUpdate({ update_id: updateId++, ...u } as Update);
  const text = (t: string) => send({
    message: {
      message_id: ++msgId, date: 1, chat: CHAT, from: USER, text: t,
      ...(t.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: t.split(" ")[0]!.length }] } : {}),
    } as any,
  });
  const press = (data: string, message: object = photoMsg()) =>
    send({ callback_query: { id: `cb${updateId}`, from: USER, chat_instance: "ci", data, message } as any });
  const of = (m: string) => calls.filter((c) => c.method === m);
  const buttons = (c: Call) => (c.payload.reply_markup.inline_keyboard as any[][]).flat();

  beforeAll(async () => {
    const t = await prisma.title.findFirstOrThrow({ where: { slug: "nguoi-gac-den-bien", status: "PUBLISHED" }, select: { id: true, slug: true, name: true } });
    playable = t;
    notPlayable = await prisma.title.findFirstOrThrow({
      where: { status: "PUBLISHED", OR: [{ mainAssetId: null }, { mainAsset: { status: { not: "READY" } } }], episodes: { none: {} } },
      select: { id: true, slug: true },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    calls = [];
    failNext = new Map();
    fileSeq = 0;
    created = createBot("123456:TEST-TOKEN-not-real-xxxxxxxxxxxxxxxxxxxx", {
      catalog: new PrismaCatalog(prisma), media: nullMedia, kv: new MemoryKV(), publicWebUrl: WEB, botUsername: "boxphim_bot",
      publicBotUrl: "https://bot.boxphim.test", rateLimit: { max: 20, windowMs: 10_000 },
    }, { botInfo: BOT_INFO });
    created.bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, any> });
      const fail = failNext.get(method);
      if (fail) {
        failNext.delete(method);
        return { ok: false, error_code: fail.code, description: fail.description } as any;
      }
      return { ok: true, result: result(method, payload as Record<string, any>) } as any;
    });
  });

  it("/start sends a banner photo with the menu and correct Mini App URLs; repeat views reuse the file_id", async () => {
    await text("/start");
    const [p] = of("sendPhoto");
    expect(p).toBeDefined();
    expect(p!.payload.chat_id).toBe(CHAT.id);
    expect(p!.payload.photo).toBeInstanceOf(InputFile);
    expect(p!.payload.parse_mode).toBe("HTML");
    expect(p!.payload.caption).toContain("BoxPhim");
    const btns = buttons(p!);
    const labels = btns.map((b) => b.text);
    for (const l of ["🎬 Phim lẻ", "📺 Phim bộ", "🆕 Phim mới", "🔥 Phim hot", "🔍 Tìm phim", "❤️ Yêu thích", "▶️ Mở BoxPhim", "⚙️ Hỗ trợ"]) {
      expect(labels).toContain(l);
    }
    expect(btns.find((b) => b.text === "❤️ Yêu thích").web_app.url).toBe(`${WEB}/tg?to=%2Fmy-list`);
    expect(btns.find((b) => b.text === "▶️ Mở BoxPhim").web_app.url).toBe(`${WEB}/tg?to=%2Fbrowse`);
    expect(btns.find((b) => b.text === "🎬 Phim lẻ").callback_data).toBe("L:m:1");
    for (const b of btns) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(of("sendChatAction")[0]?.payload.action).toBe("upload_photo");

    calls = [];
    await text("/start");
    expect(of("sendPhoto")[0]!.payload.photo).toBe("fid-1"); // largest PhotoSize of the first upload
    expect(of("sendChatAction")).toHaveLength(0);
  });

  it("list paging edits the same message instead of sending new ones", async () => {
    await press("L:m:1");
    await press("L:m:2");
    expect(of("sendPhoto")).toHaveLength(0);
    const edits = of("editMessageMedia");
    expect(edits).toHaveLength(2);
    for (const e of edits) {
      expect(e.payload.chat_id).toBe(CHAT.id);
      expect(e.payload.message_id).toBe(77);
      expect(e.payload.media.type).toBe("photo");
    }
    expect(edits[0]!.payload.media.caption).toContain("Phim lẻ");
    expect(edits[1]!.payload.media.caption).toContain("trang 2/");
    const labels = buttons(edits[1]!).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["◀ Trước", "Tiếp ▶", "🏠 Trang chủ"]));
    expect(labels.some((l) => /^2\/\d+$/.test(l))).toBe(true);
    expect(labels.filter((l) => /^\d+\. /.test(l))).toHaveLength(4);
    const nav = buttons(edits[1]!);
    expect(nav.find((b) => b.text === "◀ Trước").callback_data).toBe("L:m:1");
    expect(nav.find((b) => b.text === "Tiếp ▶").callback_data).toBe("L:m:3");
    expect(nav.find((b) => /^5\. /.test(b.text)).callback_data).toMatch(/^D:[A-Za-z0-9_-]{22}:m:2$/);
    expect(of("answerCallbackQuery")).toHaveLength(2);
  });

  it("treats 'message is not modified' as success", async () => {
    failNext.set("editMessageMedia", { code: 400, description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same" });
    await press("L:t:1");
    expect(of("editMessageMedia")).toHaveLength(1);
    expect(of("sendPhoto")).toHaveLength(0);
    expect(of("answerCallbackQuery")).toHaveLength(1);
  });

  it("falls back to a new message when the old one can't be edited", async () => {
    failNext.set("editMessageMedia", { code: 400, description: "Bad Request: message to edit not found" });
    await press("L:s:1");
    expect(of("sendPhoto")).toHaveLength(1);
  });

  it("re-uploads when a cached file_id is rejected", async () => {
    await press("h"); // populates cache with fid-1
    calls = [];
    failNext.set("editMessageMedia", { code: 400, description: "Bad Request: wrong file identifier/HTTP URL specified" });
    await press("h");
    const edits = of("editMessageMedia");
    expect(edits).toHaveLength(2);
    expect(edits[0]!.payload.media.media).toBe("fid-1");
    expect(edits[1]!.payload.media.media).toBeInstanceOf(InputFile);
  });

  it("detail of a playable title: Xem ngay → /watch/<id>, back → list page", async () => {
    await press(encode({ a: "detail", id: playable.id, back: { list: { kind: "movies" }, page: 3 } }));
    const [e] = of("editMessageMedia");
    expect(e).toBeDefined();
    const cap: string = e!.payload.media.caption;
    expect(cap).toContain(playable.name);
    expect(cap).toContain("✅ Xem được ngay");
    const btns = buttons(e!);
    expect(btns.find((b) => b.text === "▶ Xem ngay").web_app.url).toBe(`${WEB}/tg?to=${encodeURIComponent(`/watch/${playable.id}`)}`);
    expect(btns.find((b) => b.text === "ℹ️ Chi tiết").web_app.url).toBe(`${WEB}/tg?to=${encodeURIComponent(`/title/${playable.slug}`)}`);
    expect(btns.find((b) => b.text === "❤️ Thêm vào yêu thích").web_app.url).toBe(`${WEB}/tg?to=${encodeURIComponent(`/title/${playable.slug}`)}`);
    expect(btns.find((b) => b.text === "↩ Quay lại").callback_data).toBe("L:m:3");
    expect(btns.find((b) => b.text === "🏠 Trang chủ").callback_data).toBe("h");
  });

  it("detail of a non-playable title: Xem ngay → /title/<slug>", async () => {
    await press(encode({ a: "detail", id: notPlayable.id }));
    const btns = buttons(of("editMessageMedia")[0]!);
    expect(btns.find((b) => b.text === "▶ Xem ngay").web_app.url).toBe(`${WEB}/tg?to=${encodeURIComponent(`/title/${notPlayable.slug}`)}`);
    expect(btns.some((b) => b.text === "↩ Quay lại")).toBe(false);
  });

  it("plain text searches accent-insensitively: 'nguoi gac den' finds 'Người Gác Đèn Biển'", async () => {
    await text("nguoi gac den");
    const [p] = of("sendPhoto");
    expect(p).toBeDefined();
    expect(p!.payload.caption).toContain("Người Gác Đèn Biển");
    const first = buttons(p!).find((b) => /^1\. /.test(b.text));
    expect(first.text).toContain("Người Gác Đèn Biển");
    // results are a normal list screen with a search back-reference
    expect(first.callback_data).toMatch(/^D:[A-Za-z0-9_-]{22}:q\.[A-Za-z0-9_-]{10}:1$/);
    expect(first.callback_data.startsWith(`D:${uuidToShort(playable.id)}`)).toBe(true);
    // the search list survives paging/back via the stored query id
    calls = [];
    await press(first.callback_data.replace(/^D:[^:]+:/, "L:"));
    expect(of("editMessageMedia")[0]!.payload.media.caption).toContain("Người Gác Đèn Biển");
  });

  it("/search with no text prompts with force_reply; empty results render an empty state", async () => {
    await text("/search");
    expect(of("sendMessage")[0]!.payload.reply_markup.force_reply).toBe(true);
    calls = [];
    await text("zzzz qqqq không tồn tại");
    const [p] = of("sendPhoto");
    expect(p!.payload.caption).toContain("Không tìm thấy");
  });

  it("answers unknown / forged / stale callbacks without crashing", async () => {
    for (const d of ["garbage", "D:AAAAAAAAAAAAAAAAAAAAAA", "L:g.khong-co-the-loai:1", "L:q.AAAAAAAAAA:1", "x"]) {
      calls = [];
      await expect(press(d)).resolves.toBeUndefined();
      expect(of("answerCallbackQuery")).toHaveLength(1);
    }
    calls = [];
    await press("garbage");
    expect(of("answerCallbackQuery")[0]!.payload.text).toMatch(/không còn hợp lệ/);
    expect(of("editMessageMedia")).toHaveLength(0);
  });

  it("answers the callback even when Telegram errors unexpectedly", async () => {
    failNext.set("editMessageMedia", { code: 500, description: "Internal Server Error" });
    await press("L:n:1");
    expect(of("answerCallbackQuery")[0]!.payload.text).toMatch(/lỗi/);
  });

  it("inline mode returns articles with URL buttons (web_app not allowed there) and a web_app header button", async () => {
    await send({ inline_query: { id: "iq1", from: USER, query: "bao lua", offset: "" } as any });
    const [a] = of("answerInlineQuery");
    expect(a).toBeDefined();
    const results = a!.payload.results as any[];
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain("Bão Lửa Sài Gòn");
    expect(results[0].thumbnail_url).toMatch(/^https:\/\/bot\.boxphim\.test\/thumb\/[A-Za-z0-9_-]{22}\.jpg$/);
    const rbtns = results[0].reply_markup.inline_keyboard.flat();
    expect(rbtns.every((b: any) => b.url && !b.web_app)).toBe(true);
    expect(rbtns[1].url).toMatch(/^https:\/\/t\.me\/boxphim_bot\?start=d_[A-Za-z0-9_-]{22}$/);
    expect(a!.payload.button.web_app.url).toBe(`${WEB}/tg?to=${encodeURIComponent("/search?q=bao%20lua")}`);
  });

  it("help mentions the configured @boxphim_bot username for inline mode", async () => {
    await text("/help");
    expect(of("sendPhoto")[0]!.payload.caption).toContain("<code>@boxphim_bot tên phim</code>");
  });

  it("group /start links to the private chat with the configured username", async () => {
    await send({ message: { message_id: 5, date: 1, chat: { id: -100, type: "supergroup", title: "G" }, from: USER, text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] } as any });
    expect(of("sendMessage")[0]!.payload.reply_markup.inline_keyboard[0][0].url).toBe("https://t.me/boxphim_bot?start=hot");
  });

  it("deep link /start d_<id> opens the title", async () => {
    await text(`/start d_${uuidToShort(playable.id)}`);
    expect(of("sendPhoto")[0]!.payload.caption).toContain(playable.name);
  });

  it("rate-limits a user hammering buttons", async () => {
    for (let i = 0; i < 24; i++) await press("x");
    const texts = of("answerCallbackQuery").map((c) => c.payload.text);
    expect(texts).toHaveLength(24);
    expect(texts.filter((t) => t && /nhanh/.test(t))).toHaveLength(4);
  });

  it("GrammyError helper sanity", () => {
    expect(new GrammyError("x", { ok: false, error_code: 400, description: "message is not modified" }, "editMessageMedia", {})).toBeInstanceOf(Error);
  });
});
