import { NextRequest, NextResponse } from "next/server";
import { getProducts } from "@/lib/firestore-queries";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim() || "";

    if (q.length < 2) {
      return NextResponse.json([], {
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
      });
    }

    const products = await getProducts({ search: q, limitCount: 6 });

    const result = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      sku: p.sku ?? null,
      price: p.price,
      imageUrl: p.imageUrl ?? null,
      dimensions:
        p.dimensionLength && p.dimensionWidth && p.dimensionHeight
          ? `${p.dimensionLength}×${p.dimensionWidth}×${p.dimensionHeight} ${p.dimensionUnit || "мм"}`
          : null,
    }));

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Search suggest error:", error);
    return NextResponse.json([], {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" },
    });
  }
}