// =========================================================
// FILE: src/app/api/auth/register/route.ts — поддержка телефона и email
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import {
  createUser,
  createUserByEmail,
  createUserSession,
  formatPhoneDisplay,
  isValidRussianPhone,
  isValidEmail,
  normalizeEmail,
  normalizePhone,
} from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/lib/supabase-queries";

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
    const phoneRaw = body.phone ? String(body.phone).trim() : "";
    const emailRaw = body.email ? String(body.email).trim() : "";
    const password = String(body.password || "");
    const name = body.name ? String(body.name).trim() : undefined;

    if (!password) {
      return NextResponse.json({ error: "Пароль обязателен" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Пароль минимум 8 символов" }, { status: 400 });
    }

    // Определяем метод регистрации: если передан email и он валиден — по email, иначе по телефону
    // Для совместимости поддерживаем оба, приоритет — email если есть, иначе phone
    let method: "email" | "phone" = "phone";
    if (emailRaw && isValidEmail(emailRaw)) {
      method = "email";
    } else if (phoneRaw) {
      method = "phone";
    } else {
      // Пытаемся прочитать настройку из админки, чтобы дать подсказку
      try {
        const settings = await getSettings();
        const configured = String(settings.registration_contact_field || "phone").toLowerCase();
        if (configured === "email") {
          return NextResponse.json({ error: "Email и пароль обязательны" }, { status: 400 });
        }
      } catch {}
      return NextResponse.json({ error: "Телефон и пароль обязательны" }, { status: 400 });
    }

    if (method === "email") {
      const email = normalizeEmail(emailRaw);
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
      }
      const result = await createUserByEmail({ email, password, name });
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      await createUserSession({
        uid: result.id,
        phone: email, // в сессии храним идентификатор (email)
        name: result.name || undefined,
      });
      return NextResponse.json(
        {
          success: true,
          user: { id: result.id, email, phone: email, name: result.name },
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } else {
      const phoneDigits = normalizePhone(phoneRaw);
      if (!isValidRussianPhone(phoneDigits)) {
        return NextResponse.json({ error: "Некорректный номер телефона" }, { status: 400 });
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
    }
  } catch (error: unknown) {
    console.error("Register error:", error);
    const message = error instanceof Error ? error.message : "Ошибка сервера";
    return NextResponse.json(
      {
        error:
          message.includes("permission") || message.includes("PERMISSION")
            ? "Нет доступа к базе. Проверьте правила для users."
            : `Ошибка регистрации: ${message}`,
      },
      { status: 500 }
    );
  }
}
