// =========================================================
// FILE: src/app/api/health/route.ts
// =========================================================

import { getAdminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getAdminDb().collection("settings").limit(1).get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}