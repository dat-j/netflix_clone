import { describe, expect, it } from "vitest";
import { buildThumbsVtt, planThumbs, spriteSheetCount, thumbCount, thumbCues, vttTimestamp } from "../src/pipeline/thumbs.js";

describe("thumbnail sprites", () => {
  it("tile size keeps aspect ratio at 160 px wide, even height", () => {
    expect(planThumbs(1920, 1080)).toMatchObject({ tileWidth: 160, tileHeight: 90, cols: 10, rows: 10, intervalSec: 10 });
    expect(planThumbs(640, 480).tileHeight).toBe(120);
    expect(planThumbs(1920, 800).tileHeight).toBe(66);
    expect(planThumbs(1080, 1920).tileHeight).toBe(284);
  });

  it("one thumbnail per started 10 s", () => {
    expect(thumbCount(48, 10)).toBe(5);
    expect(thumbCount(40, 10)).toBe(4);
    expect(thumbCount(0.4, 10)).toBe(1);
  });

  it("cue math: positions, last cue clipped to duration", () => {
    const plan = planThumbs(1920, 1080);
    const cues = thumbCues(48, plan);
    expect(cues).toHaveLength(5);
    expect(cues[0]).toEqual({ start: 0, end: 10, sprite: "sprite_001.jpg", x: 0, y: 0, w: 160, h: 90 });
    expect(cues[4]).toEqual({ start: 40, end: 48, sprite: "sprite_001.jpg", x: 640, y: 0, w: 160, h: 90 });
  });

  it("wraps rows and sheets (10x10 per sheet)", () => {
    const plan = planThumbs(1920, 1080);
    const cues = thumbCues(2 * 3600 + 5, plan); // 2h → 721 thumbs → 8 sheets
    expect(cues).toHaveLength(721);
    expect(cues[10]).toMatchObject({ sprite: "sprite_001.jpg", x: 0, y: 90 });
    expect(cues[99]).toMatchObject({ sprite: "sprite_001.jpg", x: 1440, y: 810 });
    expect(cues[100]).toMatchObject({ sprite: "sprite_002.jpg", x: 0, y: 0, start: 1000, end: 1010 });
    expect(cues[720]).toMatchObject({ sprite: "sprite_008.jpg", x: 0, y: 180, start: 7200, end: 7205 });
    expect(spriteSheetCount(cues, plan)).toBe(8);
  });

  it("uses the real frame count; the last cue always runs to the end", () => {
    const plan = planThumbs(1920, 1080);
    const cues = thumbCues(40.008, plan, 4); // ffmpeg emitted 4 frames (t≈5,15,25,35)
    expect(cues).toHaveLength(4);
    expect(cues[3]).toMatchObject({ start: 30, end: 40.008, x: 480 });
    expect(thumbCues(44, plan, 4).at(-1)).toMatchObject({ start: 30, end: 44 });
    expect(thumbCues(48, plan, 5).at(-1)).toMatchObject({ start: 40, end: 48 });
  });

  it("composeSprites tiles frames row-major and crops a partial sheet", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const sharp = (await import("sharp")).default;
    const { composeSprites } = await import("../src/pipeline/thumbs.js");
    const dir = await mkdtemp(join(tmpdir(), "sprites-test-"));
    try {
      const plan = { ...planThumbs(1920, 1080), cols: 3, rows: 2 };
      const frames: string[] = [];
      for (let i = 0; i < 8; i++) {
        const f = join(dir, `t${i}.jpg`);
        await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: i * 30, g: 0, b: 0 } } }).jpeg().toFile(f);
        frames.push(f);
      }
      expect(await composeSprites(frames, plan, dir)).toEqual(["sprite_001.jpg", "sprite_002.jpg"]);
      expect(await sharp(join(dir, "sprite_001.jpg")).metadata()).toMatchObject({ width: 480, height: 180 });
      expect(await sharp(join(dir, "sprite_002.jpg")).metadata()).toMatchObject({ width: 480, height: 90 }); // 2 frames → 1 row
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("VTT timestamps and relative sprite references", () => {
    expect(vttTimestamp(0)).toBe("00:00:00.000");
    expect(vttTimestamp(3725.5)).toBe("01:02:05.500");
    const vtt = buildThumbsVtt(thumbCues(15, planThumbs(1280, 720)));
    expect(vtt).toBe(
      ["WEBVTT", "", "00:00:00.000 --> 00:00:10.000", "sprite_001.jpg#xywh=0,0,160,90", "", "00:00:10.000 --> 00:00:15.000", "sprite_001.jpg#xywh=160,0,160,90", ""].join("\n"),
    );
  });
});
