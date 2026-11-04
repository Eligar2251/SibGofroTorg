import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { captureFullSnapshot, effectiveSource, fullBackupStatus, invalidateFullReplicaReadiness, isFullBackupRunning, restoreFullSnapshotTargets, restartFullBackupScheduler, runFullReplication, validateFullSnapshot } from "@/lib/full-backup";
import { readFullBackupSettings, saveFullBackupSettings } from "@/lib/full-backup-settings";
import { invalidateProductsCache } from "@/lib/supabase-queries";
import { invalidateDatabaseSchemaCache } from "@/lib/admin-database";
import type { DbBackendMode } from "@/lib/db-runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function ownerOnly() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "owner") return NextResponse.json({ error: "Доступ только владельцу" }, { status: 403 });
  return auth;
}
export async function GET(req: NextRequest) {
  const auth = await ownerOnly(); if (auth instanceof NextResponse) return auth;
  try {
    if (req.nextUrl.searchParams.get("download") === "1") {
      const source = effectiveSource();
      const snapshot = await captureFullSnapshot(source);
      if (effectiveSource() !== source) throw new Error("Рабочая база изменилась во время создания копии. Повторите попытку.");
      return new NextResponse(JSON.stringify(snapshot), { headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="sgt-full-public-${new Date().toISOString().slice(0, 10)}.json"`,
      } });
    }
    return NextResponse.json(fullBackupStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 }); }
}
export async function PUT(req: NextRequest) {
  const auth = await ownerOnly(); if (auth instanceof NextResponse) return auth;
  try {
    if (isFullBackupRunning()) return NextResponse.json({ error: "Дождитесь завершения копирования" }, { status: 409 });
    const body = await req.json();
    if (typeof body.enabled !== "boolean" || !body.targets || !["primary", "secondary", "local"].every(k => typeof body.targets[k] === "boolean")) throw new Error("Некорректные настройки синхронизации");
    const interval = Number(body.intervalSec);
    if (!Number.isInteger(interval) || interval < 60 || interval > 86400) throw new Error("Интервал должен быть от 60 до 86400 секунд");
    if (body.enabled && body.confirmReplace !== true) throw new Error("Подтвердите замену данных в выбранных резервных базах");
    saveFullBackupSettings({ enabled: body.enabled, intervalSec: interval, targets: { primary: body.targets.primary, secondary: body.targets.secondary, local: body.targets.local } });
    invalidateFullReplicaReadiness();
    restartFullBackupScheduler();
    return NextResponse.json(fullBackupStatus());
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
export async function POST(req: NextRequest) {
  const auth = await ownerOnly(); if (auth instanceof NextResponse) return auth;
  try {
    const body = await req.json();
    if (body.action === "run") {
      if (!readFullBackupSettings().enabled) return NextResponse.json({ error: "Сначала включите копирование" }, { status: 400 });
      return NextResponse.json(await runFullReplication());
    }
    if (body.action === "restore") {
      if (readFullBackupSettings().enabled) return NextResponse.json({ error: "Перед восстановлением остановите автоматическое копирование." }, { status: 409 });
      if (isFullBackupRunning()) return NextResponse.json({ error: "Дождитесь завершения копирования" }, { status: 409 });
      if (body.confirmReplace !== true) return NextResponse.json({ error: "Подтвердите полную замену данных" }, { status: 400 });
      const targets: DbBackendMode[] = Array.isArray(body.targets) ? body.targets : [];
      if (!targets.length || targets.some(t => !["primary", "secondary", "local"].includes(t)) || new Set(targets).size !== targets.length) throw new Error("Выберите базы для восстановления");
      const snapshot = validateFullSnapshot(body.snapshot);
      const results = await restoreFullSnapshotTargets(snapshot, targets);
      invalidateProductsCache(); invalidateDatabaseSchemaCache();
      return NextResponse.json({ ok: results.every(r => r.ok), results }, { status: results.every(r => r.ok) ? 200 : 207 });
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
