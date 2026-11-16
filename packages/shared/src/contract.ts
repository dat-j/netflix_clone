/**
 * HỢP ĐỒNG API — nguồn sự thật duy nhất giữa apps/api và apps/web.
 *
 * Quy ước chung
 * - NestJS đặt global prefix `v1`. Trình duyệt gọi cùng origin qua Next rewrite: `/api/v1/...`.
 * - JSON camelCase. Thời gian là chuỗi ISO 8601. Mọi URL ảnh/video trả về là URL tuyệt đối dùng được ngay.
 * - Xác thực bằng cookie httpOnly: `at` (access JWT ~15 phút, path=/), `rt` (refresh ~30 ngày, path=/api/v1/auth),
 *   `pid` (profile đang chọn, path=/). Server Component của Next forward header Cookie sang API.
 * - Lỗi: HTTP status + body `ApiError`.
 * - Phân trang: `?page=1&pageSize=24` → `Paginated<T>`.
 *
 * Danh sách endpoint (đường dẫn sau `/v1`)
 *
 * AUTH (public trừ khi ghi chú)
 *   POST   /auth/register            RegisterBody → AuthResponse (set cookie, gửi mail xác thực)
 *   POST   /auth/login               LoginBody → AuthResponse (set cookie)
 *   POST   /auth/refresh             → AuthResponse (xoay refresh token)
 *   POST   /auth/logout              → 204
 *   GET    /auth/me                  [auth] → MeResponse
 *   POST   /auth/verify-email        { token } → 204
 *   POST   /auth/forgot-password     { email } → 204 (luôn 204)
 *   POST   /auth/reset-password      { token, password } → 204
 *   GET    /auth/sessions            [auth] → DeviceSession[]
 *   DELETE /auth/sessions/:id        [auth] → 204
 *
 * PROFILES [auth]
 *   GET    /profiles                 → ProfileDto[]
 *   POST   /profiles                 ProfileInput → ProfileDto
 *   PATCH  /profiles/:id             Partial<ProfileInput> → ProfileDto
 *   DELETE /profiles/:id             → 204
 *   POST   /profiles/:id/select      → ProfileDto (set cookie `pid`)
 *   GET    /profiles/avatars         → AvatarOption[]
 *
 * BILLING
 *   GET    /plans                    (public) → PlanDto[]
 *   GET    /subscription             [auth] → SubscriptionDto | null
 *
 * BROWSE [auth + profile]
 *   GET    /browse/home?type=MOVIE|SERIES   → HomeResponse
 *   GET    /browse/rows/:rowId?page=        → Paginated<TitleCard>
 *   GET    /browse/genres                   → GenreDto[]
 *   GET    /browse/genres/:slug?page=&sort= → { genre: GenreDto } & Paginated<TitleCard>
 *   GET    /browse/search?q=&page=          → Paginated<TitleCard>
 *   GET    /titles/:idOrSlug                → TitleDetail
 *   GET    /titles/:id/similar              → TitleCard[]
 *   GET    /my-list                         → TitleCard[]
 *   PUT    /my-list/:titleId                → 204
 *   DELETE /my-list/:titleId                → 204
 *   PUT    /ratings/:titleId                { value: RatingValue } → 204
 *   DELETE /ratings/:titleId                → 204
 *   GET    /continue-watching               → TitleCard[] (có `progress`)
 *   DELETE /continue-watching/:titleId      → 204
 *
 * PLAYBACK [auth + profile + thuê bao ACTIVE]
 *   POST   /playback/sessions               StartPlaybackBody → PlaybackSession
 *            402 NO_SUBSCRIPTION | 409 TOO_MANY_STREAMS | 404 NOT_PLAYABLE
 *   POST   /playback/sessions/:sid/heartbeat HeartbeatBody → 204 (410 SESSION_ENDED nếu bị chiếm slot)
 *   DELETE /playback/sessions/:sid          → 204
 *   GET    /playback/sessions/:sid/master.m3u8            → playlist (đã lọc theo maxHeight của gói)
 *   GET    /playback/sessions/:sid/r/:rendition/index.m3u8 → playlist (URI segment → URL CDN đã ký, URI key → endpoint dưới)
 *   GET    /playback/sessions/:sid/key      → 16 byte thô (application/octet-stream)
 *   GET    /playback/preview/:titleId       [auth] → PreviewSource | 404  (trailer/preview cho hero + hover card, không cần thuê bao)
 *
 * DEV CDN (chỉ khi CDN_PROVIDER=local)
 *   GET    /dev-cdn/s/:token/:exp/*key      → stream object bucket media nếu token hợp lệ (hỗ trợ Range, CORS *)
 *   GET    /dev-cdn/p/*key                  → ảnh công khai (prefix `images/`)
 *
 * ADMIN [auth + role ADMIN], prefix /admin
 *   GET    /admin/stats                         → AdminStats
 *   GET    /admin/users?q=&page=                → Paginated<AdminUser>
 *   POST   /admin/users/:id/subscription        GrantSubscriptionBody → SubscriptionDto
 *   DELETE /admin/users/:id/subscription        → 204
 *   PATCH  /admin/users/:id                     { disabled?: boolean; role?: UserRole } → AdminUser
 *   GET    /admin/plans                         → PlanDto[] (kể cả không active)
 *   POST   /admin/plans                         PlanInput → PlanDto
 *   PATCH  /admin/plans/:id                     Partial<PlanInput> → PlanDto
 *   GET    /admin/source-files?q=&prefix=&status=&unlinked=&page= → Paginated<SourceFileDto>
 *   POST   /admin/source-files/scan             { prefix?: string } → { queued: true } (liệt kê bucket + probe nền)
 *   GET    /admin/tmdb/search?q=&type=          → TmdbSearchResult[]
 *   POST   /admin/titles/import-tmdb            { tmdbId: number; type: TitleType } → AdminTitle
 *   GET    /admin/titles?q=&status=&type=&page= → Paginated<AdminTitle>
 *   POST   /admin/titles                        AdminTitleInput → AdminTitle
 *   GET    /admin/titles/:id                    → AdminTitle
 *   PATCH  /admin/titles/:id                    Partial<AdminTitleInput> → AdminTitle (ghi nhận overriddenFields)
 *   DELETE /admin/titles/:id                    → 204
 *   POST   /admin/titles/:id/sync-tmdb          → AdminTitle
 *   POST   /admin/titles/:id/publish            → AdminTitle   (yêu cầu mainAsset READY)
 *   POST   /admin/titles/:id/unpublish          → AdminTitle
 *   POST   /admin/titles/:id/assets             AttachAssetBody → MediaAssetDto (tạo asset + đẩy job transcode)
 *   POST   /admin/titles/:id/images             multipart(file, kind) → ImageDto
 *   GET    /admin/jobs?status=&page=            → Paginated<TranscodeJobDto>
 *   POST   /admin/jobs/:id/retry                → TranscodeJobDto
 *   GET    /admin/genres                        → GenreDto[]
 *   GET/POST/PATCH/DELETE /admin/home-rows[/:id]      HomeRowInput ↔ HomeRowDto ; POST /admin/home-rows/reorder { ids: string[] }
 *   GET/POST/PATCH/DELETE /admin/collections[/:id]    CollectionInput ↔ CollectionDto
 *   GET/POST/DELETE /admin/billboards[/:id]           { titleId } ↔ BillboardDto
 */

