// =========================================================
// FILE: src/app/api/health/recover-admin/route.ts
// Аварийное восстановление доступа в админку БЕЗ SQL.
//
// Когда нет доступа в панель (пароль забыт, аккаунт деактивирован, таблица
// admins пуста), создать/сбросить администратора можно одним POST-запросом.
//
// БЕЗОПАСНОСТЬ:
//   • по умолчанию выключено: пока не задана переменная ADMIN_RECOVERY_TOKEN,
//     маршрут отвечает 404 — никакой «двери» в проекте нет;
//   • токен короче 32 символов считается недействительным;
//   • сравнение токена — постоянное по времени (timingSafeEqual);
//   • ограничение 5 попыток на IP за 15 минут;
//   • пароль не логируется и не возвращается, в базе только scrypt-хеш.
// После восстановления переменную ADMIN_RECOVERY_TOKEN нужно УДАЛИТЬ.
// =========================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminDb } from "@/lib/supabase";
import { hashPassword } from "@/lib/user-auth";
import { ADMIN_ROLES, isFullAccessRole, parseAdminRole } from "@/lib/admin-rbac";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { errorText, noStoreJson } from "@/lib/api-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recoveryToken(): string | null {
  const token = String(process.env.ADMIN_RECOVERY_TOKEN || "").trim();
  if (token.length < 32) return null;
  return token;
}

function tokensEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HTML-форма для браузера: не требует терминала и curl. */
function recoveryFormHtml(): string {
  return `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Восстановление доступа в админку</title>
<style>
  :root { color-scheme: light dark }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px 16px; background: #0b0e14; color: #e8eaed }
  .card { max-width: 460px; margin: 0 auto; background: #151a22; border: 1px solid #2b3442; border-radius: 16px; padding: 22px }
  h1 { font-size: 18px; margin: 0 0 6px }
  p.hint { color: #9aa4b2; font-size: 13px; line-height: 1.5; margin: 0 0 16px }
  label { display: block; font-size: 12px; color: #9aa4b2; margin: 12px 0 6px }
  input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 10px; border: 1px solid #2b3442; background: #0f141b; color: inherit; font-size: 14px }
  button { width: 100%; margin-top: 18px; padding: 12px; border: 0; border-radius: 10px; background: #2f6fed; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer }
  button:disabled { opacity: .6; cursor: default }
  .result { margin-top: 16px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word }
  .ok { color: #6ddc8a } .err { color: #ff8b7a }
</style>
<div class="card">
  <h1>Восстановление доступа в админку</h1>
  <p class="hint">Одноразовая процедура. Заполните поля, нажмите кнопку — аккаунт будет создан или его пароль обновлён.
  После этого <b>удалите переменную ADMIN_RECOVERY_TOKEN</b> в панели хостинга и перезапустите приложение.</p>
  <form id="f">
    <label for="token">ADMIN_RECOVERY_TOKEN</label>
    <input id="token" name="token" type="password" autocomplete="off" required>
    <label for="username">Логин администратора</label>
    <input id="username" name="username" value="owner" required>
    <label for="password">Новый пароль (8+ символов)</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required>
    <label for="role">Роль</label>
    <select id="role" name="role">
      <option value="owner">owner — владелец (полный доступ)</option>
      <option value="admin">admin — администратор</option>
      <option value="manager">manager — менеджер</option>
      <option value="lawyer">lawyer — юрист</option>
      <option value="wastepaper">wastepaper — макулатура</option>
    </select>
    <button type="submit">Восстановить доступ</button>
  </form>
  <div class="result" id="r"></div>
</div>
<script>
  const form = document.getElementById("f");
  const result = document.getElementById("r");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    result.className = "result";
    result.textContent = "Отправляю…";
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const response = await fetch(location.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(() => ({}));
      result.className = response.ok ? "result ok" : "result err";
      result.textContent = body.ok
        ? "Готово: " + (body.note || "доступ восстановлен") + "\nЛогин: " + (body.username || "") + ", роль: " + (body.role || "")
        : "Не получилось: " + (body.error || "неизвестная ошибка") + (body.detail ? "\n" + body.detail : "") + (body.hint ? "\n" + body.hint : "");
    } catch (error) {
      result.className = "result err";
      result.textContent = "Ошибка запроса: " + error.message;
    } finally {
      button.disabled = false;
    }
  });
</script>
</html>`;
}

