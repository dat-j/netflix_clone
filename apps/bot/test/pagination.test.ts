import { describe, expect, it } from "vitest";
import { pageOf, paginate, windowAround } from "../src/lib/pagination.js";

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
  it("pages an episode grid of 12", () => {
    expect(paginate(14, 1, 12)).toMatchObject({ totalPages: 2, start: 0, end: 12, prev: 2, next: 2 });
    expect(paginate(14, 2, 12)).toMatchObject({ start: 12, end: 14 });
    expect(paginate(12, 2, 12)).toMatchObject({ page: 1, totalPages: 1 });
  });
});

describe("pageOf", () => {
  it("finds the page that contains an item", () => {
    expect(pageOf(0, 12)).toBe(1);
    expect(pageOf(11, 12)).toBe(1);
    expect(pageOf(12, 12)).toBe(2);
    expect(pageOf(13, 12)).toBe(2);
    expect(pageOf(-1, 12)).toBe(1);
    expect(pageOf(Number.NaN, 12)).toBe(1);
  });
});

describe("windowAround (season selector)", () => {
  it("shows everything when it fits", () => {
    expect(windowAround(4, 2, 5)).toEqual({ start: 0, end: 4, prevStart: null, nextStart: null });
    expect(windowAround(0, 0, 3)).toEqual({ start: 0, end: 0, prevStart: null, nextStart: null });
  });
  it("windows long season lists around the current one, wrapping at the ends", () => {
    expect(windowAround(8, 0, 3)).toEqual({ start: 0, end: 3, prevStart: 6, nextStart: 3 });
    expect(windowAround(8, 4, 3)).toEqual({ start: 3, end: 6, prevStart: 0, nextStart: 6 });
    expect(windowAround(8, 7, 3)).toEqual({ start: 6, end: 8, prevStart: 3, nextStart: 0 });
    expect(windowAround(8, 99, 3)).toMatchObject({ start: 6, end: 8 });
    expect(windowAround(8, -3, 3)).toMatchObject({ start: 0, end: 3 });
  });
});
