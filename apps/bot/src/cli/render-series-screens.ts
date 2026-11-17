/**
 * Renders the series screens (detail → episode picker → episode card) to tmp/screens/bot-series/ (no Telegram token):
 *   pnpm --filter @app/bot render:series [title-slug]
 * Uses the published series with the most published episodes (or the given slug). Also renders edge cases from an
 * in-memory copy: a long multi-season series (season window + paging), episodes without stills, and a series with no
 * published episodes.
 */
import { env, REPO_ROOT } from "../env.js";
import { createPrismaClient } from "@app/db";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaCatalog, type EpisodeInfo, type SeasonInfo, type TitleDetail } from "../catalog.js";
import { MemoryKV } from "../lib/kv.js";
import { S3MediaStore } from "../lib/media.js";
import { SearchStore } from "../lib/search-store.js";
import { PhotoService } from "../photos.js";
import { Screens, type Screen } from "../screens.js";

const out = join(REPO_ROOT, "tmp/screens/bot-series");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const prisma = createPrismaClient(env().databaseUrl);
const media = new S3MediaStore(env().media);
const kv = new MemoryKV();
const catalog = new PrismaCatalog(prisma);
const photos = new PhotoService(kv, media);
const screens = new Screens({ catalog, photos, searches: new SearchStore(kv), publicWebUrl: env().publicWebUrl, botUsername: env().botUsername });

function keyboardText(s: Screen): string {
  return s.keyboard.inline_keyboard
    .map((row) => row.map((b) => `[${b.text}${"callback_data" in b ? ` ⟶ ${b.callback_data}` : "web_app" in b ? ` ⟶ webapp ${decodeURIComponent(b.web_app!.url.split("to=")[1] ?? "")}` : ""}]`).join(" "))
    .join("\n");
}

async function save(name: string, s: Screen | null | undefined) {
  if (!s) throw new Error(`screen ${name} missing`);
  const buf = await s.photo.render();
  writeFileSync(join(out, `${name}.jpg`), buf);
  writeFileSync(join(out, `${name}.txt`), `${s.caption}\n\n── keyboard ──\n${keyboardText(s)}\n`);
  console.log(`${name}.jpg ${buf.length} bytes, caption ${s.caption.length} chars`);
}

try {
  const slug = process.argv[2];
  const rows = await prisma.title.findMany({
    where: { type: "SERIES", status: "PUBLISHED", ...(slug ? { slug } : {}) },
    select: { id: true, slug: true, _count: { select: { episodes: { where: { status: "PUBLISHED" } } } } },
  });
  rows.sort((a, b) => b._count.episodes - a._count.episodes);
  const pick = rows[0];
  if (!pick) throw new Error("no published series in the DB");
  let t = (await catalog.detail(pick.id))!;
  const real = t.seasons.length > 0;
  console.log(`series: ${t.slug} — ${t.seasons.length} seasons, ${t.seasons.reduce((n, s) => n + s.episodes.length, 0)} published episodes${real ? "" : " (none → synthetic episodes below)"}`);
  if (!real) {
    // no seeded episodes yet: synthesise some so the picker can still be eyeballed with real artwork
    const eps = (n: number, sn: number): EpisodeInfo[] => Array.from({ length: n }, (_, i) => ({
      id: `00000000-0000-7000-8000-${String(sn * 1000 + i + 1).padStart(12, "0")}`, episodeNumber: i + 1,
      name: i % 4 === 2 ? `Tập ${i + 1}` : ["Đêm trắng", "Người trở về", "Bí mật dưới hầm", "Lời hứa cuối cùng"][i % 4]!,
      overview: "Một đêm mưa ở phố cổ, những bí mật cũ dần lộ ra khi người con trai trở về sau mười năm biệt tăm.",
      runtimeMinutes: 42 + (i % 7), stillKey: null, playable: !(sn === 2 && i === n - 1),
    }));
    t = { ...t, playable: true, maxHeight: 1080, seasonCount: 2, seasons: [{ seasonNumber: 1, name: "Mùa 1", episodes: eps(14, 1) }, { seasonNumber: 2, name: "Hồi kết", episodes: eps(5, 2) }] };
  }
  const back = { list: { kind: "series" as const }, page: 1 };
  const s1 = t.seasons[0]!;
  await save("01-series-detail", screens.detailFor(t, back));
  await save("02-episodes-s1-p1", screens.episodesFor(t, s1, 1, back));
  if (s1.episodes.length > 12) await save("03-episodes-s1-p2", screens.episodesFor(t, s1, 2, back));
  if (t.seasons[1]) await save("04-episodes-s2", screens.episodesFor(t, t.seasons[1], 1, back));
  await save("05-episode-s1e1", screens.episodeFor(t, s1, s1.episodes[0]!, back));
  const named = s1.episodes.find((e) => e.name && !/^(tập|episode)\s*\d+$/i.test(e.name) && e !== s1.episodes[0]) ?? s1.episodes[1];
  if (named) await save("06-episode-named", screens.episodeFor(t, s1, named, back));
  const last = t.seasons.at(-1)!;
  await save("07-episode-last", screens.episodeFor(t, last, last.episodes.at(-1)!, back));
  const unplayable = t.seasons.flatMap((s) => s.episodes.map((e) => ({ s, e }))).find((x) => !x.e.playable);
  if (unplayable) await save("08-episode-unplayable", screens.episodeFor(t, unplayable.s, unplayable.e, back));

  // edge cases (in-memory)
  const many: SeasonInfo[] = Array.from({ length: 8 }, (_, i) => ({
    seasonNumber: i + 1, name: null,
    episodes: Array.from({ length: 6 + i }, (_, j) => ({ ...s1.episodes[j % s1.episodes.length]!, episodeNumber: j + 1, stillKey: null })),
  }));
  many.push({ seasonNumber: 0, name: "Specials", episodes: [{ ...s1.episodes[0]!, stillKey: null }] });
  const long: TitleDetail = { ...t, seasonCount: many.length, seasons: many };
  await save("09-many-seasons-window", screens.episodesFor(long, many[4]!, 1, back));
  await save("10-no-stills-fallback-backdrop", screens.episodesFor({ ...long, posterKey: long.posterKey }, many[7]!, 2));
  const noArt: TitleDetail = { ...long, backdropKey: null, posterKey: null, name: "Phim Bộ Không Ảnh" };
  await save("11-no-art-episode", screens.episodeFor(noArt, many[0]!, many[0]!.episodes[0]!));
  const empty: TitleDetail = { ...t, seasons: [], seasonCount: 0, playable: false, maxHeight: null };
  await save("12-series-no-episodes", screens.detailFor(empty, back));
} finally {
  await prisma.$disconnect();
  media.close();
}
