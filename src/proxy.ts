// =========================================================
// FILE: src/proxy.ts
// Middleware: CSP + защита админки через JWT.
//
// Изменения относительно прошлой версии:
//   • путь админки берётся из единого модуля @/lib/admin-path
//     (раньше proxy знал только ADMIN_SECRET_PATH, а layout — ещё и
//     NEXT_PUBLIC_ADMIN_PATH: при расхождении переменных вход в панель
//     превращался в цикл логина);
//   • токен проверяется тем же кодом, что и в серверных маршрутах;
//   • сессия продлевается скользяще — активный администратор больше не
//     вылетает на страницу входа через 7 дней посреди работы;
//   • при истёкшей сессии API отвечает 401 с кодом session_expired (клиент
//     показывает «войдите заново», а не общую ошибку), страница — редиректом
//     на /{путь}/login?expired=1.
// =========================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_PATH,
  normalizeAdminPath,
} from "@/lib/admin-path";
import {
  canAccessAdminApi,
  canAccessAdminPage,
  getAdminLandingPath,
} from "@/lib/admin-rbac";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  adminSessionNeedsRenewal,
  signAdminSession,
  verifyAdminSessionToken,
  type AdminSessionToken,
} from "@/lib/admin-session-token";

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

/** Путь админки, если запрос к ней относится (страница или API). */
function adminScope(pathname: string): "page" | "api" | null {
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
    return "api";
  }
  if (pathname === `/${ADMIN_PATH}` || pathname.startsWith(`/${ADMIN_PATH}/`)) {
    return "page";
  }
  // Секретный путь могли случайно вписать со слешами в переменной —
  // тогда в URL может оказаться /secret//orders. Считаем это админкой.
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && normalizeAdminPath(first) === ADMIN_PATH && pathname.startsWith(`/${first}`)) {
    return "page";
  }
  return null;
}

function isPublicAdminAuthPath(pathname: string): boolean {
  return (
    pathname === `/${ADMIN_PATH}/login` ||
    pathname === `/${ADMIN_PATH}/api/login` ||
    pathname === `/${ADMIN_PATH}/api/logout`
  );
}

/** Продлить сессию: выдаём свежую cookie, если текущая «состарилась». */
async function maybeRenewSession(
  response: NextResponse,
  session: AdminSessionToken
): Promise<void> {
  if (!adminSessionNeedsRenewal(session)) return;
  try {
    const token = await signAdminSession({
      username: session.username,
      role: session.role,
      displayName: session.displayName,
    });
    response.cookies.set(ADMIN_SESSION_COOKIE, token, adminSessionCookieOptions());
  } catch (error) {
    console.error("[proxy] не удалось продлить сессию:", error);
  }
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

  const scope = adminScope(pathname);

  if (scope) {
    const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const session = await verifyAdminSessionToken(token);

    if (scope === "api") {
      if (!session) {
        const res = NextResponse.json(
          {
            error: "Сессия истекла — войдите в админку заново",
            code: "session_expired",
          },
          { status: 401 }
        );
        applySecurityHeaders(res);
        return res;
      }
      if (!canAccessAdminApi(session.role, pathname, request.method)) {
        const res = NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 }
        );
        applySecurityHeaders(res);
        return res;
      }
      const res = NextResponse.next();
      applySecurityHeaders(res);
      await maybeRenewSession(res, session);
      return res;
    }

    if (!isPublicAdminAuthPath(pathname)) {
      if (!session) {
        const loginUrl = new URL(`/${ADMIN_PATH}/login`, request.url);
        loginUrl.searchParams.set("expired", "1");
        const res = NextResponse.redirect(loginUrl);
        applySecurityHeaders(res);
        return res;
      }
      if (!canAccessAdminPage(session.role, pathname, ADMIN_PATH)) {
        // Нет прав на страницу — ведём на доступную стартовую.
        const res = NextResponse.redirect(
          new URL(getAdminLandingPath(session.role, ADMIN_PATH), request.url)
        );
        applySecurityHeaders(res);
        return res;
      }
    }

    const res = NextResponse.next();
    applySecurityHeaders(res);
    if (session) await maybeRenewSession(res, session);
    return res;
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
