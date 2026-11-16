import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} phút`;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

export function formatRemaining(positionSec: number, durationSec: number): string | null {
  const left = Math.max(0, Math.round((durationSec - positionSec) / 60));
  if (!durationSec || left <= 0) return null;
  return left >= 60 ? `Còn ${Math.floor(left / 60)} giờ ${left % 60} phút` : `Còn ${left} phút`;
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString("vi-VN")} ${currency}`;
  }
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", opts).format(d);
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "Vừa xong";
  if (min < 60) return `${min} phút trước`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return formatDate(iso);
}

export function qualityLabel(height: number | null | undefined): string | null {
  if (!height) return null;
  if (height >= 2160) return "4K";
  if (height >= 1080) return "Full HD";
  if (height >= 720) return "HD";
  return "SD";
}

/** Strip Vietnamese diacritics (used for client-side highlighting, the API does the real search) */
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

export function safeNextPath(next: string | null | undefined, fallback = "/browse"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
