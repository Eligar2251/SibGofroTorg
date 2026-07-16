// =========================================================
// FILE: src/app/api/auth/profile/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireUserApi, updateUserProfile } from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  const auth = await requireUserApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    await updateUserProfile(auth.uid, {
      name: body.name != null ? String(body.name).trim() : undefined,
      email: body.email != null ? String(body.email).trim() : undefined,
      customerType:
        body.customerType === "legal" || body.customerType === "individual"
          ? body.customerType
          : undefined,
      companyName:
        body.companyName != null ? String(body.companyName).trim() : undefined,
      inn: body.inn != null ? String(body.inn).trim() : undefined,
      kpp: body.kpp != null ? String(body.kpp).trim() : undefined,
      ogrn: body.ogrn != null ? String(body.ogrn).trim() : undefined,
      legalAddress:
        body.legalAddress != null
          ? String(body.legalAddress).trim()
          : undefined,
      actualAddress:
        body.actualAddress != null
          ? String(body.actualAddress).trim()
          : undefined,
      deliveryAddress:
        body.deliveryAddress != null
          ? String(body.deliveryAddress).trim()
          : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Profile update error:", e);
    return NextResponse.json({ error: "Ошибка сохранения" }, { status: 500 });
  }
}