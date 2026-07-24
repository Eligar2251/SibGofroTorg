// =========================================================
// FILE: src/app/api/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { getCategoryBySlug, getProducts } from "@/lib/supabase-queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const categorySlug = searchParams.get("category") || undefined;
    const q = searchParams.get("q") || undefined;
    const sort = searchParams.get("sort") || "default";
    const stock = searchParams.get("stock");
    const limitParam = searchParams.get("limit");
    const promoOnly = searchParams.get("promo") === "1";
    const featuredOnly = searchParams.get("featured") === "1";

    let categoryId: string | undefined;
    if (categorySlug) {
      const cat = await getCategoryBySlug(categorySlug);
      if (!cat) {
        return NextResponse.json({ products: [] }, {
        headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
      });
      }
      categoryId = cat.id;
    }

    // Безопасный парсинг лимита с жестким ограничением от 1 до 100
    const rawLimit = limitParam ? Number(limitParam) : undefined;
    const limitCount =
      rawLimit != null && Number.isFinite(rawLimit)
        ? Math.min(Math.max(1, Math.floor(rawLimit)), 100)
        : undefined;

    let products = await getProducts({
      categoryId,
      search: q,
      sortBy: sort,
      // Если лимит не передан, ставим 48 для главной страницы, 
      // иначе undefined для категорий/поиска (чтобы забрать всё, но в пределах разумного)
      limitCount: limitCount ?? (categorySlug || q ? undefined : 48),
      promoOnly: promoOnly || undefined,
      featuredOnly: featuredOnly || undefined,
    });

    if (stock === "yes") {
      products = products.filter((p) => p.inStock);
    }

    // Страховка: никогда не отдаём безразмерный ответ через public API
    if (products.length > 100) {
      products = products.slice(0, 100);
    }

    return NextResponse.json({ products }, {
      headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("API /api/products error:", error);
    return NextResponse.json({ products: [] }, {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }
}