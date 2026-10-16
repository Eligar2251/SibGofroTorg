// =========================================================
// FILE: src/lib/auth.ts
// Админская аутентификация — JWT в cookie с поддержкой ролей.
//
// Подпись/проверка токена живут в src/lib/admin-session-token.ts: тот же
// код использует proxy (middleware), поэтому «в proxy сессия валидна, а в
// layout нет» больше невозможно. Здесь только работа с cookie и React.
// =========================================================

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  hasAdminPermission,
  type AdminPermission,
  type AdminRole,
} from "@/lib/admin-rbac";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  adminSessionSecretProblem,
  signAdminSession,
  verifyAdminSessionToken,
} from "@/lib/admin-session-token";

const COOKIE = ADMIN_SESSION_COOKIE;

export interface AdminSession {
  username: string;
  role: AdminRole;
  displayName: string;
}

/**
 * Выдать сессию и положить её в cookie.
 * Если ADMIN_SESSION_SECRET не настроен, бросаем понятную ошибку: маршрут
 * входа покажет её администратору, а не безликое «Ошибка сервера».
 */
export async function createSession(data: {
  username: string;
  role: AdminRole;
  displayName?: string;
}) {
  const problem = adminSessionSecretProblem();
  if (problem && process.env.NODE_ENV === "production") {
    throw new Error(problem);
  }

  const token = await signAdminSession(data);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, adminSessionCookieOptions());
}

/**
 * Проверить текущую сессию. Никогда не бросает: истёкший токен, отсутствие
 * секрета или битая cookie — это просто «нет сессии» (→ страница входа),
 * а не падение рендера админки.
 */
export async function verifySession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE)?.value;
  if (!token) return null;

  const session = await verifyAdminSessionToken(token);
  if (!session) {
    const problem = adminSessionSecretProblem();
    if (problem) console.warn(`[auth] сессия не проверена: ${problem}`);
    return null;
  }

  return {
    username: session.username,
    role: session.role,
    displayName: session.displayName,
  };
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

export async function requireAdminApi(): Promise<AdminSession | NextResponse> {
  const session = await verifySession();
  if (!session) {
    return NextResponse.json(
      {
        error: "Сессия истекла — войдите в админку заново",
        code: "session_expired",
      },
      { status: 401 }
    );
  }
  return session;
}

/** Единая проверка точечных прав для API-маршрутов. */
export function hasPermission(
  session: AdminSession,
  action: AdminPermission | string
): boolean {
  return hasAdminPermission(session.role, action);
}

/** Количество доступных ролей-разрешений (для диагностики). */
export function permissionCount(session: AdminSession): number {
  const candidates: AdminPermission[] = [
    "view_dashboard",
    "view_finance",
    "view_deliveries",
    "view_payment_details",
    "view_settings",
    "manage_settings",
    "use_operational_settings",
    "view_logs",
    "delete",
    "manage_users",
    "view_database",
    "manage_database",
    "view_money",
    "manage_money",
  ];
  return candidates.filter((permission) =>
    hasAdminPermission(session.role, permission)
  ).length;
}
