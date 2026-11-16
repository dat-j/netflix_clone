/**
 * Seed catalog demo (idempotent): thể loại, ~36 title có artwork sinh tự động, hàng trang chủ, collection, billboard,
 * gắn file nguồn (đã probe OK) làm asset qua đúng service của admin, rồi xuất bản tất cả.
 *
 *   pnpm --filter @app/api seed:catalog
 *
 * Biến môi trường tuỳ chọn: SEED_ATTACH_LIMIT (mặc định 12 title được gắn asset), SEED_WAIT_SECONDS (mặc định 60 —
 * chờ worker probe khi bucket chưa được quét), SEED_REGEN_ART=1 (sinh lại toàn bộ artwork).
 */
import "../env.js";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { InfraModule } from "../infra/infra.module.js";
import { PrismaService } from "../infra/prisma.service.js";
import { RedisService } from "../infra/redis.service.js";
import { StorageModule } from "../modules/storage/storage.module.js";
import { ImagePipelineService } from "../modules/storage/image-pipeline.service.js";
import { AdminContentModule } from "../modules/admin-content/admin-content.module.js";
import { AdminTitlesService } from "../modules/admin-content/admin-titles.service.js";
import { MediaQueuesService } from "../modules/admin-content/queues.service.js";
import { slugify } from "../modules/admin-content/slug.js";
import { invalidateCatalogCache } from "../modules/catalog/cache.js";
import { GENRES, TITLES, type SeedTitle } from "./seed-catalog-data.js";
import { backdropPng, logoPng, posterPng } from "./artwork.js";

@Module({ imports: [InfraModule, StorageModule, AdminContentModule] })
class SeedModule {}

