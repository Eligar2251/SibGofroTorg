// =========================================================
// FILE: src/lib/admin-rbac.ts
// Единые правила ролей админ-панели.
//
// Модуль намеренно не зависит от cookies/Next server APIs: одни и те же
// правила используются в proxy, серверных маршрутах и интерфейсе. Это
// защищает от расхождений, которые раньше приводили к циклу
// «админка → логин → админка» для ролей, отличных от admin.
// =========================================================

export const ADMIN_ROLES = ["admin", "manager", "lawyer", "wastepaper"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Стартовая страница роли после входа / при запрете страницы.
 * Макулатурщик работает только в отдельном модуле учёта макулатуры.
 */
export function getAdminLandingPath(
  role: AdminRole | null,
  adminPath: string
): string {
  if (role === "wastepaper") return `/${adminPath}/wastepaper-account`;
  return `/${adminPath}`;
}

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
 * может читать журнал действий, менять аккаунты и настройки сайта.
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
      "manage_users",
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

  // Макулатурщик работает только в отдельном модуле учёта макулатуры —
  // сайт, заявки, основной учёт и дашборд ему недоступны.
  if (role === "wastepaper") {
    return (
      relativePath === "/wastepaper-account" ||
      relativePath.startsWith("/wastepaper-account/")
    );
  }

  if (role === "manager") {
    return !(
      relativePath === "/settings" ||
      relativePath.startsWith("/settings/") ||
      // Отдельный учёт макулатуры доступен только admin и макулатурщику.
      relativePath === "/wastepaper-account" ||
      relativePath.startsWith("/wastepaper-account/")
    );
  }

  // Юрист работает с ограниченным представлением дашборда и видит
  // учёт аренды (только просмотр: финансы, просрочки, отчётность).
  return relativePath === "/" || relativePath === "/rent";
}

/**
 * В модуле аренды редактировать может только администратор.
 * Остальные роли (manager, lawyer) — только просмотр.
 */
export function canEditRent(role: AdminRole): boolean {
  return role === "admin";
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

  // Поток изменений (SSE) доступен всем ролям: он отдаёт только сигналы
  // «в такой-то таблице изменилась запись», а набор таблиц и превью
  // фильтруются по роли внутри самого маршрута.
  if (pathname === "/api/admin/events") return method.toUpperCase() === "GET";

  // Макулатурщику доступны только API отдельного учёта макулатуры.
  if (role === "wastepaper") {
    return pathname === "/api/admin/wp" || pathname.startsWith("/api/admin/wp/");
  }

  if (role === "manager") {
    // Отдельный учёт макулатуры — только admin и макулатурщик.
    if (pathname === "/api/admin/wp" || pathname.startsWith("/api/admin/wp/")) return false;
    if (pathname === "/api/admin/activity-logs") return false;
    if (pathname.startsWith("/api/admin/activity-logs/")) return false;
    if (pathname === "/api/admin/admin-users") return false;
    if (pathname.startsWith("/api/admin/admin-users/")) return false;

    // Точный маршрут нужен рабочим модулям (зарплаты и порядок товаров).
    // Сам route фильтрует ключи и не отдаёт менеджеру настройки сайта.
    if (pathname === "/api/admin/settings") return true;
    if (pathname.startsWith("/api/admin/settings/")) return false;

    return true;
  }

  // Юрист видит учёт аренды только на чтение (дашборд, финансы,
  // просрочки), плюс карточку складского платежа на дашборде.
  const methodGet = method.toUpperCase() === "GET";
  if (
    methodGet &&
    (pathname === "/api/admin/rent" || pathname.startsWith("/api/admin/rent/"))
  ) {
    return true;
  }
  return (
    methodGet &&
    /^\/api\/admin\/warehouse\/payments\/[^/]+$/.test(pathname)
  );
}
