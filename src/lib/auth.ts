// =========================================================
// FILE: src/lib/auth.ts
// Админская аутентификация — JWT в cookie с поддержкой ролей.
// =========================================================

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

function getAdminSecret(): Uint8Array {
  const fromEnv = process.env.ADMIN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    return new TextEncoder().encode(fromEnv);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ADMIN_SESSION_SECRET must be set (≥32 chars) in production"
    );
  }
  console.warn(
    "[auth] ADMIN_SESSION_SECRET не задан — используется dev-секрет. Задайте в .env.local"
  );
  return new TextEncoder().encode(
    "dev-only-admin-session-secret-min-32-chars!!"
  );
}

const COOKIE = "admin-session";

export interface AdminSession {
  username: string;
  role: string;
  displayName: string;
}

export async function createSession(data: {
  username: string;
  role: string;
  displayName?: string;
}) {
  const secret = getAdminSecret();
  const token = await new SignJWT({
    username: data.username,
    role: data.role || "admin",
    displayName: data.displayName || data.username,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
}

export async function verifySession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAdminSecret());
    return {
      username: (payload.username as string) || "",
      role: (payload.role as string) || "admin",
      displayName: (payload.displayName as string) || (payload.username as string) || "",
    };
  } catch {
    return null;
  }
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

export async function requireAdminApi(): Promise<
  AdminSession | NextResponse
> {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return session;
}

/** Проверка роли: менеджер не может удалять и видеть логи */
export function hasPermission(session: AdminSession, action: string): boolean {
  if (session.role === "admin") return true;
  // Менеджер: может всё кроме удаления и просмотра логов
  if (session.role === "manager") {
    return !["delete", "view_logs", "manage_users"].includes(action);
  }
  return false;
}
