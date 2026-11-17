import { describe, expect, it } from "vitest";
import { paginate } from "../src/lib/pagination.js";

describe("paginate", () => {
  it("computes slices for a 2×2 grid", () => {
    expect(paginate(27, 1)).toMatchObject({ page: 1, totalPages: 7, start: 0, end: 4, prev: 7, next: 2 });
    expect(paginate(27, 7)).toMatchObject({ page: 7, start: 24, end: 27, prev: 6, next: 1 });
    expect(paginate(8, 2)).toMatchObject({ page: 2, totalPages: 2, start: 4, end: 8 });
  });
  it("clamps out-of-range and junk pages", () => {
    expect(paginate(9, 99)).toMatchObject({ page: 3, start: 8, end: 9 });
    expect(paginate(9, 0).page).toBe(1);
    expect(paginate(9, -5).page).toBe(1);
    expect(paginate(9, Number.NaN).page).toBe(1);
  });
  it("handles empty lists", () => {
    expect(paginate(0, 3)).toMatchObject({ page: 1, totalPages: 1, start: 0, end: 0, prev: 1, next: 1 });
  });
  it("supports other page sizes", () => {
    expect(paginate(17, 2, 16)).toMatchObject({ totalPages: 2, start: 16, end: 17 });
  });
});
