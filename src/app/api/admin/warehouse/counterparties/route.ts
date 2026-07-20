import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { saveCounterparty } from "@/lib/warehouse";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const result = await saveCounterparty({
      name: String(body.name || ""),
      roles: Array.isArray(body.roles) ? body.roles : [],
      phone: body.phone,
      email: body.email,
      inn: body.inn,
      kpp: body.kpp,
      address: body.address,
      contactName: body.contactName,
      comment: body.comment,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
