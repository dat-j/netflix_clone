import type { FfprobeResult } from "../lib/probe.js";
import { languageEndonym, normalizeLanguage } from "./subtitles.js";

/** Each source audio track becomes one AAC-LC stereo HLS rendition (EXT-X-MEDIA TYPE=AUDIO). */
export const AUDIO_KBPS = 128;
export const AUDIO_GROUP_ID = "aud";
/** Upper bound on audio renditions per asset (keeps the ffmpeg graph and the player menu sane). */
export const MAX_AUDIO_TRACKS = 8;

export interface AudioPlan {
  /** Absolute ffprobe stream index. */
  streamIndex: number;
  /** Output directory / variant name: `audio_<n>_<lang>` (matches the API's rendition-name rules). */
  name: string;
  language: string;
  label: string;
  /** Output channels (always stereo). */
  channels: 2;
  sourceChannels: number | null;
  isDefault: boolean;
  kbps: number;
}

/**
 * Audio tracks to transcode: every audio stream with channels > 0 (source order), at most MAX_AUDIO_TRACKS.
 * Labels come from the language (stream `title` tags are often noise like "English Stereo"/"AC3 5.1"); the title is
 * only appended when two tracks would otherwise share a label. Exactly one track is default: the first with
 * disposition.default, else the first track.
 */
export function planAudio(p: FfprobeResult): AudioPlan[] {
  const streams = (p.streams ?? []).filter((s) => s.codec_type === "audio" && (s.channels ?? 1) > 0).slice(0, MAX_AUDIO_TRACKS);
  const defIdx = Math.max(0, streams.findIndex((s) => s.disposition?.default));
  const plans = streams.map((s, i): AudioPlan => {
    const language = normalizeLanguage(s.tags?.language);
    return {
      streamIndex: s.index,
      name: `audio_${i + 1}_${language.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "und"}`,
      language,
      label: languageEndonym(language, streams.length > 1 ? `Âm thanh ${i + 1}` : "Âm thanh gốc"),
      channels: 2,
      sourceChannels: s.channels ?? null,
      isDefault: i === defIdx,
      kbps: AUDIO_KBPS,
    };
  });
  // disambiguate duplicate labels (e.g. two English tracks: main + commentary)
  const count = new Map<string, number>();
  for (const a of plans) count.set(a.label, (count.get(a.label) ?? 0) + 1);
  plans.forEach((a, i) => {
    if (count.get(a.label)! < 2) return;
    const title = streams[i]!.tags?.title?.trim();
    a.label = title && title !== a.label ? `${a.label} (${title})` : `${a.label} ${i + 1}`;
  });
  return plans;
}
