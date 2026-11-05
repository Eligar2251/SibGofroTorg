// Migration download and read-only recovery of any previously existing server JSON.
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { canAccessDatabase } from "@/lib/admin-rbac";
import { getLocalDbFilePath } from "@/lib/db-runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function checkAccess() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!canAccessDatabase(auth.role) || !hasPermission(auth, "view_database")) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }
  return auth;
}

export async function GET(request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;

  const format = request.nextUrl.searchParams.get("format") || "json";
  const inline = request.nextUrl.searchParams.get("inline") === "1";

  if (format === "sql") {
    const sqlPath = path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "supabase",
      "FULL_DATABASE_MIGRATION.sql"
    );
    if (!fs.existsSync(sqlPath)) {
      return NextResponse.json(
        { error: "Файл FULL_DATABASE_MIGRATION.sql не найден" },
        { status: 404 }
      );
    }
    const sqlContent = fs.readFileSync(sqlPath, "utf8");
    return new NextResponse(sqlContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...(inline
          ? {}
          : {
              "Content-Disposition":
                'attachment; filename="FULL_DATABASE_MIGRATION.sql"',
            }),
      },
    });
  }

  if (auth.role !== "owner") return NextResponse.json({ error: "Доступ только владельцу" }, { status: 403 });
  const legacyFile = getLocalDbFilePath();
  if (!fs.existsSync(legacyFile)) return NextResponse.json({ error: "Старый серверный файл не найден." }, { status: 404 });
  return new NextResponse(fs.readFileSync(legacyFile, "utf8"), { headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Content-Disposition": 'attachment; filename="legacy-server-local-db.json"',
  } });
}

export async function POST(_request: NextRequest) {
  const auth = await checkAccess();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ error: "Импорт в серверную JSON-БД отключён. Существующие файлы не удалены." }, { status: 410 });
}
