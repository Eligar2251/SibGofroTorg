// =========================================================
// FILE: src/app/api/products/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { isProductAvailable } from "@/lib/stock-availability";
import { getCategoryBySlug, getProducts } from "@/lib/supabase-queries";
import { parseTagList } from "@/lib/home-tiles";

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
    const saleOnly = searchParams.get("sale") === "1";
    // Метки плиток главной: ?tag=озон,вб — товары с любой из меток
    // (учитываются products.tags и бейджи товара).
    const tags = parseTagList(searchParams.get("tag") || "");

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
      limitCount: limitCount ?? (categorySlug || q || tags.length ? undefined : 48),
      promoOnly: promoOnly || undefined,
      featuredOnly: featuredOnly || undefined,
      saleOnly: saleOnly || undefined,
      tags: tags.length ? tags : undefined,
    });

    if (stock === "yes") {
      // Единое правило наличия: флаг in_stock + положительный остаток.
      products = products.filter((p) => isProductAvailable(p));
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