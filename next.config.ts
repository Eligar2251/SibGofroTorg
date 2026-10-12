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
    // Все внешние изображения (товарные фото из Cloudinary, фото из
    // Unsplash) отдаются с нашего домена через /media/... — браузер
    // посетителя не обращается к иностранным CDN. Лоадер превращает
    // известные внешние ссылки в /media/..., локальные файлы из /public
    // оставляет как есть. Прокси — src/app/media/[...path]/route.ts.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // Промежуточные ширины под карточки товаров на мобильных
    // (DPR 2.6 × ~185px ≈ 480px): без них next/image отдавал исходники
    // ~600px для слотов ~185px — лишние ~150 КиБ на главной (Lighthouse).
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