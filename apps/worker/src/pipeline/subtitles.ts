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

const upperFirst = (s: string, locale: string) => {
  try {
    return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  } catch {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
};

/**
 * Human label for a language, in that language (endonym): `vi` → "Tiếng Việt", `en` → "English", `ja` → "日本語".
 * `und` → `fallback`.
 */
export function languageEndonym(lang: string, fallback = "Không xác định"): string {
  if (lang === "und") return fallback;
  try {
    const name = new Intl.DisplayNames([lang], { type: "language" }).of(lang);
    if (name && name.toLowerCase() !== lang.toLowerCase()) return upperFirst(name, lang);
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

/**
 * Text subtitle tracks to extract as WebVTT. Labels are the language's own name ("Tiếng Việt", "English"), with
 * " (Forced)" / " [CC]" from the dispositions; a stream `title` is only used to tell apart two tracks that would get
 * the same label. At most one track is default (first non-forced track with disposition.default).
 */
export function planSubtitles(p: FfprobeResult): { extract: SubtitlePlan[]; skipped: FfprobeStream[] } {
  const subs = (p.streams ?? []).filter((s) => s.codec_type === "subtitle");
  const extract: SubtitlePlan[] = [];
  const skipped: FfprobeStream[] = [];
  const src: FfprobeStream[] = [];
  let haveDefault = false;
  for (const s of subs) {
    if (!isTextSubtitle(s.codec_name)) {
      skipped.push(s);
      continue;
    }
    const language = normalizeLanguage(s.tags?.language);
    const isForced = !!s.disposition?.forced || /\bforced\b/i.test(s.tags?.title ?? "");
    const sdh = !!s.disposition?.hearing_impaired || /\b(sdh|cc)\b/i.test(s.tags?.title ?? "");
    const isDefault = !haveDefault && !isForced && !!s.disposition?.default;
    if (isDefault) haveDefault = true;
    const label = `${languageEndonym(language)}${isForced ? " (Forced)" : ""}${sdh ? " [CC]" : ""}`;
    src.push(s);
    extract.push({
      streamIndex: s.index,
      codec: s.codec_name!,
      language,
      label,
      isDefault,
      isForced,
      fileName: `${String(extract.length + 1).padStart(2, "0")}_${language.replace(/[^a-z0-9-]/gi, "")}.vtt`,
    });
  }
  const count = new Map<string, number>();
  for (const e of extract) count.set(e.label, (count.get(e.label) ?? 0) + 1);
  extract.forEach((e, i) => {
    if (count.get(e.label)! < 2) return;
    const title = src[i]!.tags?.title?.trim();
    e.label = title && title !== e.label ? `${e.label} (${title})` : `${e.label} ${i + 1}`;
  });
  return { extract, skipped };
}

export function buildSubtitleArgs(input: string, outDir: string, plans: SubtitlePlan[]): string[] {
  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", input];
  for (const p of plans) args.push("-map", `0:${p.streamIndex}`, "-c:s", "webvtt", "-f", "webvtt", `${outDir}/${p.fileName}`);
  return args;
}
