// =========================================================
// FILE: next.config.ts
// =========================================================

import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,

  images: {
    // Любые внешние картинки идут через наш /media (src/lib/image-loader.ts).
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // Ширины под карточки товаров на мобильных.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 480, 560],
  },

  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  // Standalone output ускоряет контейнерный деплой: рантайм получает
  // уже собранный self-contained bundle без повторной установки prod-deps.
  output: "standalone",

  // Fix turbopack root directory issue
  turbopack: {
    root: __dirname,
  },

  // CSP + security — в src/proxy.ts.
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