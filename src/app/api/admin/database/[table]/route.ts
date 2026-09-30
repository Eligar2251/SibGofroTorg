// =========================================================
// FILE: src/app/api/admin/database/[table]/route.ts
// Просмотр строк таблицы и правка отдельной ячейки.
//
// Разрешено ровно две операции: чтение существующих строк и изменение
// значения в существующей строке. Никаких INSERT/DELETE и никакого SQL
// от пользователя: имя таблицы и колонки сверяются со схемой базы.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requireAdminApi } from "@/lib/auth";
import { isOwner } from "@/lib/admin-rbac";
import { logAdminAction } from "@/lib/activity-log";
import {
  buildColumnsFromRows,
  coerceCellValue,
  fetchTableRows,
  getTableSchema,
  isOwnerOnlyTable,
  isSensitiveColumn,
  updateTableCell,
  type DatabaseColumn,
} from "@/lib/admin-database";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Служебные поля, которые закрыты для правки через «Базу Данных». */
const PROTECTED_COLUMNS: Record<string, readonly string[]> = {
  admins: ["role", "username", "is_active", "password_hash", "id"],
};

function isSensitiveOrProtected(table: string, column: string): boolean {
  return (
    isSensitiveColumn(column) ||
    (PROTECTED_COLUMNS[table] || []).includes(column)
  );
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function resolveTable(
  rawTable: string,
  role: string
): Promise<{ table: string } | NextResponse> {
  const table = String(rawTable || "").trim().toLowerCase();
  if (!TABLE_NAME_RE.test(table)) {
    return noStoreJson({ error: "Некорректное имя таблицы" }, { status: 400 });
  }
  const schema = await getTableSchema(table);
  if (!schema) {
    return noStoreJson({ error: "Таблица не найдена" }, { status: 404 });
  }
  if (isOwnerOnlyTable(table) && !isOwner(role as never)) {
    // Владельческие данные (правки денег) не показываем даже по прямой ссылке.
    return noStoreJson({ error: "Таблица не найдена" }, { status: 404 });
  }
  return { table };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "view_database")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { table: rawTable } = await params;
  const resolved = await resolveTable(rawTable, auth.role);
  if (resolved instanceof NextResponse) return resolved;

  try {
    const schema = (await getTableSchema(resolved.table))!;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 5),
      200
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
    const search = searchParams.get("q") || "";
    const sort = searchParams.get("sort");
    const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

    const result = await fetchTableRows({
      table: resolved.table,
      schema,
      limit,
      offset,
      search,
      sort,
      dir,
      // Журнал владельческих движений деньгами скрыт от админов.
      hideOwnerMoneyLogs: !isOwner(auth.role),
    });

    return noStoreJson({
      table: resolved.table,
      label: result.schema.label,
      group: result.schema.group,
      editable: result.schema.editable,
      ownerOnly: result.schema.ownerOnly,
      primaryKey: result.schema.primaryKey,
      columns: result.schema.columns.filter(
        (column) => !isSensitiveColumn(column.name)
      ),
      rows: result.rows,
      total: result.total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("Database rows error:", error);
    return noStoreJson(
      {
        error:
          error?.message ||
          "Не удалось прочитать таблицу. Проверьте, что применены миграции.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  if (!hasPermission(auth, "manage_database")) {
    return noStoreJson({ error: "Недостаточно прав" }, { status: 403 });
  }

  const { table: rawTable } = await params;
  const resolved = await resolveTable(rawTable, auth.role);
  if (resolved instanceof NextResponse) return resolved;

  try {
    const schema = (await getTableSchema(resolved.table))!;
    if (!schema.editable || !schema.primaryKey) {
      return noStoreJson(
        { error: "В этой таблице нельзя менять данные (нет колонки-идентификатора)" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const columnName = String(body.column || "");
    const keyValue = String(body.key ?? "");
    if (!columnName || !keyValue) {
      return noStoreJson({ error: "Не хватает данных для правки" }, { status: 400 });
    }
    if (isSensitiveColumn(columnName)) {
      return noStoreJson({ error: "Эту колонку менять нельзя" }, { status: 403 });
    }

    let columns: DatabaseColumn[] = schema.columns;
    if (columns.length === 0) {
      const probe = await fetchTableRows({
        table: resolved.table,
        schema,
        limit: 1,
        offset: 0,
      });
      columns = probe.rows.length > 0
        ? buildColumnsFromRows(probe.rows)
        : buildColumnsFromRows([]);
    }

    const column = columns.find((item) => item.name === columnName);
    if (!column) {
      return noStoreJson({ error: "Такой колонки нет в таблице" }, { status: 400 });
    }
    // Роль, логин и активность сотрудников админки меняются только в
    // разделе «Пользователи» — иначе это обход прав.
    if (!column.editable && isSensitiveOrProtected(resolved.table, columnName)) {
      return noStoreJson(
        { error: "Это поле меняется только в разделе «Пользователи»" },
        { status: 403 }
      );
    }

    // Для колонок без описания типа определяем тип по текущему значению.
    let effectiveColumn = column;
    if (effectiveColumn.type === "unknown") {
      const probe = await fetchTableRows({
        table: resolved.table,
        schema: { ...schema, columns },
        limit: 1,
        offset: 0,
      });
      const current = probe.rows[0]?.[columnName];
      effectiveColumn = {
        ...column,
        type:
          typeof current === "number"
            ? "number"
            : typeof current === "boolean"
              ? "boolean"
              : typeof current === "object" && current !== null
                ? "json"
                : "string",
      };
    }

    const coerced = coerceCellValue(effectiveColumn, body.value ?? null);
    if (!coerced.ok) {
      return noStoreJson({ error: coerced.error }, { status: 400 });
    }

    const row = await updateTableCell({
      table: resolved.table,
      schema,
      keyColumn: schema.primaryKey,
      keyValue,
      column: columnName,
      value: coerced.value,
    });

    await logAdminAction(
      auth.displayName,
      auth.role,
      "update",
      "database",
      `${resolved.table}:${keyValue}`,
      `База данных: ${schema.label} · ${columnName}`,
      {
        table: resolved.table,
        column: columnName,
        key: keyValue,
        value: coerced.value,
        ip: clientIp(request),
      }
    );

    return noStoreJson({ row });
  } catch (error: any) {
    console.error("Database update error:", error);
    return noStoreJson(
      {
        error:
          error?.message ||
          (error?.code === "23505"
            ? "Такое значение уже есть — нужно уникальное"
            : "Не удалось сохранить значение"),
      },
      { status: 500 }
    );
  }
}
