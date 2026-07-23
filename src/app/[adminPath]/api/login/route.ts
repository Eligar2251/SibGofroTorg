// =========================================================
// FILE: src/app/[adminPath]/api/login/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { hashPassword, verifyPassword } from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

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

    if (error || !admin) {
      return NextResponse.json(
        { error: "Неверный логин или пароль" },
        { status: 401 }
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
          await db.from("admins").update({
            password_hash: hashPassword(password),
            updated_at: new Date().toISOString(),
          }).eq("id", admin.id);
          // Удаляем plaintext пароль
          await db.from("admins").update({ password_hash: hashPassword(password) } as any).eq("id", admin.id);
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

    await createSession(username);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
