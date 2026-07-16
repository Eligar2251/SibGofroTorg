// =========================================================
// FILE: src/app/api/auth/register/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  createUserSession,
  formatPhoneDisplay,
  normalizePhone,
} from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
    if (phoneDigits.length < 11) {
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
      name,
    });

    return NextResponse.json({
      success: true,
      user: {
        id: result.id,
        phone: formatPhoneDisplay(phoneDigits),
        name: name || null,
      },
    });
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