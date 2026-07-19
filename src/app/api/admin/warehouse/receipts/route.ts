import { NextRequest, NextResponse } from "next/server";
import { createReceipt } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const result = await createReceipt({
      date: String(body.date || ""),
      supplier: String(body.supplier || ""),
      comment: body.comment ?? null,
      items: Array.isArray(body.items) ? body.items : [],
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create receipt error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
