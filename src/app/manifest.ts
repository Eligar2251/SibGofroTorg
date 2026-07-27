// src/app/manifest.ts
// Web App Manifest — отдаётся Next.js по /manifest.webmanifest.
//
// display: "standalone" убирает адресную строку и панель браузера, когда
// сайт добавлен на домашний экран (Android/Chrome, десктопные браузеры).
// На iOS Safari за это отвечает <meta name="apple-mobile-web-app-capable">
// в src/app/layout.tsx — манифест там пока не управляет режимом показа.

import type { MetadataRoute } from "next";
import { SITE_NAME, DEFAULT_DESCRIPTION } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — гофротара и упаковка`,
    short_name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#1b2b4b",
    lang: "ru",
    dir: "ltr",
    categories: ["business", "shopping"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // maskable — чтобы Android не рисовал белую рамку вокруг иконки
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
