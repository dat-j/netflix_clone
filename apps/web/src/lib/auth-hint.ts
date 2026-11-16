/**
 * The API's access cookie (`at`) lives 15 minutes and the refresh cookie (`rt`) is scoped to
 * /api/v1/auth, so page requests cannot tell "logged out" from "access token expired".
 * The web app therefore keeps a non-sensitive hint cookie (`lm_s=1`) for the refresh lifetime:
 * the proxy lets hinted requests through, and the client `api()` refreshes on 401.
 * If the refresh fails the client clears the hint and goes to /login — so this never loops.
 */
export const AUTH_HINT_COOKIE = "lm_s";
export const ACCESS_COOKIE = "at";
export const PROFILE_COOKIE = "pid";
const HINT_MAX_AGE = 30 * 24 * 3600;

export function setAuthHint() {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${AUTH_HINT_COOKIE}=1; path=/; max-age=${HINT_MAX_AGE}; samesite=lax${secure}`;
}

export function clearAuthHint() {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_HINT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
