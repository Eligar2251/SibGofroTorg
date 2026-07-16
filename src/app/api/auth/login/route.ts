// =========================================================
// FILE: src/app/api/auth/login/route.ts
// =========================================================
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import {
  createUserSession,
  findUserByPhone,
  formatPhoneDisplay,
  normalizePhone,
  verifyPassword,
} from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");

    if (!phone || !password) {
      return NextResponse.json(
        { error: "Телефон и пароль обязательны" },
        { status: 400 }
      );
    }

    const ip = clientIp(request);
    const rl = rateLimit(`user-register:${clientIp(request)}`, 10, 60 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Слишком много регистраций с этого IP." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    // password min 8
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Пароль минимум 8 символов" },
        { status: 400 }
      );
    }

    const phoneDigits = normalizePhone(phone);
    const user = await findUserByPhone(phoneDigits);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "Неверный телефон или пароль" },
        { status: 401 }
      );
    }

    

    await createUserSession({
      uid: user.id,
      phone: user.phoneDigits,
      name: user.name || undefined,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        phone: formatPhoneDisplay(user.phoneDigits),
        name: user.name || null,
      },
    });
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