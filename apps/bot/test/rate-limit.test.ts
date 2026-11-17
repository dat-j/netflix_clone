import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/lib/rate-limit.js";

describe("RateLimiter", () => {
  it("allows max hits per window, flags the first block, then resets", () => {
    let now = 0;
    const r = new RateLimiter(3, 1000, () => now);
    expect([r.hit(1), r.hit(1), r.hit(1)]).toEqual(["ok", "ok", "ok"]);
    expect(r.hit(1)).toBe("blocked-first");
    expect(r.hit(1)).toBe("blocked");
    expect(r.hit(2)).toBe("ok");
    now = 1000;
    expect(r.hit(1)).toBe("ok");
  });
});
