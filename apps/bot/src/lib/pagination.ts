export const PAGE_SIZE = 4;

export interface PageInfo {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  prev: number;
  next: number;
}

/** 1-based page math with clamping; prev/next wrap around so the nav buttons never dead-end. */
export function paginate(total: number, requested: number, size = PAGE_SIZE): PageInfo {
  const t = Math.max(0, Math.floor(total) || 0);
  const totalPages = Math.max(1, Math.ceil(t / size));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requested) || 1));
  const start = (page - 1) * size;
  const end = Math.min(t, start + size);
  return {
    page, totalPages, total: t, start, end,
    prev: page > 1 ? page - 1 : totalPages,
    next: page < totalPages ? page + 1 : 1,
  };
}

/** 1-based page that contains the 0-based item `index` (used to return to the right episode-grid page). */
export function pageOf(index: number, size = PAGE_SIZE): number {
  return Math.floor(Math.max(0, Math.floor(index) || 0) / size) + 1;
}

export interface WindowInfo { start: number; end: number; prevStart: number | null; nextStart: number | null }

/**
 * Fixed-size window over `total` items that contains item `index` (e.g. the season selector row). prev/nextStart are
 * the first index of the neighbouring windows (wrapping around), or null when everything fits in one window.
 */
export function windowAround(total: number, index: number, size: number): WindowInfo {
  const t = Math.max(0, Math.floor(total) || 0);
  if (t <= size) return { start: 0, end: t, prevStart: null, nextStart: null };
  const count = Math.ceil(t / size);
  const w = Math.min(count - 1, Math.max(0, Math.floor(Math.min(t - 1, Math.max(0, index)) / size)));
  const start = w * size;
  return {
    start,
    end: Math.min(t, start + size),
    prevStart: (w > 0 ? w - 1 : count - 1) * size,
    nextStart: (w < count - 1 ? w + 1 : 0) * size,
  };
}
