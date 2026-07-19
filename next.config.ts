// =========================================================
// FILE: next.config.ts
// =========================================================

import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: isProd ? 60 * 60 * 24 * 30 : 60,
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  // Fix turbopack root directory issue
  turbopack: {
    root: __dirname,
  },

  // CSP + security — в src/proxy.ts (nonce).
  // Здесь только кеш публичных ассетов.
  // НЕ трогаем /_next/static — Next сам ставит immutable long-cache в prod.
  async headers() {
    if (!isProd) return [];

    const longCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=31536000, immutable",
      },
    ];

    const dayCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=86400, stale-while-revalidate=604800",
      },
    ];

    // path-to-regexp: отдельные source на каждое расширение
    // (regex вида /:path*\.(?:svg|...) — invalid в Next.js)
    const staticExt = [
      "svg",
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "avif",
      "ico",
      "woff",
      "woff2",
      "ttf",
      "otf",
      "pdf",
    ];

    return [
      {
        source: "/favicon.ico",
        headers: dayCache,
      },
      {
        source: "/robots.txt",
        headers: dayCache,
      },
      {
        source: "/sitemap.xml",
        headers: dayCache,
      },
      {
        source: "/manifest.webmanifest",
        headers: dayCache,
      },
      {
        source: "/site.webmanifest",
        headers: dayCache,
      },
      ...staticExt.map((ext) => ({
        source: `/:path*.${ext}`,
        headers: longCache,
      })),
    ];
  },
};

export default nextConfig;