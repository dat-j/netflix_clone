/** Time formatting for the player chrome. Pure, unit-tested. */

/** 5 → "0:05", 65 → "1:05", 3725 → "1:02:05". Negative/NaN render as "0:00". */
export function formatClock(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Remaining time with a leading minus, Netflix style: "-1:23:45". */
export function formatRemainingClock(currentSec: number, durationSec: number): string {
  const left = Math.max(0, (durationSec || 0) - (currentSec || 0));
  return `-${formatClock(Math.ceil(left - 0.001))}`;
}

/** Spoken form for aria-valuetext: "1 giờ 2 phút 5 giây". */
export function formatSpokenTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} giờ`);
  if (m) parts.push(`${m} phút`);
  if (sec || parts.length === 0) parts.push(`${sec} giây`);
  return parts.join(" ");
}

/** Label for a quality level: 1080 → "1080p (Full HD)". */
export function qualityName(height: number): string {
  if (height >= 2160) return `${height}p (4K)`;
  if (height >= 1080) return `${height}p (Full HD)`;
  if (height >= 720) return `${height}p (HD)`;
  return `${height}p`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** "T1:E3 · Tên tập" label for series (shared with browse/detail). */
export { episodeLabel } from "../../../lib/episodes";
