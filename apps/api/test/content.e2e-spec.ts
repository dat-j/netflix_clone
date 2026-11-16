import "../src/env.js";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { HomeResponse, Paginated, PlaybackSession, TitleCard, TitleDetail, AdminTitle } from "@app/shared";
import { encryptMediaKey, generateHlsKey, mediaLayout, signCdnPrefix } from "@app/shared/media";
import { AppModule } from "../src/app.module.js";
import { ApiExceptionFilter } from "../src/common/api-exception.js";
import { env } from "../src/env.js";
import { PrismaService } from "../src/infra/prisma.service.js";
import { StorageService } from "../src/modules/storage/storage.service.js";
import { rewriteMaster, rewriteRendition } from "../src/modules/playback/playlist.js";
import { slugify } from "../src/modules/admin-content/slug.js";

const TAG = randomBytes(4).toString("hex");
const CDN_BASE = env("CDN_BASE_URL");
const cdnPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, "");
/** URL công khai `/api/v1/...` → đường dẫn gọi thẳng API `/v1/...` */
const apiPath = (url: string) => url.replace(/^\/api/, "");

interface Actor { userId: string; profileId: string; cookie: string }

describe("content (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let http: ReturnType<typeof request>;

  let viewer: Actor; // có thuê bao (1 luồng, tối đa 720p)
  let kid: Actor; // hồ sơ trẻ em cùng user viewer
  let freeUser: Actor; // không thuê bao
  let admin: Actor;
  let planId: string;
  let genreId: string;
  let playableId: string; // title có asset READY (fake HLS)
  let adultId: string; // title T18
  const assetKey = generateHlsKey();
  const plainSegment = randomBytes(188 * 20);
  const assetIds: string[] = [];
  const titleIds: string[] = [];
  const bucketKeys: string[] = [];

  async function makeActor(role: "USER" | "ADMIN", opts: { isKids?: boolean; userId?: string } = {}): Promise<Actor> {
    const email = `content-${TAG}-${randomBytes(3).toString("hex")}@example.test`;
    const userId = opts.userId ?? (await prisma.user.create({ data: { email, passwordHash: "x", role } })).id;
    const profile = await prisma.profile.create({ data: { userId, name: opts.isKids ? "Bé" : "Người lớn", avatarKey: "a1", isKids: !!opts.isKids } });
    const token = jwt.sign({ sub: userId, sid: randomUUID(), role, email }, env("JWT_ACCESS_SECRET"), { algorithm: "HS256", expiresIn: "15m" });
    return { userId, profileId: profile.id, cookie: `at=${token}; pid=${profile.id}` };
  }

  async function putFakeAsset(assetId: string) {
    const enc = encryptMediaKey(assetKey.key, env("MEDIA_KEY_ENCRYPTION_SECRET"));
    await prisma.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: "READY", durationSec: 600, outputPrefix: mediaLayout.assetPrefix(assetId), hlsIv: assetKey.ivHex,
        encKeyCipher: enc.encKeyCipher, encKeyIv: enc.encKeyIv, encKeyTag: enc.encKeyTag,
        thumbsVttKey: mediaLayout.thumbsVtt(assetId), readyAt: new Date(),
        renditions: {
          create: [
            { name: "360p", width: 640, height: 360, videoKbps: 800, audioKbps: 96, codecs: "avc1.4d401e,mp4a.40.2", playlistKey: mediaLayout.renditionPlaylist(assetId, "360p") },
            { name: "720p", width: 1280, height: 720, videoKbps: 2800, audioKbps: 128, codecs: "avc1.4d401f,mp4a.40.2", playlistKey: mediaLayout.renditionPlaylist(assetId, "720p") },
            { name: "1080p", width: 1920, height: 1080, videoKbps: 5000, audioKbps: 192, codecs: "avc1.640028,mp4a.40.2", playlistKey: mediaLayout.renditionPlaylist(assetId, "1080p") },
          ],
        },
      },
    });
    const master = [
      "#EXTM3U", "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"', "360p/index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"', "720p/index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"', "1080p/index.m3u8", "",
    ].join("\n");
    const rendition = () => [
      "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD",
      `#EXT-X-KEY:METHOD=AES-128,URI="urn:app:hls-key",IV=0x${assetKey.ivHex}`,
      "#EXTINF:4.000,", "seg_00000.ts", "#EXTINF:4.000,", "seg_00001.ts", "#EXT-X-ENDLIST", "",
    ].join("\n");
    const cipher = createCipheriv("aes-128-cbc", assetKey.key, Buffer.from(assetKey.ivHex, "hex"));
    const encSeg = Buffer.concat([cipher.update(plainSegment), cipher.final()]);
    const p = mediaLayout.assetPrefix(assetId);
    bucketKeys.push(mediaLayout.master(assetId), mediaLayout.thumbsVtt(assetId),
      ...["360p", "720p", "1080p"].flatMap((r) => [mediaLayout.renditionPlaylist(assetId, r), `${p}/${r}/seg_00000.ts`]));
    await storage.putMedia(mediaLayout.master(assetId), master, "application/vnd.apple.mpegurl", "no-cache");
    for (const r of ["360p", "720p", "1080p"]) {
      await storage.putMedia(mediaLayout.renditionPlaylist(assetId, r), rendition(), "application/vnd.apple.mpegurl", "no-cache");
      await storage.putMedia(`${p}/${r}/seg_00000.ts`, encSeg, "video/mp2t");
    }
    await storage.putMedia(mediaLayout.thumbsVtt(assetId), "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nsprite_001.jpg#xywh=0,0,160,90\n", "text/vtt");
  }

  async function makeTitle(name: string, data: { rating?: string; status?: "PUBLISHED" | "DRAFT" } = {}) {
    const t = await prisma.title.create({
      data: {
        type: "MOVIE", name, slug: `${slugify(name)}-${randomBytes(3).toString("hex")}`, overview: `Mô tả ${name}`,
        maturityRating: data.rating ?? "T13", status: data.status ?? "PUBLISHED", publishedAt: new Date(), tmdbRating: 7.5,
        genres: { create: [{ genreId }] },
      },
    });
    titleIds.push(t.id);
    return t.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.use(cookieParser());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);

    genreId = (await prisma.genre.create({ data: { slug: `test-${TAG}`, name: `Thể loại thử ${TAG}` } })).id;
    planId = (await prisma.plan.create({
      data: { code: `content-test-${TAG}`, name: "Test", priceAmount: 0, maxHeight: 720, maxConcurrentStreams: 1 },
    })).id;
    viewer = await makeActor("USER");
    kid = await makeActor("USER", { isKids: true, userId: viewer.userId });
    kid.cookie = `${viewer.cookie.split(";")[0]}; pid=${kid.profileId}`;
    freeUser = await makeActor("USER");
    admin = await makeActor("ADMIN");
    await prisma.subscription.create({
      data: { userId: viewer.userId, planId, status: "ACTIVE", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
    });

    playableId = await makeTitle(`Người Thử Nghiệm ${TAG}`, { rating: "P" });
    adultId = await makeTitle(`Đêm Kinh Hoàng ${TAG}`, { rating: "T18" });
    const main = await prisma.mediaAsset.create({ data: { kind: "MAIN", status: "PENDING" } });
    const preview = await prisma.mediaAsset.create({ data: { kind: "PREVIEW", status: "PENDING" } });
    assetIds.push(main.id, preview.id);
    await putFakeAsset(main.id);
    await putFakeAsset(preview.id);
    await prisma.title.update({ where: { id: playableId }, data: { mainAssetId: main.id, previewAssetId: preview.id } });
  }, 60_000);

  afterAll(async () => {
    if (storage) await Promise.allSettled(bucketKeys.map((k) => storage.deleteMedia(k)));
    if (prisma) {
      const imgs = await prisma.image.findMany({ where: { titleId: { in: titleIds } }, select: { key: true } });
      await Promise.allSettled(imgs.map((i) => storage.deleteMedia(i.key)));
      await prisma.title.deleteMany({ where: { id: { in: titleIds } } });
      await prisma.mediaAsset.deleteMany({ where: { id: { in: assetIds } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `content-${TAG}-` } } });
      await prisma.plan.deleteMany({ where: { id: planId } });
      await prisma.genre.deleteMany({ where: { id: genreId } });
    }
    await app?.close();
  });

  // ───────── browse ─────────
  describe("browse", () => {
    it("401 khi chưa đăng nhập, 403 PROFILE_REQUIRED khi chưa chọn hồ sơ", async () => {
      await http.get("/v1/browse/home").expect(401);
      const res = await http.get("/v1/browse/home").set("Cookie", viewer.cookie.split(";")[0]!).expect(403);
      expect(res.body.code).toBe("PROFILE_REQUIRED");
    });

    it("home trả các hàng đúng dạng", async () => {
      const res = await http.get("/v1/browse/home").set("Cookie", viewer.cookie).expect(200);
      const body = res.body as HomeResponse;
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThan(0);
      for (const row of body.rows) {
        expect(row).toMatchObject({ id: expect.any(String), kind: expect.any(String), title: expect.any(String), hasMore: expect.any(Boolean) });
        expect(row.items.length).toBeGreaterThan(0);
        expect(row.items.length).toBeLessThanOrEqual(18);
        const c = row.items[0]!;
        expect(c).toMatchObject({ id: expect.any(String), slug: expect.any(String), name: expect.any(String), inMyList: expect.any(Boolean) });
        if (row.kind === "TOP10") row.items.forEach((it, i) => expect(it.rank).toBe(i + 1));
      }
      if (body.billboard) expect(body.billboard.genreList).toBeDefined();
      const movies = (await http.get("/v1/browse/home?type=MOVIE").set("Cookie", viewer.cookie).expect(200)).body as HomeResponse;
      for (const row of movies.rows) for (const it of row.items) expect(it.type).toBe("MOVIE");
      await http.get("/v1/browse/home?type=FOO").set("Cookie", viewer.cookie).expect(400);
    });

    it("trang của một hàng có phân trang", async () => {
      const home = (await http.get("/v1/browse/home").set("Cookie", viewer.cookie).expect(200)).body as HomeResponse;
      const row = home.rows[0]!;
      const res = await http.get(`/v1/browse/rows/${row.id}?page=1&pageSize=5`).set("Cookie", viewer.cookie).expect(200);
      const page = res.body as Paginated<TitleCard>;
      expect(page).toMatchObject({ page: 1, pageSize: 5 });
      expect(page.items.length).toBeLessThanOrEqual(5);
    });

    it("tìm kiếm không dấu: 'nguoi thu nghiem' thấy 'Người Thử Nghiệm…'", async () => {
      const res = await http.get(`/v1/browse/search?q=${encodeURIComponent(`nguoi thu nghiem ${TAG}`)}`).set("Cookie", viewer.cookie).expect(200);
      expect((res.body as Paginated<TitleCard>).items.map((i) => i.id)).toContain(playableId);
      const res2 = await http.get(`/v1/browse/search?q=${encodeURIComponent(`NGƯỜI THỬ ${TAG}`)}`).set("Cookie", viewer.cookie).expect(200);
      expect((res2.body as Paginated<TitleCard>).items[0]?.id).toBe(playableId);
      const res3 = await http.get(`/v1/browse/search?q=${encodeURIComponent(`the loai thu ${TAG}`)}`).set("Cookie", viewer.cookie).expect(200);
      expect((res3.body as Paginated<TitleCard>).items.map((i) => i.id)).toEqual(expect.arrayContaining([playableId, adultId]));
    });

    it("thể loại + chi tiết + similar", async () => {
      const g = await http.get(`/v1/browse/genres/test-${TAG}?sort=az`).set("Cookie", viewer.cookie).expect(200);
      expect(g.body.genre.slug).toBe(`test-${TAG}`);
      expect(g.body.total).toBe(2);
      const d = (await http.get(`/v1/titles/${playableId}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d).toMatchObject({ id: playableId, playable: true, maxAvailableHeight: 1080, hasPreview: true });
      const bySlug = await http.get(`/v1/titles/${d.slug}`).set("Cookie", viewer.cookie).expect(200);
      expect(bySlug.body.id).toBe(playableId);
      const sim = await http.get(`/v1/titles/${playableId}/similar`).set("Cookie", viewer.cookie).expect(200);
      expect((sim.body as TitleCard[]).map((c) => c.id)).toContain(adultId);
    });

    it("hồ sơ trẻ em không thấy phim T18", async () => {
      await http.get(`/v1/titles/${adultId}`).set("Cookie", kid.cookie).expect(404);
      await http.get(`/v1/titles/${playableId}`).set("Cookie", kid.cookie).expect(200);
      const s = await http.get(`/v1/browse/search?q=${encodeURIComponent(`dem kinh hoang ${TAG}`)}`).set("Cookie", kid.cookie).expect(200);
      expect(s.body.items).toHaveLength(0);
    });

    it("my list + rating phản ánh trên thẻ", async () => {
      await http.put(`/v1/my-list/${playableId}`).set("Cookie", viewer.cookie).expect(204);
      await http.put(`/v1/my-list/${playableId}`).set("Cookie", viewer.cookie).expect(204); // idempotent
      await http.put(`/v1/ratings/${playableId}`).set("Cookie", viewer.cookie).send({ value: "LOVE" }).expect(204);
      await http.put(`/v1/ratings/${playableId}`).set("Cookie", viewer.cookie).send({ value: "MEH" }).expect(400);
      let d = (await http.get(`/v1/titles/${playableId}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d.inMyList).toBe(true);
      expect(d.rating).toBe("LOVE");
      const list = (await http.get("/v1/my-list").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(list[0]).toMatchObject({ id: playableId, inMyList: true, rating: "LOVE" });
      // hồ sơ khác của cùng user không bị ảnh hưởng
      const kd = (await http.get(`/v1/titles/${playableId}`).set("Cookie", kid.cookie).expect(200)).body as TitleDetail;
      expect(kd.inMyList).toBe(false);
      await http.delete(`/v1/my-list/${playableId}`).set("Cookie", viewer.cookie).expect(204);
      await http.delete(`/v1/ratings/${playableId}`).set("Cookie", viewer.cookie).expect(204);
      d = (await http.get(`/v1/titles/${playableId}`).set("Cookie", viewer.cookie).expect(200)).body as TitleDetail;
      expect(d.inMyList).toBe(false);
      expect(d.rating).toBeNull();
      await http.put(`/v1/my-list/${randomUUID()}`).set("Cookie", viewer.cookie).expect(404);
    });
  });

  // ───────── playback ─────────
  describe("playback", () => {
    it("không có thuê bao → 402 NO_SUBSCRIPTION", async () => {
      const res = await http.post("/v1/playback/sessions").set("Cookie", freeUser.cookie).send({ titleId: playableId }).expect(402);
      expect(res.body.code).toBe("NO_SUBSCRIPTION");
    });

    it("title chưa có asset → 404 NOT_PLAYABLE", async () => {
      const res = await http.post("/v1/playback/sessions").set("Cookie", viewer.cookie).send({ titleId: adultId }).expect(404);
      expect(res.body.code).toBe("NOT_PLAYABLE");
    });

    it("phiên phát: giới hạn luồng, playlist, key, CDN, heartbeat → xem tiếp", async () => {
      const start = await http.post("/v1/playback/sessions").set("Cookie", viewer.cookie).send({ titleId: playableId }).expect(201);
      const s = start.body as PlaybackSession;
      expect(s).toMatchObject({ durationSec: 600, resumePositionSec: 0, heartbeatIntervalSec: 10, maxHeight: 720, episode: null });
      expect(s.manifestUrl).toBe(`/api/v1/playback/sessions/${s.sessionId}/master.m3u8`);
      expect(s.thumbnailsVttUrl).toContain(`${CDN_BASE}/s/`);

      // gói 1 luồng → luồng thứ 2 bị chặn (kể cả từ hồ sơ khác của cùng user)
      const second = await http.post("/v1/playback/sessions").set("Cookie", kid.cookie).send({ titleId: playableId }).expect(409);
      expect(second.body.code).toBe("TOO_MANY_STREAMS");

      // master: lọc theo maxHeight 720, URI tương đối
      const master = await http.get(apiPath(s.manifestUrl)).set("Cookie", viewer.cookie).expect(200);
      expect(master.headers["content-type"]).toContain("application/vnd.apple.mpegurl");
      expect(master.text).toContain("r/360p/index.m3u8");
      expect(master.text).toContain("r/720p/index.m3u8");
      expect(master.text).not.toContain("1080p");

      // rendition: segment → URL CDN ký, key → endpoint phiên
      const base = apiPath(s.manifestUrl).replace(/master\.m3u8$/, "");
      await http.get(`${base}r/1080p/index.m3u8`).set("Cookie", viewer.cookie).expect(403);
      const rend = await http.get(`${base}r/720p/index.m3u8`).set("Cookie", viewer.cookie).expect(200);
      expect(rend.text).toContain(`URI="/api/v1/playback/sessions/${s.sessionId}/key"`);
      expect(rend.text).not.toContain("urn:app:hls-key");
      const segUrls = rend.text.split("\n").filter((l) => l.startsWith("http"));
      expect(segUrls).toHaveLength(2);
      expect(segUrls[0]).toMatch(new RegExp(`^${CDN_BASE}/s/[^/]+/\\d+/hls/${assetIds[0]}/720p/seg_00000\\.ts$`));

      // key: 16 byte, chỉ chủ phiên
      const key = await http.get(`${base}key`).set("Cookie", viewer.cookie).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(key.headers["content-type"]).toContain("application/octet-stream");
      expect(Buffer.compare(key.body as Buffer, assetKey.key)).toBe(0);
      await http.get(`${base}key`).set("Cookie", freeUser.cookie).expect(410);
      await http.get(`${base}key`).expect(401);

      // segment qua dev CDN → giải mã AES-128-CBC ra đúng nội dung
      const seg = await http.get(cdnPath(segUrls[0]!)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(seg.headers["content-type"]).toBe("video/mp2t");
      expect(seg.headers["access-control-allow-origin"]).toBe("*");
      const decipher = createDecipheriv("aes-128-cbc", key.body as Buffer, Buffer.from(assetKey.ivHex, "hex"));
      expect(Buffer.compare(Buffer.concat([decipher.update(seg.body as Buffer), decipher.final()]), plainSegment)).toBe(0);
      const ranged = await http.get(cdnPath(segUrls[0]!)).set("Range", "bytes=0-99").expect(206);
      expect(ranged.headers["content-range"]).toMatch(/^bytes 0-99\//);
      const vtt = await http.get(cdnPath(s.thumbnailsVttUrl!)).expect(200);
      expect(vtt.headers["content-type"]).toContain("text/vtt");

      // heartbeat → tiến độ → xem tiếp
      await http.post(`/v1/playback/sessions/${s.sessionId}/heartbeat`).set("Cookie", viewer.cookie).send({ positionSec: 120, durationSec: 600 }).expect(204);
      await http.post(`/v1/playback/sessions/nonexistent-session-id/heartbeat`).set("Cookie", viewer.cookie).send({ positionSec: 1, durationSec: 600 }).expect(410);
      const cw = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw[0]).toMatchObject({ id: playableId, progress: { positionSec: 120, durationSec: 600, completed: false } });
      expect(cw[0]!.progress!.ratio).toBeCloseTo(0.2);
      const home = (await http.get("/v1/browse/home").set("Cookie", viewer.cookie).expect(200)).body as HomeResponse;
      const cwRow = home.rows.find((r) => r.kind === "CONTINUE_WATCHING");
      if (cwRow) expect(cwRow.items[0]!.id).toBe(playableId);

      // kết thúc phiên → slot được giải phóng, resume từ 120s
      await http.delete(`/v1/playback/sessions/${s.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      await http.get(apiPath(s.manifestUrl)).set("Cookie", viewer.cookie).expect(410);
      const again = (await http.post("/v1/playback/sessions").set("Cookie", viewer.cookie).send({ titleId: playableId }).expect(201)).body as PlaybackSession;
      expect(again.resumePositionSec).toBe(120);
      // xem gần hết (≥95%) → completed, rời khỏi xem tiếp
      await http.post(`/v1/playback/sessions/${again.sessionId}/heartbeat`).set("Cookie", viewer.cookie).send({ positionSec: 590, durationSec: 600 }).expect(204);
      const cw2 = (await http.get("/v1/continue-watching").set("Cookie", viewer.cookie).expect(200)).body as TitleCard[];
      expect(cw2.map((c) => c.id)).not.toContain(playableId);
      await http.delete(`/v1/playback/sessions/${again.sessionId}`).set("Cookie", viewer.cookie).expect(204);
      await http.delete(`/v1/continue-watching/${playableId}`).set("Cookie", viewer.cookie).expect(204);
    });

    it("token CDN sai/hết hạn → 403", async () => {
      const key = `${mediaLayout.assetPrefix(assetIds[0]!)}/720p/seg_00000.ts`;
      const secret = env("CDN_SIGNING_SECRET");
      const okExp = Math.floor(Date.now() / 1000) + 600;
      const good = signCdnPrefix(`hls/${assetIds[0]}/`, okExp, secret);
      await http.get(`/v1/dev-cdn/s/${good}/${okExp}/${key}`).expect(200);
      await http.get(`/v1/dev-cdn/s/${good.slice(0, -2)}xx/${okExp}/${key}`).expect(403);
      await http.get(`/v1/dev-cdn/s/${good}/${okExp + 1}/${key}`).expect(403);
      const pastExp = Math.floor(Date.now() / 1000) - 10;
      await http.get(`/v1/dev-cdn/s/${signCdnPrefix(`hls/${assetIds[0]}/`, pastExp, secret)}/${pastExp}/${key}`).expect(403);
      // token của asset khác không mở được asset này
      await http.get(`/v1/dev-cdn/s/${signCdnPrefix(`hls/${assetIds[1]}/`, okExp, secret)}/${okExp}/${key}`).expect(403);
      // ảnh công khai chỉ dưới images/
      await http.get(`/v1/dev-cdn/p/${key}`).expect(403);
      const pre = await http.options(`/v1/dev-cdn/s/${good}/${okExp}/${key}`).expect(204);
      expect(pre.headers["access-control-allow-headers"]).toContain("Range");
    });

    it("preview: không cần thuê bao, proxy có token", async () => {
      const res = await http.get(`/v1/playback/preview/${playableId}`).set("Cookie", freeUser.cookie).expect(200);
      expect(res.body.durationSec).toBe(600);
      const masterPath = apiPath(res.body.manifestUrl as string);
      const master = await http.get(masterPath).set("Cookie", freeUser.cookie).expect(200);
      expect(master.text).toContain("r/720p/index.m3u8");
      expect(master.text).not.toContain("1080p");
      const base = masterPath.replace(/master\.m3u8$/, "");
      const rend = await http.get(`${base}r/360p/index.m3u8`).set("Cookie", freeUser.cookie).expect(200);
      expect(rend.text).toContain(`/key"`);
      await http.get(`${base}key`).set("Cookie", freeUser.cookie).expect(200);
      // token gắn với user
      await http.get(masterPath).set("Cookie", viewer.cookie).expect(403);
      await http.get(`/v1/playback/preview/${adultId}`).set("Cookie", freeUser.cookie).expect(404);
    });
  });

  // ───────── admin ─────────
  describe("admin content", () => {
    it("người dùng thường bị 403 ở mọi route admin", async () => {
      for (const path of ["/v1/admin/stats", "/v1/admin/titles", "/v1/admin/source-files", "/v1/admin/jobs", "/v1/admin/home-rows", "/v1/admin/tmdb/search?q=x"]) {
        const r = await http.get(path).set("Cookie", viewer.cookie).expect(403);
        expect(r.body.code).toBe("FORBIDDEN");
      }
      await http.post("/v1/admin/titles").set("Cookie", viewer.cookie).send({ type: "MOVIE", name: "x" }).expect(403);
    });

    it("stats + danh sách", async () => {
      const s = await http.get("/v1/admin/stats").set("Cookie", admin.cookie).expect(200);
      expect(s.body).toMatchObject({ users: expect.any(Number), titlesPublished: expect.any(Number), sourceBytes: expect.any(String) });
      await http.get("/v1/admin/source-files?unlinked=true&page=1").set("Cookie", admin.cookie).expect(200);
      await http.get("/v1/admin/jobs?status=FAILED").set("Cookie", admin.cookie).expect(200);
      await http.get("/v1/admin/genres").set("Cookie", admin.cookie).expect(200);
    });

    it("CRUD title + slug tiếng Việt + overriddenFields + publish cần asset READY", async () => {
      const created = await http.post("/v1/admin/titles").set("Cookie", admin.cookie)
        .send({ type: "MOVIE", name: `Đường Về Nhà ${TAG}`, overview: "abc", releaseDate: "2024-05-01", genreIds: [genreId] }).expect(201);
      const t = created.body as AdminTitle;
      titleIds.push(t.id);
      expect(t.slug).toBe(`duong-ve-nha-${TAG}`);
      expect(t).toMatchObject({ status: "DRAFT", overriddenFields: [], releaseDate: "2024-05-01" });
      expect(t.genres.map((g) => g.id)).toEqual([genreId]);
      // trùng tên → slug -2
      const dup = (await http.post("/v1/admin/titles").set("Cookie", admin.cookie).send({ type: "MOVIE", name: `Đường Về Nhà ${TAG}` }).expect(201)).body as AdminTitle;
      titleIds.push(dup.id);
      expect(dup.slug).toBe(`duong-ve-nha-${TAG}-2`);

      await http.post("/v1/admin/titles").set("Cookie", admin.cookie).send({ type: "MOVIE" }).expect(400);

      const patched = (await http.patch(`/v1/admin/titles/${t.id}`).set("Cookie", admin.cookie)
        .send({ name: `Đường Về ${TAG}`, runtimeMinutes: 100 }).expect(200)).body as AdminTitle;
      expect(patched.name).toBe(`Đường Về ${TAG}`);
      expect(patched.overriddenFields.sort()).toEqual(["name", "runtimeMinutes"]);
      const p2 = (await http.patch(`/v1/admin/titles/${t.id}`).set("Cookie", admin.cookie).send({ genreIds: [] }).expect(200)).body as AdminTitle;
      expect(p2.overriddenFields.sort()).toEqual(["genres", "name", "runtimeMinutes"]);
      expect(p2.genres).toEqual([]);

      const pub = await http.post(`/v1/admin/titles/${t.id}/publish`).set("Cookie", admin.cookie).expect(409);
      expect(pub.body.code).toBe("CONFLICT");
      // title có asset READY thì publish được
      const ok = (await http.post(`/v1/admin/titles/${playableId}/publish`).set("Cookie", admin.cookie).expect(200)).body as AdminTitle;
      expect(ok.status).toBe("PUBLISHED");
      expect(ok.mainAsset?.status).toBe("READY");
      expect(ok.mainAsset?.renditions.map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);

      const list = (await http.get(`/v1/admin/titles?q=${encodeURIComponent(`Đường Về`)}&status=DRAFT`).set("Cookie", admin.cookie).expect(200)).body as Paginated<AdminTitle>;
      expect(list.items.map((i) => i.id)).toEqual(expect.arrayContaining([t.id, dup.id]));

      await http.delete(`/v1/admin/titles/${dup.id}`).set("Cookie", admin.cookie).expect(204);
      await http.get(`/v1/admin/titles/${dup.id}`).set("Cookie", admin.cookie).expect(404);
    });

    it("upload ảnh → WebP + kích thước + blur", async () => {
      const sharp = (await import("sharp")).default;
      const png = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
      const res = await http.post(`/v1/admin/titles/${adultId}/images`).set("Cookie", admin.cookie)
        .field("kind", "POSTER").attach("file", png, { filename: "p.png", contentType: "image/png" }).expect(201);
      expect(res.body).toMatchObject({ kind: "POSTER", width: 400, height: 600, isPrimary: true });
      expect(res.body.blur).toMatch(/^data:image\/webp;base64,/);
      const img = await http.get(cdnPath(res.body.url)).expect(200);
      expect(img.headers["content-type"]).toBe("image/webp");
      await http.post(`/v1/admin/titles/${adultId}/images`).set("Cookie", admin.cookie)
        .field("kind", "BANNER").attach("file", png, { filename: "p.png", contentType: "image/png" }).expect(400);
    });

    it("home rows, collections, billboards", async () => {
      const coll = (await http.post("/v1/admin/collections").set("Cookie", admin.cookie)
        .send({ name: `Bộ Sưu Tập ${TAG}`, titleIds: [playableId, adultId] }).expect(201)).body;
      expect(coll.slug).toBe(`bo-suu-tap-${TAG}`);
      expect(coll.titles.map((t: { id: string }) => t.id)).toEqual([playableId, adultId]);
      await http.post("/v1/admin/home-rows").set("Cookie", admin.cookie).send({ kind: "COLLECTION", title: "x" }).expect(400);
      const row = (await http.post("/v1/admin/home-rows").set("Cookie", admin.cookie)
        .send({ kind: "COLLECTION", title: `Hàng ${TAG}`, collectionId: coll.id }).expect(201)).body;
      expect(row).toMatchObject({ kind: "COLLECTION", collectionId: coll.id, genreId: null, titleType: null, isActive: true });
      const rows = (await http.get("/v1/admin/home-rows").set("Cookie", admin.cookie).expect(200)).body as { id: string }[];
      const reordered = (await http.post("/v1/admin/home-rows/reorder").set("Cookie", admin.cookie)
        .send({ ids: [row.id, ...rows.filter((r) => r.id !== row.id).map((r) => r.id)] }).expect(200)).body as { id: string; sortOrder: number }[];
      expect(reordered[0]!.id).toBe(row.id);
      // hàng mới hiển thị đầu tiên trên trang chủ (kid không thấy phim T18 trong đó)
      const home = (await http.get("/v1/browse/home").set("Cookie", kid.cookie).expect(200)).body as HomeResponse;
      expect(home.rows[0]!.id).toBe(row.id);
      expect(home.rows[0]!.items.map((i) => i.id)).toEqual([playableId]);
      // khôi phục thứ tự, dọn dẹp
      await http.post("/v1/admin/home-rows/reorder").set("Cookie", admin.cookie).send({ ids: rows.filter((r) => r.id !== row.id).map((r) => r.id) }).expect(200);
      await http.delete(`/v1/admin/home-rows/${row.id}`).set("Cookie", admin.cookie).expect(204);
      await http.delete(`/v1/admin/collections/${coll.id}`).set("Cookie", admin.cookie).expect(204);

      const bb = (await http.post("/v1/admin/billboards").set("Cookie", admin.cookie).send({ titleId: playableId }).expect(201)).body;
      expect(bb).toMatchObject({ titleId: playableId, isActive: true });
      await http.delete(`/v1/admin/billboards/${bb.id}`).set("Cookie", admin.cookie).expect(204);
    });

    it("TMDB không cấu hình → 503 rõ ràng", async () => {
      if (process.env.TMDB_API_KEY) return;
      const r = await http.get("/v1/admin/tmdb/search?q=matrix").set("Cookie", admin.cookie).expect(503);
      expect(r.body.message).toContain("TMDB");
    });
  });
});

describe("playlist rewriting (unit)", () => {
  it("master lọc + đổi URI; rendition ký segment và thay key", () => {
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n360p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1920x1080\n1080p/index.m3u8\n";
    const out = rewriteMaster(master, new Set(["360p"]));
    expect(out).toBe("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\nr/360p/index.m3u8\n");
    const rend = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="urn:app:hls-key",IV=0x00\n#EXTINF:4,\nseg_00000.ts\n';
    const r = rewriteRendition(rend, { assetPrefix: "hls/a", renditionDir: "hls/a/360p", keyUrl: "/k", signObject: (k) => `S:${k}` });
    expect(r).toBe('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="/k",IV=0x00\n#EXTINF:4,\nS:hls/a/360p/seg_00000.ts\n');
    expect(() => rewriteRendition("../../b/x.ts", { assetPrefix: "hls/a", renditionDir: "hls/a/360p", keyUrl: "/k", signObject: (k) => k })).toThrow();
  });
});
