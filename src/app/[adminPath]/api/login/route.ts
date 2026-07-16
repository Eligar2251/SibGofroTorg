// =========================================================
// FILE: src/app/[adminPath]/api/login/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { createSession } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
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
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
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

    const snap = await getAdminDb()
      .collection("admins")
      .where("username", "==", username)
      .limit(1)
      .get();

    if (snap.empty) {
      return NextResponse.json(
        { error: "Неверный логин или пароль" },
        { status: 401 }
      );
    }

    const doc = snap.docs[0];
    const admin = doc.data();

    let valid = false;

    // Новый формат: passwordHash (scrypt salt:hash)
    if (admin.passwordHash && typeof admin.passwordHash === "string") {
      valid = verifyPassword(password, admin.passwordHash);
    }
    // Legacy: plaintext password — работает, но сразу мигрируем в hash
    else if (admin.password && typeof admin.password === "string") {
      valid = admin.password === password;
      if (valid) {
        try {
          await doc.ref.update({
            passwordHash: hashPassword(password),
            password: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
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