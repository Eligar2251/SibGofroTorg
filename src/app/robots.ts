// =========================================================
// FILE: src/app/robots.ts
// =========================================================

import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://gofrotara.online";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          `/${ADMIN_PATH}`,
          `/${ADMIN_PATH}/`,
          "/api/",
          "/cabinet",
          "/login",
          "/register",
          "/order",
          "/order/",
        ],
      },
      {
        userAgent: "Yandex",
        allow: "/",
        disallow: [
          `/${ADMIN_PATH}`,
          `/${ADMIN_PATH}/`,
          "/api/",
          "/cabinet",
          "/login",
          "/register",
          "/order",
          "/order/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}