/**
 * Single source of truth for the product brand. Rebrand = change this object
 * + the --brand tokens in app/globals.css (+ the wordmark glyph in components/brand/logo.tsx).
 */
export const BRAND = {
  name: "Lumio",
  shortName: "Lumio",
  tagline: "Phim, series không giới hạn và nhiều nội dung khác",
  description:
    "Xem phim lẻ, phim bộ và chương trình độc quyền mọi lúc, mọi nơi. Trải nghiệm điện ảnh tại nhà trên mọi thiết bị.",
  supportEmail: "hotro@lumio.vn",
  supportPhone: "1900 0000",
  country: "Việt Nam",
  /** Accent used where CSS variables are not available (OG image, theme-color) */
  accentHex: "#ff5a3c",
  backgroundHex: "#141414",
} as const;

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
