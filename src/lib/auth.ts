// =========================================================
// FILE: src/lib/auth.ts
// Админская аутентификация — JWT в cookie (без изменений логики).
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

export async function createSession(username: string) {
  const secret = getAdminSecret();
  const token = await new SignJWT({ username, role: "admin" })
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

export async function verifySession(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getAdminSecret());
    if (payload.role !== "admin") return null;
    return (payload.username as string) || null;
  } catch {
    return null;
  }
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

export async function requireAdminApi(): Promise<
  { username: string } | NextResponse
> {
  const username = await verifySession();
  if (!username) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { username };
}
