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

async function isLastActiveAdmin(db: ReturnType<typeof getAdminDb>, id: string) {
  const { data, error } = await db.from("admins").select("id,role,is_active");
  if (error) throw error;
  return (
    (data || []).filter(
      (row) =>
        String(row.id) !== id &&
        parseAdminRole(row.role) === "admin" &&
        row.is_active !== false
    ).length === 0
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_users")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const db = getAdminDb();
    const { data: current, error: currentError } = await db
      .from("admins")
      .select(ADMIN_USER_FIELDS)
      .eq("id", id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return noStoreJson({ error: "Пользователь не найден" }, { status: 404 });
    }

    const currentRole = parseAdminRole(current.role) || "admin";
    const nextRole = body.role === undefined ? currentRole : parseAdminRole(body.role);
    if (!nextRole) throw new Error("Выберите корректную роль");

    const displayName = String(
      body.displayName === undefined
        ? current.display_name || current.username
        : body.displayName
    ).trim();
    if (!displayName || displayName.length > 100) {
      throw new Error("Имя должно содержать от 1 до 100 символов");
    }

    const nextIsActive =
      body.isActive === undefined ? current.is_active !== false : body.isActive === true;
    const isCurrent = String(current.username) === auth.username;
    if (isCurrent && nextRole !== currentRole) {
      throw new Error("Нельзя изменить роль текущего аккаунта");
    }
    if (isCurrent && !nextIsActive) {
      throw new Error("Нельзя отключить текущий аккаунт");
    }

    if (
      currentRole === "admin" &&
      current.is_active !== false &&
      (nextRole !== "admin" || !nextIsActive) &&
      (await isLastActiveAdmin(db, id))
    ) {
      throw new Error("Нельзя отключить или понизить последнего администратора");
    }

    const update: Record<string, unknown> = {
      role: nextRole,
      display_name: displayName,
      is_active: nextIsActive,
      updated_at: new Date().toISOString(),
    };
    const password = typeof body.password === "string" ? body.password : "";
    if (password) {
      if (password.length < 8 || password.length > 200) {
        throw new Error("Пароль должен содержать от 8 до 200 символов");
      }
      update.password_hash = hashPassword(password);
    }

    const { data, error } = await db
      .from("admins")
      .update(update)
      .eq("id", id)
      .select(ADMIN_USER_FIELDS)
      .single();
    if (error) throw error;

    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "admin-user",
      id,
      `Пользователь ${current.username}`,
      {
        role: nextRole,
        isActive: nextIsActive,
        passwordChanged: Boolean(password),
      }
    );

    return noStoreJson({ user: mapAdminUser(data, auth.username) });
  } catch (error) {
    console.error("Update admin user error:", error);
    return noStoreJson(
      {
        error:
          error instanceof Error ? error.message : "Не удалось обновить пользователя",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_users")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const db = getAdminDb();
    const { data: current, error: currentError } = await db
      .from("admins")
      .select(ADMIN_USER_FIELDS)
      .eq("id", id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) {
      return noStoreJson({ error: "Пользователь не найден" }, { status: 404 });
    }
    if (String(current.username) === auth.username) {
      throw new Error("Нельзя удалить текущий аккаунт");
    }
    if (
      (parseAdminRole(current.role) || "admin") === "admin" &&
      current.is_active !== false &&
      (await isLastActiveAdmin(db, id))
    ) {
      throw new Error("Нельзя удалить последнего активного администратора");
    }

    const { error } = await db.from("admins").delete().eq("id", id);
    if (error) throw error;

    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "admin-user",
      id,
      `Пользователь ${current.username}`,
      { role: parseAdminRole(current.role) || "admin" }
    );

    return noStoreJson({ success: true });
  } catch (error) {
    console.error("Delete admin user error:", error);
    return noStoreJson(
      {
        error:
          error instanceof Error ? error.message : "Не удалось удалить пользователя",
      },
      { status: 400 }
    );
  }
}
