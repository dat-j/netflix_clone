import "../src/env.js";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import sharp from "sharp";
import type {
  AdminEpisode, AdminSeason, AdminTitle, ImageDto, MediaAssetDto, PlaybackSession, SeasonDto, TitleCard, TitleDetail,
} from "@app/shared";
import { encryptMediaKey, generateHlsKey, mediaLayout } from "@app/shared/media";
import { AppModule } from "../src/app.module.js";
import { ApiExceptionFilter } from "../src/common/api-exception.js";
import { env } from "../src/env.js";
import { PrismaService } from "../src/infra/prisma.service.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { MediaQueuesService } from "../src/modules/admin-content/queues.service.js";
import { TmdbClient } from "../src/modules/tmdb/tmdb.client.js";

const TAG = randomBytes(4).toString("hex");
const CDN_BASE = env("CDN_BASE_URL");
const cdnPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");
const apiPath = (url: string) => url.replace(/^\/api/, "");
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

interface Actor { userId: string; profileId: string; cookie: string }
type Layout = "muxed" | "audio-groups";

// ───────── TMDB giả (không gọi mạng) ─────────
const TMDB_ID = 900_000 + Math.floor(Math.random() * 99_999);
const tmdbState = { s1e1Name: "Khởi đầu", s1e2Overview: "Mô tả tập 2 (vi)" };
function fakeTmdbGet(path: string, params: Record<string, string | number | undefined> = {}): unknown {
  const vi = params.language === "vi-VN";
  if (path === `/tv/${TMDB_ID}`) {
    return {
      id: TMDB_ID, name: `Phim TMDB ${TAG}`, original_name: "TMDB Show", overview: "Tổng quan", first_air_date: "2020-01-01",
      episode_run_time: [45], genres: [], origin_country: ["US"], original_language: "en", vote_average: 8,
      credits: { cast: [], crew: [] }, aggregate_credits: { cast: [] }, content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-14" }] },
      images: { logos: [], posters: [], backdrops: [] }, external_ids: {},
      seasons: [
        { season_number: 0, name: "Specials", episode_count: 1 },
        { season_number: 1, name: vi ? "Mùa 1" : "Season 1", episode_count: 2 },
        { season_number: 2, name: vi ? "Mùa 2" : "Season 2", episode_count: 1 },
      ],
    };
  }
  const m = new RegExp(`^/tv/${TMDB_ID}/season/(\\d+)$`).exec(path);
  if (m) {
    const n = Number(m[1]);
    if (n === 1) {
      return {
        season_number: 1, name: vi ? "Mùa 1" : "Season 1", overview: vi ? "" : "Season one", air_date: "2020-01-01",
        episodes: [
          { episode_number: 1, name: vi ? tmdbState.s1e1Name : "The Beginning", overview: vi ? "" : "EN overview 1", air_date: "2020-01-01", runtime: 44, still_path: "/s1e1.jpg" },
          { episode_number: 2, name: vi ? "Tập 2" : "Second", overview: vi ? tmdbState.s1e2Overview : "EN overview 2", air_date: "2020-01-08", runtime: 46, still_path: "/s1e2.jpg" },
        ],
      };
    }
    if (n === 0) return { season_number: 0, name: "Specials", episodes: [{ episode_number: 1, name: "Hậu trường", still_path: null }] };
    if (n === 2) {
      return { season_number: 2, name: vi ? "Mùa 2" : "Season 2", overview: "S2", air_date: "2021-01-01", episodes: [{ episode_number: 1, name: "S2E1", overview: "x", air_date: "2021-01-01", runtime: 50, still_path: null }] };
    }
  }
  throw Object.assign(new Error(`fake TMDB: ${path}`), { status: 404 });
}

