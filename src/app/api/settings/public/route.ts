// src/app/api/settings/public/route.ts
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/supabase-queries";

export async function GET() {
  try {
    const settings = (await getSettings()) || {};
    const deliveryPrice = Number(settings.delivery_price);
    const freeDeliveryThreshold = Number(settings.free_delivery_threshold);
    return NextResponse.json({
      deliveryPrice: Number.isFinite(deliveryPrice) && deliveryPrice >= 0 ? deliveryPrice : 800,
      freeDeliveryThreshold:
        Number.isFinite(freeDeliveryThreshold) && freeDeliveryThreshold > 0
          ? freeDeliveryThreshold
          : 30000,
    }, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json(
      { deliveryPrice: 800, freeDeliveryThreshold: 30000 },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  }
}
