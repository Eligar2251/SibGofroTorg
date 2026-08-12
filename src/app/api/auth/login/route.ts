// =========================================================
// FILE: src/app/api/auth/login/route.ts — вход по телефону или email
// =========================================================
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import {
  createUserSession,
  findUserByPhoneOrEmail,
  formatPhoneDisplay,
  normalizeEmail,
  normalizePhone,
  verifyPassword,
} from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const phoneRaw = body.phone ? String(body.phone).trim() : "";
    const emailRaw = body.email ? String(body.email).trim() : "";
    const identifier = emailRaw || phoneRaw || String(body.identifier || "").trim();
    const password = String(body.password || "");

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Логин и пароль обязательны" },
        { status: 400 }
      );
    }

    const ip = clientIp(request);
    const rl = rateLimit(`user-login:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Слишком много попыток входа. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Пароль минимум 8 символов" },
        { status: 400 }
      );
    }

    const user = await findUserByPhoneOrEmail(identifier);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      const isEmail = identifier.includes("@");
      return NextResponse.json(
        { error: isEmail ? "Неверный email или пароль" : "Неверный телефон или пароль" },
        { status: 401 }
      );
    }

    const sessionIdentifier = user.email && identifier.includes("@")
      ? normalizeEmail(user.email)
      : user.phoneDigits && !user.phoneDigits.startsWith("email_")
        ? user.phoneDigits
        : normalizeEmail(user.email || identifier);

    await createUserSession({
      uid: user.id,
      phone: sessionIdentifier,
      name: user.name || undefined,
    });

    const isEmailUser = !!user.email && (!user.phoneDigits || user.phoneDigits.startsWith("email_") || identifier.includes("@"));

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user.id,
          phone: isEmailUser ? user.email : formatPhoneDisplay(user.phoneDigits),
          email: user.email || null,
          name: user.name || null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("Login error:", error);
    const message =
      error instanceof Error ? error.message : "Ошибка сервера";
    return NextResponse.json(
      { error: `Ошибка входа: ${message}` },
      { status: 500 }
    );
  }
}
