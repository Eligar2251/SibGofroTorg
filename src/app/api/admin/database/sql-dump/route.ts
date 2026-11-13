// =========================================================
// FILE: src/app/api/admin/database/sql-dump/route.ts
// Полный SQL-дамп ДАННЫХ всех таблиц (для вставки в Supabase → SQL Editor).
//   GET ?download=1          — файл sgt-full-data-YYYY-MM-DD.sql как вложение
//   GET ?inline=1            — тот же текст без вложения (просмотр)
//   GET ?format=json         — { sql, filename, totalRows, tables, warnings, … }
//                              (нужен, чтобы записать файл сразу в папку на ПК)
//   GET ?source=primary|secondary|local — база-источник; local = копия на этом ПК
//   GET ?verify=0            — без сверочного SELECT в конце
// Доступ только владельцу: в дампе персональные данные и хеши паролей.
// =========================================================
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { effectiveSource } from "@/lib/full-backup";
import { isPcLocalServer } from "@/lib/pc-local-runtime";
import { createSqlDataDump, isSqlDumpSource, type SqlDumpSource } from "@/lib/sql-dump-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickSource(value: string | null): SqlDumpSource {
  if (value) {
    if (!isSqlDumpSource(value)) throw new Error("Недопустимый источник дампа");
    return value;
  }
  const active = effectiveSource();
  if (active === "primary" || active === "secondary") return active;
  if (isPcLocalServer()) return "local";
  throw new Error("Рабочая база не определена: выберите Supabase №1, Supabase №2 или локальную копию ПК");
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "owner") return NextResponse.json({ error: "Доступ только владельцу" }, { status: 403 });
  try {
    const params = req.nextUrl.searchParams;
    const dump = await createSqlDataDump({ source: pickSource(params.get("source")), verify: params.get("verify") !== "0" });
    if (params.get("format") === "json") {
      return NextResponse.json(dump, { headers: { "Cache-Control": "no-store" } });
    }
    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Sgt-Dump-Rows": String(dump.totalRows),
      "X-Sgt-Dump-Bytes": String(dump.bytes),
      ...(dump.warnings.length ? { "X-Sgt-Dump-Warnings": String(dump.warnings.length) } : {}),
    };
    if (params.get("inline") === "1") return new NextResponse(dump.sql, { headers });
    return new NextResponse(dump.sql, { headers: { ...headers, "Content-Disposition": `attachment; filename="${dump.filename}"` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