// ───────── chung ─────────
export type ApiErrorCode =
  | "VALIDATION" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT"
  | "INVALID_CREDENTIALS" | "EMAIL_TAKEN" | "TOKEN_INVALID" | "PROFILE_REQUIRED" | "PROFILE_LIMIT"
  | "NO_SUBSCRIPTION" | "TOO_MANY_STREAMS" | "SESSION_ENDED" | "NOT_PLAYABLE" | "RATE_LIMITED" | "INTERNAL";

export interface ApiError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export type UserRole = "USER" | "ADMIN";
export type TitleType = "MOVIE" | "SERIES";
export type PublishStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type RatingValue = "DISLIKE" | "LIKE" | "LOVE";
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";
export type AssetStatus = "PENDING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";
export type AssetKind = "MAIN" | "PREVIEW";
export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
export type ImageKind = "POSTER" | "BACKDROP" | "LOGO" | "STILL";
export type HomeRowKind =
  | "COLLECTION" | "GENRE" | "TRENDING" | "TOP10" | "CONTINUE_WATCHING" | "MY_LIST" | "NEW_RELEASES";

// ───────── auth / tài khoản ─────────
export interface RegisterBody { email: string; password: string }
export interface LoginBody { email: string; password: string }

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}
export interface AuthResponse { user: UserDto }
export interface MeResponse {
  user: UserDto;
  subscription: SubscriptionDto | null;
  /** Profile đang chọn theo cookie `pid`, null nếu chưa chọn */
  profile: ProfileDto | null;
}
export interface DeviceSession {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ip: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
}

