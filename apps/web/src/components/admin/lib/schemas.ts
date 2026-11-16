import { z } from "zod";
import type { AdminTitle, AdminTitleInput, GrantSubscriptionBody, PlanDto, PlanInput } from "@app/shared";

/** Gom lỗi zod thành { field: message } để hiển thị dưới input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const optText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

// ───────── title ─────────
export const titleFormSchema = z.object({
  type: z.enum(["MOVIE", "SERIES"]),
  name: z.string().trim().min(1, "Bắt buộc nhập tên phim").max(300, "Tối đa 300 ký tự"),
  slug: z
    .string()
    .trim()
    .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), "Chỉ gồm a-z, 0-9 và dấu gạch ngang"),
  originalName: optText,
  tagline: optText,
  overview: optText,
  releaseDate: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Định dạng YYYY-MM-DD")
    .transform((v) => (v === "" ? null : v)),
  runtimeMinutes: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) < 2000), "Số phút không hợp lệ")
    .transform((v) => (v === "" ? null : Number(v))),
  maturityRating: optText,
  countries: z
    .string()
    .transform((v) => v.split(/[,;]/).map((s) => s.trim().toUpperCase()).filter(Boolean))
    .refine((arr) => arr.every((c) => /^[A-Z]{2}$/.test(c)), "Mã quốc gia 2 chữ cái, cách nhau bởi dấu phẩy"),
  genreIds: z.array(z.string()),
});

export type TitleFormValues = z.input<typeof titleFormSchema>;
export type TitleFormParsed = z.output<typeof titleFormSchema>;

export function titleToForm(t: AdminTitle | null): TitleFormValues {
  return {
    type: t?.type ?? "MOVIE",
    name: t?.name ?? "",
    slug: t?.slug ?? "",
    originalName: t?.originalName ?? "",
    tagline: t?.tagline ?? "",
    overview: t?.overview ?? "",
    releaseDate: t?.releaseDate ? t.releaseDate.slice(0, 10) : "",
    runtimeMinutes: t?.runtimeMinutes ? String(t.runtimeMinutes) : "",
    maturityRating: t?.maturityRating ?? "",
    countries: (t?.countries ?? []).join(", "),
    genreIds: t?.genres.map((g) => g.id) ?? [],
  };
}

export function parsedToInput(p: TitleFormParsed): AdminTitleInput {
  const input: AdminTitleInput = {
    type: p.type,
    name: p.name,
    originalName: p.originalName,
    tagline: p.tagline,
    overview: p.overview,
    releaseDate: p.releaseDate,
    runtimeMinutes: p.runtimeMinutes,
    maturityRating: p.maturityRating,
    countries: p.countries,
    genreIds: p.genreIds,
  };
  if (p.slug) input.slug = p.slug;
  return input;
}

/** Chỉ giữ các trường đã đổi so với bản gốc (PATCH để API ghi nhận overriddenFields đúng). */
export function diffTitleInput(original: AdminTitle, next: AdminTitleInput): Partial<AdminTitleInput> {
  const before = parsedToInput(titleFormSchema.parse(titleToForm(original)));
  const out: Partial<AdminTitleInput> = {};
  const keys = Object.keys(next) as (keyof AdminTitleInput)[];
  for (const k of keys) {
    const a = before[k];
    const b = next[k];
    const same = Array.isArray(a) && Array.isArray(b) ? a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|") : a === b;
    if (!same) (out as Record<string, unknown>)[k] = b;
  }
  return out;
}

/** Tên trường form ↔ tên trường trong overriddenFields (API có thể dùng genreIds hoặc genres). */
export function isOverridden(overridden: string[], field: string): boolean {
  if (overridden.includes(field)) return true;
  if (field === "genreIds") return overridden.includes("genres");
  return false;
}

// ───────── plan ─────────
const intStr = (msg: string, min = 0) =>
  z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= min, msg)
    .transform(Number);

export const planFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Bắt buộc")
    .regex(/^[a-z0-9_-]+$/, "Chỉ a-z, 0-9, _ hoặc -"),
  name: z.string().trim().min(1, "Bắt buộc"),
  description: optText,
  priceAmount: intStr("Giá phải là số nguyên ≥ 0"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/, "Mã tiền tệ 3 chữ cái"),
  intervalMonths: intStr("Chu kỳ ≥ 1 tháng", 1),
  maxHeight: z.enum(["480", "720", "1080", "2160"]).transform(Number),
  maxConcurrentStreams: intStr("Số luồng ≥ 1", 1),
  maxProfiles: intStr("Số hồ sơ ≥ 1", 1),
  isActive: z.boolean(),
  sortOrder: intStr("Thứ tự ≥ 0"),
});
export type PlanFormValues = z.input<typeof planFormSchema>;

export function planToForm(p: PlanDto | null): PlanFormValues {
  return {
    code: p?.code ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    priceAmount: String(p?.priceAmount ?? ""),
    currency: p?.currency ?? "VND",
    intervalMonths: String(p?.intervalMonths ?? 1),
    maxHeight: String(p?.maxHeight ?? 1080) as PlanFormValues["maxHeight"],
    maxConcurrentStreams: String(p?.maxConcurrentStreams ?? 1),
    maxProfiles: String(p?.maxProfiles ?? 1),
    isActive: p?.isActive ?? true,
    sortOrder: String(p?.sortOrder ?? 0),
  };
}

export function planParsedToInput(p: z.output<typeof planFormSchema>): PlanInput {
  return { ...p };
}

// ───────── grant subscription ─────────
export const grantFormSchema = z.object({
  planCode: z.string().min(1, "Chọn gói"),
  months: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 36, "Từ 1 đến 36 tháng")
    .transform(Number),
  note: z
    .string()
    .trim()
    .max(500, "Tối đa 500 ký tự")
    .transform((v) => (v === "" ? undefined : v)),
});
export type GrantFormValues = z.input<typeof grantFormSchema>;
export function grantParsed(v: z.output<typeof grantFormSchema>): GrantSubscriptionBody {
  return v.note ? { planCode: v.planCode, months: v.months, note: v.note } : { planCode: v.planCode, months: v.months };
}
