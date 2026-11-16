import type { ApiError, ApiErrorCode } from "@app/shared";

export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiRequestError";
    this.statusCode = error.statusCode;
    this.code = error.code;
    this.details = error.details;
  }
}

export async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const err = (data && typeof data === "object" && "code" in data ? data : null) as ApiError | null;
    throw new ApiRequestError(err ?? { statusCode: res.status, code: "INTERNAL", message: res.statusText || "Lỗi không xác định" });
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
