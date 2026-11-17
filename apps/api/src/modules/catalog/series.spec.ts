import { compareEp, nextAfter, pickResume, sortEpisodes } from "./series.js";

const ep = (s: number, e: number) => ({ id: `S${s}E${e}`, seasonNumber: s, episodeNumber: e });
const all = sortEpisodes([ep(2, 1), ep(0, 1), ep(1, 2), ep(1, 1), ep(2, 2), ep(1, 3)]);

describe("series ordering", () => {
  it("sorts by season then episode, specials (season 0) last", () => {
    expect(all.map((e) => e.id)).toEqual(["S1E1", "S1E2", "S1E3", "S2E1", "S2E2", "S0E1"]);
    expect(compareEp(ep(1, 9), ep(2, 1))).toBeLessThan(0);
  });
  it("nextAfter crosses season boundaries and skips missing numbers", () => {
    expect(nextAfter(all, ep(1, 3))?.id).toBe("S2E1");
    expect(nextAfter(all, ep(1, 1))?.id).toBe("S1E2");
    expect(nextAfter(all, ep(1, 99))?.id).toBe("S2E1"); // tập đã bị gỡ: tập phát được kế tiếp
    expect(nextAfter(all, ep(0, 1))).toBeNull();
  });
});

describe("pickResume (contract rule)", () => {
  const p = (id: string, completed: boolean) => {
    const [, s, e] = /^S(\d+)E(\d+)$/.exec(id)!;
    return { episodeId: id, completed, episode: { seasonNumber: Number(s), episodeNumber: Number(e) } };
  };
  it("no progress → first episode of the lowest season", () => {
    expect(pickResume(all, null)).toEqual({ episode: all[0], kind: "first" });
    expect(pickResume([], null)).toBeNull();
  });
  it("in-progress episode → that episode", () => {
    expect(pickResume(all, p("S1E2", false))).toMatchObject({ episode: { id: "S1E2" }, kind: "progress" });
  });
  it("finished episode → next one, across seasons", () => {
    expect(pickResume(all, p("S1E3", true))).toMatchObject({ episode: { id: "S2E1" }, kind: "next" });
  });
  it("finished the last episode → back to the first", () => {
    expect(pickResume(all, p("S0E1", true))).toMatchObject({ episode: { id: "S1E1" }, kind: "first" });
  });
  it("in-progress episode that is no longer playable → the next playable one", () => {
    const withoutS1E2 = all.filter((e) => e.id !== "S1E2");
    expect(pickResume(withoutS1E2, p("S1E2", false))).toMatchObject({ episode: { id: "S1E3" }, kind: "next" });
  });
});
