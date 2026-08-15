import { NextResponse } from "next/server";
import { SITE_NAME } from "@/lib/seo";

export const dynamic = "force-static";

export function GET() {
  const adminPath =
    process.env.NEXT_PUBLIC_ADMIN_PATH ||
    process.env.ADMIN_SECRET_PATH ||
    "admin";
  return NextResponse.json(
    {
      id: `/${adminPath}`,
      name: `${SITE_NAME} — управление`,
      short_name: `${SITE_NAME} Админ`,
      description: "Мобильная панель управления СибГофроТорг",
      start_url: `/${adminPath}`,
      // scope «/» нужен из-за нормализации Next.js /admin/ → /admin и
      // чтобы переход «Открыть сайт» не выталкивал установленное PWA в Safari/Chrome.
      scope: "/",
      display: "standalone",
      display_override: ["fullscreen", "standalone"],
      orientation: "portrait-primary",
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
        { name: "Панель", url: `/${adminPath}`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "Товары", url: `/${adminPath}/products`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
        { name: "Учёт", url: `/${adminPath}/warehouse`, icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
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
