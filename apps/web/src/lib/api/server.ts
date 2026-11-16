import "server-only";

import { cookies } from "next/headers";
import { ApiRequestError, parseResponse } from "./errors";

/**
 * Gọi API từ Server Component / Route Handler: forward cookie của request hiện tại sang NestJS.
 * Lưu ý: server không refresh được token (không set được cookie khi render) — nếu 401, trang nên
 * render phần client để `api()` phía client tự refresh, hoặc redirect về /login.
 */
const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export async function serverApi<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown; query?: Record<string, string | number | boolean | null | undefined> } = {},
): Promise<T> {
  const { body, query, headers, ...rest } = init;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}/v1${path}${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
    ...rest,
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

/** Như `serverApi` nhưng trả null khi 401/403/404 thay vì ném lỗi. */
export async function serverApiOrNull<T>(...args: Parameters<typeof serverApi<T>>): Promise<T | null> {
  try {
    return await serverApi<T>(...args);
  } catch (e) {
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.statusCode)) return null;
    throw e;
  }
}