const log = (...a: unknown[]) => console.log("[seed:catalog]", ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ["error"] });
  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  const images = app.get(ImagePipelineService);
  const titlesSvc = app.get(AdminTitlesService);
  const queues = app.get(MediaQueuesService);

  try {
    // 1. thể loại
    const genreId = new Map<string, string>();
    for (const g of GENRES) {
      const byTmdb = await prisma.genre.findUnique({ where: { tmdbId: g.tmdbId }, select: { id: true, slug: true } });
      const existing = await prisma.genre.findUnique({ where: { slug: g.slug } });
      const tmdbFree = !byTmdb || byTmdb.slug === g.slug;
      const row = existing
        ? await prisma.genre.update({ where: { id: existing.id }, data: { name: g.name, nameEn: g.nameEn, ...(tmdbFree ? { tmdbId: g.tmdbId } : {}) } })
        : await prisma.genre.create({ data: { slug: g.slug, name: g.name, nameEn: g.nameEn, ...(tmdbFree ? { tmdbId: g.tmdbId } : {}) } });
      genreId.set(g.slug, row.id);
    }
    log(`genres: ${GENRES.length}`);

    // 2. titles + credits + artwork
    const ids: string[] = [];
    let created = 0, artworks = 0;
    for (const t of TITLES) {
      const slug = slugify(t.name);
      let title = await prisma.title.findUnique({ where: { slug }, select: { id: true } });
      if (!title) {
        const dto = await titlesSvc.create(
          {
            type: t.type, name: t.name, slug, originalName: t.originalName, tagline: t.tagline ?? null, overview: t.overview,
            releaseDate: `${t.year}-${String((t.name.length % 12) + 1).padStart(2, "0")}-15`, runtimeMinutes: t.runtime,
            maturityRating: t.rating, countries: ["VN"], genreIds: t.genres.map((s) => genreId.get(s)!),
          },
          { tmdbRating: t.tmdbRating, originalLang: "vi" },
        );
        title = { id: dto.id };
        created++;
      }
      ids.push(title.id);
      await ensureCredits(prisma, title.id, t);
      artworks += await ensureArtwork(prisma, images, title.id, t);
    }
    log(`titles: ${TITLES.length} (mới ${created}), ảnh mới ${artworks}`);

    // 3. collection biên tập
    const picks = [0, 8, 3, 13, 21, 16, 29, 32, 4, 18].map((i) => ids[i]!);
    const coll = await prisma.collection.upsert({
      where: { slug: "tuyen-chon-bien-tap" }, create: { slug: "tuyen-chon-bien-tap", name: "Tuyển chọn của biên tập" }, update: {},
    });
    if ((await prisma.collectionItem.count({ where: { collectionId: coll.id } })) === 0) {
      await prisma.collectionItem.createMany({ data: picks.map((titleId, sortOrder) => ({ collectionId: coll.id, titleId, sortOrder })) });
    }

    // 4. hàng trang chủ
    const rows: { kind: "TRENDING" | "TOP10" | "CONTINUE_WATCHING" | "MY_LIST" | "NEW_RELEASES" | "COLLECTION" | "GENRE"; title: string; genre?: string; collectionId?: string }[] = [
      { kind: "CONTINUE_WATCHING", title: "Tiếp tục xem" },
      { kind: "TRENDING", title: "Đang thịnh hành" },
      { kind: "TOP10", title: "Top 10 tại Việt Nam hôm nay" },
      { kind: "NEW_RELEASES", title: "Mới phát hành" },
      { kind: "MY_LIST", title: "Danh sách của tôi" },
      { kind: "COLLECTION", title: "Tuyển chọn của biên tập", collectionId: coll.id },
      { kind: "GENRE", title: "Phim hành động", genre: "hanh-dong" },
      { kind: "GENRE", title: "Hài hước vui nhộn", genre: "hai" },
      { kind: "GENRE", title: "Lãng mạn", genre: "lang-man" },
      { kind: "GENRE", title: "Kinh dị rùng rợn", genre: "kinh-di" },
      { kind: "GENRE", title: "Khoa học viễn tưởng", genre: "khoa-hoc-vien-tuong" },
      { kind: "GENRE", title: "Hoạt hình cho cả nhà", genre: "hoat-hinh" },
      { kind: "GENRE", title: "Phim tài liệu", genre: "tai-lieu" },
      { kind: "GENRE", title: "Chính kịch đặc sắc", genre: "chinh-kich" },
    ];
    let order = 0, rowsCreated = 0;
    for (const r of rows) {
      const gid = r.genre ? genreId.get(r.genre)! : null;
      const exists = await prisma.homeRow.findFirst({ where: { kind: r.kind, genreId: gid, collectionId: r.collectionId ?? null } });
      if (!exists) {
        await prisma.homeRow.create({ data: { kind: r.kind, title: r.title, genreId: gid, collectionId: r.collectionId ?? null, sortOrder: order } });
        rowsCreated++;
      }
      order++;
    }
    log(`home rows: ${rows.length} (mới ${rowsCreated})`);

    // 5. billboard
    for (const i of [0, 8]) {
      const titleId = ids[i]!;
      if (!(await prisma.billboard.findFirst({ where: { titleId } }))) await prisma.billboard.create({ data: { titleId, sortOrder: i } });
    }

    // 6. gắn asset từ file nguồn đã probe OK
    const attached = await attachSources(prisma, titlesSvc, queues, ids);

    // 7. xuất bản tất cả (force: seed cho phép title chưa có asset READY để UI có dữ liệu)
    let published = 0;
    for (const [i, id] of ids.entries()) {
      const t = await prisma.title.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (t.status !== "PUBLISHED") {
        await titlesSvc.publish(id, { force: true, publishedAt: new Date(Date.now() - i * 2.5 * 86_400_000) });
        published++;
      }
    }
    await invalidateCatalogCache(redis);

    const ready = await prisma.title.count({ where: { id: { in: ids }, mainAsset: { status: "READY" } } });
    const pending = await prisma.title.count({ where: { id: { in: ids }, mainAsset: { status: { in: ["QUEUED", "PROCESSING", "PENDING"] } } } });
    log(`xuất bản mới ${published}; asset mới gắn ${attached}; playable (main READY) ${ready}/${ids.length}; đang transcode ${pending}`);
  } finally {
    await app.close();
  }
}

