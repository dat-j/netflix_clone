/**
 * BoxPhim Telegram bot entrypoint.
 *   - TELEGRAM_BOT_TOKEN empty → log and exit 0 (Railway's default ON_FAILURE restart policy then leaves the service
 *     stopped instead of crash-looping; set the token and redeploy to enable it).
 *   - Long polling by default (no public URL needed); TELEGRAM_WEBHOOK_URL switches to webhook mode on PORT.
 */
import { env } from "./env.js";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { createPrismaClient } from "@app/db";
import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { PrismaCatalog } from "./catalog.js";
import { createHttpServer } from "./http.js";
import { createKV } from "./lib/kv.js";
import { errMessage, logger, registerSecret, setDebug } from "./lib/log.js";
import { S3MediaStore } from "./lib/media.js";
import { configureBot } from "./startup.js";

const log = logger("main");
const ALLOWED_UPDATES = ["message", "callback_query", "inline_query"] as const;

async function main() {
  const cfg = env();
  setDebug(cfg.debug);
  if (!cfg.token) {
    log.warn("TELEGRAM_BOT_TOKEN chưa được cấu hình — bot Telegram bị tắt. Đặt biến này (lấy từ @BotFather) rồi deploy lại để bật.");
    process.exit(0);
  }
  registerSecret(cfg.token);
  registerSecret(cfg.webhookSecret);
  if (!cfg.publicWebUrl.startsWith("https://")) {
    log.warn("PUBLIC_WEB_URL không phải https — Telegram sẽ từ chối nút Mini App (web_app)", { publicWebUrl: cfg.publicWebUrl });
  }

  const prisma = createPrismaClient(cfg.databaseUrl);
  const media = new S3MediaStore(cfg.media);
  const kv = createKV(cfg.redisUrl);
  const catalog = new PrismaCatalog(prisma);
  const publicBotUrl = cfg.publicBotUrl || (cfg.webhookUrl ? new URL(cfg.webhookUrl).origin : "");

  const { bot, photos } = createBot(cfg.token, {
    catalog, media, kv, publicWebUrl: cfg.publicWebUrl, botUsername: cfg.botUsername, publicBotUrl: publicBotUrl || undefined, rateLimit: cfg.rateLimit,
  });
  await bot.init();
  photos.setBotId(bot.botInfo.id);
  log.info("bot ready", { username: bot.botInfo.username, mode: cfg.webhookUrl ? "webhook" : "polling" });
  if (bot.botInfo.username.toLowerCase() !== cfg.botUsername.toLowerCase()) {
    log.warn("TELEGRAM_BOT_USERNAME không khớp với username thật của token — link t.me sẽ sai", { configured: cfg.botUsername, actual: bot.botInfo.username });
  }
  await configureBot(bot.api, cfg.publicWebUrl);

  let server: Server | undefined;
  let stopping = false;
  const shutdown = async (signal: string, code = 0) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    const force = setTimeout(() => process.exit(code), 10_000);
    force.unref();
    try {
      if (bot.isRunning()) await bot.stop();
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
      await prisma.$disconnect().catch(() => {});
      await kv.close();
      media.close();
    } catch (err) {
      log.error("shutdown error", { err: errMessage(err) });
    }
    process.exit(code);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  if (cfg.webhookUrl) {
    const url = new URL(cfg.webhookUrl);
    const secret = cfg.webhookSecret || createHash("sha256").update(`boxphim-webhook:${cfg.token}`).digest("hex").slice(0, 48);
    registerSecret(secret);
    const handler = webhookCallback(bot, "http", { secretToken: secret, onTimeout: "return", timeoutMilliseconds: 55_000 });
    server = createHttpServer({ catalog, photos, webhook: { path: url.pathname || "/", handler } });
    server.listen(cfg.port, () => log.info("http listening", { port: cfg.port, webhookPath: url.pathname }));
    await bot.api.setWebhook(url.href, { secret_token: secret, allowed_updates: [...ALLOWED_UPDATES] });
    log.info("webhook registered", { url: url.origin + url.pathname });
    return;
  }

  if (publicBotUrl) {
    server = createHttpServer({ catalog, photos });
    server.listen(cfg.port, () => log.info("http listening (thumbnails/health)", { port: cfg.port }));
  }
  // bot.start() deletes any previously registered webhook, then long-polls until bot.stop().
  bot
    .start({ allowed_updates: [...ALLOWED_UPDATES], onStart: () => log.info("long polling started") })
    .catch((err) => {
      // 409 Conflict = another instance is polling with the same token (run exactly one replica in polling mode).
      log.error("polling stopped with error", { err: errMessage(err) });
      void shutdown("polling-error", 1);
    });
}

main().catch((err) => {
  log.error("fatal", { err: errMessage(err) });
  process.exit(1);
});
