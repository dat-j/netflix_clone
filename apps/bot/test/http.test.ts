import "../src/env.js";
import { createPrismaClient } from "@app/db";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { PrismaCatalog } from "../src/catalog.js";
import { createHttpServer } from "../src/http.js";
import { uuidToShort } from "../src/lib/callback.js";
import { MemoryKV } from "../src/lib/kv.js";
import { PhotoService } from "../src/photos.js";

const prisma = createPrismaClient(process.env.DATABASE_URL);
const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);

describe.skipIf(!dbOk)("http server", () => {
  it("serves health and JPEG inline thumbnails, 404 for unknown ids", async () => {
    const t = await prisma.title.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { id: true } });
    const photos = new PhotoService(new MemoryKV(), { get: async () => null, close: () => {} });
    const server = createHttpServer({ catalog: new PrismaCatalog(prisma), photos }).listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      const res = await fetch(`${base}/thumb/${uuidToShort(t.id)}.jpg`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 200, 300]);
      expect((await fetch(`${base}/thumb/${uuidToShort("00000000-0000-7000-8000-000000000000")}.jpg`)).status).toBe(404);
      expect((await fetch(`${base}/thumb/../../etc/passwd`)).status).toBe(404);
    } finally {
      server.close();
      await prisma.$disconnect();
    }
  });
});
