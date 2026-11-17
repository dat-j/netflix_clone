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
