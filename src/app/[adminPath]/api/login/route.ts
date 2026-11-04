// =========================================================
// FILE: src/app/[adminPath]/api/login/route.ts
//
// Ключевое отличие от прошлой версии: сбой подключения к базе больше НЕ
// выглядит как «Неверный логин или пароль». Если запрос к таблице admins
// упал (проект Supabase на паузе, отозванный ключ, сеть), маршрут отвечает
// 503 с кодом db_unavailable, пояснением и ссылкой на отчёт о базе. Именно
// из-за прежнего поведения казалось, что «истёк JWT» или слетел пароль.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getAdminDb, probeDatabaseBackend } from "@/lib/supabase";
import { getDbFailoverState, getDbRuntimeConfig } from "@/lib/db-runtime-config";
import {
  hashPassword,
  verifyAdminStoredPassword,
} from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity-log";
import { getAdminLandingPath, parseAdminRole } from "@/lib/admin-rbac";
import { ADMIN_PATH } from "@/lib/admin-path";
import { isDbUnavailable, noStoreJson } from "@/lib/api-errors";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ adminPath: string }> }
) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isForm = (request.headers.get("content-type") || "")
    .toLowerCase().startsWith("application/x-www-form-urlencoded");
  // HTML-form fallback uses a short error code, never credentials or server details in the URL.
  const respond = (payload: Record<string, unknown>, status: number, formError: string) => {
    if (!isForm) return noStoreJson(payload, status);
    const url = new URL(`/${ADMIN_PATH}/login`, request.url);
    url.searchParams.set("login_error", formError);
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  // Browser-native form submission must not permit cross-site login CSRF.
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return respond({ error: "Недопустимый источник запроса" }, 403, "origin");
  }
  if (origin) {
    try {
      const forwardedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
      if (new URL(origin).host !== forwardedHost) {
        return respond({ error: "Недопустимый источник запроса" }, 403, "origin");
      }
    } catch {
      return respond({ error: "Недопустимый источник запроса" }, 403, "origin");
    }
  }

  const ip = clientIp(request);
  const rl = rateLimit(`admin-login:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    const response = respond({ error: "Слишком много попыток. Подождите и попробуйте снова." }, 429, "rate_limit");
    response.headers.set("Retry-After", String(rl.retryAfterSec));
    return response;
  }

  try {
    const body = isForm
      ? Object.fromEntries((await request.formData()).entries())
      : await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return respond({ error: "Логин и пароль обязательны" }, 400, "missing");
    }

    const db = getAdminDb();
    let { data: admin, error } = await db
      .from("admins")
      .select("*")
      .eq("username", username)
      .limit(1)
      .maybeSingle();

    // Если логин в Supabase Table Editor ввели с заглавной буквы (напр. Eligar2251),
    // а в форме написали строчными (или наоборот) — находим без учёта регистра.
    if (!error && !admin && !/[%_]/.test(username)) {
      const ciRes = await db
        .from("admins")
        .select("*")
        .ilike("username", username)
        .limit(1)
        .maybeSingle();
      if (!ciRes.error && ciRes.data) {
        admin = ciRes.data;
      }
    }

    // Ошибка БД — это НЕ «неверный пароль»: показываем настоящую причину.
    if (error) {
      console.error("Admin login db error:", error);
      return respond(
        {
          error: "База данных недоступна",
          code: "db_unavailable",
          detail: error.message,
          hint:
            "Не удалось проверить логин и пароль: приложение не может обратиться к базе. " +
            "Проверьте, запущена ли база (сервер базы данных / проект Supabase), и перезапустите её.",
        },
        503, "database"
      );
    }

    if (!admin) {
      // Если основная БД упала и переключилась на пустую локальную БД,
      // не обманываем пользователя ошибкой «Неверный пароль», а предлагаем
      // выбрать локальный файл БД для беспарольного входа!
      const failover = getDbFailoverState();
      const cfg = getDbRuntimeConfig();
      if (failover.activeFallbackBackend === "local" || cfg.activeBackend !== "local") {
        const primaryProbe = await probeDatabaseBackend("primary");
        if (!primaryProbe.reachable) {
          return respond(
            {
              error: "Основная база данных не отвечает",
              code: "db_unavailable",
              allowLocalFileLogin: true,
              detail: primaryProbe.error || failover.lastError,
              hint:
                "Основная БД недоступна. Выберите локальный файл БД (.json) ниже, чтобы войти в админ-панель без пароля и продолжить работу автономно.",
            },
            503, "database"
          );
        }
      }
      return respond({ error: "Неверный логин или пароль" }, 401, "credentials");
    }

    if (admin.is_active === false) {
      return respond({ error: "Аккаунт деактивирован. Обратитесь к администратору." }, 403, "inactive");
    }

    let valid = false;

    // Штатный scrypt-хэш (`salt:hash`) ИЛИ пароль, вписанный напрямую
    // через визуальный интерфейс Supabase (Table Editor -> admins -> Insert row):
    // при первом входе такой пароль автоматически зашифровывается в scrypt-хэш.
    if (admin.password_hash && typeof admin.password_hash === "string") {
      const check = verifyAdminStoredPassword(password, admin.password_hash);
      valid = check.valid;
      if (valid && check.needsRehash) {
        try {
          await db
            .from("admins")
            .update({
              password_hash: hashPassword(password),
              updated_at: new Date().toISOString(),
            })
            .eq("id", admin.id);
        } catch (e) {
          console.error("Admin password auto-hash migration failed:", e);
        }
      }
    }
    // Legacy: колонка password — мигрируем в scrypt password_hash
    else if ((admin as any).password && typeof (admin as any).password === "string") {
      valid = (admin as any).password === password;
      if (valid) {
        try {
          await db
            .from("admins")
            .update({
              password_hash: hashPassword(password),
              updated_at: new Date().toISOString(),
            })
            .eq("id", admin.id);
        } catch (e) {
          console.error("Admin password migration failed:", e);
        }
      }
    }

    if (!valid) {
      return respond({ error: "Неверный логин или пароль" }, 401, "credentials");
    }

    // У старых администраторов колонка role могла быть пустой — это admin.
    // Неизвестную роль никогда не повышаем до admin: такой аккаунт должен
    // быть исправлен в БД, иначе JWT мог бы получить лишние права.
    const role = parseAdminRole(admin.role ?? "admin");
    if (!role) {
      return respond({ error: "Для аккаунта указана неизвестная роль" }, 403, "role");
    }

    const canonicalUsername = String(admin.username || username).trim();

    try {
      await createSession({
        username: canonicalUsername,
        role,
        displayName: admin.display_name || canonicalUsername,
      });
    } catch (sessionError) {
      console.error("Admin session error:", sessionError);
      return respond(
        {
          error: "Не удалось создать сессию админки",
          code: "session_secret_missing",
          detail:
            sessionError instanceof Error ? sessionError.message : String(sessionError),
          hint:
            "Задайте переменную ADMIN_SESSION_SECRET (строка 32+ символов) в переменных окружения приложения и перезапустите его. Логин и пароль при этом верны.",
        },
        503, "session"
      );
    }

    await logActivity({
      adminName: admin.display_name || username,
      adminRole: role,
      action: "login",
      entityType: "settings",
      entityId: admin.id,
      entityLabel: `Вход: ${username}`,
      ipAddress: clientIp(request),
    }).catch((error) => {
      // Журнал не должен мешать входу.
      console.error("Admin login log error:", error);
    });

    if (isForm) {
      const response = NextResponse.redirect(new URL(getAdminLandingPath(role, ADMIN_PATH), request.url), 303);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return noStoreJson({ success: true, role });
  } catch (error) {
    console.error("Login error:", error);
    if (isDbUnavailable(error)) {
      return respond(
        {
          error: "База данных недоступна",
          code: "db_unavailable",
          detail: error instanceof Error ? error.message : String(error),
          hint:
            "Проверьте, запущена ли база (сервер базы данных / проект Supabase), и перезапустите её.",
        },
        503, "database"
      );
    }
    return respond({ error: "Ошибка сервера" }, 500, "server");
  }
}
