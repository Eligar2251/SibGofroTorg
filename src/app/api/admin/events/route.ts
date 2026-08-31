// =========================================================
// FILE: src/app/api/admin/events/route.ts
// SSE-поток изменений для админ-панели.
//
// Браузер держит одно соединение со СВОИМ доменом (EventSource), сервер
// пересылает в него события Supabase Realtime, полученные под service_role.
// Никаких ключей Supabase в браузере, никаких правок CSP (connect-src 'self'),
// доступ — только по admin-session cookie.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import {
  subscribeToChanges,
  subscribeToHubStatus,
  getHubStatus,
  tablesForRole,
  type RealtimeEvent,
} from "@/lib/realtime-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Пинг реже, чем типовой таймаут прокси (60 c), чтобы соединение не рвалось. */
const HEARTBEAT_MS = 25_000;

export async function GET(request: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (unsubscribe) unsubscribe();
        if (unsubscribeStatus) unsubscribeStatus();
        try {
          controller.close();
        } catch {
          // уже закрыт
        }
      };

      const allowedTables = new Set(tablesForRole(session.role));

      // Порядок важен: сначала подписка (она же поднимает канал к Supabase),
      // потом hello — иначе клиент всегда получал бы status: "idle".
      unsubscribe = subscribeToChanges((event: RealtimeEvent) => {
        if (!allowedTables.has(event.table)) return;
        send("change", event);
      });

      // Канал поднимается асинхронно, поэтому о смене состояния сообщаем
      // отдельным событием: как только поток ожил, клиент гасит polling.
      unsubscribeStatus = subscribeToHubStatus((status) => {
        send("status", { ...getHubStatus(), status });
      });

      send("hello", {
        ...getHubStatus(),
        role: session.role,
        tables: [...allowedTables],
        at: new Date().toISOString(),
      });

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsubscribe) unsubscribe();
      if (unsubscribeStatus) unsubscribeStatus();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx на VPS иначе буферизует поток и события приходят пачками
      "X-Accel-Buffering": "no",
    },
  });
}
