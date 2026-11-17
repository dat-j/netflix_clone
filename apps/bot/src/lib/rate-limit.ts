/** Fixed-window per-user limiter (in memory; one bot replica handles all updates in polling mode). */
export type Verdict = "ok" | "blocked-first" | "blocked";

export class RateLimiter {
  private readonly hits = new Map<number, { start: number; count: number }>();
  constructor(private readonly max: number, private readonly windowMs: number, private readonly now = () => Date.now()) {}

  hit(userId: number): Verdict {
    const t = this.now();
    let w = this.hits.get(userId);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.hits.set(userId, w);
      if (this.hits.size > 10_000) this.sweep(t);
    }
    w.count++;
    if (w.count <= this.max) return "ok";
    return w.count === this.max + 1 ? "blocked-first" : "blocked";
  }

  private sweep(t: number) {
    for (const [k, w] of this.hits) if (t - w.start >= this.windowMs) this.hits.delete(k);
  }
}
