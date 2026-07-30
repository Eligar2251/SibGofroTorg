// src/app/api/admin/activity-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function mapLog(row: any) {
  return {
    id: row.id,
    adminId: row.admin_id || null,
    adminName: row.admin_name || "Система",
    adminRole: row.admin_role || "system",
    action: row.action || "",
    entityType: row.entity_type || "",
    entityId: row.entity_id || "",
    entityLabel: row.entity_label || "",
    details: row.details && typeof row.details === "object" ? row.details : {},
    ipAddress: row.ip_address || "",
    createdAt: row.created_at || null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "view_logs")) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "300") || 300, 1),
      1000
    );

    const db = getAdminDb();
    const { data, error } = await db
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json((data || []).map(mapLog));
  } catch (error) {
    console.error("Activity logs error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
