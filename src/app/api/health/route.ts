// src/app/api/health/route.ts

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  // Короткий неблокирующий probe БД — чисто информационно.
  // Ошибка не влияет на статус ответа (всегда 200), только на поле db.
  let db: "up" | "down" | "unconfigured" = "unconfigured";
  const hasSupabaseUrl = Boolean(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  const hasSupabaseSecret = Boolean(
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  if (hasSupabaseUrl && hasSupabaseSecret) {
    try {
      const { getAdminDb } = await import("@/lib/supabase");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const { error } = await getAdminDb()
          .from("settings")
          .select("key")
          .limit(1);
        db = error ? "down" : "up";
      } finally {
        clearTimeout(timer);
      }
    } catch {
      db = "down";
    }
  }

  return Response.json({
    ok: true,
    db,
    uptimeSec: Math.round(process.uptime()),
    latencyMs: Date.now() - startedAt,
    ts: new Date().toISOString(),
  });
}
