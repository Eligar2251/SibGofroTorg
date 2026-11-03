// src/app/health/db/route.ts → GET /api/health/db

import { getAdminDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseSecret) {
    return Response.json(
      {
        ok: false,
        error:
          "SUPABASE_URL и SUPABASE_SECRET_KEY (или SUPABASE_SERVICE_ROLE_KEY) не заданы в переменных окружения",
      },
      { status: 503 }
    );
  }

  try {
    const { error } = await getAdminDb().from("settings").select("key").limit(1);
    if (error) {
      return Response.json({ ok: false, error: error.message }, { status: 503 });
    }
    return Response.json({ ok: true, db: "up" });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || "supabase_unreachable" },
      { status: 503 }
    );
  }
}
