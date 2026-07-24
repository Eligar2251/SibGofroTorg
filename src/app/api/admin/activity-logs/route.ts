// src/app/api/admin/activity-logs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (!hasPermission(auth, "view_logs")) {
    return NextResponse.json({ error: "Нет прав для просмотра логов" }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "100") || 100, 1), 500);

    const db = getAdminDb();
    const { data, error } = await db
      .from("activity_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json(data || []);
  } catch (error) {
    console.error("Activity logs error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
