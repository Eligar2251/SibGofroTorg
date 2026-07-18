// src/app/api/products/[productId]/views/route.ts
import { NextRequest, NextResponse } from "next/server";
import { recordProductView, getProductViewCount } from "@/lib/firestore-queries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const body = await request.json();
    const { sessionId, userId, ipHash, userAgent, referrer } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 });
    }

    const result = await recordProductView(productId, {
      userId: userId || null,
      sessionId,
      ipHash: ipHash || null,
      userAgent: userAgent || null,
      referrer: referrer || null,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Record product view error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const viewCount = await getProductViewCount(productId);
    return NextResponse.json({ viewCount });
  } catch (error) {
    console.error("Get product view count error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}