async function ensureCredits(prisma: PrismaService, titleId: string, t: SeedTitle) {
  if (await prisma.credit.count({ where: { titleId } })) return;
  const people = [...t.cast.map((name, i) => ({ name, role: "CAST" as const, order: i })), { name: t.director, role: "DIRECTOR" as const, order: 0 }];
  for (const p of people) {
    const person = (await prisma.person.findFirst({ where: { name: p.name, tmdbId: null } })) ?? (await prisma.person.create({ data: { name: p.name } }));
    await prisma.credit.upsert({
      where: { titleId_personId_role: { titleId, personId: person.id, role: p.role } },
      create: { titleId, personId: person.id, role: p.role, sortOrder: p.order },
      update: {},
    });
  }
}

async function ensureArtwork(prisma: PrismaService, images: ImagePipelineService, titleId: string, t: SeedTitle): Promise<number> {
  const regen = process.env.SEED_REGEN_ART === "1";
  const have = regen ? new Set<string>() : new Set((await prisma.image.findMany({ where: { titleId }, select: { kind: true } })).map((i) => i.kind));
  let n = 0;
  if (!have.has("POSTER")) { await images.saveTitleImage(titleId, "POSTER", await posterPng(t.name, t.year, t.colors)); n++; }
  if (!have.has("BACKDROP")) { await images.saveTitleImage(titleId, "BACKDROP", await backdropPng(t.name, t.tagline, t.colors)); n++; }
  if (!have.has("LOGO")) { await images.saveTitleImage(titleId, "LOGO", await logoPng(t.name, t.colors[1])); n++; }
  return n;
}

async function attachSources(prisma: PrismaService, titlesSvc: AdminTitlesService, queues: MediaQueuesService, ids: string[]): Promise<number> {
  const limit = Number(process.env.SEED_ATTACH_LIMIT ?? 12);
  const waitSec = Number(process.env.SEED_WAIT_SECONDS ?? 60);
  let sources = await prisma.sourceFile.findMany({ where: { probeStatus: "OK" }, orderBy: { key: "asc" } });
  if (!sources.length) {
    const total = await prisma.sourceFile.count();
    if (!total) {
      log("chưa có SourceFile → đẩy job scan lên hàng đợi probe");
      await queues.enqueueScan();
    }
    const deadline = Date.now() + waitSec * 1000;
    while (!sources.length && Date.now() < deadline) {
      await sleep(3000);
      sources = await prisma.sourceFile.findMany({ where: { probeStatus: "OK" }, orderBy: { key: "asc" } });
    }
  }
  if (!sources.length) {
    log("không có file nguồn probe OK (worker chưa chạy?) — bỏ qua bước gắn asset; chạy lại seed sau khi worker sẵn sàng");
    return 0;
  }
  log(`file nguồn OK: ${sources.length}`);
  let attached = 0;
  // Chỉ phim lẻ, theo thứ tự seed; title đã có main asset (không FAILED) thì giữ nguyên.
  const titles = await prisma.title.findMany({
    where: { id: { in: ids }, type: "MOVIE" },
    select: { id: true, name: true, mainAsset: { select: { status: true } }, previewAssetId: true },
  });
  const byId = new Map(titles.map((t) => [t.id, t]));
  const movieIds = ids.filter((id) => byId.has(id));
  const withAsset = movieIds.filter((id) => byId.get(id)!.mainAsset && byId.get(id)!.mainAsset!.status !== "FAILED").length;
  let rr = withAsset;
  for (const id of movieIds) {
    if (rr >= limit) break;
    const t = byId.get(id)!;
    if (t.mainAsset && t.mainAsset.status !== "FAILED") continue;
    const sf = sources[rr % sources.length]!;
    await titlesSvc.attachAsset(id, { sourceFileId: sf.id, kind: "MAIN" });
    log(`  MAIN  ${t.name} ← ${sf.key}`);
    rr++;
    attached++;
  }
  // Preview cho title billboard đầu tiên: file ngắn nhất
  const first = byId.get(ids[0]!);
  if (first && !first.previewAssetId) {
    const shortest = [...sources].sort((a, b) => (a.durationSec ?? 1e9) - (b.durationSec ?? 1e9))[0]!;
    await titlesSvc.attachAsset(first.id, { sourceFileId: shortest.id, kind: "PREVIEW" });
    log(`  PREVIEW ${first.name} ← ${shortest.key}`);
    attached++;
  }
  return attached;
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("[seed:catalog] lỗi:", err);
    process.exit(1);
  },
);
