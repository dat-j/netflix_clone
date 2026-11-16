import type { FfprobeResult, FfprobeStream } from "../lib/probe.js";

const TEXT_SUB_CODECS = new Set([
  "subrip", "srt", "ass", "ssa", "webvtt", "mov_text", "text", "subviewer", "subviewer1", "microdvd", "mpl2",
  "jacosub", "sami", "realtext", "pjs", "stl", "vplayer",
]);
/** Image-based (PGS/VobSub/DVB/…) need OCR — skipped. */
export function isTextSubtitle(codec: string | undefined): boolean {
  return !!codec && TEXT_SUB_CODECS.has(codec);
}

const ISO639_2_TO_1: Record<string, string> = {
  eng: "en", vie: "vi", fre: "fr", fra: "fr", ger: "de", deu: "de", spa: "es", ita: "it", jpn: "ja", kor: "ko",
  chi: "zh", zho: "zh", rus: "ru", por: "pt", tha: "th", ind: "id", ara: "ar", hin: "hi", dut: "nl", nld: "nl",
  pol: "pl", tur: "tr", swe: "sv", nor: "no", dan: "da", fin: "fi", gre: "el", ell: "el", heb: "he", cze: "cs",
  ces: "cs", hun: "hu", rum: "ro", ron: "ro", ukr: "uk", may: "ms", msa: "ms", fil: "fil", tgl: "tl", khm: "km",
  lao: "lo", bur: "my", mya: "my",
};
/** BCP-47-ish short code ("en", "vi"); `und` when unknown. */
export function normalizeLanguage(tag: string | undefined | null): string {
  const t = (tag ?? "").trim().toLowerCase();
  if (!t || t === "und" || t === "unk") return "und";
  return ISO639_2_TO_1[t] ?? t;
}
export function languageLabel(lang: string): string {
  if (lang === "und") return "Unknown";
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(lang);
    if (name && name.toLowerCase() !== lang) return name;
  } catch {
    /* invalid code */
  }
  return lang;
}

export interface SubtitlePlan {
  streamIndex: number;
  codec: string;
  language: string;
  label: string;
  isDefault: boolean;
  isForced: boolean;
  /** File name under `subs/`. */
  fileName: string;
}

export function planSubtitles(p: FfprobeResult): { extract: SubtitlePlan[]; skipped: FfprobeStream[] } {
  const subs = (p.streams ?? []).filter((s) => s.codec_type === "subtitle");
  const extract: SubtitlePlan[] = [];
  const skipped: FfprobeStream[] = [];
  for (const s of subs) {
    if (!isTextSubtitle(s.codec_name)) {
      skipped.push(s);
      continue;
    }
    const language = normalizeLanguage(s.tags?.language);
    const isForced = !!s.disposition?.forced;
    const title = s.tags?.title?.trim();
    const label = title || `${languageLabel(language)}${isForced ? " (forced)" : ""}`;
    extract.push({
      streamIndex: s.index,
      codec: s.codec_name!,
      language,
      label,
      isDefault: !!s.disposition?.default,
      isForced,
      fileName: `${String(extract.length + 1).padStart(2, "0")}_${language.replace(/[^a-z0-9-]/gi, "")}.vtt`,
    });
  }
  return { extract, skipped };
}

export function buildSubtitleArgs(input: string, outDir: string, plans: SubtitlePlan[]): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", input];
  for (const p of plans) args.push("-map", `0:${p.streamIndex}`, "-c:s", "webvtt", "-f", "webvtt", `${outDir}/${p.fileName}`);
  return args;
}
