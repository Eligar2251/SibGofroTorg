// src/app/api/health/route.ts
import { getAdminDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getAdminDb().from("settings").select("key").limit(1);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
