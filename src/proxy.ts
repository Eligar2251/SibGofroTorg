// =========================================================
// FILE: src/proxy.ts
// Middleware: CSP + защита админки через JWT.
// =========================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import {
  canAccessAdminApi,
  canAccessAdminPage,
  getAdminLandingPath,
  parseAdminRole,
  type AdminRole,
} from "@/lib/admin-rbac";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

function getAdminSecret(): Uint8Array | null {
  const fromEnv = process.env.ADMIN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    return new TextEncoder().encode(fromEnv);
  }
  // Без production-секрета нельзя использовать известную заглушку: токен
  // с ней мог бы подписать кто угодно. Просто отклоняем любую сессию.
  if (process.env.NODE_ENV === "production") return null;
  return new TextEncoder().encode(
    "dev-only-admin-session-secret-min-32-chars!!"
  );
}

async function getAdminRole(request: NextRequest): Promise<AdminRole | null> {
  const token = request.cookies.get("admin-session")?.value;
  const secret = getAdminSecret();
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return parseAdminRole(payload.role);
  } catch {
    return null;
  }
}

function buildCsp(): string {
  const isDev = process.env.NODE_ENV === "development";

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    isDev ? "'unsafe-eval'" : "",
    "https://mc.yandex.ru",
    "https://*.yandex.ru",
    "https://yastatic.net",
  ]
    .filter(Boolean)
    .join(" ");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Внешних CDN в img-src нет: картинки идут через наш /media.
    "img-src 'self' data: blob: https://mc.yandex.ru https://*.yandex.ru https://*.yandex.net https://yandex.ru https://yandex.com",
    "font-src 'self' data:",
    // Метрика открывает WebSocket wss://mc.yandex.ru/solid.ws — схема wss://
    "connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://botapi.max.ru https://*.yandex.ru https://yandex.ru wss://mc.yandex.ru wss://mc.yandex.com wss://*.yandex.ru https://*.supabase.co https://*.supabase.in wss://*.supabase.co wss://*.supabase.in",
    "frame-src 'self' https://yandex.ru https://*.yandex.ru https://yandex.com https://*.yandex.com https://mc.yandex.ru",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ];

  if (isDev) {
    return directives
      .filter((d) => d !== "upgrade-insecure-requests")
      .join("; ");
  }
  return directives.join("; ");
}

function applySecurityHeaders(response: NextResponse) {
  const isProd = process.env.NODE_ENV === "production";

  response.headers.set("Content-Security-Policy", buildCsp());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    // Камера — только своему origin (браузер спросит разрешение отдельно).
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  response.headers.set("Cross-Origin-Resource-Policy", "same-site");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");

  if (isProd) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  response.headers.delete("Access-Control-Allow-Origin");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Короткие QR-ссылки /q/{code} ──
  const shortQr = pathname.match(/^\/[Qq]\/(.+)$/);
  if (shortQr && !pathname.startsWith("/q/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/q/${shortQr[1]}`;
    const res = NextResponse.rewrite(url);
    applySecurityHeaders(res);
    return res;
  }

  // ── Admin API ──
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    const role = await getAdminRole(request);
    if (!role) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(res);
      return res;
    }
    if (!canAccessAdminApi(role, pathname, request.method)) {
      const res = NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      applySecurityHeaders(res);
      return res;
    }
  }

  // ── Admin UI ──
  if (
    pathname === `/${ADMIN_PATH}` ||
    pathname.startsWith(`/${ADMIN_PATH}/`)
  ) {
    const loginPath = `/${ADMIN_PATH}/login`;
    const loginApiPath = `/${ADMIN_PATH}/api/login`;
    const logoutApiPath = `/${ADMIN_PATH}/api/logout`;
    const isPublicAuthPath =
      pathname === loginPath ||
      pathname === loginApiPath ||
      pathname === logoutApiPath;

    if (!isPublicAuthPath) {
      const role = await getAdminRole(request);
      if (!role) {
        const res = NextResponse.redirect(new URL(loginPath, request.url));
        applySecurityHeaders(res);
        return res;
      }
      if (!canAccessAdminPage(role, pathname, ADMIN_PATH)) {
        // Нет прав на страницу — ведём на доступную стартовую.
        const res = NextResponse.redirect(
          new URL(getAdminLandingPath(role, ADMIN_PATH), request.url)
        );
        applySecurityHeaders(res);
        return res;
      }
    }
  }

  const response = NextResponse.next();
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    },
  ],
};
