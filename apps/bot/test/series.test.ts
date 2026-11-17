/**
 * Series (seasons/episodes) handler tests: fake Telegram API + a fixture series inserted inside an interactive
 * Prisma transaction that is always rolled back, so nothing leaks into the shared local DB and other engineers'
 * data (e.g. a demo series being seeded concurrently) does not affect the assertions.
 */
import "../src/env.js";
import { createPrismaClient, type Prisma, type PrismaClient } from "@app/db";
import type { Update, UserFromGetMe } from "grammy/types";
import { afterAll, describe, expect, it } from "vitest";
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
const USER = { id: 2002, is_bot: false, first_name: "Đạt", language_code: "vi" };
const CHAT = { id: 2002, type: "private" as const, first_name: "Đạt" };
const to = (path: string) => `${WEB}/tg?to=${encodeURIComponent(path)}`;

interface Call { method: string; payload: Record<string, any> }

let dbOk = false;
let prisma: PrismaClient;
try {
  prisma = createPrismaClient(process.env.DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  console.warn("local Postgres unavailable → skipping series handler tests");
}
const nullMedia: MediaStore = { get: async () => null, close: () => {} };

interface Fixture { series: { id: string; slug: string }; empty: { id: string; slug: string }; episodeIds: Map<string, string> }

/**
 * "Phố Thử Nghiệm" — S1: 14 published + E15 draft; S2: E1 published, E2 published but asset still PROCESSING, E3 draft;
 * S3: drafts only (hidden); S0 (specials): 1 published. Plus a published series with draft episodes only.
 */
async function seed(tx: Prisma.TransactionClient): Promise<Fixture> {
  const tag = Math.random().toString(36).slice(2, 8);
  const asset = async (status: "READY" | "PROCESSING") => (await tx.mediaAsset.create({
    data: {
      status,
      renditions: status === "READY"
        ? { create: { name: "1080p", width: 1920, height: 1080, videoKbps: 5000, audioKbps: 128, codecs: "avc1", playlistKey: `hls/x/1080p.m3u8` } }
        : undefined,
    },
    select: { id: true },
  })).id;
  const series = await tx.title.create({
    data: { type: "SERIES", slug: `zz-bot-fixture-${tag}`, name: "Phố Thử Nghiệm", status: "PUBLISHED", overview: "Chuyện phố cổ.", maturityRating: "T13" },
    select: { id: true, slug: true },
  });
  const episodeIds = new Map<string, string>();
  const ep = async (seasonId: string, n: number, status: "PUBLISHED" | "DRAFT", assetStatus: "READY" | "PROCESSING" | null, seasonNumber: number) => {
    const e = await tx.episode.create({
      data: {
        titleId: series.id, seasonId, episodeNumber: n, name: n === 3 ? "Đêm trắng" : `Tập ${n}`, status, runtimeMinutes: 40 + n,
        overview: `Tóm tắt tập ${n} mùa ${seasonNumber}.`, mainAssetId: assetStatus ? await asset(assetStatus) : null,
        ...(n === 1 && seasonNumber === 1 ? { images: { create: { kind: "STILL", key: `images/x/still-${tag}.webp`, isPrimary: true } } } : {}),
      },
      select: { id: true },
    });
    episodeIds.set(`${seasonNumber}:${n}`, e.id);
  };
  const season = (n: number) => tx.season.create({ data: { titleId: series.id, seasonNumber: n, name: n === 0 ? "Specials" : `Mùa ${n}` }, select: { id: true } });
  const s1 = await season(1), s2 = await season(2), s3 = await season(3), s0 = await season(0);
  for (let n = 1; n <= 14; n++) await ep(s1.id, n, "PUBLISHED", "READY", 1);
  await ep(s1.id, 15, "DRAFT", null, 1);
  await ep(s2.id, 1, "PUBLISHED", "READY", 2);
  await ep(s2.id, 2, "PUBLISHED", "PROCESSING", 2);
  await ep(s2.id, 3, "DRAFT", "READY", 2);
  await ep(s3.id, 1, "DRAFT", "READY", 3);
  await ep(s0.id, 1, "PUBLISHED", "READY", 0);

  const empty = await tx.title.create({
    data: { type: "SERIES", slug: `zz-bot-fixture-empty-${tag}`, name: "Phim Bộ Chưa Phát Hành", status: "PUBLISHED" },
    select: { id: true, slug: true },
  });
  const es = await tx.season.create({ data: { titleId: empty.id, seasonNumber: 1 }, select: { id: true } });
  await tx.episode.create({ data: { titleId: empty.id, seasonId: es.id, episodeNumber: 1, status: "DRAFT" } });
  return { series, empty, episodeIds };
}

class Rollback extends Error {}

describe.skipIf(!dbOk)("series: episode picker (fake Telegram API, fixture in a rolled-back transaction)", () => {
  let created: CreatedBot;
  let calls: Call[];
  let updateId = 1;
  let msgId = 100;
  let fileSeq = 0;

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const photoMsg = () => ({
    message_id: 77, date: 1, chat: CHAT, from: BOT_INFO, caption: "x",
    photo: [{ file_id: "big", file_unique_id: "b", width: 1280, height: 720 }],
  });
  function result(method: string, payload: Record<string, any>) {
    if (method === "sendPhoto" || method === "editMessageMedia") {
      const media = method === "sendPhoto" ? payload.photo : payload.media.media;
      const fid = typeof media === "string" ? media : `fid-${++fileSeq}`;
      return { message_id: payload.message_id ?? ++msgId, date: 1, chat: CHAT, photo: [{ file_id: fid, file_unique_id: "u", width: 1280, height: 720 }] };
    }
    if (method === "sendMessage") return { message_id: ++msgId, date: 1, chat: CHAT, text: payload.text };
    return true;
  }

  async function withFixture(fn: (fx: Fixture, catalog: PrismaCatalog) => Promise<void>) {
    try {
      await prisma.$transaction(async (tx) => {
        const fx = await seed(tx);
        const catalog = new PrismaCatalog(tx as unknown as PrismaClient);
        calls = [];
        created = createBot("123456:TEST-TOKEN-not-real-xxxxxxxxxxxxxxxxxxxx", {
          catalog, media: nullMedia, kv: new MemoryKV(), publicWebUrl: WEB, botUsername: "boxphim_bot", rateLimit: { max: 1000, windowMs: 10_000 },
        }, { botInfo: BOT_INFO });
        created.bot.api.config.use(async (_prev, method, payload) => {
          calls.push({ method, payload: payload as Record<string, any> });
          return { ok: true, result: result(method, payload as Record<string, any>) } as any;
        });
        await fn(fx, catalog);
        throw new Rollback();
      }, { timeout: 120_000, maxWait: 10_000 });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  const send = (u: Omit<Update, "update_id">) => created.bot.handleUpdate({ update_id: updateId++, ...u } as Update);
  const press = async (data: string) => {
    calls = [];
    await send({ callback_query: { id: `cb${updateId}`, from: USER, chat_instance: "ci", data, message: photoMsg() } as any });
    const edit = calls.find((c) => c.method === "editMessageMedia");
    const answer = calls.find((c) => c.method === "answerCallbackQuery");
    expect(answer, `callback ${data} answered`).toBeDefined();
    const btns = edit ? (edit.payload.reply_markup.inline_keyboard as any[][]).flat() : [];
    for (const b of btns) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    return {
      caption: (edit?.payload.media.caption ?? "") as string,
      rows: edit ? (edit.payload.reply_markup.inline_keyboard as any[][]).map((r) => r.map((b) => b.text)) : [],
      btn: (label: string | RegExp) => {
        const b = btns.find((x) => (typeof label === "string" ? x.text === label : label.test(x.text)));
        if (!b) throw new Error(`no button ${label} in ${btns.map((x) => x.text).join(" | ")}`);
        return b;
      },
      labels: btns.map((b) => b.text as string),
      toast: answer?.payload.text as string | undefined,
      edited: !!edit,
    };
  };

  it("detail → episode list → page → switch season → episode → next → back (all in one message)", async () => {
    await withFixture(async (fx) => {
      const sid = uuidToShort(fx.series.id);
      const back = { list: { kind: "series" as const }, page: 2 };

      // series detail
      const d = await press(encode({ a: "detail", id: fx.series.id, back }));
      expect(d.caption).toContain("Phim bộ · 3 mùa · 17 tập");
      expect(d.caption).toContain("mở Mùa 1 · Tập 1");
      expect(d.btn(/^▶ Xem ngay/).text).toBe("▶ Xem ngay (Mùa 1 · Tập 1)");
      expect(d.btn(/^▶ Xem ngay/).web_app.url).toBe(to(`/watch/${fx.series.id}`));
      expect(d.btn("❤️ Yêu thích").web_app.url).toBe(to(`/title/${fx.series.slug}`));
      expect(d.btn("↩ Quay lại").callback_data).toBe("L:s:2");
      expect(d.btn("🏠 Trang chủ").callback_data).toBe("h");
      expect(d.btn("📃 Danh sách tập").callback_data).toBe(`E:${sid}:1:1:s:2`);

      // episode list, season 1 page 1
      const l1 = await press(d.btn("📃 Danh sách tập").callback_data);
      expect(l1.caption).toContain("Mùa 1 · 14 tập · trang 1/2");
      expect(l1.rows[0]).toEqual(["• Mùa 1 •", "Mùa 2", "Đặc biệt"]); // draft-only season 3 hidden, specials last
      expect(l1.btn("• Mùa 1 •").callback_data).toBe("x");
      const epRows = l1.rows.filter((r) => r.every((t) => /^Tập \d+/.test(t)));
      expect(epRows).toHaveLength(4);
      expect(epRows.every((r) => r.length === 3)).toBe(true);
      expect(epRows.flat()).toEqual(Array.from({ length: 12 }, (_, i) => `Tập ${i + 1}`));
      expect(l1.btn("Tập 5").callback_data).toBe(`P:${sid}:1:5:s:2`);
      expect(l1.btn("Tiếp ▶").callback_data).toBe(`E:${sid}:1:2:s:2`);
      expect(l1.btn("1/2").callback_data).toBe("x");
      expect(l1.btn("↩ Quay lại").callback_data).toBe(`D:${sid}:s:2`);

      // page 2: 13, 14 — never the draft 15
      const l2 = await press(l1.btn("Tiếp ▶").callback_data);
      expect(l2.caption).toContain("trang 2/2");
      expect(l2.labels.filter((t) => /^Tập \d+/.test(t))).toEqual(["Tập 13", "Tập 14"]);
      expect(l2.btn("◀ Trước").callback_data).toBe(`E:${sid}:1:1:s:2`);

      // switch season → 2: unplayable episode marked, draft E3 hidden, single page (no pager)
      const s2 = await press(l2.btn("Mùa 2").callback_data);
      expect(s2.caption).toContain("Mùa 2 · 2 tập");
      expect(s2.rows[0]).toEqual(["Mùa 1", "• Mùa 2 •", "Đặc biệt"]);
      expect(s2.labels.filter((t) => /^Tập \d+/.test(t))).toEqual(["Tập 1", "Tập 2 ⏳"]);
      expect(s2.labels).not.toContain("Tiếp ▶");

      // open S1E14 → next crosses into season 2
      const e14 = await press(encode({ a: "episode", id: fx.series.id, season: 1, episode: 14, back }));
      expect(e14.caption).toContain("<b>Mùa 1 · Tập 14</b>"); // generic "Tập 14" name not repeated
      expect(e14.caption).toContain("⏱ 54 phút · ✅ Xem được ngay");
      expect(e14.caption).toContain("Tóm tắt tập 14 mùa 1.");
      expect(e14.caption).toContain("Tập 14/14 của Mùa 1");
      expect(e14.btn("▶ Xem tập này").web_app.url).toBe(to(`/watch/${fx.series.id}?episode=${fx.episodeIds.get("1:14")}`)); // mở thẳng tập trong Mini App
      expect(e14.btn("📃 Danh sách tập").callback_data).toBe(`E:${sid}:1:2:s:2`); // back to the page holding E14
      expect(e14.btn("↩ Quay lại").callback_data).toBe(`D:${sid}:s:2`);
      expect(e14.btn("⏭ Tập tiếp theo (Mùa 2)").callback_data).toBe(`P:${sid}:2:1:s:2`);

      const s2e1 = await press(e14.btn(/^⏭/).callback_data);
      expect(s2e1.caption).toContain("Mùa 2 · Tập 1");
      const s2e2 = await press(s2e1.btn("⏭ Tập tiếp theo").callback_data);
      expect(s2e2.caption).toContain("⏳ Sắp có");
      expect(s2e2.labels).not.toContain("▶ Xem tập này");
      expect(s2e2.btn("⏳ Tập này sắp có").web_app.url).toBe(to(`/title/${fx.series.slug}`));
      const sp = await press(s2e2.btn(/^⏭ Tập tiếp theo/).callback_data); // → specials
      expect(sp.caption).toContain("Đặc biệt · Tập 1");
      expect(sp.labels.some((t) => t.startsWith("⏭"))).toBe(false); // last episode: no next

      // named episode heading
      const e3 = await press(encode({ a: "episode", id: fx.series.id, season: 1, episode: 3 }));
      expect(e3.caption).toContain("<b>Mùa 1 · Tập 3 — Đêm trắng</b>");

      // back from the episode card → series detail with the list back-reference intact
      const back2 = await press(e14.btn("↩ Quay lại").callback_data);
      expect(back2.caption).toContain("Phố Thử Nghiệm");
      expect(back2.btn("↩ Quay lại").callback_data).toBe("L:s:2");

      expect(calls.filter((c) => c.method === "sendPhoto")).toHaveLength(0);
    });
  });

  it("unpublished / unknown episodes and seasons fall back gracefully with a toast", async () => {
    await withFixture(async (fx) => {
      const draft = await press(encode({ a: "episode", id: fx.series.id, season: 1, episode: 15 }));
      expect(draft.toast).toMatch(/Tập này hiện không có/);
      expect(draft.caption).toContain("Danh sách tập");
      expect(draft.caption).toContain("Mùa 1 · 14 tập");

      const hiddenSeason = await press(encode({ a: "episodes", id: fx.series.id, season: 3, page: 1 }));
      expect(hiddenSeason.toast).toMatch(/Mùa này hiện không có, đã chuyển sang Mùa 1/);
      expect(hiddenSeason.caption).toContain("Mùa 1 · 14 tập");

      const farPage = await press(encode({ a: "episodes", id: fx.series.id, season: 1, page: 99 }));
      expect(farPage.caption).toContain("trang 2/2"); // clamped

      const goneTitle = await press(encode({ a: "episode", id: "00000000-0000-7000-8000-00000000dead", season: 1, episode: 1 }));
      expect(goneTitle.toast).toMatch(/không có trên BoxPhim/);
      expect(goneTitle.edited).toBe(false);

      // a movie id in an episode button (forged) → its normal detail screen, no picker
      const movie = await prisma.title.findFirst({ where: { type: "MOVIE", status: "PUBLISHED" }, select: { id: true, name: true } });
      if (movie) {
        const m = await press(encode({ a: "episodes", id: movie.id, season: 1, page: 1 }));
        expect(m.caption).toContain(movie.name);
        expect(m.labels).toContain("❤️ Thêm vào yêu thích");
      }

      for (const bad of [`E:${uuidToShort(fx.series.id)}:1:0`, `P:${uuidToShort(fx.series.id)}:01:1`, "E:garbage:1:1"]) {
        const r = await press(bad);
        expect(r.toast).toMatch(/không còn hợp lệ/);
      }
    });
  });

  it("a series without published episodes: no picker button, picker callback falls back to detail", async () => {
    await withFixture(async (fx) => {
      const d = await press(encode({ a: "detail", id: fx.empty.id }));
      expect(d.caption).toContain("Chưa có tập nào được phát hành");
      expect(d.caption).toContain("⏳ Sắp có");
      expect(d.labels).not.toContain("📃 Danh sách tập");
      expect(d.btn("▶ Xem ngay").web_app.url).toBe(to(`/title/${fx.empty.slug}`));
      const l = await press(encode({ a: "episodes", id: fx.empty.id, season: 1, page: 1 }));
      expect(l.toast).toMatch(/chưa có tập nào/);
      expect(l.caption).toContain("Phim Bộ Chưa Phát Hành");
    });
  });

  it("catalog: cards carry the season count; detail hides drafts and exposes stills", async () => {
    await withFixture(async (fx, catalog) => {
      const [card] = await catalog.cards([fx.series.id]);
      expect(card!.seasonCount).toBe(3);
      const [emptyCard] = await catalog.cards([fx.empty.id]);
      expect(emptyCard!.seasonCount).toBe(0);
      const t = (await catalog.detail(fx.series.id))!;
      expect(t.seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 0]);
      expect(t.seasons[0]!.episodes.map((e) => e.episodeNumber)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
      expect(t.seasons[0]!.episodes[0]!.stillKey).toMatch(/^images\/x\/still-/);
      expect(t.seasons[0]!.episodes[0]!.id).toBe(fx.episodeIds.get("1:1"));
      expect(t.seasons[1]!.episodes.map((e) => [e.episodeNumber, e.playable])).toEqual([[1, true], [2, false]]);
      expect(t.playable).toBe(true);
      expect(t.maxHeight).toBe(1080);
      expect((await catalog.detail(fx.empty.id))!.seasons).toEqual([]);
    });
  });
});
