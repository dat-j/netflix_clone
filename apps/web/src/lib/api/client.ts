"use client";

import { ApiRequestError, parseResponse } from "./errors";

/** Gọi API từ trình duyệt (cùng origin, cookie httpOnly). Tự refresh access token một lần khi gặp 401. */
const BASE = "/api/v1";
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Không thử refresh khi 401 (dùng cho chính các endpoint auth) */
  noRefresh?: boolean;
}

export function buildUrl(path: string, query?: ApiOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

export async function api<T = void>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, query, noRefresh, headers, ...init } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const doFetch = () =>
    fetch(buildUrl(path, query), {
      credentials: "include",
      ...init,
      headers: { ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });

  let res = await doFetch();
  if (res.status === 401 && !noRefresh && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await doFetch();
  }
  return parseResponse<T>(res);
}

export { ApiRequestError };
