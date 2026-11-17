import { sanitizeMiniAppPath } from "@app/shared";
import { describe, expect, it } from "vitest";
import { miniAppEntry } from "./telegram";

describe("sanitizeMiniAppPath (Mini App ?to=)", () => {
  it.each([
    "/browse", "/browse/movies", "/browse/series", "/browse/genre/hanh-dong", "/title/mua-hoa-gao-do",
    "/watch/01a1e3ee-e15f-76ff-ab7f-4004e5cfe4f5", "/my-list", "/account", "/plans", "/search",
  ])("allows %s", (p) => expect(sanitizeMiniAppPath(p)).toBe(p));

  it("keeps only q for /search and re-encodes it", () => {
    expect(sanitizeMiniAppPath("/search?q=mưa hoa&x=1")).toBe(`/search?q=${encodeURIComponent("mưa hoa")}`);
    expect(sanitizeMiniAppPath("/search?q=" + "a".repeat(300))).toBe(`/search?q=${"a".repeat(100)}`);
  });

  it("drops query strings and fragments elsewhere", () => {
    expect(sanitizeMiniAppPath("/title/abc?next=//evil")).toBe("/title/abc");
    expect(sanitizeMiniAppPath("/browse#x")).toBe("/browse");
  });

  it.each([
    null, undefined, "", "browse", "https://evil.example", "http://localhost:3000/browse", "//evil.example", "///evil.example",
    "/\\evil.example", "\\\\evil.example", "javascript:alert(1)", "data:text/html,x", "/admin", "/admin/users", "/login",
    "/tg", "/title/../admin", "/title/a/b", "/title/%2e%2e%2fadmin", "/watch/not-a-uuid", "/browse/genre/", "%2F%2Fevil.example",
    "/title/a\nb", "/browse\t", " /browse", "/profiles?next=//evil",
  ])("falls back to /browse for %j", (p) => expect(sanitizeMiniAppPath(p)).toBe("/browse"));

  it("builds the /tg entry URL", () => {
    expect(miniAppEntry("/title/x")).toBe("/tg?to=%2Ftitle%2Fx");
    expect(miniAppEntry(null)).toBe("/tg");
    expect(miniAppEntry("//evil")).toBe("/tg?to=%2Fbrowse");
  });
});
