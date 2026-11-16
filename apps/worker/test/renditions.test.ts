import { describe, expect, it } from "vitest";
import { avcCodecString, h264Level, selectRenditions } from "../src/pipeline/renditions.js";

const dims = (w: number, h: number, fps = 30) => selectRenditions(w, h, fps).map((r) => `${r.name}:${r.width}x${r.height}`);

describe("selectRenditions", () => {
  it("1080p 16:9 gets the full ladder", () => {
    expect(dims(1920, 1080)).toEqual(["360p:640x360", "480p:854x480", "720p:1280x720", "1080p:1920x1080"]);
  });

  it("never upscales: 720p source stops at 720p, 4K stops at the top rung (1080p)", () => {
    expect(dims(1280, 720)).toEqual(["360p:640x360", "480p:854x480", "720p:1280x720"]);
    expect(dims(3840, 2160).at(-1)).toBe("1080p:1920x1080");
    for (const r of selectRenditions(1280, 720)) {
      expect(r.width).toBeLessThanOrEqual(1280);
      expect(r.height).toBeLessThanOrEqual(720);
    }
  });

  it("4:3 SD keeps aspect ratio with even dimensions", () => {
    expect(dims(640, 480)).toEqual(["360p:480x360", "480p:640x480"]);
    expect(dims(720, 576)).toEqual(["360p:450x360", "480p:600x480"]);
  });

  it("scope / letterboxed sources fit the 16:9 box by width", () => {
    expect(dims(1920, 800)).toEqual(["360p:640x266", "480p:854x356", "720p:1280x534", "1080p:1920x800"]);
    expect(dims(1280, 544)).toEqual(["360p:640x272", "480p:854x362", "720p:1280x544"]);
  });

  it("slightly-short sources still get their rung, at source size (tolerance, no upscale)", () => {
    expect(dims(1912, 1072).at(-1)).toBe("1080p:1912x1072");
    expect(dims(1280, 714).at(-1)).toBe("720p:1280x714");
  });

  it("sources below 360p get exactly one (lowest) rendition at source size", () => {
    expect(dims(320, 240)).toEqual(["360p:320x240"]);
    expect(dims(176, 144)).toEqual(["360p:176x144"]);
  });

  it("odd dimensions are made even and never exceed the source", () => {
    for (const r of selectRenditions(853, 481)) {
      expect(r.width % 2).toBe(0);
      expect(r.height % 2).toBe(0);
      expect(r.width).toBeLessThanOrEqual(853);
      expect(r.height).toBeLessThanOrEqual(481);
    }
    expect(dims(321, 241)).toEqual(["360p:320x240"]);
  });

  it("portrait video uses the short side (9:16 box)", () => {
    expect(dims(1080, 1920)).toEqual(["360p:360x640", "480p:480x854", "720p:720x1280", "1080p:1080x1920"]);
    expect(dims(720, 1280)).toEqual(["360p:360x640", "480p:480x854", "720p:720x1280"]);
  });

  it("square video", () => {
    expect(dims(1080, 1080)).toEqual(["360p:360x360", "480p:480x480", "720p:720x720", "1080p:1080x1080"]);
  });

  it("bitrate: lower for small/letterboxed frames (floor 50%), higher for >40 fps", () => {
    const [low] = selectRenditions(320, 240);
    expect(low!.videoKbps).toBe(400); // 800 * 0.5 floor
    const hfr = selectRenditions(1920, 1080, 60).at(-1)!;
    expect(hfr.videoKbps).toBe(7500);
    expect(selectRenditions(1920, 1080, 30).at(-1)!.videoKbps).toBe(5000);
  });

  it("rejects invalid input", () => {
    expect(() => selectRenditions(0, 1080)).toThrow();
  });
});

describe("h264Level", () => {
  it("picks the smallest fitting level", () => {
    expect(h264Level(640, 360, 30, 800)).toBe(30);
    expect(h264Level(854, 480, 30, 1400)).toBe(31);
    expect(h264Level(1280, 720, 30, 2800)).toBe(31);
    expect(h264Level(1280, 720, 60, 4200)).toBe(32);
    expect(h264Level(1920, 1080, 30, 5000)).toBe(40);
    expect(h264Level(1920, 1080, 60, 7500)).toBe(42);
  });
  it("codec string", () => {
    expect(avcCodecString(31)).toBe("avc1.64001f");
    expect(avcCodecString(40)).toBe("avc1.640028");
  });
});
