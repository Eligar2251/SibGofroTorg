// =========================================================
// FILE: src/app/sitemap.ts
// =========================================================

import type { MetadataRoute } from "next";
import { getCategories, getProducts } from "@/lib/supabase-queries";
import { SITE_URL } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const revalidate = 3600; // раз в час

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/catalog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.95,
    },
    {
      url: `${SITE_URL}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/delivery`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.75,
    },
    {
      url: `${SITE_URL}/contacts`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/wastepaper`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/search`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.4,
    },
  ];

  try {
    const [categories, products] = await Promise.all([
      getCategories(),
      getProducts({ limitCount: 5000 }),
    ]);

    const categoryUrls: MetadataRoute.Sitemap = categories.map((c) => ({
      url: `${SITE_URL}/catalog/${c.slug}`,
      lastModified: c.createdAt ? new Date(c.createdAt) : new Date(),
      changeFrequency: "daily" as const,
      priority: 0.85,
    }));

    const productUrls: MetadataRoute.Sitemap = products
      .filter((p) => p.slug && p.isVisible !== false)
      .map((p) => ({
        url: `${SITE_URL}/catalog/product/${p.slug}`,
        lastModified: p.updatedAt
          ? new Date(p.updatedAt)
          : p.createdAt
            ? new Date(p.createdAt)
            : new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.8,
      }));

    return [...staticPages, ...categoryUrls, ...productUrls];
  } catch (e) {
    console.error("sitemap error:", e);
    return staticPages;
  }
}