// =========================================================
// FILE: src/app/api/auth/register/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  createUserSession,
  formatPhoneDisplay,
  isValidRussianPhone,
  normalizePhone,
} from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rl = rateLimit(
    `user-register:${clientIp(request)}`,
    10,
    60 * 60 * 1000
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Слишком много регистраций. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = await request.json();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    const name = body.name ? String(body.name).trim() : undefined;

    if (!phone || !password) {
      return NextResponse.json(
        { error: "Телефон и пароль обязательны" },
        { status: 400 }
      );
    }

    const phoneDigits = normalizePhone(phone);
    if (!isValidRussianPhone(phoneDigits)) {
      return NextResponse.json(
        { error: "Некорректный номер телефона" },
        { status: 400 }
      );
    } 
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Пароль минимум 8 символов" },
        { status: 400 }
      );
    }

    const result = await createUser({ phone: phoneDigits, password, name });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await createUserSession({
      uid: result.id,
      phone: phoneDigits,
      name: result.name || undefined,
    });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: result.id,
          phone: formatPhoneDisplay(phoneDigits),
          name: result.name,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: unknown) {
    console.error("Register error:", error);
    const message =
      error instanceof Error ? error.message : "Ошибка сервера";
    // Часто Firestore: Missing or insufficient permissions
    return NextResponse.json(
      {
        error:
          message.includes("permission") || message.includes("PERMISSION")
            ? "Нет доступа к базе. Проверьте правила Firestore для коллекции users."
            : `Ошибка регистрации: ${message}`,
      },
      { status: 500 }
    );
  }
}