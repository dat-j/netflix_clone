import { z } from "zod";
import { ApiException } from "../../common/api-exception.js";

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new ApiException(400, "VALIDATION", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), r.error.issues);
  }
  return r.data;
}

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "uuid không hợp lệ");
const nullableStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));

export const titleType = z.enum(["MOVIE", "SERIES"]);

export const adminTitleInput = z.object({
  type: titleType,
  name: z.string().trim().min(1).max(300),
  slug: z.string().trim().max(100).regex(/^[a-z0-9-]*$/, "slug chỉ gồm a-z, 0-9, -").optional(),
  originalName: nullableStr(300),
  tagline: nullableStr(500),
  overview: nullableStr(5000),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "releaseDate dạng YYYY-MM-DD").nullable().optional(),
  runtimeMinutes: z.number().int().min(0).max(2000).nullable().optional(),
  maturityRating: nullableStr(20),
  countries: z.array(z.string().trim().min(1).max(10)).max(20).optional(),
  genreIds: z.array(uuid).max(30).optional(),
});
export const adminTitlePatch = adminTitleInput.partial().extend({
  /** Mở rộng: cho phép admin đặt lại danh sách trường bị khóa (ví dụ [] để TMDB ghi đè lại) */
  overriddenFields: z.array(z.string()).optional(),
});
export type AdminTitleInputParsed = z.infer<typeof adminTitleInput>;
export type AdminTitlePatchParsed = z.infer<typeof adminTitlePatch>;

export const attachAssetBody = z.object({ sourceFileId: uuid, kind: z.enum(["MAIN", "PREVIEW"]) });

export const homeRowKind = z.enum(["COLLECTION", "GENRE", "TRENDING", "TOP10", "CONTINUE_WATCHING", "MY_LIST", "NEW_RELEASES"]);
export const homeRowInput = z.object({
  kind: homeRowKind,
  title: z.string().trim().min(1).max(200),
  collectionId: uuid.nullable().optional(),
  genreId: uuid.nullable().optional(),
  titleType: titleType.nullable().optional(),
  isActive: z.boolean().optional(),
});
export const homeRowPatch = homeRowInput.partial();
export const reorderBody = z.object({ ids: z.array(uuid).min(1).max(500) });

export const collectionInput = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(100).regex(/^[a-z0-9-]*$/).optional(),
  titleIds: z.array(uuid).max(500),
});
export const collectionPatch = collectionInput.partial();

export const billboardInput = z.object({ titleId: uuid });
export const scanBody = z.object({ prefix: z.string().max(1024).optional() });

export { uuid };

// ───────── phim bộ ─────────
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dạng YYYY-MM-DD").nullable().optional();
const markerSec = z.number().int().min(0).max(86_400).nullable().optional();

export const adminSeasonInput = z.object({
  seasonNumber: z.number().int().min(0).max(1000),
  name: nullableStr(300),
  overview: nullableStr(5000),
  airDate: dateOnly,
});
export const adminSeasonPatch = adminSeasonInput.partial().extend({
  /** Mở rộng (giống title): đặt lại danh sách trường bị khóa, ví dụ [] để TMDB ghi đè lại */
  overriddenFields: z.array(z.string()).optional(),
});

export const adminEpisodeInput = z.object({
  episodeNumber: z.number().int().min(0).max(10_000),
  name: nullableStr(300),
  overview: nullableStr(5000),
  runtimeMinutes: z.number().int().min(0).max(2000).nullable().optional(),
  airDate: dateOnly,
  introStartSec: markerSec,
  introEndSec: markerSec,
  creditsStartSec: markerSec,
});
export const adminEpisodePatch = adminEpisodeInput.partial().extend({ overriddenFields: z.array(z.string()).optional() });
export const bulkEpisodesBody = z.object({ count: z.number().int().min(1).max(200), startAt: z.number().int().min(0).max(10_000).optional() });
export const episodeAssetBody = z.object({ sourceFileId: uuid });
export const syncSeasonsBody = z.object({ seasonNumbers: z.array(z.number().int().min(0).max(1000)).max(100).optional() });

/** Mốc intro/credits hợp lệ sau khi gộp với giá trị hiện tại. */
export function assertMarkers(m: { introStartSec: number | null; introEndSec: number | null; creditsStartSec: number | null }) {
  if ((m.introStartSec === null) !== (m.introEndSec === null)) {
    throw new ApiException(400, "VALIDATION", "introStartSec và introEndSec phải cùng có hoặc cùng trống");
  }
  if (m.introStartSec !== null && m.introEndSec !== null && m.introEndSec <= m.introStartSec) {
    throw new ApiException(400, "VALIDATION", "introEndSec phải lớn hơn introStartSec");
  }
  if (m.creditsStartSec !== null && m.introEndSec !== null && m.creditsStartSec < m.introEndSec) {
    throw new ApiException(400, "VALIDATION", "creditsStartSec phải sau introEndSec");
  }
}
