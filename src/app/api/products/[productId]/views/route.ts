// src/app/api/products/[productId]/views/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  recordProductView,
  getProductViewCount,
} from "@/lib/supabase-queries";
import { verifyUserSession } from "@/lib/user-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const { productId } = await params;
    const body = await request.json().catch(() => ({}));
    const { sessionId, ipHash, userAgent, referrer } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "Session ID required" },
        { status: 400 }
      );
    }

    /* userId берём из серверной сессии — клиенту не доверяем */
    const session = await verifyUserSession().catch(() => null);

    const result = await recordProductView(productId, {
      userId: session?.uid ?? null,
      sessionId: sessionId.slice(0, 128),
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