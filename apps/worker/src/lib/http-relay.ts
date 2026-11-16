/**
 * Loopback HTTP relay for (presigned) URLs.
 *
 * Why: the bundled static ffmpeg/ffprobe builds (johnvansickle, glibc-static) segfault inside getaddrinfo() as soon as
 * they must resolve a hostname (e.g. `localhost`, `s3.amazonaws.com`); IP literals work. So when we run the bundled
 * binaries, ffprobe reads `http://127.0.0.1:<port>/<token>` and this relay forwards each request (including the
 * `Range` header ffprobe relies on to seek) to the real presigned URL with Node's fetch. Nothing is buffered or stored.
 * With a system ffprobe (FFPROBE_PATH set, as in the Docker image) the presigned URL is used directly.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

let server: Server | undefined;
let port = 0;
const routes = new Map<string, string>();
const PASS_HEADERS = ["content-length", "content-range", "accept-ranges", "content-type", "last-modified", "etag"];

async function ensureServer(): Promise<number> {
  if (server) return port;
  const s = createServer(async (req, res) => {
    const target = routes.get((req.url ?? "").slice(1));
    if (!target || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404).end();
      return;
    }
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers: req.headers.range ? { range: req.headers.range } : {},
        signal: ac.signal,
      });
      const headers: Record<string, string> = {};
      for (const h of PASS_HEADERS) {
        const v = upstream.headers.get(h);
        if (v) headers[h] = v;
      }
      res.writeHead(upstream.status, headers);
      if (!upstream.body || req.method === "HEAD") return void res.end();
      Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).on("error", () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve());
  });
  s.unref();
  server = s;
  port = (s.address() as AddressInfo).port;
  return port;
}

/** True when we're using the bundled static binaries (no FFPROBE_PATH override) and the URL is not an IP literal. */
export function needsRelay(url: string): boolean {
  if (process.env.FFPROBE_PATH || process.env.FFMPEG_DIRECT_URLS === "1") return false;
  try {
    const host = new URL(url).hostname;
    return !/^(\d+\.){3}\d+$|^\[.*\]$/.test(host);
  } catch {
    return false;
  }
}

/** Runs `fn` with a URL ffmpeg/ffprobe can open; the relay route is removed afterwards. */
export async function withReadableUrl<T>(url: string, fn: (url: string) => Promise<T>): Promise<T> {
  if (!needsRelay(url)) return fn(url);
  const p = await ensureServer();
  const token = randomBytes(16).toString("hex");
  routes.set(token, url);
  try {
    return await fn(`http://127.0.0.1:${p}/${token}`);
  } finally {
    routes.delete(token);
  }
}
