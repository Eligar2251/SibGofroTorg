// =========================================================
// FILE: src/app/api/admin/rent/building/route.ts
// Схема здания аренды: чтение и сохранение.
// GET  — любой авторизованный (admin/manager/lawyer)
// POST — только admin (full access)
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireRentRead, requireRentEdit } from "../helpers";
import { getRentBuildingScheme, saveRentBuildingScheme, type RentBuildingScheme } from "@/lib/rent-building";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireRentRead();
  if (auth instanceof NextResponse) return auth;
  try {
    const scheme = await getRentBuildingScheme();
    return NextResponse.json(scheme, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (e: any) {
    console.error("rent building GET error", e);
    return NextResponse.json({ error: e?.message || "Не удалось загрузить схему" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRentEdit();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await request.json()) as Partial<RentBuildingScheme>;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    }
    const buildings = Array.isArray(body.buildings) ? body.buildings : [];
    const offices = Array.isArray(body.offices) ? body.offices : [];
    await saveRentBuildingScheme({ buildings, offices } as RentBuildingScheme);
    const scheme = await getRentBuildingScheme();
    return NextResponse.json(scheme);
  } catch (e: any) {
    console.error("rent building POST error", e);
    return NextResponse.json({ error: e?.message || "Не удалось сохранить схему" }, { status: 500 });
  }
}
