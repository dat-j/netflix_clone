import { describe, expect, it } from "vitest";
import { isVideoKey } from "../src/lib/extensions.js";
import { displaySize, normalizeContainer, parseRational, redactUrl, summarizeProbe, type FfprobeResult } from "../src/lib/probe.js";
import { isTextSubtitle, normalizeLanguage, planSubtitles } from "../src/pipeline/subtitles.js";

describe("isVideoKey", () => {
  it("accepts common video extensions case-insensitively", () => {
    for (const k of ["a.mp4", "dir/b.MKV", "c.mov", "d.avi", "e.webm", "f.m4v", "g.ts", "h.m2ts", "i.wmv", "j.flv", "k.mpg", "x/y/z.MPEG"]) {
      expect(isVideoKey(k), k).toBe(true);
    }
  });
  it("rejects non-video, folders, hidden files and extensionless keys", () => {
    for (const k of ["a.srt", "b.jpg", "c.nfo", "d.txt", "folder/", "e", ".hidden.mp4", "dir/._resource.mov", "f.mp4.part", ""]) {
      expect(isVideoKey(k), k).toBe(false);
    }
  });
});

describe("probe parsing", () => {
  it("parseRational", () => {
    expect(parseRational("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRational("0/0")).toBeNull();
    expect(parseRational("25")).toBe(25);
  });

  it("displaySize applies SAR and rotation", () => {
    expect(displaySize({ index: 0, width: 720, height: 576, sample_aspect_ratio: "64:45" })).toEqual({ width: 1024, height: 576 });
    expect(displaySize({ index: 0, width: 1920, height: 1080, tags: { rotate: "90" } })).toEqual({ width: 1080, height: 1920 });
    expect(displaySize({ index: 0, width: 1920, height: 1080, side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] })).toEqual({ width: 1080, height: 1920 });
    expect(displaySize({ index: 0, width: 1920, height: 1080, sample_aspect_ratio: "1:1" })).toEqual({ width: 1920, height: 1080 });
  });

  it("normalizeContainer", () => {
    expect(normalizeContainer("mov,mp4,m4a,3gp,3g2,mj2", "x.mp4", "isom")).toBe("mp4");
    expect(normalizeContainer("mov,mp4,m4a,3gp,3g2,mj2", "x.mov", "qt  ")).toBe("mov");
    expect(normalizeContainer("matroska,webm", "x.webm")).toBe("webm");
    expect(normalizeContainer("matroska,webm", "x.mkv")).toBe("mkv");
    expect(normalizeContainer("asf", "x.wmv")).toBe("wmv");
    expect(normalizeContainer("avi", "x.avi")).toBe("avi");
  });

  it("summarizeProbe extracts the contract shape", () => {
    const p: FfprobeResult = {
      format: { format_name: "matroska,webm", duration: "52.021", bit_rate: "9645000" },
      streams: [
        { index: 0, codec_type: "video", codec_name: "hevc", width: 1280, height: 720, avg_frame_rate: "25/1", color_transfer: "smpte2084" },
        { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "eng" } },
        { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6, tags: { language: "und" } },
        { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: { language: "vie" } },
        { index: 4, codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle" },
        { index: 5, codec_type: "video", codec_name: "mjpeg", width: 600, height: 800, disposition: { attached_pic: 1 } },
      ],
    };
    const s = summarizeProbe(p, "movies/a.mkv");
    expect(s).toEqual({
      container: "mkv",
      durationSec: 52.021,
      videoCodec: "hevc",
      width: 1280,
      height: 720,
      frameRate: 25,
      bitrateKbps: 9645,
      isHdr: true,
      audioTracks: [
        { index: 1, codec: "aac", language: "eng", channels: 2 },
        { index: 2, codec: "ac3", language: null, channels: 6 },
      ],
      subtitleTracks: [
        { index: 3, codec: "subrip", language: "vie" },
        { index: 4, codec: "hdmv_pgs_subtitle", language: null },
      ],
    });
    const subs = planSubtitles(p);
    expect(subs.extract.map((x) => [x.streamIndex, x.language, x.label, x.fileName])).toEqual([[3, "vi", "Vietnamese", "01_vi.vtt"]]);
    expect(subs.skipped.map((x) => x.index)).toEqual([4]);
  });

  it("subtitle helpers", () => {
    expect(isTextSubtitle("mov_text")).toBe(true);
    expect(isTextSubtitle("dvd_subtitle")).toBe(false);
    expect(normalizeLanguage("eng")).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("und");
  });

  it("redacts presigned query strings", () => {
    expect(redactUrl("http://h:9/b/k.mp4?X-Amz-Signature=abc: 403")).toBe("http://h:9/b/k.mp4?… 403");
  });
});

describe("cleanFfmpegMessage", () => {
  it("drops pointers and the input url", async () => {
    const { cleanFfmpegMessage } = await import("../src/lib/probe.js");
    expect(cleanFfmpegMessage("[mov,mp4 @ 0xc37f4c0] moov atom not found | http://127.0.0.1:1/abc: Invalid data", "http://127.0.0.1:1/abc")).toBe(
      "moov atom not found | Invalid data",
    );
  });
});
