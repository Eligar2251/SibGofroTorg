// =========================================================
// FILE: src/lib/admin-session-token.ts
// Подпись и проверка JWT админской сессии.
//
// Вынесено из src/lib/auth.ts (там рядом с jose лежат next/headers,
// которые нельзя импортировать в proxy/middleware). Теперь proxy и
// серверные маршруты проверяют токен ОДНИМ кодом, поэтому «сессия
// действительна в proxy, но не в layout» больше невозможно.
//
// Сессия продлевается скользяще: proxy выдаёт свежую cookie, как только
// текущей больше ADMIN_SESSION_RENEW_AFTER_SEC. Активный администратор
// не выкидывается на логин посреди работы.
// =========================================================

import { SignJWT, jwtVerify } from "jose";
import { parseAdminRole, type AdminRole } from "@/lib/admin-rbac";

export const ADMIN_SESSION_COOKIE = "admin-session";

/** Время жизни сессии (и cookie). */
export const ADMIN_SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 дней

/** Через сколько продлевать токен при активности. */
export const ADMIN_SESSION_RENEW_AFTER_SEC = 60 * 60 * 12; // 12 часов

const DEV_SECRET = "dev-only-admin-session-secret-min-32-chars!!";

export type AdminSessionSecretState = "ok" | "missing" | "too_short" | "dev_fallback";

export function adminSessionSecretState(): AdminSessionSecretState {
  const fromEnv = process.env.ADMIN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return "ok";
  if (process.env.NODE_ENV === "production") {
    return fromEnv ? "too_short" : "missing";
  }
  return "dev_fallback";
}

/**
 * Ключ подписи. В production при отсутствии/коротком секрете возвращает
 * null — использовать известную заглушку нельзя: такой токен подпишет любой.
 */
export function adminSessionSecret(): Uint8Array | null {
  const state = adminSessionSecretState();
  if (state === "ok") {
    return new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET);
  }
  if (state === "dev_fallback") {
    return new TextEncoder().encode(DEV_SECRET);
  }
  return null;
}

/** Человеческое объяснение, что не так с секретом (для диагностики и логина). */
export function adminSessionSecretProblem(): string | null {
  const state = adminSessionSecretState();
  if (state === "missing") {
    return "ADMIN_SESSION_SECRET не задан в переменных окружения приложения.";
  }
  if (state === "too_short") {
    return `ADMIN_SESSION_SECRET короче 32 символов (сейчас ${process.env.ADMIN_SESSION_SECRET?.length ?? 0}). Вход в админку невозможен.`;
  }
  if (state === "dev_fallback") {
    return "ADMIN_SESSION_SECRET не задан — используется секрет для разработки.";
  }
  return null;
}

export type AdminSessionToken = {
  username: string;
  role: AdminRole;
  displayName: string;
  /** Выдан (мс). */
  issuedAt: number;
  /** Истекает (мс) или null, если в токене нет exp. */
  expiresAt: number | null;
};

/** Подписать токен сессии. Бросает понятную ошибку, если секрета нет. */
export async function signAdminSession(data: {
  username: string;
  role: AdminRole;
  displayName?: string;
}): Promise<string> {
  const secret = adminSessionSecret();
  if (!secret) {
    throw new Error(
      adminSessionSecretProblem() ||
        "ADMIN_SESSION_SECRET не настроен — войти в админку нельзя."
    );
  }

  return new SignJWT({
    username: data.username,
    role: data.role,
    displayName: data.displayName || data.username,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SEC}s`)
    .sign(secret);
}

/**
 * Проверить токен. Никогда не бросает: истёкший/подделанный токен — null.
 * Это важно, чтобы отсутствие секрета не превращало страницу админки
 * в «Server Components render»-ошибку, а просто вело на логин.
 */
export async function verifyAdminSessionToken(
  token: string | null | undefined
): Promise<AdminSessionToken | null> {
  if (!token) return null;
  const secret = adminSessionSecret();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = parseAdminRole(payload.role);
    if (!role) return null;
    const username = typeof payload.username === "string" ? payload.username : "";
    if (!username) return null;

    return {
      username,
      role,
      displayName:
        typeof payload.displayName === "string" && payload.displayName
          ? payload.displayName
          : username,
      issuedAt: typeof payload.iat === "number" ? payload.iat * 1000 : 0,
      expiresAt: typeof payload.exp === "number" ? payload.exp * 1000 : null,
    };
  } catch {
    return null;
  }
}

/** Пора ли продлить токен при текущей активности. */
export function adminSessionNeedsRenewal(session: AdminSessionToken): boolean {
  if (!session.issuedAt) return true;
  return Date.now() - session.issuedAt > ADMIN_SESSION_RENEW_AFTER_SEC * 1000;
}

/** Параметры cookie сессии — один набор на вход и на продление. */
export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: ADMIN_SESSION_TTL_SEC,
    path: "/",
  };
}
