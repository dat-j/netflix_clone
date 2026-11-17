import { describe, expect, it } from "vitest";
import { miniAppUrl, paths, websiteUrl } from "../src/lib/links.js";

const WEB = "https://boxphim.example/";

describe("Mini App URLs", () => {
  it("opens /tg with the path urlencoded in `to`", () => {
    expect(miniAppUrl(WEB)).toBe("https://boxphim.example/tg");
    expect(miniAppUrl(WEB, paths.browse())).toBe("https://boxphim.example/tg?to=%2Fbrowse");
    expect(miniAppUrl(WEB, paths.myList())).toBe("https://boxphim.example/tg?to=%2Fmy-list");
    expect(miniAppUrl(WEB, paths.genre("hanh-dong"))).toBe("https://boxphim.example/tg?to=%2Fbrowse%2Fgenre%2Fhanh-dong");
    expect(miniAppUrl(WEB, paths.watch("01A1E3EE-DDFF-778E-87E2-24A9C49E6F69"))).toBe(
      "https://boxphim.example/tg?to=%2Fwatch%2F01a1e3ee-ddff-778e-87e2-24a9c49e6f69");
  });
  it("double-encodes the search query so `to` decodes back to a valid path", () => {
    const url = miniAppUrl(WEB, paths.search("người gác & đèn?"));
    const to = new URL(url).searchParams.get("to")!;
    expect(to.startsWith("/search?q=")).toBe(true);
    expect(new URL(to, WEB).searchParams.get("q")).toBe("người gác & đèn?");
  });
  it("covers every contract path", () => {
    for (const p of [paths.browse(), paths.movies(), paths.series(), paths.myList(), paths.account(), paths.plans(), paths.title("a-b")]) {
      expect(new URL(miniAppUrl(WEB, p)).searchParams.get("to")).toBe(p);
    }
  });
  it("rejects unsafe slugs / ids", () => {
    expect(() => paths.title("../admin")).toThrow();
    expect(() => paths.genre("a/b")).toThrow();
    expect(() => paths.watch("123")).toThrow();
  });
  it("builds website URLs", () => {
    expect(websiteUrl(WEB, paths.title("nguoi-gac-den-bien"))).toBe("https://boxphim.example/title/nguoi-gac-den-bien");
  });
});
