import { NextResponse } from "next/server";
import { SITE_NAME } from "@/lib/seo";
import { ADMIN_PATH } from "@/lib/admin-path";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      id: `/${ADMIN_PATH}`,
      name: `${SITE_NAME} — управление`,
      short_name: `${SITE_NAME} Админ`,
      description: "Мобильная панель управления СибГофроТорг",
      start_url: `/${ADMIN_PATH}`,
      // scope «/» нужен из-за нормализации Next.js /admin/ → /admin и
      // чтобы переход «Открыть сайт» не выталкивал установленное PWA в Safari/Chrome.
      scope: "/",
      display: "standalone",
      // Android выбирает fullscreen из списка, иначе — standalone.
      display_override: ["fullscreen", "standalone"],
      orientation: "portrait-primary",
      launch_handler: { client_mode: "navigate-existing" },
      background_color: "#f5f3ee",
      theme_color: "#1b2b4b",
      lang: "ru",
      categories: ["business", "productivity"],
      prefer_related_applications: false,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      shortcuts: [
        { name: "Панель", url: `/${ADMIN_PATH}`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "Товары", url: `/${ADMIN_PATH}/products`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "Учёт СибГофроТорг", url: `/${ADMIN_PATH}/warehouse`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    }
  );
}
