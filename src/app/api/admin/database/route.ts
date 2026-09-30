// =========================================================
// FILE: src/app/api/admin/database/route.ts
// «База Данных»: список таблиц для раздела админки.
// Просмотр и правка ячеек — только admin и owner.
// =========================================================

import { NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { isOwner } from "@/lib/admin-rbac";
import { listDatabaseTables } from "@/lib/admin-database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "view_database")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const tables = await listDatabaseTables();
    const visible = tables.filter(
      (table) => !table.ownerOnly || isOwner(auth.role)
    );
    return NextResponse.json(
      {
        tables: visible,
        role: auth.role,
        canSeeOwnerData: isOwner(auth.role),
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Database tables error:", error);
    return NextResponse.json(
      { error: "Не удалось получить список таблиц" },
      { status: 500 }
    );
  }
}
