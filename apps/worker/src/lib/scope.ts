/**
 * Bucket scope guards. The client's real source bucket is shared with unrelated projects, so:
 *  - SOURCE_S3_PREFIX is a hard boundary: nothing outside it is listed, probed, downloaded or transcoded.
 *  - Bucket-wide operations on a non-local endpoint need an explicit opt-in (`--all-bucket`).
 *  - Writing synthetic samples is only allowed against a local gateway.
 *  - MEDIA_S3_PREFIX is prepended to every media-bucket key the worker reads/writes (see s3.ts `physicalKey`).
 */

/** "" stays ""; otherwise strips leading slashes and guarantees exactly one trailing slash ("movies" → "movies/"). */
export function normalizePrefix(p: string | undefined | null): string {
  const s = (p ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return s ? `${s}/` : "";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** True only for an explicit localhost / loopback endpoint. No endpoint (= AWS) is NOT local. */
export function isLocalEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return false;
  try {
    return LOCAL_HOSTS.has(new URL(endpoint).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

export function keyInScope(key: string, scopePrefix: string): boolean {
  const p = normalizePrefix(scopePrefix);
  return !p || key.startsWith(p);
}
export function assertKeyInScope(key: string, scopePrefix: string): void {
  if (!keyInScope(key, scopePrefix)) {
    throw new ScopeError(`source key "${key}" is outside SOURCE_S3_PREFIX "${normalizePrefix(scopePrefix)}" — refusing to read it`);
  }
}

/**
 * Effective listing prefix for a requested prefix, always inside the configured scope.
 * A requested prefix that already starts with the scope is used as-is; otherwise it is treated as relative to the
 * scope ("samples/" with scope "movies/" → "movies/samples/"). Requested prefixes are not normalized to a trailing
 * slash (a partial file-name prefix is legitimate) — only the scope is.
 */
export function resolveListPrefix(requested: string | undefined | null, scopePrefix: string): string {
  const scope = normalizePrefix(scopePrefix);
  const req = (requested ?? "").trim().replace(/^\/+/, "");
  if (req.includes("..")) throw new ScopeError(`invalid prefix "${req}"`);
  if (!scope) return req;
  if (!req) return scope;
  return req.startsWith(scope) ? req : `${scope}${req}`;
}

/** Refuses an un-prefixed bucket-wide listing on a non-local endpoint unless explicitly allowed. */
export function assertBucketWideAllowed(opts: { endpoint: string | undefined; bucket: string; listPrefix: string; allBucket: boolean }): void {
  if (opts.listPrefix || opts.allBucket || isLocalEndpoint(opts.endpoint)) return;
  throw new ScopeError(
    `refusing to list the whole bucket "${opts.bucket}" on ${opts.endpoint ?? "AWS"}: SOURCE_S3_PREFIX is empty and no prefix was given. ` +
      `This bucket may be shared with other projects — set SOURCE_S3_PREFIX (or pass --prefix), or pass --all-bucket ` +
      `(worker scan jobs: SOURCE_S3_ALLOW_ALL_BUCKET=true) if you really mean the entire bucket.`,
  );
}

/** seed:samples may only write to a local gateway. */
export function assertLocalForWrites(endpoint: string | undefined, what: string): void {
  if (!isLocalEndpoint(endpoint)) {
    throw new ScopeError(`${what} refuses to write to a non-local source endpoint (${endpoint ?? "AWS"}); it only runs against localhost/127.0.0.1`);
  }
}

/** MEDIA_S3_PREFIX + logical key (as stored in the DB / produced by mediaLayout). */
export function applyKeyPrefix(prefix: string, key: string): string {
  return `${normalizePrefix(prefix)}${key.replace(/^\/+/, "")}`;
}
/** Inverse of applyKeyPrefix for listing results; returns null for keys outside the prefix. */
export function stripKeyPrefix(prefix: string, physical: string): string | null {
  const p = normalizePrefix(prefix);
  if (!p) return physical;
  return physical.startsWith(p) ? physical.slice(p.length) : null;
}
