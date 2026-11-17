/**
 * grammY bot wiring. `createBot` has no side effects beyond constructing the Bot, so tests can pass `botInfo`
 * (no getMe call) and install an API transformer that records outgoing calls.
 */
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, InlineKeyboard, InputMediaBuilder, type Context, type InputFile } from "grammy";
import type { InlineQueryResultArticle, Message, UserFromGetMe } from "grammy/types";
import type { Catalog } from "./catalog.js";
import { decode, parseStartPayload, startPayloadForTitle, uuidToShort, type Action } from "./lib/callback.js";
import { cardMeta } from "./lib/format.js";
import type { KV } from "./lib/kv.js";
import { miniAppUrl, paths, websiteUrl } from "./lib/links.js";
import { errMessage, logger } from "./lib/log.js";
import type { MediaStore } from "./lib/media.js";
import { RateLimiter } from "./lib/rate-limit.js";
import { SearchStore } from "./lib/search-store.js";
import { escapeHtml as e, normalizeQuery, truncate } from "./lib/text.js";
import { largestPhotoId, PhotoService, type PhotoRef } from "./photos.js";
import { Screens, type Screen } from "./screens.js";

const log = logger("bot");

export interface BotDeps {
  catalog: Catalog;
  media: MediaStore;
  kv: KV;
  publicWebUrl: string;
  /** Bot @username without "@" for t.me links and help text (TELEGRAM_BOT_USERNAME, default boxphim_bot). */
  botUsername?: string;
  /** Public origin of this service's HTTP server (for inline-result JPEG thumbnails); optional. */
  publicBotUrl?: string;
  rateLimit?: { max: number; windowMs: number };
}

export interface CreatedBot {
  bot: Bot;
  photos: PhotoService;
  screens: Screens;
  searches: SearchStore;
}

const INLINE_PAGE = 20;
const MIN_QUERY = 2;

export function isNotModified(err: unknown): boolean {
  return err instanceof GrammyError && /message is not modified/i.test(err.description);
}
/** A cached file_id Telegram no longer accepts → drop it and re-upload. */
export function isBadFileId(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 &&
    /wrong file identifier|file reference|wrong remote file|FILE_ID_INVALID|wrong padding|can't use file of type/i.test(err.description);
}
/** Edit failures where sending a fresh message is the right recovery. */
function isUneditable(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 400 &&
    /message to edit not found|message can't be edited|there is no media in the message|MESSAGE_ID_INVALID|message is too old/i.test(err.description);
}

