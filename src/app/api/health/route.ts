// src/app/api/health/route.ts
//
// Liveness-проверка контейнера. НЕ должна зависеть от Supabase:
// если health-check падает при недоступной БД/отсутствии env-переменных,
// Timeweb считает контейнер нездоровым и перезапускает его — получается
// restart-loop, хотя сам сервер жив и может отдавать страницы.
//
// Проверку доступности БД вынесли в GET /api/health/db (readiness).

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  // Короткий неблокирующий probe БД — чисто информационно.
  // Ошибка не влияет на статус ответа (всегда 200), только на поле db.
  let db: "up" | "down" | "unconfigured" = "unconfigured";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
