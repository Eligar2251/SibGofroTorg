// =========================================================
// FILE: src/app/api/admin/settings/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { updateSettings } from "@/lib/firestore-queries";
import { requireAdminApi } from "@/lib/auth";

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = (await request.json()) as Record<string, string>;
    await updateSettings(body);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update settings error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}