export function createBot(token: string, deps: BotDeps, opts: { botInfo?: UserFromGetMe } = {}): CreatedBot {
  const bot = new Bot(token, { botInfo: opts.botInfo });
  const botUsername = deps.botUsername || opts.botInfo?.username || "boxphim_bot";
  // Flood control: transparently waits out 429 retry_after (and retries 5xx) instead of failing the update.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const photos = new PhotoService(deps.kv, deps.media);
  if (opts.botInfo) photos.setBotId(opts.botInfo.id);
  const searches = new SearchStore(deps.kv);
  const screens = new Screens({ catalog: deps.catalog, photos, searches, publicWebUrl: deps.publicWebUrl, botUsername });
  const limiter = new RateLimiter(deps.rateLimit?.max ?? 20, deps.rateLimit?.windowMs ?? 10_000);

  // ───────── presenter ─────────

  async function withPhoto(ctx: Context, ref: PhotoRef, send: (media: string | InputFile) => Promise<Message | true>) {
    let r = await photos.resolve(ref);
    if (r.uploaded) void ctx.replyWithChatAction("upload_photo").catch(() => {});
    let res: Message | true;
    try {
      res = await send(r.media);
    } catch (err) {
      if (r.uploaded || !isBadFileId(err)) throw err;
      log.warn("cached file_id rejected, re-uploading", { key: ref.key });
      await photos.forget(ref);
      r = await photos.resolve(ref);
      res = await send(r.media);
    }
    if (r.uploaded && res !== true) {
      const fid = largestPhotoId(res);
      if (fid) await photos.remember(ref, fid);
    }
  }

  async function sendScreen(ctx: Context, s: Screen) {
    await withPhoto(ctx, s.photo, (media) =>
      ctx.replyWithPhoto(media, { caption: s.caption, parse_mode: "HTML", reply_markup: s.keyboard }));
  }

  /** Edits the callback's message in place (one message per conversation); falls back to sending a new one. */
  async function present(ctx: Context, s: Screen, mode: "edit" | "send") {
    const msg = ctx.callbackQuery?.message;
    if (mode === "edit" && msg && "photo" in msg && msg.photo?.length) {
      try {
        await withPhoto(ctx, s.photo, (media) =>
          ctx.editMessageMedia(InputMediaBuilder.photo(media, { caption: s.caption, parse_mode: "HTML" }), { reply_markup: s.keyboard }));
        return;
      } catch (err) {
        if (isNotModified(err)) return;
        if (!isUneditable(err)) throw err;
      }
    }
    await sendScreen(ctx, s);
  }

  async function promptSearch(ctx: Context) {
    await ctx.reply("🔍 <b>Tìm phim</b>\nNhập tên phim, diễn viên hoặc thể loại (gõ không dấu cũng được):", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, input_field_placeholder: "Ví dụ: nguoi gac den bien" },
    });
  }

  async function search(ctx: Context, raw: string) {
    const q = normalizeQuery(raw);
    if (q.length < MIN_QUERY) {
      await promptSearch(ctx);
      return;
    }
    const { qid } = await searches.put(q);
    const s = await screens.list({ kind: "search", qid }, 1);
    if (s) await sendScreen(ctx, s);
  }

  /** Executes an action; returns an optional toast for answerCallbackQuery. */
  async function route(ctx: Context, action: Action, mode: "edit" | "send"): Promise<string | undefined> {
    switch (action.a) {
      case "noop":
        return undefined;
      case "home":
        await present(ctx, await screens.home(ctx.from?.first_name), mode);
        return undefined;
      case "help":
        await present(ctx, screens.help(), mode);
        return undefined;
      case "search":
        await promptSearch(ctx);
        return "Nhập tên phim cần tìm";
      case "genres":
        await present(ctx, await screens.genres(action.page), mode);
        return undefined;
      case "list": {
        const s = await screens.list(action.list, action.page);
        if (!s) {
          await present(ctx, await screens.home(ctx.from?.first_name), mode);
          return action.list.kind === "search" ? "Kết quả tìm kiếm đã hết hạn, hãy tìm lại nhé." : "Danh mục này không còn tồn tại.";
        }
        await present(ctx, s, mode);
        return undefined;
      }
      case "detail": {
        const s = await screens.detail(action.id, action.back);
        if (!s) {
          if (mode === "send") await present(ctx, await screens.home(ctx.from?.first_name), mode);
          return "Phim này hiện không có trên BoxPhim.";
        }
        await present(ctx, s, mode);
        return undefined;
      }
      case "episodes":
      case "episode": {
        const r = action.a === "episodes"
          ? await screens.episodes(action.id, action.season, action.page, action.back)
          : await screens.episode(action.id, action.season, action.episode, action.back);
        if (!r) {
          if (mode === "send") await present(ctx, await screens.home(ctx.from?.first_name), mode);
          return "Phim này hiện không có trên BoxPhim.";
        }
        await present(ctx, r.screen, mode);
        return r.toast;
      }
    }
  }

  // ───────── middleware ─────────

  bot.use(async (ctx, next) => {
    const started = Date.now();
    try {
      await next();
    } finally {
      log.debug("update", {
        id: ctx.update.update_id,
        kind: Object.keys(ctx.update).find((k) => k !== "update_id"),
        user: ctx.from?.id,
        ms: Date.now() - started,
      });
    }
  });

  // Per-user rate limit (inline queries are exempt: Telegram already debounces them and answers are cached).
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.inlineQuery) return next();
    const verdict = limiter.hit(ctx.from.id);
    if (verdict === "ok") return next();
    log.warn("rate limited", { user: ctx.from.id });
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Bạn thao tác hơi nhanh, đợi vài giây nhé ⏳" }).catch(() => {});
    } else if (verdict === "blocked-first" && ctx.chat?.type === "private") {
      await ctx.reply("⏳ Bạn gửi hơi nhanh, đợi vài giây rồi thử lại nhé.").catch(() => {});
    }
  });

  // Groups: web_app buttons only work in private chats, so point people to the private chat.
  const groups = bot.chatType(["group", "supergroup"]);
  groups.command(["start", "help"], async (ctx) => {
    await ctx.reply("🎬 BoxPhim hoạt động trong chat riêng. Bấm nút bên dưới để mở nhé!", {
      reply_markup: new InlineKeyboard().url("💬 Mở BoxPhim Bot", `https://t.me/${botUsername}?start=hot`),
    });
  });

  const pm = bot.chatType("private");

  pm.command("start", async (ctx) => {
    const action = parseStartPayload(ctx.match?.trim());
    if (action) {
      const toast = await route(ctx, action, "send");
      if (toast) await ctx.reply(toast);
      return;
    }
    await sendScreen(ctx, await screens.home(ctx.from.first_name));
  });
  pm.command(["search", "timphim", "tim"], async (ctx) => {
    if (ctx.match?.trim()) await search(ctx, ctx.match);
    else await promptSearch(ctx);
  });
  pm.command("moi", (ctx) => route(ctx, { a: "list", list: { kind: "new" }, page: 1 }, "send"));
  pm.command("hot", (ctx) => route(ctx, { a: "list", list: { kind: "hot" }, page: 1 }, "send"));
  pm.command("phimle", (ctx) => route(ctx, { a: "list", list: { kind: "movies" }, page: 1 }, "send"));
  pm.command("phimbo", (ctx) => route(ctx, { a: "list", list: { kind: "series" }, page: 1 }, "send"));
  pm.command("theloai", (ctx) => route(ctx, { a: "genres", page: 1 }, "send"));
  pm.command("help", (ctx) => route(ctx, { a: "help" }, "send"));

  pm.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await ctx.reply("Mình chưa hiểu lệnh này 🤔 Gõ /help để xem hướng dẫn, hoặc gõ tên phim để tìm.");
      return;
    }
    // Any plain text — including the reply to the "Tìm phim" force_reply prompt — is a search.
    await search(ctx, text);
  });
  pm.on("message", async (ctx) => {
    await ctx.reply("Gõ tên phim để tìm, hoặc bấm /start để mở trang chủ BoxPhim 🎬");
  });

  bot.on("callback_query:data", async (ctx) => {
    const action = decode(ctx.callbackQuery.data);
    let toast: string | undefined;
    try {
      if (!action) {
        log.warn("invalid callback data", { user: ctx.from.id, len: ctx.callbackQuery.data.length });
        toast = "Nút này không còn hợp lệ. Bấm /start để mở lại trang chủ.";
      } else {
        toast = await route(ctx, action, "edit");
      }
    } catch (err) {
      log.error("callback failed", { user: ctx.from.id, data: ctx.callbackQuery.data, err: errMessage(err) });
      toast = "Có lỗi xảy ra, bạn thử lại sau nhé.";
    } finally {
      // Always answer so the client's loading spinner stops, even on errors.
      await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => {});
    }
  });
  bot.on("callback_query", (ctx) => ctx.answerCallbackQuery().catch(() => {}));

  // ───────── inline mode ─────────
  // web_app buttons are only allowed in private chats with the bot, and inline results are posted into arbitrary
  // chats → results use URL buttons (website + deep link back into the bot). The results-list header button,
  // however, may be a web_app button, so "Mở BoxPhim" there opens the Mini App.
  bot.on("inline_query", async (ctx) => {
    const q = normalizeQuery(ctx.inlineQuery.query);
    const offset = Math.max(0, Number.parseInt(ctx.inlineQuery.offset || "0", 10) || 0);
    const ids = q.length >= MIN_QUERY ? await deps.catalog.search(q, 100) : await deps.catalog.listIds({ kind: "hot" });
    const page = ids.slice(offset, offset + INLINE_PAGE);
    const cards = await deps.catalog.cards(page);
    const results: InlineQueryResultArticle[] = cards.map((c) => {
      const short = uuidToShort(c.id);
      const url = websiteUrl(deps.publicWebUrl, paths.title(c.slug));
      const overview = c.overview ? truncate(c.overview, 300) : "";
      return {
        type: "article",
        id: short,
        title: `${c.name}${c.year ? ` (${c.year})` : ""}`,
        description: [cardMeta(c), c.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ") + (overview ? `\n${truncate(overview, 90)}` : ""),
        ...(deps.publicBotUrl ? { thumbnail_url: `${deps.publicBotUrl}/thumb/${short}.jpg`, thumbnail_width: 200, thumbnail_height: 300 } : {}),
        input_message_content: {
          message_text:
            `🎬 <b>${e(c.name)}</b>${c.year ? ` (${c.year})` : ""}\n${e(cardMeta(c))}` +
            (c.genres.length ? `\n🎭 ${e(c.genres.join(", "))}` : "") +
            (overview ? `\n\n${e(overview)}` : "") +
            `\n\n👉 Xem trên <b>BoxPhim</b>`,
          parse_mode: "HTML",
          // the website's Open Graph card supplies the poster preview inside the shared message
          link_preview_options: { url, prefer_large_media: true, show_above_text: true },
        },
        reply_markup: new InlineKeyboard()
          .url("▶ Xem trên BoxPhim", url).row()
          .url("🤖 Mở trong bot", `https://t.me/${botUsername}?start=${startPayloadForTitle(c.id)}`),
      };
    });
    await ctx.answerInlineQuery(results, {
      cache_time: 300,
      is_personal: false,
      next_offset: offset + INLINE_PAGE < ids.length ? String(offset + INLINE_PAGE) : "",
      button: { text: q ? `Mở BoxPhim: tìm “${truncate(q, 30)}”` : "Mở BoxPhim", web_app: { url: miniAppUrl(deps.publicWebUrl, q ? paths.search(q) : paths.browse()) } },
    });
  });

  bot.catch((err) => {
    log.error("unhandled update error", { update: err.ctx?.update?.update_id, err: errMessage(err.error) });
  });

  return { bot, photos, screens, searches };
}
