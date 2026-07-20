import { NextRequest, NextResponse } from "next/server";
import { createDeal } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const result = await createDeal({
      date: String(body.date || ""),
      customerName: String(body.customerName || ""),
      customerPhone: body.customerPhone ?? null,
      email: body.email ?? null,
      inn: body.inn ?? null,
      kpp: body.kpp ?? null,
      address: body.address ?? null,
      contactName: body.contactName ?? null,
      comment: body.comment ?? null,
      items: Array.isArray(body.items) ? body.items : [],
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create deal error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
