// =========================================================
// FILE: src/app/api/admin/rent/helpers.ts
// Общие проверки доступа API учёта аренды.
// Чтение — admin/manager/lawyer; редактирование — только admin.
// =========================================================

import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { canEditRent } from "@/lib/admin-rbac";
import type { AdminSession } from "@/lib/auth";

export async function requireRentRead(): Promise<AdminSession | NextResponse> {
  return requireAdminApi();
}

export async function requireRentEdit(): Promise<AdminSession | NextResponse> {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!canEditRent(auth.role)) {
    return NextResponse.json(
      { error: "Недостаточно прав: раздел аренды редактирует только администратор" },
      { status: 403 }
    );
  }
  return auth;
}
