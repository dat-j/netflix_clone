/** Hàm định dạng thuần cho trang admin (không phụ thuộc React/DOM để dễ test). */

import { twMerge } from "tailwind-merge";

/** Gộp class, lớp sau thắng lớp trước khi xung đột (tailwind-merge). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Bytes (number hoặc BigInt dạng chuỗi) → "1,5 GB". */
export function formatBytes(input: string | number | bigint | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  let n: number;
  try {
    n = typeof input === "number" ? input : Number(BigInt(input));
  } catch {
    n = Number(input);
  }
  if (!Number.isFinite(n) || n < 0) return "—";
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} ${UNITS[i]}`;
}

/** Giây → "1:02:03" / "4:05"; null → "—". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** ISO → "16/11/2026 14:05"; null → "—". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "3 phút trước" kiểu tương đối, dùng cho job. */
export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.round((now - t) / 1000);
  if (diff < 0) return formatDateTime(iso);
  if (diff < 45) return "vừa xong";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} phút trước`;
  if (diff < 86400) return `${Math.round(diff / 3600)} giờ trước`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} ngày trước`;
  return formatDate(iso);
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: currency === "VND" ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString("vi-VN")} ${currency}`;
  }
}

/** Tiến độ job có thể là 0..1 hoặc 0..100 → luôn trả 0..100. */
export function normalizeProgress(progress: number | null | undefined): number {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) return 0;
  const pct = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.max(0, pct));
}

export function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return "—";
  return `${width}×${height}`;
}

export function heightLabel(height: number): string {
  if (height >= 2160) return "4K";
  return `${height}p`;
}

/** Gộp danh sách quốc gia nhập dạng "VN, US" → ["VN","US"]. */
export function parseList(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Di chuyển phần tử trong mảng (cho reorder). */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Tên file từ key S3: "a/b/c.mp4" → "c.mp4". */
export function basename(key: string | null | undefined): string {
  if (!key) return "—";
  const i = key.lastIndexOf("/");
  return i >= 0 ? key.slice(i + 1) : key;
}
