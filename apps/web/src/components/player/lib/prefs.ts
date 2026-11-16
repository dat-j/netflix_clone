/** Persisted viewer preferences (per browser). Every access is guarded: storage may be unavailable. */

export interface PlayerPrefs {
  volume: number;
  muted: boolean;
  rate: number;
  /** Preferred max height for manual quality, null = Auto */
  qualityHeight: number | null;
  /** Subtitle language, null = off */
  subtitleLang: string | null;
}

export const PREFS_KEY = "lumio.player.prefs.v1";
export const RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;

export const DEFAULT_PREFS: PlayerPrefs = { volume: 1, muted: false, rate: 1, qualityHeight: null, subtitleLang: null };

export function sanitizePrefs(raw: unknown): PlayerPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const volume = typeof p.volume === "number" && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULT_PREFS.volume;
  const rate = typeof p.rate === "number" && (RATES as readonly number[]).includes(p.rate) ? p.rate : DEFAULT_PREFS.rate;
  return {
    volume,
    muted: typeof p.muted === "boolean" ? p.muted : DEFAULT_PREFS.muted,
    rate,
    qualityHeight: typeof p.qualityHeight === "number" && p.qualityHeight > 0 ? p.qualityHeight : null,
    subtitleLang: typeof p.subtitleLang === "string" && p.subtitleLang ? p.subtitleLang : null,
  };
}

export function loadPrefs(): PlayerPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(patch: Partial<PlayerPrefs>): void {
  try {
    const next = { ...loadPrefs(), ...patch };
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — preferences simply don't persist */
  }
}

/** Exponential backoff with cap: 1s, 2s, 4s, 8s… */
export function backoffDelay(attempt: number, baseMs = 1000, capMs = 10_000): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
}

/** Pick the hls.js level index whose height best matches a preferred height (≤ preferred, else lowest). */
export function levelForHeight(levels: { index: number; height: number }[], height: number | null): number {
  if (height == null || !levels.length) return -1;
  const exact = levels.find((l) => l.height === height);
  if (exact) return exact.index;
  const below = levels.filter((l) => l.height <= height).sort((a, b) => b.height - a.height);
  if (below.length) return below[0].index;
  return [...levels].sort((a, b) => a.height - b.height)[0].index;
}
