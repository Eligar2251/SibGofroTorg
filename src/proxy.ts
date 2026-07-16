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

/**
 * CSP Level 3:
 * - nonce: inline только с nonce (XSS)
 * - 'self': /_next/static чанки (без strict-dynamic!)
 * - без 'strict-dynamic': иначе браузер игнорирует 'self' и host-allowlist
 * - 'unsafe-inline' в script-src: fallback для старых браузеров;
 *   при наличии nonce современные браузеры ИГНОРИРУЮТ unsafe-inline
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // fallback; ignored by modern browsers when nonce is present
    "'unsafe-inline'",
    isDev ? "'unsafe-eval'" : "",
    "https://mc.yandex.ru",
    "https://yastatic.net",
  ]
    .filter(Boolean)
    .join(" ");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // styles: Next/Tailwind/inline — unsafe-inline ок для A+ (критичен script-src)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://mc.yandex.ru https://*.yandex.ru https://*.yandex.net https://yandex.ru https://yandex.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://api.telegram.org https://botapi.max.ru https://*.googleapis.com https://*.cloudinary.com https://res.cloudinary.com https://*.yandex.ru https://yandex.ru",
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

function applySecurityHeaders(response: NextResponse, nonce: string) {
  const isProd = process.env.NODE_ENV === "production";

  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  response.headers.set(
    "Cross-Origin-Opener-Policy",
    "same-origin-allow-popups"
  );
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

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  // ── Admin API ──
  if (pathname.startsWith("/api/admin")) {
    const ok = await isAdminAuthed(request);
    if (!ok) {
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      applySecurityHeaders(res, nonce);
      return res;
    }
  }

  // ── Admin UI ──
  if (
    pathname === `/${ADMIN_PATH}` ||
    pathname.startsWith(`/${ADMIN_PATH}/`)
  ) {
    if (
      pathname !== `/${ADMIN_PATH}/login` &&
      pathname !== `/${ADMIN_PATH}/api/login`
    ) {
      const ok = await isAdminAuthed(request);
      if (!ok) {
        const res = NextResponse.redirect(
          new URL(`/${ADMIN_PATH}/login`, request.url)
        );
        applySecurityHeaders(res, nonce);
        return res;
      }
    }
  }

  // Next.js читает x-nonce / CSP с request и вешает nonce на свои <script>
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  applySecurityHeaders(response, nonce);
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