/** Logic thuần cho phim bộ (thứ tự tập, tập kế, tập "xem tiếp") — không I/O, dễ test. */

export interface EpKey { seasonNumber: number; episodeNumber: number }

/** Mùa 0 (Specials của TMDB) xếp sau mọi mùa thường. */
const seasonRank = (n: number) => (n === 0 ? Number.MAX_SAFE_INTEGER : n);

export function compareEp(a: EpKey, b: EpKey): number {
  return seasonRank(a.seasonNumber) - seasonRank(b.seasonNumber) || a.episodeNumber - b.episodeNumber;
}

export function sortEpisodes<T extends EpKey>(list: T[]): T[] {
  return [...list].sort(compareEp);
}

/** Tập phát được đầu tiên sau `cur` (theo thứ tự mùa → tập), `sorted` đã sắp bằng `sortEpisodes`. */
export function nextAfter<T extends EpKey>(sorted: T[], cur: EpKey): T | null {
  return sorted.find((e) => compareEp(e, cur) > 0) ?? null;
}

export interface ProgressLike {
  episodeId: string | null;
  completed: boolean;
  /** Vị trí (mùa/tập) của tập trong tiến độ — có cả khi tập đã bị gỡ xuất bản */
  episode: EpKey | null;
}

/**
 * Tập "xem tiếp" theo hợp đồng: tập dở dang gần nhất → tập kế sau tập đã xem xong → tập 1 mùa nhỏ nhất.
 * `latest` là tiến độ mới nhất của profile trên title (mọi tập); `progressByEp` để dùng lại tiến độ dở dang
 * của tập kế (ví dụ xem lại tập 1 xong trong khi tập 2 đang dở).
 * Trả `kind`: `progress` (tiếp tục tập dở), `next` (tập kế), `first` (chưa xem / đã xem hết → từ đầu).
 */
export function pickResume<T extends EpKey & { id: string }>(
  sorted: T[],
  latest: ProgressLike | null,
): { episode: T; kind: "progress" | "next" | "first" } | null {
  if (!sorted.length) return null;
  if (latest?.episodeId && latest.episode) {
    const cur = sorted.find((e) => e.id === latest.episodeId);
    if (cur && !latest.completed) return { episode: cur, kind: "progress" };
    const next = nextAfter(sorted, latest.episode);
    if (next) return { episode: next, kind: "next" };
  }
  return { episode: sorted[0]!, kind: "first" };
}
