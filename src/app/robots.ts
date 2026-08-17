// =========================================================
// FILE: src/app/robots.ts
// =========================================================

import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

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