export interface ProfileDto {
  id: string;
  name: string;
  avatarKey: string;
  avatarUrl: string;
  isKids: boolean;
  language: string;
}
export interface ProfileInput { name: string; avatarKey: string; isKids?: boolean; language?: string }
export interface AvatarOption { key: string; url: string }

// ───────── thuê bao ─────────
export interface PlanDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceAmount: number;
  currency: string;
  intervalMonths: number;
  maxHeight: number;
  maxConcurrentStreams: number;
  maxProfiles: number;
  isActive: boolean;
  sortOrder: number;
}
export type PlanInput = Omit<PlanDto, "id">;
export interface SubscriptionDto {
  id: string;
  status: SubscriptionStatus;
  plan: PlanDto;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  provider: string;
}
export interface GrantSubscriptionBody { planCode: string; months: number; note?: string }

// ───────── catalog ─────────
export interface GenreDto { id: string; slug: string; name: string }

export interface ImageRef {
  url: string;
  width: number | null;
  height: number | null;
  /** data URL mờ hoặc mã màu hex để làm placeholder */
  blur: string | null;
}

export interface WatchProgressDto {
  positionSec: number;
  durationSec: number;
  /** 0..1 */
  ratio: number;
  completed: boolean;
  episodeId: string | null;
  updatedAt: string;
}

/** Thẻ phim trong hàng/lưới */
export interface TitleCard {
  id: string;
  slug: string;
  type: TitleType;
  name: string;
  year: number | null;
  runtimeMinutes: number | null;
  maturityRating: string | null;
  /** Ngắn gọn cho hover card */
  overview: string | null;
  genres: string[];
  poster: ImageRef | null;
  backdrop: ImageRef | null;
  logo: ImageRef | null;
  /** % phù hợp hiển thị (0..100), suy từ tmdbRating */
  matchScore: number | null;
  hasPreview: boolean;
  isNew: boolean;
  inMyList: boolean;
  rating: RatingValue | null;
  progress: WatchProgressDto | null;
  /** Chỉ có ở hàng TOP10: 1..10 */
  rank?: number;
}

export interface CreditDto { id: string; name: string; character: string | null; profileUrl: string | null }

export interface EpisodeDto {
  id: string;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  runtimeMinutes: number | null;
  still: ImageRef | null;
  progress: WatchProgressDto | null;
  playable: boolean;
}
export interface SeasonDto { id: string; seasonNumber: number; name: string | null; episodes: EpisodeDto[] }

export interface TitleDetail extends TitleCard {
  originalName: string | null;
  tagline: string | null;
  fullOverview: string | null;
  releaseDate: string | null;
  countries: string[];
  genreList: GenreDto[];
  cast: CreditDto[];
  directors: CreditDto[];
  writers: CreditDto[];
  /** Có asset chính READY hay không */
  playable: boolean;
  /** Chiều cao tối đa có sẵn: 480/720/1080 */
  maxAvailableHeight: number | null;
  seasons: SeasonDto[];
}

export interface HomeRow {
  id: string;
  kind: HomeRowKind;
  title: string;
  /** Link "Xem tất cả" nếu có (đường dẫn web) */
  href: string | null;
  items: TitleCard[];
  hasMore: boolean;
}
export interface HomeResponse {
  billboard: TitleDetail | null;
  rows: HomeRow[];
}

