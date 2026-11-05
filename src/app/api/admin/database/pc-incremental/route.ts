import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { resolveSupabaseCredentials } from "@/lib/db-runtime-config";
import { createDirectSupabaseClient } from "@/lib/supabase-server-engine";
import { validateFullSnapshot } from "@/lib/full-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function owner() {
  const session = await requireAdminApi();
  if (session instanceof NextResponse) return session;
  return session.role === "owner" ? session : NextResponse.json({ error: "Доступ только владельцу" }, { status: 403 });
}
function client(source: unknown) {
  if (source !== "primary" && source !== "secondary") throw new Error("Недопустимый источник");
  const c = resolveSupabaseCredentials(source);
  if (!c.configured) throw new Error(`${c.label}: URL и секретный ключ не настроены`);
  return createDirectSupabaseClient(c.url, c.serviceRoleKey, 60_000);
}
function noStore(data: unknown) { return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }); }
function error(e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
// Metadata only; no backup file is stored on the web server.
const globalState = globalThis as unknown as { __sgtPcPrune?: Map<string, number> };
async function maybePrune(db: ReturnType<typeof client>, source: string) {
  const cache = globalState.__sgtPcPrune ??= new Map();
  if (Date.now() - (cache.get(source) || 0) < 5 * 60 * 1000) return;
  cache.set(source, Date.now());
  const { error } = await db.rpc("sgt_pc_backup_prune");
  if (error) { cache.delete(source); console.error("[pc-backup] could not prune change metadata", error.message); }
}
export async function GET(req: NextRequest) {
  const auth = await owner(); if (auth instanceof NextResponse) return auth;
  try {
    const source = req.nextUrl.searchParams.get("source");
    const db = client(source);
    const { data, error: err } = await db.rpc("sgt_pc_backup_snapshot");
    if (err) {
      if (/Incremental (partition )?triggers? missing|Incremental triggers missing or disabled/i.test(err.message)) {
        throw new Error("Журнал изменений на этой Supabase не подготовлен. В разделе «База данных» нажмите «Подготовить отслеживание Supabase» для этой базы. Полные снимки можно сохранять и без журнала.");
      }
      throw new Error(`Не удалось начать отслеживание: ${err.message}. Проверьте, что на этой Supabase установлены миграции полного и инкрементального бэкапа.`);
    }
    validateFullSnapshot(data?.snapshot);
    await maybePrune(db, source!);
    return noStore(data);
  } catch (e) { return error(e); }
}
export async function POST(req: NextRequest) {
  const auth = await owner(); if (auth instanceof NextResponse) return auth;
  const contentType = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const origin = req.headers.get("origin");
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  try {
    if (contentType !== "application/json" || req.headers.get("sec-fetch-site") === "cross-site" || (origin && new URL(origin).host.toLowerCase() !== host)) return NextResponse.json({ error:"Недопустимый источник запроса" }, { status:403 });
  } catch { return NextResponse.json({ error:"Недопустимый источник запроса" }, { status:403 }); }
  try {
    const body = await req.json();
    const db = client(body.source);
    if (body.action === "enable" || body.action === "disable") {
      const { error: actionError } = await db.rpc(body.action === "enable" ? "sgt_pc_backup_enable" : "sgt_pc_backup_disable");
      if (actionError) throw new Error(`Не удалось изменить отслеживание: ${actionError.message}`);
      return noStore({ ok: true });
    }
    if (typeof body.instance !== "string" || !/^[a-f0-9]{32}$/.test(body.instance) || typeof body.cursor !== "string" || !/^[0-9]{1,19}$/.test(body.cursor) || typeof body.catalogHash !== "string" || !/^[a-f0-9]{32}$/.test(body.catalogHash)) throw new Error("Некорректные метаданные копии");
    const { data, error: err } = await db.rpc("sgt_pc_backup_changes", { p_instance: body.instance, p_cursor: body.cursor, p_catalog_hash: body.catalogHash });
    if (err) throw new Error(`Не удалось проверить изменения: ${err.message}`);
    await maybePrune(db, body.source);
    return noStore(data);
  } catch (e) { return error(e); }
}
