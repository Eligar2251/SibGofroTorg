// =========================================================
// FILE: next.config.ts
// =========================================================

import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // ── Security / hygiene ──
  poweredByHeader: false,
  compress: true,

  // ── Images ──
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com", pathname: "/**" },
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
    formats: ["image/avif", "image/webp"],
    // разумный дефолт; подгони под реальные размеры, если нужно
    minimumCacheTTL: isProd ? 60 * 60 * 24 * 30 : 60,
  },

  // ── Bundle ──
  experimental: {
    // tree-shake lucide-react — ок и для prod
    optimizePackageImports: ["lucide-react"],
  },

  // CSP + security headers — в src/proxy.ts (nonce).
  // Здесь только кеш публичных ассетов, НЕ /_next/static
  // (Next сам ставит immutable long-cache на хешированные чанки в prod).
  async headers() {
    if (!isProd) {
      // в dev не трогаем Cache-Control — иначе warning + ломается HMR
      return [];
    }

    return [
      // favicon / robots / sitemap / manifest
      {
        source: "/:file(favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|site.webmanifest)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },

      // статичные файлы из /public (картинки, иконки, pdf и т.п.)
      {
        source: "/:path*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|pdf)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;