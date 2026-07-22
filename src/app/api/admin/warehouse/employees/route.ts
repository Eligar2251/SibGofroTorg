import { NextRequest, NextResponse } from "next/server";
import { saveEmployee } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const result = await saveEmployee({
      id: body.id ?? null,
      name: String(body.name || ""),
      position: body.position ?? null,
      phone: body.phone ?? null,
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Save employee error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
