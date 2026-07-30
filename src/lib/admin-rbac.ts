// =========================================================
// FILE: src/lib/admin-rbac.ts
// Единые правила ролей админ-панели.
//
// Модуль намеренно не зависит от cookies/Next server APIs: одни и те же
// правила используются в proxy, серверных маршрутах и интерфейсе. Это
// защищает от расхождений, которые раньше приводили к циклу
// «админка → логин → админка» для ролей, отличных от admin.
// =========================================================

export const ADMIN_ROLES = ["admin", "manager", "lawyer"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminPermission =
  | "view_dashboard"
  | "view_finance"
  | "view_deliveries"
  | "view_payment_details"
  | "view_settings"
  | "manage_settings"
  | "use_operational_settings"
  | "view_logs"
  | "delete"
  | "manage_users";

export function parseAdminRole(value: unknown): AdminRole | null {
  return typeof value === "string" &&
    (ADMIN_ROLES as readonly string[]).includes(value)
    ? (value as AdminRole)
    : null;
}

/**
 * Точечные права, которые дополнительно проверяются внутри API.
 *
 * manager может выполнять все рабочие операции, включая удаление, но не
 * может читать журнал действий и настройки сайта или менять их.
 * lawyer имеет только обзор финансов, движений средств и перевозок на
 * дашборде; единственный доступный ему API — карточка платежа для чтения.
 */
export function hasAdminPermission(
  role: AdminRole,
  permission: AdminPermission | string
): boolean {
  if (role === "admin") return true;

  if (role === "manager") {
    return ![
      "view_settings",
      "manage_settings",
      "view_logs",
    ].includes(permission);
  }

  return [
    "view_dashboard",
    "view_finance",
    "view_deliveries",
    "view_payment_details",
  ].includes(permission);
}

/** Настройки рабочих модулей, не являющиеся настройками самого сайта. */
export function isOperationalSettingKey(key: string): boolean {
  return (
    key === "featured_products_order" ||
    key === "order_products_order" ||
    /^salary_(?:plan|debt|calendar|schedule)_/.test(key)
  );
}

/** Доступ к страницам внутри секретного пути админки. */
export function canAccessAdminPage(
  role: AdminRole,
  pathname: string,
  adminPath: string
): boolean {
  const root = `/${adminPath}`;
  const relativePath = pathname.slice(root.length) || "/";

  if (role === "admin") return true;

  if (role === "manager") {
    return !(
      relativePath === "/settings" ||
      relativePath.startsWith("/settings/")
    );
  }

  // Юрист работает только с ограниченным представлением дашборда.
  return relativePath === "/";
}

/**
 * Граница доступа для /api/admin. Прикладные маршруты всё равно выполняют
 * requireAdminApi(), а особо чувствительные маршруты проверяют permission.
 */
export function canAccessAdminApi(
  role: AdminRole,
  pathname: string,
  method: string
): boolean {
  if (role === "admin") return true;

  if (role === "manager") {
    if (pathname === "/api/admin/activity-logs") return false;
    if (pathname.startsWith("/api/admin/activity-logs/")) return false;

    // Точный маршрут нужен рабочим модулям (зарплаты и порядок товаров).
    // Сам route фильтрует ключи и не отдаёт менеджеру настройки сайта.
    if (pathname === "/api/admin/settings") return true;
    if (pathname.startsWith("/api/admin/settings/")) return false;

    return true;
  }

  // На дашборде юрист может открыть подробности проведённого платежа,
  // но не может изменять его или обращаться к остальным API админки.
  return (
    method.toUpperCase() === "GET" &&
    /^\/api\/admin\/warehouse\/payments\/[^/]+$/.test(pathname)
  );
}
