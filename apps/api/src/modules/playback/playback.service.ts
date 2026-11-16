import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { HeartbeatBody, PlaybackSession, PreviewSource, StartPlaybackBody } from "@app/shared";
import { decryptMediaKey, mediaLayout } from "@app/shared/media";
import { PrismaService } from "../../infra/prisma.service.js";
import { RedisService } from "../../infra/redis.service.js";
import { ApiException } from "../../common/api-exception.js";
import type { Entitlement, RequestProfile, RequestUser } from "../../common/auth.js";
import { env } from "../../env.js";
import { StorageService } from "../storage/storage.service.js";
import { CdnSigner } from "../storage/cdn-signer.js";
import { ImagePipelineService, pickImage } from "../storage/image-pipeline.service.js";
import { visibleWhere } from "../catalog/title-cards.service.js";
import { isValidRenditionName, masterRenditionNames, rewriteMaster, rewriteRendition } from "./playlist.js";
import { HEARTBEAT_INTERVAL_SEC, StreamSessionStore, type StreamSession } from "./stream-sessions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Đường dẫn công khai (cùng origin qua Next rewrite) */
export const PUBLIC_API_PREFIX = "/api/v1";
const PLAYLIST_CACHE_TTL = 600;
const PREVIEW_MAX_HEIGHT = 720;
const PREVIEW_TOKEN_TTL = 3600;

export function resumePosition(p: { positionSec: number; durationSec: number; completed: boolean } | null, durationSec: number): number {
  if (!p || p.completed) return 0;
  const dur = durationSec > 0 ? durationSec : p.durationSec;
  if (p.positionSec < 10) return 0;
  if (dur > 0 && p.positionSec >= dur * 0.95) return 0;
  return Math.floor(p.positionSec);
}

interface PlaylistSource { assetId: string; renditions: string[] }

