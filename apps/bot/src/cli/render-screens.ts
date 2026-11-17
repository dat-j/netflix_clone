/**
 * Renders the bot's screens for seeded titles to tmp/screens/bot/ (no Telegram token needed):
 *   pnpm --filter @app/bot render:screens
 */
import { env, REPO_ROOT } from "../env.js";
import { createPrismaClient } from "@app/db";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaCatalog, type TitleDetail } from "../catalog.js";
import { MemoryKV } from "../lib/kv.js";
import { S3MediaStore } from "../lib/media.js";
import { SearchStore } from "../lib/search-store.js";
import { PhotoService } from "../photos.js";
import { Screens, type Screen } from "../screens.js";

const out = join(REPO_ROOT, "tmp/screens/bot");
mkdirSync(out, { recursive: true });
const prisma = createPrismaClient(env().databaseUrl);
const media = new S3MediaStore(env().media);
const kv = new MemoryKV();
const catalog = new PrismaCatalog(prisma);
const searches = new SearchStore(kv);
const photos = new PhotoService(kv, media);
const screens = new Screens({ catalog, photos, searches, publicWebUrl: env().publicWebUrl, botUsername: env().botUsername });

async function save(name: string, s: Screen | null) {
  if (!s) throw new Error(`screen ${name} missing`);
  const buf = await s.photo.render();
  writeFileSync(join(out, `${name}.jpg`), buf);
  writeFileSync(join(out, `${name}.caption.html`), s.caption);
  console.log(`${name}.jpg ${buf.length} bytes, caption ${s.caption.length} chars`);
}

try {
  await save("01-home", await screens.home("Đạt"));
  await save("02-list-movies-p1", await screens.list({ kind: "movies" }, 1));
  await save("03-list-hot-p1", await screens.list({ kind: "hot" }, 1));
  await save("04-list-series-last", await screens.list({ kind: "series" }, 99));
  const lighthouse = await prisma.title.findUniqueOrThrow({ where: { slug: "nguoi-gac-den-bien" }, select: { id: true } });
  await save("05-detail-playable", await screens.detail(lighthouse.id, { list: { kind: "movies" }, page: 1 }));
  const series = await prisma.title.findFirstOrThrow({ where: { type: "SERIES", status: "PUBLISHED" }, select: { id: true } });
  await save("06-detail-series", await screens.detail(series.id));
  await save("07-genres", await screens.genres(1));
  await save("08-help", screens.help());
  const { qid } = await searches.put("không có phim này xyz");
  await save("09-search-empty", await screens.list({ kind: "search", qid }, 1));
  // title without any artwork → generated placeholder card
  const real = (await catalog.detail(lighthouse.id))!;
  const bare: TitleDetail = { ...real, id: "00000000-0000-7000-8000-000000000001", name: "Phim Chưa Có Ảnh Bìa Rất Dài Tên", posterKey: null, backdropKey: null, logoKey: null, tagline: null };
  await save("10-detail-no-artwork", screens.detailFor(bare));
} finally {
  await prisma.$disconnect();
  media.close();
}