describe("series (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let http: ReturnType<typeof request>;
  let viewer: Actor;
  let kid: Actor;
  let admin: Actor;
  let planId: string;
  let stillPng: Buffer;
  const enqueued: { assetId: string; transcodeJobId: string }[] = [];
  const assetKey = generateHlsKey();
  const plainVideo = randomBytes(188 * 20);
  const plainAudio = randomBytes(188 * 7);
  const assetIds: string[] = [];
  const titleIds: string[] = [];
  const sourceIds: string[] = [];
  const bucketKeys: string[] = [];

  async function makeActor(role: "USER" | "ADMIN", opts: { isKids?: boolean; userId?: string } = {}): Promise<Actor> {
    const email = `series-${TAG}-${randomBytes(3).toString("hex")}@example.test`;
    const userId = opts.userId ?? (await prisma.user.create({ data: { email, passwordHash: "x", role } })).id;
    const profile = await prisma.profile.create({ data: { userId, name: opts.isKids ? "Bé" : "Người lớn", avatarKey: "a1", isKids: !!opts.isKids } });
    const token = jwt.sign({ sub: userId, sid: randomUUID(), role, email }, env("JWT_ACCESS_SECRET"), { algorithm: "HS256", expiresIn: "15m" });
    return { userId, profileId: profile.id, cookie: `at=${token}; pid=${profile.id}` };
  }

  const encrypt = (buf: Buffer) => {
    const c = createCipheriv("aes-128-cbc", assetKey.key, Buffer.from(assetKey.ivHex, "hex"));
    return Buffer.concat([c.update(buf), c.final()]);
  };
  const mediaPlaylist = () => [
    "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-KEY:METHOD=AES-128,URI="urn:app:hls-key",IV=0x${assetKey.ivHex}`,
    "#EXTINF:4.000,", "seg_00000.ts", "#EXTINF:4.000,", "seg_00001.ts", "#EXT-X-ENDLIST", "",
  ].join("\n");

  async function put(key: string, body: Buffer | string, type: string) {
    bucketKeys.push(key);
    await storage.putMedia(key, body, type, "no-cache");
  }

  /** Asset READY giả. `muxed` = bố cục cũ (audio trong video, AudioTrack.playlistKey null); `audio-groups` = bố cục mới. */
  async function makeReadyAsset(layout: Layout, durationSec = 600): Promise<string> {
    const a = await prisma.mediaAsset.create({ data: { kind: "MAIN", status: "PENDING" } });
    assetIds.push(a.id);
    const id = a.id;
    const enc = encryptMediaKey(assetKey.key, env("MEDIA_KEY_ENCRYPTION_SECRET"));
    const p = mediaLayout.assetPrefix(id);
    const video = [
      { name: "360p", width: 640, height: 360, kbps: 800, level: "1e" },
      { name: "720p", width: 1280, height: 720, kbps: 2800, level: "1f" },
      { name: "1080p", width: 1920, height: 1080, kbps: 5000, level: "28" },
    ];
    const audio = layout === "audio-groups"
      ? [
        { name: "audio_1_en", language: "en", label: "English", isDefault: true },
        { name: "audio_2_vi", language: "vi", label: "Tiếng Việt", isDefault: false },
      ]
      : [];
    await prisma.mediaAsset.update({
      where: { id },
      data: {
        status: "READY", durationSec, outputPrefix: p, hlsIv: assetKey.ivHex,
        encKeyCipher: enc.encKeyCipher, encKeyIv: enc.encKeyIv, encKeyTag: enc.encKeyTag, readyAt: new Date(),
        thumbsVttKey: mediaLayout.thumbsVtt(id),
        renditions: {
          create: video.map((v) => ({
            name: v.name, width: v.width, height: v.height, videoKbps: v.kbps, audioKbps: 128, codecs: `avc1.6400${v.level},mp4a.40.2`,
            playlistKey: mediaLayout.renditionPlaylist(id, v.name),
          })),
        },
        audioTracks: {
          create: layout === "audio-groups"
            ? audio.map((x) => ({ language: x.language, label: x.label, channels: 2, isDefault: x.isDefault, playlistKey: mediaLayout.renditionPlaylist(id, x.name) }))
            : [{ language: "en", label: "English", channels: 2, isDefault: true, playlistKey: null }],
        },
        subtitleTracks: {
          create: [
            { language: "vi", label: "Tiếng Việt", key: `${p}/subs/01_vi.vtt`, isDefault: true, isForced: false },
            { language: "en", label: "English (Forced)", key: `${p}/subs/02_en.vtt`, isDefault: false, isForced: true },
          ],
        },
      },
    });
    const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];
    for (const x of audio) {
      lines.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="${x.label}",LANGUAGE="${x.language}",DEFAULT=${x.isDefault ? "YES" : "NO"},AUTOSELECT=YES,CHANNELS="2",URI="${x.name}/index.m3u8"`);
    }
    for (const v of video) {
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${v.kbps * 1100},RESOLUTION=${v.width}x${v.height},CODECS="avc1.6400${v.level},mp4a.40.2",FRAME-RATE=25.000${audio.length ? ',AUDIO="aud"' : ""}`,
        `${v.name}/index.m3u8`,
      );
    }
    await put(mediaLayout.master(id), lines.join("\n") + "\n", "application/vnd.apple.mpegurl");
    for (const v of video) {
      await put(mediaLayout.renditionPlaylist(id, v.name), mediaPlaylist(), "application/vnd.apple.mpegurl");
      await put(`${p}/${v.name}/seg_00000.ts`, encrypt(plainVideo), "video/mp2t");
    }
    for (const x of audio) {
      await put(mediaLayout.renditionPlaylist(id, x.name), mediaPlaylist(), "application/vnd.apple.mpegurl");
      await put(`${p}/${x.name}/seg_00000.ts`, encrypt(plainAudio), "video/mp2t");
    }
    await put(`${p}/subs/01_vi.vtt`, "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nXin chào\n", "text/vtt");
    await put(`${p}/subs/02_en.vtt`, "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n[SIGN] Hello\n", "text/vtt");
    await put(mediaLayout.thumbsVtt(id), "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nsprite_001.jpg#xywh=0,0,160,90\n", "text/vtt");
    return id;
  }

  /**
   * Phim bộ dựng thẳng trong DB: các mùa `{ n: [layout|null, ...] }` (null = tập DRAFT không asset).
   * Trả id title + map "S{n}E{e}" → episode id.
   */
  async function makeSeries(name: string, spec: Record<number, (Layout | null)[]>, rating = "T13") {
    const t = await prisma.title.create({
      data: { type: "SERIES", name, slug: `series-${TAG}-${randomBytes(3).toString("hex")}`, status: "PUBLISHED", publishedAt: new Date(), maturityRating: rating },
    });
    titleIds.push(t.id);
    const ep: Record<string, string> = {};
    for (const [n, eps] of Object.entries(spec)) {
      const season = await prisma.season.create({ data: { titleId: t.id, seasonNumber: Number(n), name: `Mùa ${n}` } });
      for (const [i, layout] of eps.entries()) {
        const assetId = layout ? await makeReadyAsset(layout) : null;
        const e = await prisma.episode.create({
          data: {
            titleId: t.id, seasonId: season.id, episodeNumber: i + 1, name: `Tập ${i + 1}`, runtimeMinutes: 10,
            status: layout ? "PUBLISHED" : "DRAFT", mainAssetId: assetId,
            ...(i === 0 ? { introStartSec: 5, introEndSec: 60, creditsStartSec: 560 } : {}),
          },
        });
        ep[`S${n}E${i + 1}`] = e.id;
      }
    }
    return { titleId: t.id, ep };
  }

  async function play(actor: Actor, titleId: string, episodeId?: string): Promise<PlaybackSession> {
    return (await http.post("/v1/playback/sessions").set("Cookie", actor.cookie).send({ titleId, ...(episodeId ? { episodeId } : {}) }).expect(201)).body as PlaybackSession;
  }
  async function watch(actor: Actor, s: PlaybackSession, positionSec: number) {
    await http.post(`/v1/playback/sessions/${s.sessionId}/heartbeat`).set("Cookie", actor.cookie).send({ positionSec, durationSec: 600 }).expect(204);
    await http.delete(`/v1/playback/sessions/${s.sessionId}`).set("Cookie", actor.cookie).expect(204);
  }

  beforeAll(async () => {
    const fakeQueues = {
      enqueueTranscode: async (data: { assetId: string; transcodeJobId: string }, jobId: string) => {
        enqueued.push(data);
        return jobId;
      },
      enqueueScan: async () => undefined,
      onModuleDestroy: async () => undefined,
    };
    const fakeTmdb = {
      apiKey: "fake", enabled: true, assertEnabled: () => undefined,
      get: async (path: string, params?: Record<string, string | number | undefined>) => fakeTmdbGet(path, params),
      download: async () => stillPng,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MediaQueuesService).useValue(fakeQueues)
      .overrideProvider(TmdbClient).useValue(fakeTmdb)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.use(cookieParser());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    stillPng = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#225588" } }).png().toBuffer();

    planId = (await prisma.plan.create({
      data: { code: `series-test-${TAG}`, name: "Test", priceAmount: 0, maxHeight: 720, maxConcurrentStreams: 3 },
    })).id;
    viewer = await makeActor("USER");
    kid = await makeActor("USER", { isKids: true, userId: viewer.userId });
    kid.cookie = `${viewer.cookie.split(";")[0]}; pid=${kid.profileId}`;
    admin = await makeActor("ADMIN");
    await prisma.subscription.create({
      data: { userId: viewer.userId, planId, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });
  }, 60_000);

  afterAll(async () => {
    if (storage) await Promise.allSettled(bucketKeys.map((k) => storage.deleteMedia(k)));
    if (prisma) {
      const imgs = await prisma.image.findMany({ where: { OR: [{ titleId: { in: titleIds } }, { episode: { titleId: { in: titleIds } } }] }, select: { key: true } });
      await Promise.allSettled(imgs.map((i) => storage.deleteMedia(i.key)));
      await prisma.title.deleteMany({ where: { id: { in: titleIds } } });
      const extra = await prisma.mediaAsset.findMany({ where: { sourceFileId: { in: sourceIds } }, select: { id: true } });
      await prisma.mediaAsset.deleteMany({ where: { id: { in: [...assetIds, ...extra.map((x) => x.id)] } } });
      await prisma.sourceFile.deleteMany({ where: { id: { in: sourceIds } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `series-${TAG}-` } } });
      await prisma.plan.deleteMany({ where: { id: planId } });
    }
    await app?.close();
  });

  // ───────── admin ─────────
  describe("admin: mùa/tập", () => {
    let titleId: string;
    let s1: AdminSeason;
    let eps: AdminEpisode[];

    it("CRUD mùa: tạo, trùng số → 409, title phim lẻ → 409, PATCH khóa trường", async () => {
      const t = (await http.post("/v1/admin/titles").set("Cookie", admin.cookie).send({ type: "SERIES", name: `Bộ Admin ${TAG}`, maturityRating: "T13" }).expect(201)).body as AdminTitle;
      titleId = t.id;
      titleIds.push(t.id);
      expect(t).toMatchObject({ seasonCount: 0, episodeCount: 0, publishedEpisodeCount: 0 });
      s1 = (await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: 1, name: "Mùa 1", airDate: "2024-01-02" }).expect(201)).body;
      expect(s1).toMatchObject({ titleId, seasonNumber: 1, name: "Mùa 1", overview: null, airDate: "2024-01-02", episodes: [] });
      const dup = await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: 1 }).expect(409);
      expect(dup.body.code).toBe("CONFLICT");
      await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: -1 }).expect(400);
      await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({}).expect(400);
      const s2 = (await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: 2 }).expect(201)).body as AdminSeason;
      await http.patch(`/v1/admin/seasons/${s2.id}`).set("Cookie", admin.cookie).send({ seasonNumber: 1 }).expect(409);
      const p = (await http.patch(`/v1/admin/seasons/${s2.id}`).set("Cookie", admin.cookie).send({ seasonNumber: 3, overview: "Mô tả" }).expect(200)).body as AdminSeason;
      expect(p).toMatchObject({ seasonNumber: 3, overview: "Mô tả" });
      expect((await prisma.season.findUniqueOrThrow({ where: { id: s2.id } })).overriddenFields).toEqual(["overview"]);
      const movie = (await http.post("/v1/admin/titles").set("Cookie", admin.cookie).send({ type: "MOVIE", name: `Lẻ ${TAG}` }).expect(201)).body as AdminTitle;
      titleIds.push(movie.id);
      await http.post(`/v1/admin/titles/${movie.id}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: 1 }).expect(409);
      await http.get(`/v1/admin/titles/${randomUUID()}/seasons`).set("Cookie", admin.cookie).expect(404);
      await http.patch(`/v1/admin/seasons/not-a-uuid`).set("Cookie", admin.cookie).send({}).expect(404);
      await http.delete(`/v1/admin/seasons/${s2.id}`).set("Cookie", admin.cookie).expect(204);
      await http.get(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", viewer.cookie).expect(403);
    });

    it("tập: bulk, trùng số → 409, markers, PATCH ghi overriddenFields", async () => {
      eps = (await http.post(`/v1/admin/seasons/${s1.id}/episodes/bulk`).set("Cookie", admin.cookie).send({ count: 3 }).expect(201)).body;
      expect(eps.map((e) => e.episodeNumber)).toEqual([1, 2, 3]);
      expect(eps[0]).toMatchObject({ seasonId: s1.id, seasonNumber: 1, status: "DRAFT", name: null, still: null, mainAsset: null });
      const clash = await http.post(`/v1/admin/seasons/${s1.id}/episodes/bulk`).set("Cookie", admin.cookie).send({ count: 2, startAt: 3 }).expect(409);
      expect(clash.body.details).toEqual({ episodeNumbers: [3] });
      const more = (await http.post(`/v1/admin/seasons/${s1.id}/episodes/bulk`).set("Cookie", admin.cookie).send({ count: 1 }).expect(201)).body as AdminEpisode[];
      expect(more[0]!.episodeNumber).toBe(4);
      await http.post(`/v1/admin/seasons/${s1.id}/episodes/bulk`).set("Cookie", admin.cookie).send({ count: 0 }).expect(400);
      await http.post(`/v1/admin/seasons/${s1.id}/episodes`).set("Cookie", admin.cookie).send({ episodeNumber: 2 }).expect(409);
      await http.post(`/v1/admin/seasons/${s1.id}/episodes`).set("Cookie", admin.cookie).send({ episodeNumber: 9, introStartSec: 30, introEndSec: 10 }).expect(400);
      await http.post(`/v1/admin/seasons/${s1.id}/episodes`).set("Cookie", admin.cookie).send({ episodeNumber: 9, introStartSec: 30 }).expect(400);
      const e9 = (await http.post(`/v1/admin/seasons/${s1.id}/episodes`).set("Cookie", admin.cookie)
        .send({ episodeNumber: 9, name: "Chín", introStartSec: 0, introEndSec: 50, creditsStartSec: 1200, airDate: "2024-02-01" }).expect(201)).body as AdminEpisode;
      expect(e9).toMatchObject({ episodeNumber: 9, name: "Chín", introStartSec: 0, introEndSec: 50, creditsStartSec: 1200, airDate: "2024-02-01" });
      await http.patch(`/v1/admin/episodes/${e9.id}`).set("Cookie", admin.cookie).send({ episodeNumber: 1 }).expect(409);
      await http.patch(`/v1/admin/episodes/${e9.id}`).set("Cookie", admin.cookie).send({ creditsStartSec: 10 }).expect(400); // trước introEnd
      const patched = (await http.patch(`/v1/admin/episodes/${eps[0]!.id}`).set("Cookie", admin.cookie)
        .send({ name: "Phi công", runtimeMinutes: 42, introStartSec: 3, introEndSec: 63 }).expect(200)).body as AdminEpisode;
      expect(patched).toMatchObject({ name: "Phi công", runtimeMinutes: 42, introStartSec: 3, introEndSec: 63, creditsStartSec: null });
      expect((await prisma.episode.findUniqueOrThrow({ where: { id: eps[0]!.id } })).overriddenFields.sort()).toEqual(["name", "runtimeMinutes"]);
      await http.delete(`/v1/admin/episodes/${e9.id}`).set("Cookie", admin.cookie).expect(204);
      await http.delete(`/v1/admin/episodes/${more[0]!.id}`).set("Cookie", admin.cookie).expect(204);
      const list = (await http.get(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).expect(200)).body as AdminSeason[];
      expect(list.map((s) => [s.seasonNumber, s.episodes.map((e) => e.episodeNumber)])).toEqual([[1, [1, 2, 3]]]);
    });

    it("gắn file nguồn → asset + job + enqueue; publish cần READY; luật publish phim bộ", async () => {
      const sf = await prisma.sourceFile.create({
        data: { bucket: "source", key: `test/${TAG}/ep1.mkv`, sizeBytes: 1000n, probeStatus: "OK", durationSec: 600 },
      });
      sourceIds.push(sf.id);
      const before = enqueued.length;
      const asset = (await http.post(`/v1/admin/episodes/${eps[0]!.id}/assets`).set("Cookie", admin.cookie).send({ sourceFileId: sf.id }).expect(201)).body as MediaAssetDto;
      expect(asset).toMatchObject({ kind: "MAIN", status: "QUEUED", sourceKey: sf.key });
      expect(asset.latestJob).toMatchObject({ status: "QUEUED", titleName: `Bộ Admin ${TAG} — S1E1` });
      expect(enqueued.slice(before)).toEqual([{ assetId: asset.id, transcodeJobId: asset.latestJob!.id }]);
      await http.post(`/v1/admin/episodes/${eps[0]!.id}/assets`).set("Cookie", admin.cookie).send({ sourceFileId: randomUUID() }).expect(404);
      await http.post(`/v1/admin/episodes/${eps[0]!.id}/assets`).set("Cookie", admin.cookie).send({}).expect(400);

      // chưa READY → không publish được tập, title bộ chưa có tập → không publish được
      expect((await http.post(`/v1/admin/episodes/${eps[0]!.id}/publish`).set("Cookie", admin.cookie).expect(409)).body.code).toBe("CONFLICT");
      expect((await http.post(`/v1/admin/titles/${titleId}/publish`).set("Cookie", admin.cookie).expect(409)).body.message).toContain("tập");

      // giả lập worker xong: tập 1 + tập 2 READY
      const ready1 = await makeReadyAsset("muxed");
      const ready2 = await makeReadyAsset("audio-groups");
      await prisma.episode.update({ where: { id: eps[0]!.id }, data: { mainAssetId: ready1 } });
      await prisma.episode.update({ where: { id: eps[1]!.id }, data: { mainAssetId: ready2 } });
      const pub = (await http.post(`/v1/admin/episodes/${eps[0]!.id}/publish`).set("Cookie", admin.cookie).expect(200)).body as AdminEpisode;
      expect(pub).toMatchObject({ status: "PUBLISHED", mainAsset: { status: "READY" } });
      const t = (await http.post(`/v1/admin/titles/${titleId}/publish`).set("Cookie", admin.cookie).expect(200)).body as AdminTitle;
      expect(t).toMatchObject({ status: "PUBLISHED", mainAsset: null, seasonCount: 1, episodeCount: 3, publishedEpisodeCount: 1 });

      // publish-ready: chỉ tập 2 (READY, chưa publish); tập 3 không có asset
      const batch = (await http.post(`/v1/admin/seasons/${s1.id}/publish-ready`).set("Cookie", admin.cookie).expect(200)).body as AdminEpisode[];
      expect(batch.map((e) => e.episodeNumber)).toEqual([2]);
      expect((await http.post(`/v1/admin/seasons/${s1.id}/publish-ready`).set("Cookie", admin.cookie).expect(200)).body).toEqual([]);
      const listed = (await http.get(`/v1/admin/titles?type=SERIES&q=${encodeURIComponent(`Bộ Admin ${TAG}`)}`).set("Cookie", admin.cookie).expect(200)).body.items as AdminTitle[];
      expect(listed[0]).toMatchObject({ id: titleId, seasonCount: 1, episodeCount: 3, publishedEpisodeCount: 2 });

      // xóa: mùa còn tập publish → 409; tập publish → 409
      expect((await http.delete(`/v1/admin/seasons/${s1.id}`).set("Cookie", admin.cookie).expect(409)).body.details).toEqual({ publishedEpisodes: 2 });
      await http.delete(`/v1/admin/episodes/${eps[0]!.id}`).set("Cookie", admin.cookie).expect(409);
      // gỡ tập: được khi còn tập khác; tập cuối của title đang publish → 409
      expect((await http.post(`/v1/admin/episodes/${eps[1]!.id}/unpublish`).set("Cookie", admin.cookie).expect(200)).body.status).toBe("DRAFT");
      await http.post(`/v1/admin/episodes/${eps[0]!.id}/unpublish`).set("Cookie", admin.cookie).expect(409);
      await http.post(`/v1/admin/titles/${titleId}/unpublish`).set("Cookie", admin.cookie).expect(200);
      await http.post(`/v1/admin/episodes/${eps[0]!.id}/unpublish`).set("Cookie", admin.cookie).expect(200);
      await http.delete(`/v1/admin/seasons/${s1.id}`).set("Cookie", admin.cookie).expect(204);
      expect((await http.get(`/v1/admin/titles/${titleId}`).set("Cookie", admin.cookie).expect(200)).body).toMatchObject({ seasonCount: 0, episodeCount: 0 });
    });

    it("ảnh still của tập: chỉ kind=STILL, thay ảnh cũ, hiện trên AdminEpisode", async () => {
      const s = (await http.post(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).send({ seasonNumber: 1 }).expect(201)).body as AdminSeason;
      const [e] = (await http.post(`/v1/admin/seasons/${s.id}/episodes/bulk`).set("Cookie", admin.cookie).send({ count: 1 }).expect(201)).body as AdminEpisode[];
      const img = (await http.post(`/v1/admin/episodes/${e!.id}/images`).set("Cookie", admin.cookie)
        .field("kind", "STILL").attach("file", stillPng, { filename: "s.png", contentType: "image/png" }).expect(201)).body as ImageDto;
      expect(img).toMatchObject({ kind: "STILL", width: 1280, height: 720, isPrimary: true });
      expect((await http.get(cdnPath(img.url)).expect(200)).headers["content-type"]).toBe("image/webp");
      const img2 = (await http.post(`/v1/admin/episodes/${e!.id}/images`).set("Cookie", admin.cookie)
        .attach("file", stillPng, { filename: "s.png", contentType: "image/png" }).expect(201)).body as ImageDto;
      await http.post(`/v1/admin/episodes/${e!.id}/images`).set("Cookie", admin.cookie)
        .field("kind", "POSTER").attach("file", stillPng, { filename: "s.png", contentType: "image/png" }).expect(400);
      await http.post(`/v1/admin/episodes/${e!.id}/images`).set("Cookie", admin.cookie).field("kind", "STILL").expect(400);
      const seasons = (await http.get(`/v1/admin/titles/${titleId}/seasons`).set("Cookie", admin.cookie).expect(200)).body as AdminSeason[];
      expect(seasons[0]!.episodes[0]!.still?.id).toBe(img2.id);
      expect(await prisma.image.count({ where: { episodeId: e!.id } })).toBe(1);
      // ảnh tập không lẫn vào ảnh của title
      expect(((await http.get(`/v1/admin/titles/${titleId}`).set("Cookie", admin.cookie).expect(200)).body as AdminTitle).images).toEqual([]);
    });
  });

  // ───────── TMDB ─────────
  describe("TMDB mùa/tập (client giả)", () => {
    it("import phim bộ tạo luôn mùa/tập + still; sync không ghi đè trường admin đã sửa", async () => {
      const t = (await http.post("/v1/admin/titles/import-tmdb").set("Cookie", admin.cookie).send({ tmdbId: TMDB_ID, type: "SERIES" }).expect(201)).body as AdminTitle;
      titleIds.push(t.id);
      expect(t).toMatchObject({ type: "SERIES", tmdbId: TMDB_ID, seasonCount: 2, episodeCount: 3 }); // mùa 0 bị bỏ qua mặc định
      let seasons = (await http.get(`/v1/admin/titles/${t.id}/seasons`).set("Cookie", admin.cookie).expect(200)).body as AdminSeason[];
      expect(seasons.map((s) => [s.seasonNumber, s.name, s.overview])).toEqual([[1, "Mùa 1", "Season one"], [2, "Mùa 2", "S2"]]);
      const [e1, e2] = seasons[0]!.episodes;
      // vi trống → fallback en; tên "Tập 2" mặc định của TMDB → dùng tên en
      expect(e1).toMatchObject({ episodeNumber: 1, name: "Khởi đầu", overview: "EN overview 1", airDate: "2020-01-01", runtimeMinutes: 44, status: "DRAFT" });
      expect(e2).toMatchObject({ episodeNumber: 2, name: "Second", overview: "Mô tả tập 2 (vi)", runtimeMinutes: 46 });
      expect(e1!.still).toMatchObject({ kind: "STILL", width: 1280, height: 720 });
      expect(seasons[1]!.episodes[0]!.still).toBeNull();

      // admin sửa tên tập 1 + mô tả mùa 1; TMDB đổi dữ liệu → sync giữ bản sửa tay, cập nhật phần còn lại
      await http.patch(`/v1/admin/episodes/${e1!.id}`).set("Cookie", admin.cookie).send({ name: "Tên sửa tay" }).expect(200);
      await http.patch(`/v1/admin/seasons/${seasons[0]!.id}`).set("Cookie", admin.cookie).send({ overview: "Mùa sửa tay" }).expect(200);
      tmdbState.s1e1Name = "Tên TMDB mới";
      tmdbState.s1e2Overview = "Mô tả TMDB mới";
      const stillId = e1!.still!.id;
      seasons = (await http.post(`/v1/admin/titles/${t.id}/sync-tmdb-seasons`).set("Cookie", admin.cookie).send({ seasonNumbers: [1, 0] }).expect(200)).body as AdminSeason[];
      expect(seasons.map((s) => s.seasonNumber)).toEqual([0, 1, 2]); // mùa 0 chỉ khi yêu cầu rõ
      const s1 = seasons.find((s) => s.seasonNumber === 1)!;
      expect(s1.overview).toBe("Mùa sửa tay");
      expect(s1.episodes[0]).toMatchObject({ name: "Tên sửa tay" });
      expect(s1.episodes[1]).toMatchObject({ overview: "Mô tả TMDB mới" });
      expect(s1.episodes[0]!.still!.id).toBe(stillId); // still có sẵn không bị tải lại
      // overriddenFields: [] → TMDB được ghi đè lại
      await http.patch(`/v1/admin/episodes/${e1!.id}`).set("Cookie", admin.cookie).send({ overriddenFields: [] }).expect(200);
      seasons = (await http.post(`/v1/admin/titles/${t.id}/sync-tmdb-seasons`).set("Cookie", admin.cookie).send({}).expect(200)).body as AdminSeason[];
      expect(seasons.find((s) => s.seasonNumber === 1)!.episodes[0]!.name).toBe("Tên TMDB mới");

      const movie = (await http.post("/v1/admin/titles").set("Cookie", admin.cookie).send({ type: "MOVIE", name: `Lẻ TMDB ${TAG}` }).expect(201)).body as AdminTitle;
      titleIds.push(movie.id);
      await http.post(`/v1/admin/titles/${movie.id}/sync-tmdb-seasons`).set("Cookie", admin.cookie).send({}).expect(409);
      await http.post(`/v1/admin/titles/${t.id}/sync-tmdb-seasons`).set("Cookie", admin.cookie).send({ seasonNumbers: "x" }).expect(400);
    });
  });

  // ───────── catalog + playback ─────────
  describe("xem phim bộ", () => {
    let titleId: string;
    let ep: Record<string, string>;

    beforeAll(async () => {
      // S1: E1 (bố cục cũ), E2 (mới), E3 (cũ), E4 DRAFT · S2: E1 (mới), E2 (cũ) · S3: chỉ tập DRAFT → ẩn
      ({ titleId, ep } = await makeSeries(`Phố Đêm ${TAG}`, { 1: ["muxed", "audio-groups", "muxed", null], 2: ["audio-groups", "muxed"], 3: [null] }, "T16"));
    }, 60_000);

    it("chi tiết: mùa hiển thị, tập xem tiếp, số đếm, chỉ tập PUBLISHED", async () => {
      const d = (await http.get(`/v1/titles/${titleId}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d).toMatchObject({ type: "SERIES", playable: true, seasonCount: 2, episodeCount: 5, maxAvailableHeight: 1080, progress: null });
      expect(d.resumeEpisode).toMatchObject({ id: ep.S1E1, seasonNumber: 1, episodeNumber: 1, name: "Tập 1", runtimeMinutes: 10, still: null });
      expect(d.seasons.map((s) => [s.seasonNumber, s.episodeCount, s.episodes.length])).toEqual([[1, 3, 3], [2, 2, 0]]);
      expect(d.seasons[0]!.episodes[0]).toMatchObject({ id: ep.S1E1, seasonNumber: 1, playable: true, progress: null, airDate: null });
      const s2 = (await http.get(`/v1/titles/${titleId}/episodes?season=2`).set("Cookie", viewer.cookie).expect(200)).body as SeasonDto;
      expect(s2).toMatchObject({ seasonNumber: 2, episodeCount: 2 });
      expect(s2.episodes.map((e) => e.id)).toEqual([ep.S2E1, ep.S2E2]);
      await http.get(`/v1/titles/${titleId}/episodes?season=3`).set("Cookie", viewer.cookie).expect(404);
      await http.get(`/v1/titles/${titleId}/episodes?season=x`).set("Cookie", viewer.cookie).expect(400);
      expect(((await http.get(`/v1/titles/${titleId}/episodes`).set("Cookie", viewer.cookie).expect(200)).body as SeasonDto).seasonNumber).toBe(1);
      // hồ sơ trẻ em: lọc như cũ (T16)
      await http.get(`/v1/titles/${titleId}`).set("Cookie", kid.cookie).expect(404);
      await http.get(`/v1/titles/${titleId}/episodes?season=1`).set("Cookie", kid.cookie).expect(404);
      await http.post("/v1/playback/sessions").set("Cookie", kid.cookie).send({ titleId }).expect(404);
    });

    it("phát không episodeId → S1E1, markers, nextEpisode, track (bố cục cũ: không audioTracks)", async () => {
      const s = await play(viewer, titleId);
      expect(s.episode).toEqual({ id: ep.S1E1, seasonNumber: 1, episodeNumber: 1, name: "Tập 1" });
      expect(s.markers).toEqual({ introStartSec: 5, introEndSec: 60, creditsStartSec: 560 });
      expect(s.nextEpisode).toMatchObject({ id: ep.S1E2, seasonNumber: 1, episodeNumber: 2 });
      expect(s.audioTracks).toEqual([]);
      expect(s.subtitles.map((x) => [x.language, x.label, x.isDefault, x.isForced])).toEqual([["vi", "Tiếng Việt", true, false], ["en", "English (Forced)", false, true]]);
      for (const sub of s.subtitles) {
        expect(sub.url.startsWith(`${CDN_BASE}/s/`)).toBe(true);
        const vtt = await http.get(cdnPath(sub.url)).expect(200);
        expect(vtt.text.startsWith("WEBVTT")).toBe(true);
      }
      const master = await http.get(apiPath(s.manifestUrl)).set("Cookie", viewer.cookie).expect(200);
      expect(master.text).not.toContain("EXT-X-MEDIA");
      expect(master.text).toContain("r/720p/index.m3u8");
      expect(master.text).not.toContain("1080p");
      await watch(viewer, s, 200);
      // tập dở dang → thẻ xem tiếp mang tiến độ của tập; phát lại tiếp đúng vị trí
      const cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw[0]).toMatchObject({ id: titleId, type: "SERIES", progress: { episodeId: ep.S1E1, positionSec: 200, completed: false } });
      const again = await play(viewer, titleId);
      expect(again).toMatchObject({ episode: { id: ep.S1E1 }, resumePositionSec: 200 });
      await http.delete(`/v1/playback/sessions/${again.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      // tập không tồn tại / DRAFT → 404
      await http.post("/v1/playback/sessions").set("Cookie", viewer.cookie).send({ titleId, episodeId: ep.S1E4 }).expect(404);
      await http.post("/v1/playback/sessions").set("Cookie", viewer.cookie).send({ titleId, episodeId: randomUUID() }).expect(404);
    });

    it("bố cục mới: master có nhóm AUDIO, playlist audio qua proxy, segment audio ký CDN + giải mã được", async () => {
      const s = await play(viewer, titleId, ep.S1E2);
      expect(s.markers).toEqual({ introStartSec: null, introEndSec: null, creditsStartSec: null });
      expect(s.audioTracks.map((a) => [a.language, a.label, a.channels, a.isDefault])).toEqual([["en", "English", 2, true], ["vi", "Tiếng Việt", 2, false]]);
      const master = (await http.get(apiPath(s.manifestUrl)).set("Cookie", viewer.cookie).expect(200)).text;
      expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="r/audio_1_en/index.m3u8"');
      expect(master).toContain('URI="r/audio_2_vi/index.m3u8"');
      expect(master).toMatch(/#EXT-X-STREAM-INF:[^\n]*RESOLUTION=1280x720[^\n]*AUDIO="aud"\nr\/720p\/index\.m3u8/);
      expect(master).not.toContain("1080p");
      const base = apiPath(s.manifestUrl).replace(/master\.m3u8$/, "");
      const audioPl = (await http.get(`${base}r/audio_2_vi/index.m3u8`).set("Cookie", viewer.cookie).expect(200)).text;
      expect(audioPl).toContain(`URI="/api/v1/playback/sessions/${s.sessionId}/key"`);
      const segUrl = audioPl.split("\n").find((l) => l.startsWith("http"))!;
      expect(segUrl).toMatch(new RegExp(`^${CDN_BASE}/s/[^/]+/\\d+/hls/[0-9a-f-]+/audio_2_vi/seg_00000\\.ts$`));
      const key = (await http.get(`${base}key`).set("Cookie", viewer.cookie).buffer(true).parse(binary).expect(200)).body as Buffer;
      const seg = (await http.get(cdnPath(segUrl)).buffer(true).parse(binary).expect(200)).body as Buffer;
      const d = createDecipheriv("aes-128-cbc", key, Buffer.from(assetKey.ivHex, "hex"));
      expect(Buffer.compare(Buffer.concat([d.update(seg), d.final()]), plainAudio)).toBe(0);
      await http.get(`${base}r/audio_9_xx/index.m3u8`).set("Cookie", viewer.cookie).expect(403);
      await http.get(`${base}r/1080p/index.m3u8`).set("Cookie", viewer.cookie).expect(403);
      await http.delete(`/v1/playback/sessions/${s.sessionId}`).set("Cookie", viewer.cookie).expect(204);
    });

    it("xem xong tập cuối mùa 1 → nextEpisode/xem tiếp/resume sang S2E1; hết phim → rời xem tiếp", async () => {
      const s13 = await play(viewer, titleId, ep.S1E3);
      expect(s13.nextEpisode).toMatchObject({ id: ep.S2E1, seasonNumber: 2, episodeNumber: 1 }); // qua ranh giới mùa
      await watch(viewer, s13, 590); // ≥95% → completed
      let cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw[0]).toMatchObject({ id: titleId, progress: { episodeId: ep.S2E1, positionSec: 0, completed: false } });
      const d = (await http.get(`/v1/titles/${titleId}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d.resumeEpisode?.id).toBe(ep.S2E1);
      expect(d.progress?.episodeId).toBe(ep.S2E1);
      expect(d.seasons.map((x) => x.episodes.length)).toEqual([0, 2]); // mùa đang xem có đủ tập
      expect(d.seasons[1]!.episodes[0]!.progress).toBeNull();
      const s21 = await play(viewer, titleId);
      expect(s21).toMatchObject({ episode: { id: ep.S2E1 }, resumePositionSec: 0, nextEpisode: { id: ep.S2E2 } });
      expect(s21.audioTracks).toHaveLength(2);
      await watch(viewer, s21, 120);
      cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw.filter((c) => c.id === titleId)).toHaveLength(1); // một thẻ cho cả bộ
      expect(cw[0]).toMatchObject({ id: titleId, progress: { episodeId: ep.S2E1, positionSec: 120 } });
      const ep2 = (await http.get(`/v1/titles/${titleId}/episodes?season=2`).set("Cookie", viewer.cookie).expect(200)).body as SeasonDto;
      expect(ep2.episodes[0]!.progress).toMatchObject({ positionSec: 120, completed: false });

      const last = await play(viewer, titleId, ep.S2E2);
      expect(last.nextEpisode).toBeNull();
      await watch(viewer, last, 599);
      cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw.map((c) => c.id)).not.toContain(titleId);
      const restart = await play(viewer, titleId);
      expect(restart.episode?.id).toBe(ep.S1E1); // đã xem hết → từ đầu
      await http.delete(`/v1/playback/sessions/${restart.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      await http.delete(`/v1/continue-watching/${titleId}`).set("Cookie", viewer.cookie).expect(204);
    });

    it("tập dở của tập kế được giữ khi xem lại tập trước", async () => {
      const a = await play(viewer, titleId, ep.S1E2);
      await watch(viewer, a, 300);
      const b = await play(viewer, titleId, ep.S1E1);
      await watch(viewer, b, 595);
      const cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw[0]).toMatchObject({ id: titleId, progress: { episodeId: ep.S1E2, positionSec: 300 } });
      const s = await play(viewer, titleId);
      expect(s).toMatchObject({ episode: { id: ep.S1E2 }, resumePositionSec: 300 });
      await http.delete(`/v1/playback/sessions/${s.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      await http.delete(`/v1/continue-watching/${titleId}`).set("Cookie", viewer.cookie).expect(204);
    });

    it("phim bộ cũ chỉ có asset của title (không có tập) vẫn phát như trước", async () => {
      const assetId = await makeReadyAsset("muxed");
      const t = await prisma.title.create({
        data: { type: "SERIES", name: `Bộ cũ ${TAG}`, slug: `bo-cu-${TAG}`, status: "PUBLISHED", publishedAt: new Date(), maturityRating: "T13", mainAssetId: assetId },
      });
      titleIds.push(t.id);
      const s = await play(viewer, t.id);
      expect(s).toMatchObject({ episode: null, nextEpisode: null, audioTracks: [], markers: { introStartSec: null, introEndSec: null, creditsStartSec: null } });
      await http.delete(`/v1/playback/sessions/${s.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      const d = (await http.get(`/v1/titles/${t.id}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d).toMatchObject({ playable: true, seasons: [], resumeEpisode: null, seasonCount: 0, episodeCount: 0 });
    });
  });
});