// ───────── playback ─────────
export interface StartPlaybackBody { titleId: string; episodeId?: string }
export interface PlaybackSession {
  sessionId: string;
  /** Đường dẫn cùng origin: /api/v1/playback/sessions/:sid/master.m3u8 */
  manifestUrl: string;
  /** URL WebVTT thumbnail (sprite, cue dạng `sprite_001.jpg#xywh=x,y,w,h`), null nếu chưa có */
  thumbnailsVttUrl: string | null;
  durationSec: number;
  resumePositionSec: number;
  heartbeatIntervalSec: number;
  maxHeight: number;
  title: { id: string; name: string; type: TitleType; maturityRating: string | null; logo: ImageRef | null; backdrop: ImageRef | null };
  episode: { id: string; seasonNumber: number; episodeNumber: number; name: string | null } | null;
  subtitles: { id: string; language: string; label: string; url: string; isDefault: boolean }[];
}
export interface HeartbeatBody { positionSec: number; durationSec: number; paused?: boolean }
export interface PreviewSource { manifestUrl: string; durationSec: number }

// ───────── admin ─────────
export interface AdminStats {
  users: number;
  activeSubscriptions: number;
  titlesPublished: number;
  titlesDraft: number;
  sourceFiles: number;
  sourceBytes: string;
  jobsQueued: number;
  jobsRunning: number;
  jobsFailed: number;
  viewsLast7d: number;
}
export interface AdminUser extends UserDto {
  disabled: boolean;
  profileCount: number;
  subscription: SubscriptionDto | null;
}
export interface SourceFileDto {
  id: string;
  bucket: string;
  key: string;
  /** BigInt dạng chuỗi */
  sizeBytes: string;
  lastModified: string | null;
  probeStatus: "PENDING" | "OK" | "FAILED" | "SKIPPED";
  probeError: string | null;
  container: string | null;
  durationSec: number | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  audioTracks: { index: number; codec: string; language: string | null; channels: number | null }[];
  subtitleTracks: { index: number; codec: string; language: string | null }[];
  linkedAssetIds: string[];
}
export interface TmdbSearchResult {
  tmdbId: number;
  type: TitleType;
  name: string;
  originalName: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  alreadyImported: boolean;
}
export interface ImageDto extends ImageRef { id: string; kind: ImageKind; isPrimary: boolean }
export interface MediaAssetDto {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  durationSec: number | null;
  sourceKey: string | null;
  renditions: { name: string; width: number; height: number; videoKbps: number }[];
  errorMessage: string | null;
  latestJob: TranscodeJobDto | null;
}
export interface TranscodeJobDto {
  id: string;
  assetId: string;
  titleName: string | null;
  sourceKey: string | null;
  status: JobStatus;
  progress: number;
  stage: string | null;
  attempt: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
export interface AdminTitleInput {
  type: TitleType;
  name: string;
  slug?: string;
  originalName?: string | null;
  tagline?: string | null;
  overview?: string | null;
  releaseDate?: string | null;
  runtimeMinutes?: number | null;
  maturityRating?: string | null;
  countries?: string[];
  genreIds?: string[];
}
export interface AdminTitle {
  id: string;
  slug: string;
  type: TitleType;
  tmdbId: number | null;
  name: string;
  originalName: string | null;
  tagline: string | null;
  overview: string | null;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  maturityRating: string | null;
  countries: string[];
  status: PublishStatus;
  publishedAt: string | null;
  overriddenFields: string[];
  genres: GenreDto[];
  images: ImageDto[];
  mainAsset: MediaAssetDto | null;
  previewAsset: MediaAssetDto | null;
  createdAt: string;
  updatedAt: string;
}
export interface AttachAssetBody { sourceFileId: string; kind: AssetKind }
export interface HomeRowInput {
  kind: HomeRowKind;
  title: string;
  collectionId?: string | null;
  genreId?: string | null;
  titleType?: TitleType | null;
  isActive?: boolean;
}
export interface HomeRowDto extends Required<HomeRowInput> { id: string; sortOrder: number }
export interface CollectionInput { name: string; slug?: string; titleIds: string[] }
export interface CollectionDto { id: string; slug: string; name: string; titles: { id: string; name: string; posterUrl: string | null }[] }
export interface BillboardDto { id: string; titleId: string; titleName: string; backdropUrl: string | null; isActive: boolean; sortOrder: number }
