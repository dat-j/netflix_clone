import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// .env dùng chung ở gốc monorepo
loadEnv({ path: path.resolve(process.cwd(), "../../.env"), quiet: true });

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

/**
 * Artwork origins the image optimizer may fetch from. Comma-separated URL patterns, e.g.
 *   MEDIA_IMAGE_ORIGINS="https://img.example-cdn.com/**,http://localhost:4000/v1/dev-cdn/p/**"
 * Defaults to the dev CDN served by the API. Set NEXT_PUBLIC_IMAGE_UNOPTIMIZED=1 to let the
 * browser load artwork straight from the CDN (when the CDN already resizes/encodes images).
 */
const imageOrigins = (process.env.MEDIA_IMAGE_ORIGINS ?? `${apiUrl}/v1/dev-cdn/p/**`)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((u) => new URL(u));

const isLocal = imageOrigins.some((u) => ["localhost", "127.0.0.1", "0.0.0.0"].includes(u.hostname));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: imageOrigins,
    formats: ["image/avif", "image/webp"],
    qualities: [60, 75, 85],
    deviceSizes: [390, 640, 828, 1080, 1280, 1600, 1920, 2560, 3200],
    imageSizes: [96, 160, 240, 320, 480],
    minimumCacheTTL: 86400,
    // Only needed when artwork comes from a local dev CDN (never true for a real CDN host)
    dangerouslyAllowLocalIP: isLocal,
  },
  // Web và API cùng origin: /api/v1/* → NestJS /v1/*
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