export async function GET(request: Request) {
  const expected = recoveryToken();
  if (!expected) {
    return new NextResponse(
      JSON.stringify({
        ok: false,
        error: "Not found",
        hint:
          "Функция выключена. Чтобы включить аварийное восстановление доступа, добавьте переменную ADMIN_RECOVERY_TOKEN (случайная строка 32+ символов), перезапустите приложение и откройте этот адрес в браузере.",
      }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } }
    );
  }

  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    return new NextResponse(recoveryFormHtml(), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  return noStoreJson({
    ok: true,
    enabled: true,
    usage:
      'POST {"token":"<ADMIN_RECOVERY_TOKEN>","username":"owner","password":"<новый пароль 8+ символов>","role":"owner"}',
    note: "После восстановления удалите ADMIN_RECOVERY_TOKEN и перезапустите приложение.",
  });
}

export async function POST(request: Request) {
  // Выключено, пока токен не задан: отвечаем как на несуществующий маршрут.
  const expected = recoveryToken();
  if (!expected) {
    return noStoreJson({ ok: false, error: "Not found" }, 404);
  }

  const ip = clientIp(request);
  const rl = rateLimit(`admin-recovery:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.ok) {
    return noStoreJson(
      { ok: false, error: "Слишком много попыток. Повторите позже." },
      429
    );
  }

  let body: { token?: unknown; username?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ ok: false, error: "Ожидается JSON" }, 400);
  }

  const token = String(body.token || "");
  if (!tokensEqual(token, expected)) {
    return noStoreJson({ ok: false, error: "Неверный токен" }, 403);
  }

  const username = String(body.username || "").trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    return noStoreJson(
      {
        ok: false,
        error:
          "Логин: 3–64 символа, латиница, цифры, точка, дефис или подчёркивание",
      },
      400
    );
  }

  const password = String(body.password || "");
  if (password.length < 8 || password.length > 200) {
    return noStoreJson(
      { ok: false, error: "Пароль: от 8 до 200 символов" },
      400
    );
  }

  const requestedRole = body.role ? parseAdminRole(body.role) : null;
  if (body.role && !requestedRole) {
    return noStoreJson(
      { ok: false, error: `Роль должна быть одной из: ${ADMIN_ROLES.join(", ")}` },
      400
    );
  }

  try {
    const db = getAdminDb();

    // Если активных «полных» администраторов нет — восстанавливаемый аккаунт
    // делаем владельцем, иначе админку снова некому будет вести.
    const { data: existing, error: readError } = await db
      .from("admins")
      .select("id,username,role,is_active");
    if (readError) throw readError;

    const rows = (existing || []) as Array<{ username?: string; role?: string; is_active?: boolean }>;
    const hasFullAccess = rows.some(
      (row) => isFullAccessRole(parseAdminRole(row.role)) && row.is_active !== false
    );
    const role =
      requestedRole || (hasFullAccess ? "admin" : "owner");
    const displayName = username;

    const current = rows.find((row) => String(row.username || "") === username);
    const passwordHash = hashPassword(password);

    if (current) {
      const { error } = await db
        .from("admins")
        .update({
          password_hash: passwordHash,
          role,
          is_active: true,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        })
        .eq("username", username);
      if (error) throw error;

      return noStoreJson({
        ok: true,
        action: "updated",
        username,
        role,
        note:
          "Пароль обновлён, аккаунт активирован. Войдите в админку и удалите переменную ADMIN_RECOVERY_TOKEN.",
      });
    }

    const { error } = await db.from("admins").insert({
      username,
      password_hash: passwordHash,
      role,
      display_name: displayName,
      is_active: true,
    });
    if (error) throw error;

    return noStoreJson({
      ok: true,
      action: "created",
      username,
      role,
      note:
        "Администратор создан. Войдите в админку и удалите переменную ADMIN_RECOVERY_TOKEN.",
    });
  } catch (error) {
    console.error("Admin recovery error:", error);
    const message = errorText(error);
    const code = (error as { code?: string } | null)?.code;
    // 23514 = нарушение CHECK-ограничения: в базе ещё старый список ролей.
    const hint =
      code === "23514"
        ? "База не знает роль owner: примените supabase/migration_owner_role_and_money.sql в Supabase → SQL Editor (он расширяет список ролей) и повторите."
        : "Сначала убедитесь, что база доступна: откройте /api/health/db?deep=1. Если таблицы admins нет — примените supabase/schema.sql в Supabase → SQL Editor.";
    return noStoreJson(
      {
        ok: false,
        error: "Не удалось записать администратора",
        code: "db_unavailable",
        detail: message,
        hint,
      },
      503
    );
  }
}
