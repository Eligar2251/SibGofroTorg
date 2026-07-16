// =========================================================
// FILE: src/proxy.ts
// =========================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

function getAdminSecret(): Uint8Array {
  const fromEnv = process.env.ADMIN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    return new TextEncoder().encode(fromEnv);
  }
  // Edge proxy: в prod без секрета — все admin-запросы fail closed
  if (process.env.NODE_ENV === "production") {
    return new TextEncoder().encode("__invalid_prod_secret_force_fail__");
  }
  return new TextEncoder().encode(
    "dev-only-admin-session-secret-min-32-chars!!"
  );
}

async function isAdminAuthed(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get("admin-session")?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getAdminSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Защита admin API
  if (pathname.startsWith("/api/admin")) {
    const ok = await isAdminAuthed(request);
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Защита admin UI
  if (
    pathname === `/${ADMIN_PATH}` ||
    pathname.startsWith(`/${ADMIN_PATH}/`)
  ) {
    // login-страницу и login API не блокируем
    if (
      pathname === `/${ADMIN_PATH}/login` ||
      pathname === `/${ADMIN_PATH}/api/login`
    ) {
      return NextResponse.next();
    }

    const ok = await isAdminAuthed(request);
    if (!ok) {
      return NextResponse.redirect(
        new URL(`/${ADMIN_PATH}/login`, request.url)
      );
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/admin/:path*",
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};