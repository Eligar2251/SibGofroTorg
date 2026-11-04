import { NextRequest, NextResponse } from "next/server";
import { ADMIN_PATH } from "@/lib/admin-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The old flow uploaded a full database to the web server and activated it.
// It is disabled rather than silently writing user data on the hosting disk.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ adminPath: string }> }) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ emergencyLoginAllowed: false, error: "Аварийный вход через серверную JSON-БД отключён до реализации работы с диском ПК." }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(_request: NextRequest, { params }: { params: Promise<{ adminPath: string }> }) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ error: "Аварийный вход через серверную JSON-БД отключён до реализации работы с диском ПК." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
