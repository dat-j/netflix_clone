import { describe, expect, it } from "vitest";
import type { FfprobeResult } from "../src/lib/probe.js";
import { planAudio } from "../src/pipeline/audio.js";
import { languageEndonym, planSubtitles } from "../src/pipeline/subtitles.js";

/** Stream layout of samples/sample-720p-hevc-2audio-subs.mkv (ffprobe). */
const sample: FfprobeResult = {
  streams: [
    { index: 0, codec_type: "video", codec_name: "hevc", width: 1280, height: 720, disposition: { default: 0 } },
    { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, disposition: { default: 1, forced: 0 }, tags: { language: "eng", title: "English Stereo" } },
    { index: 2, codec_type: "audio", codec_name: "ac3", channels: 6, disposition: { default: 0, forced: 0 }, tags: { language: "vie", title: "Tiếng Việt 5.1" } },
    { index: 3, codec_type: "subtitle", codec_name: "subrip", disposition: { default: 0, forced: 0 }, tags: { language: "eng" } },
    { index: 4, codec_type: "subtitle", codec_name: "ass", disposition: { default: 0, forced: 0 }, tags: { language: "vie" } },
  ],
};

describe("languageEndonym", () => {
  it("names languages in their own language", () => {
    expect(languageEndonym("vi")).toBe("Tiếng Việt");
    expect(languageEndonym("en")).toBe("English");
    expect(languageEndonym("fr")).toBe("Français");
    expect(languageEndonym("und")).toBe("Không xác định");
    expect(languageEndonym("zz-not-a-lang!")).toBe("zz-not-a-lang!");
  });
});

describe("planAudio", () => {
  it("one stereo rendition per source track, labels from language, default from disposition", () => {
    expect(planAudio(sample)).toEqual([
      { streamIndex: 1, name: "audio_1_en", language: "en", label: "English", channels: 2, sourceChannels: 2, isDefault: true, kbps: 128 },
      { streamIndex: 2, name: "audio_2_vi", language: "vi", label: "Tiếng Việt", channels: 2, sourceChannels: 6, isDefault: false, kbps: 128 },
    ]);
  });

  it("first track is default when none is flagged; exactly one default", () => {
    const p: FfprobeResult = {
      streams: [
        { index: 0, codec_type: "video" },
        { index: 1, codec_type: "audio", channels: 2, disposition: { default: 0 }, tags: { language: "jpn" } },
        { index: 2, codec_type: "audio", channels: 2, disposition: { default: 0 }, tags: { language: "eng" } },
      ],
    };
    expect(planAudio(p).map((a) => [a.name, a.isDefault])).toEqual([["audio_1_ja", true], ["audio_2_en", false]]);
    const two: FfprobeResult = {
      streams: [
        { index: 1, codec_type: "audio", channels: 2, disposition: { default: 1 } },
        { index: 2, codec_type: "audio", channels: 2, disposition: { default: 1 } },
      ],
    };
    expect(planAudio(two).filter((a) => a.isDefault)).toHaveLength(1);
  });

  it("duplicate labels are disambiguated with the stream title; unknown language gets a generic label", () => {
    const p: FfprobeResult = {
      streams: [
        { index: 1, codec_type: "audio", channels: 2, tags: { language: "eng" } },
        { index: 2, codec_type: "audio", channels: 2, tags: { language: "eng", title: "Commentary" } },
        { index: 3, codec_type: "audio", channels: 2 },
      ],
    };
    expect(planAudio(p).map((a) => a.label)).toEqual(["English 1", "English (Commentary)", "Âm thanh 3"]);
    expect(planAudio({ streams: [{ index: 1, codec_type: "audio", channels: 2 }] })[0]).toMatchObject({ name: "audio_1_und", label: "Âm thanh gốc" });
  });

  it("video-only and zero-channel audio produce no audio renditions; caps at 8 tracks", () => {
    expect(planAudio({ streams: [{ index: 0, codec_type: "video" }, { index: 1, codec_type: "audio", channels: 0 }] })).toEqual([]);
    const many: FfprobeResult = { streams: Array.from({ length: 12 }, (_, i) => ({ index: i, codec_type: "audio", channels: 2 })) };
    expect(planAudio(many)).toHaveLength(8);
  });
});

describe("planSubtitles", () => {
  it("sample: endonym labels, no default (source has none), not forced", () => {
    const { extract } = planSubtitles(sample);
    expect(extract.map((e) => [e.fileName, e.language, e.label, e.isDefault, e.isForced])).toEqual([
      ["01_en.vtt", "en", "English", false, false],
      ["02_vi.vtt", "vi", "Tiếng Việt", false, false],
    ]);
  });

  it("forced / SDH flags, a single default that is never the forced track", () => {
    const p: FfprobeResult = {
      streams: [
        { index: 1, codec_type: "subtitle", codec_name: "subrip", disposition: { default: 1, forced: 1 }, tags: { language: "eng" } },
        { index: 2, codec_type: "subtitle", codec_name: "subrip", disposition: { default: 1 }, tags: { language: "vie" } },
        { index: 3, codec_type: "subtitle", codec_name: "subrip", disposition: { default: 1, hearing_impaired: 1 }, tags: { language: "eng" } },
        { index: 4, codec_type: "subtitle", codec_name: "hdmv_pgs_subtitle", tags: { language: "eng" } },
      ],
    };
    const { extract, skipped } = planSubtitles(p);
    expect(extract.map((e) => [e.label, e.isDefault, e.isForced])).toEqual([
      ["English (Forced)", false, true],
      ["Tiếng Việt", true, false],
      ["English [CC]", false, false],
    ]);
    expect(skipped.map((s) => s.index)).toEqual([4]);
  });
});