@Injectable()
export class PlaybackService {
  private readonly logger = new Logger("PlaybackService");
  private readonly keySecret = env("MEDIA_KEY_ENCRYPTION_SECRET");
  private readonly previewSecret = env("CDN_SIGNING_SECRET");

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CdnSigner) private readonly cdn: CdnSigner,
    @Inject(ImagePipelineService) private readonly images: ImagePipelineService,
    @Inject(StreamSessionStore) private readonly sessions: StreamSessionStore,
  ) {}

  // ───────── playlist gốc từ bucket (cache Redis) ─────────

  private async playlistText(key: string): Promise<string | null> {
    const ck = `pb:pl:${key}`;
    try {
      const hit = await this.redis.get(ck);
      if (hit !== null) return hit;
    } catch { /* bỏ qua */ }
    const text = await this.storage.getMediaText(key);
    if (text !== null) await this.redis.set(ck, text, "EX", PLAYLIST_CACHE_TTL).catch(() => undefined);
    return text;
  }

  /** Tên playlist con được phép: rendition video ≤ maxHeight (luôn giữ bậc thấp nhất) + media không phải video. */
  private async allowedRenditions(assetId: string, maxHeight: number): Promise<string[] | null> {
    const master = await this.playlistText(mediaLayout.master(assetId));
    if (master === null) return null;
    const rows = await this.prisma.rendition.findMany({ where: { assetId }, select: { name: true, height: true }, orderBy: { height: "asc" } });
    const heightBy = new Map(rows.map((r) => [r.name, r.height]));
    const names = masterRenditionNames(master);
    const video = names.filter((n) => heightBy.has(n));
    const okVideo = video.filter((n) => heightBy.get(n)! <= maxHeight);
    if (!okVideo.length && video.length) okVideo.push(video.sort((a, b) => heightBy.get(a)! - heightBy.get(b)!)[0]!);
    return [...okVideo, ...names.filter((n) => !heightBy.has(n))];
  }

  // ───────── phiên phát ─────────

  async start(user: RequestUser, profile: RequestProfile, ent: Entitlement, body: StartPlaybackBody): Promise<PlaybackSession> {
    const titleId = body?.titleId;
    const episodeId = body?.episodeId ?? null;
    if (typeof titleId !== "string" || !UUID_RE.test(titleId) || (episodeId !== null && (typeof episodeId !== "string" || !UUID_RE.test(episodeId)))) {
      throw new ApiException(400, "VALIDATION", "titleId/episodeId không hợp lệ");
    }
    const title = await this.prisma.title.findFirst({
      where: { AND: [{ id: titleId }, visibleWhere(profile)] },
      select: {
        id: true, name: true, type: true, maturityRating: true, mainAssetId: true,
        images: { where: { kind: { in: ["LOGO", "BACKDROP"] } }, select: { kind: true, key: true, width: true, height: true, blurData: true, isPrimary: true } },
      },
    });
    if (!title) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy phim");

    let assetId: string | null = title.mainAssetId;
    let episode: PlaybackSession["episode"] = null;
    if (episodeId) {
      const ep = await this.prisma.episode.findFirst({
        where: { id: episodeId, titleId, status: "PUBLISHED" },
        select: { id: true, episodeNumber: true, name: true, mainAssetId: true, season: { select: { seasonNumber: true } } },
      });
      if (!ep) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy tập phim");
      assetId = ep.mainAssetId;
      episode = { id: ep.id, seasonNumber: ep.season.seasonNumber, episodeNumber: ep.episodeNumber, name: ep.name };
    }
    const asset = assetId
      ? await this.prisma.mediaAsset.findUnique({
        where: { id: assetId },
        select: { id: true, status: true, durationSec: true, thumbsVttKey: true, subtitleTracks: true },
      })
      : null;
    if (!asset || asset.status !== "READY") throw new ApiException(404, "NOT_PLAYABLE", "Phim chưa sẵn sàng để phát");
    const renditions = await this.allowedRenditions(asset.id, ent.maxHeight);
    if (!renditions?.length) throw new ApiException(404, "NOT_PLAYABLE", "Phim chưa sẵn sàng để phát");

    const sid = randomBytes(16).toString("base64url");
    const session: StreamSession = {
      sid, userId: user.id, profileId: profile.id, titleId, episodeId, assetId: asset.id,
      maxHeight: ent.maxHeight, renditions, createdAt: Date.now(),
    };
    const ok = await this.sessions.start(session, ent.maxConcurrentStreams);
    if (!ok) {
      throw new ApiException(409, "TOO_MANY_STREAMS", `Tài khoản đang xem trên quá nhiều thiết bị (tối đa ${ent.maxConcurrentStreams})`, {
        maxConcurrentStreams: ent.maxConcurrentStreams,
      });
    }

    const [progress, heights] = await Promise.all([
      this.prisma.watchProgress.findFirst({
        where: { profileId: profile.id, titleId, episodeId }, orderBy: { updatedAt: "desc" },
        select: { positionSec: true, durationSec: true, completed: true },
      }),
      this.prisma.rendition.findMany({ where: { assetId: asset.id, name: { in: renditions } }, select: { height: true } }),
      this.prisma.viewEvent.create({ data: { profileId: profile.id, titleId } }),
    ]);
    const durationSec = asset.durationSec ?? 0;
    const prefix = `${mediaLayout.assetPrefix(asset.id)}/`;
    return {
      sessionId: sid,
      manifestUrl: `${PUBLIC_API_PREFIX}/playback/sessions/${sid}/master.m3u8`,
      thumbnailsVttUrl: asset.thumbsVttKey?.startsWith(prefix) ? this.cdn.signedUrl(asset.thumbsVttKey) : null,
      durationSec,
      resumePositionSec: resumePosition(progress, durationSec),
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      maxHeight: heights.length ? Math.max(...heights.map((h) => h.height)) : ent.maxHeight,
      title: {
        id: title.id, name: title.name, type: title.type, maturityRating: title.maturityRating,
        logo: this.images.imageRef(pickImage(title.images, "LOGO")),
        backdrop: this.images.imageRef(pickImage(title.images, "BACKDROP")),
      },
      episode,
      subtitles: asset.subtitleTracks
        .filter((s) => s.key.startsWith(prefix))
        .map((s) => ({ id: s.id, language: s.language, label: s.label, url: this.cdn.signedUrl(s.key), isDefault: s.isDefault })),
    };
  }

  private async ownedSession(sid: string, user: RequestUser): Promise<StreamSession> {
    const s = await this.sessions.get(sid);
    if (!s || s.userId !== user.id) throw new ApiException(410, "SESSION_ENDED", "Phiên phát đã kết thúc");
    return s;
  }

  async heartbeat(sid: string, user: RequestUser, body: HeartbeatBody): Promise<void> {
    const pos = Number(body?.positionSec);
    const dur = Number(body?.durationSec);
    if (!Number.isFinite(pos) || pos < 0 || !Number.isFinite(dur) || dur < 0) {
      throw new ApiException(400, "VALIDATION", "positionSec/durationSec không hợp lệ");
    }
    const s = await this.ownedSession(sid, user);
    if (!(await this.sessions.touch(s))) throw new ApiException(410, "SESSION_ENDED", "Phiên phát đã kết thúc");
    await this.saveProgress(s, pos, dur);
  }

  private async saveProgress(s: StreamSession, positionSec: number, durationSec: number) {
    const profileId = s.profileId;
    const duration = durationSec > 0 ? durationSec : positionSec;
    const position = Math.min(positionSec, duration || positionSec);
    const completed = duration > 0 && position >= duration * 0.95;
    const existing = await this.prisma.watchProgress.findFirst({
      where: { profileId, titleId: s.titleId, episodeId: s.episodeId }, orderBy: { updatedAt: "desc" }, select: { id: true },
    });
    const data = { positionSec: position, durationSec: duration, completed };
    if (existing) await this.prisma.watchProgress.update({ where: { id: existing.id }, data });
    else await this.prisma.watchProgress.create({ data: { ...data, profileId, titleId: s.titleId, episodeId: s.episodeId } });
  }

  async end(sid: string, user: RequestUser): Promise<void> {
    const s = await this.sessions.get(sid);
    if (s && s.userId === user.id) await this.sessions.end(s);
  }

  async masterPlaylist(sid: string, user: RequestUser): Promise<string> {
    const s = await this.ownedSession(sid, user);
    return this.buildMaster({ assetId: s.assetId, renditions: s.renditions });
  }

  async renditionPlaylist(sid: string, user: RequestUser, rendition: string): Promise<string> {
    const s = await this.ownedSession(sid, user);
    return this.buildRendition({ assetId: s.assetId, renditions: s.renditions }, rendition, `${PUBLIC_API_PREFIX}/playback/sessions/${sid}/key`);
  }

  async key(sid: string, user: RequestUser): Promise<Buffer> {
    const s = await this.ownedSession(sid, user);
    return this.assetKey(s.assetId);
  }

  private async buildMaster(src: PlaylistSource): Promise<string> {
    const text = await this.playlistText(mediaLayout.master(src.assetId));
    if (text === null) throw new ApiException(404, "NOT_PLAYABLE", "Không tìm thấy playlist");
    return rewriteMaster(text, new Set(src.renditions));
  }

  private async buildRendition(src: PlaylistSource, rendition: string, keyUrl: string): Promise<string> {
    if (!isValidRenditionName(rendition) || !src.renditions.includes(rendition)) {
      throw new ApiException(403, "FORBIDDEN", "Chất lượng không được phép");
    }
    const key = mediaLayout.renditionPlaylist(src.assetId, rendition);
    const text = await this.playlistText(key);
    if (text === null) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy playlist");
    return rewriteRendition(text, {
      assetPrefix: mediaLayout.assetPrefix(src.assetId),
      renditionDir: `${mediaLayout.assetPrefix(src.assetId)}/${rendition}`,
      keyUrl,
      signObject: (k) => this.cdn.signedUrl(k),
    });
  }

  private async assetKey(assetId: string): Promise<Buffer> {
    const a = await this.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { encKeyCipher: true, encKeyIv: true, encKeyTag: true } });
    if (!a?.encKeyCipher || !a.encKeyIv || !a.encKeyTag) throw new ApiException(404, "NOT_FOUND", "Không có key");
    try {
      return decryptMediaKey({ encKeyCipher: a.encKeyCipher, encKeyIv: a.encKeyIv, encKeyTag: a.encKeyTag }, this.keySecret);
    } catch (err) {
      this.logger.error(`Giải mã key asset ${assetId} lỗi: ${(err as Error).message}`);
      throw new ApiException(500, "INTERNAL", "Không giải mã được key");
    }
  }

  // ───────── preview (trailer) — không cần thuê bao, không chiếm slot ─────────

  private previewToken(assetId: string, userId: string, exp: number): string {
    return createHmac("sha256", this.previewSecret).update(`preview\n${assetId}\n${userId}\n${exp}`).digest("base64url");
  }

  private verifyPreview(assetId: string, userId: string, exp: string, token: string): void {
    const expN = Number(exp);
    const ok = UUID_RE.test(assetId) && Number.isFinite(expN) && expN >= Math.floor(Date.now() / 1000) && (() => {
      const a = Buffer.from(this.previewToken(assetId, userId, expN));
      const b = Buffer.from(token);
      return a.length === b.length && timingSafeEqual(a, b);
    })();
    if (!ok) throw new ApiException(403, "FORBIDDEN", "Token preview không hợp lệ hoặc đã hết hạn");
  }

  async preview(titleId: string, user: RequestUser): Promise<PreviewSource> {
    if (!UUID_RE.test(titleId)) throw new ApiException(404, "NOT_FOUND", "Không có preview");
    const t = await this.prisma.title.findFirst({
      where: { id: titleId, status: "PUBLISHED" }, select: { previewAsset: { select: { id: true, status: true, durationSec: true } } },
    });
    const a = t?.previewAsset;
    if (!a || a.status !== "READY") throw new ApiException(404, "NOT_FOUND", "Không có preview");
    const exp = Math.ceil((Date.now() / 1000 + PREVIEW_TOKEN_TTL) / 600) * 600;
    const token = this.previewToken(a.id, user.id, exp);
    return { manifestUrl: `${PUBLIC_API_PREFIX}/playback/previews/${a.id}/${exp}/${token}/master.m3u8`, durationSec: a.durationSec ?? 0 };
  }

  private async previewSource(assetId: string, user: RequestUser, exp: string, token: string): Promise<PlaylistSource> {
    this.verifyPreview(assetId, user.id, exp, token);
    const renditions = await this.allowedRenditions(assetId, PREVIEW_MAX_HEIGHT);
    if (!renditions?.length) throw new ApiException(404, "NOT_FOUND", "Không có preview");
    return { assetId, renditions };
  }

  async previewMaster(assetId: string, exp: string, token: string, user: RequestUser) {
    return this.buildMaster(await this.previewSource(assetId, user, exp, token));
  }

  async previewRendition(assetId: string, exp: string, token: string, rendition: string, user: RequestUser) {
    const src = await this.previewSource(assetId, user, exp, token);
    return this.buildRendition(src, rendition, `${PUBLIC_API_PREFIX}/playback/previews/${assetId}/${exp}/${token}/key`);
  }

  async previewKey(assetId: string, exp: string, token: string, user: RequestUser) {
    this.verifyPreview(assetId, user.id, exp, token);
    const a = await this.prisma.mediaAsset.findUnique({ where: { id: assetId }, select: { kind: true, status: true } });
    if (!a || a.kind !== "PREVIEW" || a.status !== "READY") throw new ApiException(404, "NOT_FOUND", "Không có preview");
    return this.assetKey(assetId);
  }
}
