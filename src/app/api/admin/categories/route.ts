// =========================================================
// FILE: src/app/api/admin/categories/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createCategory } from "@/lib/supabase-queries";
import { requireAdminApi } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json(
        { error: "Название обязательно" },
        { status: 400 }
      );
    }
    const result = await createCategory(body);
    revalidateTag("categories", { expire: 0 });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Create category error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}