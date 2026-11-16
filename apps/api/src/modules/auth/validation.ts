import { z } from "zod";
import { ApiException } from "../../common/api-exception.js";

/** Validate một body/query bằng zod, ném ApiException 400 VALIDATION nếu sai. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const message = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
    throw new ApiException(400, "VALIDATION", message || "Dữ liệu không hợp lệ", issues);
  }
  return result.data;
}

export const uuidParam = z.uuid();

export function parseId(id: string): string {
  if (!uuidParam.safeParse(id).success) throw new ApiException(404, "NOT_FOUND", "Không tìm thấy");
  return id;
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Email không hợp lệ" }).max(254));

export const passwordSchema = z
  .string()
  .min(8, { message: "Mật khẩu tối thiểu 8 ký tự" })
  .max(200, { message: "Mật khẩu quá dài" });
