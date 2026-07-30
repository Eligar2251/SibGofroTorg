import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { parseAdminRole } from "@/lib/admin-rbac";
import { logAdminAction } from "@/lib/activity-log";
import { getAdminDb } from "@/lib/supabase";
import { hashPassword } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ADMIN_USER_FIELDS =
  "id,username,role,display_name,is_active,created_at,updated_at";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function validateUsername(raw: unknown): string {
  const username = String(raw || "").trim();
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    throw new Error(
      "Логин должен содержать 3–64 символа: латиницу, цифры, точку, _ или -"
    );
  }
  return username;
}

function validateDisplayName(raw: unknown, username: string): string {
  const displayName = String(raw || username).trim();
  if (!displayName || displayName.length > 100) {
    throw new Error("Имя должно содержать от 1 до 100 символов");
  }
  return displayName;
}

function validatePassword(raw: unknown): string {
  const password = String(raw || "");
  if (password.length < 8 || password.length > 200) {
    throw new Error("Пароль должен содержать от 8 до 200 символов");
  }
  return password;
}

function mapAdminUser(row: any, currentUsername: string) {
  return {
    id: String(row.id),
    username: String(row.username || ""),
    role: parseAdminRole(row.role) || "admin",
    displayName: String(row.display_name || row.username || ""),
    isActive: row.is_active !== false,
    isCurrent: String(row.username || "") === currentUsername,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_users")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const db = getAdminDb();
    const { data, error } = await db
      .from("admins")
      // password_hash намеренно никогда не выбирается и не уходит в браузер.
      .select(ADMIN_USER_FIELDS)
      .order("created_at", { ascending: true });
    if (error) throw error;

    return noStoreJson({
      users: (data || []).map((row) => mapAdminUser(row, auth.username)),
    });
  } catch (error) {
    console.error("Admin users list error:", error);
    return noStoreJson(
      { error: "Не удалось загрузить пользователей" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_users")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const username = validateUsername(body.username);
    const displayName = validateDisplayName(body.displayName, username);
    const role = parseAdminRole(body.role);
    if (!role) throw new Error("Выберите корректную роль");
    const password = validatePassword(body.password);

    // Открытый пароль существует только в памяти этого запроса. В БД сразу
    // записывается соль:scrypt-хэш; в ответе хэш также не возвращается.
    const passwordHash = hashPassword(password);
    const db = getAdminDb();
    const { data, error } = await db
      .from("admins")
      .insert({
        username,
        password_hash: passwordHash,
        role,
        display_name: displayName,
        is_active: body.isActive !== false,
      })
      .select(ADMIN_USER_FIELDS)
      .single();

    if (error?.code === "23505") {
      return noStoreJson(
        { error: "Пользователь с таким логином уже существует" },
        { status: 409 }
      );
    }
    if (error) throw error;

    await logAdminAction(
      auth.displayName,
      auth.role,
      "create",
      "admin-user",
      String(data.id),
      `Пользователь ${username}`,
      { role, isActive: data.is_active !== false }
    );

    return noStoreJson(
      { user: mapAdminUser(data, auth.username) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create admin user error:", error);
    return noStoreJson(
      {
        error:
          error instanceof Error ? error.message : "Не удалось создать пользователя",
      },
      { status: 400 }
    );
  }
}
