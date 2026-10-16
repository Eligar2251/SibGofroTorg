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
import { getAdminDb } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity-log";
import { parseAdminRole } from "@/lib/admin-rbac";
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

  const ip = clientIp(request);
  const rl = rateLimit(`admin-login:${ip}`, 10, 15 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите и попробуйте снова." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "");

    if (!username || !password) {
      return NextResponse.json(
        { error: "Логин и пароль обязательны" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const { data: admin, error } = await db
      .from("admins")
      .select("*")
      .eq("username", username)
      .limit(1)
      .maybeSingle();

    // Ошибка БД — это НЕ «неверный пароль»: показываем настоящую причину.
    if (error) {
      console.error("Admin login db error:", error);
      return noStoreJson(
        {
          error: "База данных недоступна",
          code: "db_unavailable",
          detail: error.message,
          hint:
            "Логин и пароль верны, но приложение не может обратиться к базе. " +
            "Откройте /api/health/db?deep=1 — там причина (Supabase на паузе, отозванный ключ, сеть).",
          diagnostics: "/api/health/db",
        },
        503
      );
    }

    if (!admin) {
      return NextResponse.json(
        { error: "Неверный логин или пароль" },
        { status: 401 }
      );
    }

    if (admin.is_active === false) {
      return NextResponse.json(
        { error: "Аккаунт деактивирован. Обратитесь к администратору." },
        { status: 403 }
      );
    }

    let valid = false;

    // Новый формат: passwordHash (scrypt salt:hash)
    if (admin.password_hash && typeof admin.password_hash === "string") {
      valid = verifyPassword(password, admin.password_hash);
    }
    // Legacy: plaintext password — мигрируем в hash
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
      return NextResponse.json(
        { error: "Неверный логин или пароль" },
        { status: 401 }
      );
    }

    // У старых администраторов колонка role могла быть пустой — это admin.
    // Неизвестную роль никогда не повышаем до admin: такой аккаунт должен
    // быть исправлен в БД, иначе JWT мог бы получить лишние права.
    const role = parseAdminRole(admin.role ?? "admin");
    if (!role) {
      return NextResponse.json(
        { error: "Для аккаунта указана неизвестная роль" },
        { status: 403 }
      );
    }

    try {
      await createSession({
        username,
        role,
        displayName: admin.display_name || username,
      });
    } catch (sessionError) {
      console.error("Admin session error:", sessionError);
      return noStoreJson(
        {
          error: "Не удалось создать сессию админки",
          code: "session_secret_missing",
          detail:
            sessionError instanceof Error ? sessionError.message : String(sessionError),
          hint:
            "Задайте переменную ADMIN_SESSION_SECRET (строка 32+ символов) в переменных окружения приложения и перезапустите его. Логин и пароль при этом верны.",
        },
        503
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

    return NextResponse.json({ success: true, role });
  } catch (error) {
    console.error("Login error:", error);
    if (isDbUnavailable(error)) {
      return noStoreJson(
        {
          error: "База данных недоступна",
          code: "db_unavailable",
          detail: error instanceof Error ? error.message : String(error),
          hint: "Откройте /api/health/db?deep=1 — там причина и что делать.",
          diagnostics: "/api/health/db",
        },
        503
      );
    }
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
