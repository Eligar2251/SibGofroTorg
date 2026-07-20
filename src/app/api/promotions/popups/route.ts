import { NextResponse } from "next/server";
import { getProductById, getPromotions } from "@/lib/firestore-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^https:\/\//i.test(value)) return value;
  return null;
}

export async function GET() {
  try {
    const promotions = (await getPromotions()).filter(
      (promotion) => promotion.isPopup === true
    );

    const result = await Promise.all(
      promotions.map(async (promotion) => {
        let href: string | null = null;
        if (promotion.linkType === "url") {
          href = safeLink(promotion.linkUrl);
        } else if (promotion.linkType === "product" && promotion.productId) {
          const product = await getProductById(promotion.productId);
          if (product?.slug) href = `/catalog/product/${product.slug}`;
        }

        return {
          id: promotion.id,
          title: promotion.title,
          subtitle: promotion.subtitle || null,
          badge: promotion.badge || "Акция",
          imageUrl: promotion.imageUrl || null,
          href,
          popupStartAt: promotion.popupStartAt || null,
          popupDelaySeconds: Math.min(
            3600,
            Math.max(0, Number(promotion.popupDelaySeconds) || 0)
          ),
          popupDurationSeconds: Math.min(
            300,
            Math.max(3, Number(promotion.popupDurationSeconds) || 15)
          ),
        };
      })
    );

    return NextResponse.json(
      { promotions: result },
      {
        headers: {
          "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("Popup promotions error:", error);
    return NextResponse.json(
      { promotions: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
