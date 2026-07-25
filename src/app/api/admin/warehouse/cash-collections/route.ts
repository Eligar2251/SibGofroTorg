import { NextRequest, NextResponse } from "next/server";
import { collectCash, getCashCollections } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const collections = await getCashCollections();
    return NextResponse.json({ collections });
  } catch (error: any) {
    console.error("Get cash collections error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await collectCash(body.note || null);

    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "cash-collection",
      "cash-collection",
      `Сдана касса на сумму ${result.amount} ₽`
    );

    return NextResponse.json({ success: true, amount: result.amount });
  } catch (error: any) {
    console.error("Collect cash error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
