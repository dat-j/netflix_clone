/**
 * Optional HTTP server: health check, JPEG poster thumbnails for inline-mode results (Telegram fetches
 * `thumbnail_url` itself and the media bucket is private + WebP), and the webhook endpoint in webhook mode.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Catalog } from "./catalog.js";
import { shortToUuid } from "./lib/callback.js";
import { errMessage, logger } from "./lib/log.js";
import type { PhotoService } from "./photos.js";
import { renderThumb } from "./render/render.js";

const log = logger("http");

export interface HttpDeps {
  catalog: Catalog;
  photos: PhotoService;
  webhook?: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown };
}

export function createHttpServer(d: HttpDeps): Server {
  const thumbs = new Map<string, Promise<Buffer | null>>();
  const thumb = (id: string) => {
    let p = thumbs.get(id);
    if (!p) {
      p = (async () => {
        const [card] = await d.catalog.cards([id]);
        if (!card) return null;
        return renderThumb(await d.photos.loadArt(card.posterKey), card.name);
      })().catch((err) => {
        log.warn("thumb failed", { id, err: errMessage(err) });
        thumbs.delete(id);
        return null;
      });
      thumbs.set(id, p);
      while (thumbs.size > 500) thumbs.delete(thumbs.keys().next().value!);
    }
    return p;
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (d.webhook && req.method === "POST" && url.pathname === d.webhook.path) return void (await d.webhook.handler(req, res));
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      const m = /^\/thumb\/([A-Za-z0-9_-]{22})\.jpg$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const id = shortToUuid(m[1]!);
        const buf = id ? await thumb(id) : null;
        if (!buf) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "content-length": buf.length }).end(buf);
        return;
      }
      res.writeHead(404).end();
    } catch (err) {
      log.error("request failed", { path: url.pathname, err: errMessage(err) });
      if (!res.headersSent) res.writeHead(500).end();
    }
  });
}
