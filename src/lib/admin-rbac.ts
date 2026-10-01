// =========================================================
// FILE: src/lib/admin-rbac.ts
// Единые правила ролей админ-панели.
//
// Модуль намеренно не зависит от cookies/Next server APIs: одни и те же
// правила используются в proxy, серверных маршрутах и интерфейсе. Это
// защищает от расхождений, которые раньше приводили к циклу
// «админка → логин → админка» для ролей, отличных от admin.
// =========================================================

export const ADMIN_ROLES = [
  "owner",
  "admin",
  "manager",
  "lawyer",
  "wastepaper",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Владелец — надмножество администратора с правом правки денег. */
export function isOwner(role: AdminRole | null | undefined): boolean {
  return role === "owner";
}

/** Полный доступ к админке (настройки, журнал, все модули). */
export function isFullAccessRole(role: AdminRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

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
  | "manage_users"
  | "view_database"
  | "manage_database"
  | "view_money"
  | "manage_money";

/**
 * Права «только владелец». Обычный admin их не получает: он видит
 * денежные счета и их балансы, но не журнал правок владельца и не может
 * двигать деньги напрямую, без документов.
 */
export const OWNER_ONLY_PERMISSIONS: readonly AdminPermission[] = [
  "view_money",
  "manage_money",
];

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
  // Владелец — единственная роль, которой доступны владельческие права
  // (правка денежных счетов и журнал этих правок).
  if (role === "owner") return true;

  if ((OWNER_ONLY_PERMISSIONS as readonly string[]).includes(permission)) {
    return false;
  }

  if (role === "admin") return true;

  if (role === "manager") {
    return ![
      "view_settings",
      "manage_settings",
      "manage_users",
      "view_logs",
      // Просмотр базы данных — это доступ ко всем таблицам сразу,
      // поэтому только admin и owner (после проверки права).
      "view_database",
      "manage_database",
    ].includes(permission);
  }

  return [
    "view_dashboard",
    "view_finance",
    "view_deliveries",
    "view_payment_details",
  ].includes(permission);
}

/**
 * Раздел «База Данных»: все таблицы с данными и правкой ячеек.
 * Доступен владельцу и администратору, остальным ролям — нет.
 */
export function canAccessDatabase(role: AdminRole | null | undefined): boolean {
  return isFullAccessRole(role);
}

/**
 * Настройки зарплат модуля «Учёт макулатура» (планы, долги, календарь,
 * график) и общая ширина колонок таблицы зарплат — их читает/пишет
 * /api/admin/wp/settings для администратора и роли «макулатура».
 */
export function isWastepaperSalarySettingKey(key: string): boolean {
  return /^wp_salary_(?:plan|debt|calendar|schedule|color)_/.test(key) || key === "salary_table_col_widths";
}

/** Настройки рабочих модулей, не являющиеся настройками самого сайта. */
export function isOperationalSettingKey(key: string): boolean {
  return (
    key === "featured_products_order" ||
    key === "order_products_order" ||
    /^salary_(?:plan|debt|calendar|schedule|color)_/.test(key) ||
    // Ширины колонок таблицы зарплат — настройка интерфейса, а не сайта:
    // менеджеру она нужна, ведь именно он и работает в этой таблице.
    key === "salary_table_col_widths" ||
    isWastepaperSalarySettingKey(key)
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

  if (role === "owner" || role === "admin") return true;

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
      // База данных — только владелец и администратор.
      relativePath === "/database" ||
      relativePath.startsWith("/database/") ||
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
 * В модуле аренды редактировать может только администратор (и владелец).
 * Остальные роли (manager, lawyer) — только просмотр.
 */
export function canEditRent(role: AdminRole): boolean {
  return isFullAccessRole(role);
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
  // Владелец имеет доступ ко всем API админки.
  if (role === "owner") return true;

  // Денежные счета и правки остатков — строго владелец. Обычный admin
  // видит итоговые балансы (как и раньше), но не журнал правок владельца.
  if (pathname === "/api/admin/money" || pathname.startsWith("/api/admin/money/")) {
    return false;
  }
  // Просмотр базы данных доступен только admin и owner (не manager/прочим).
  if (
    pathname === "/api/admin/database" ||
    pathname.startsWith("/api/admin/database/")
  ) {
    return role === "admin";
  }

  if (role === "admin") return true;

  // Поток изменений (SSE) доступен всем ролям: он отдаёт только сигналы
  // «в такой-то таблице изменилась запись», а набор таблиц и превью
  // фильтруются по роли внутри самого маршрута.
  if (pathname === "/api/admin/events") return method.toUpperCase() === "GET";
  // Статус того же канала (диагностика: «почему реалтайм молчит») —
  // только чтение, тоже доступен всем ролям.
  if (pathname === "/api/admin/events/status") return method.toUpperCase() === "GET";

  // Макулатурщику доступны API отдельного учёта макулатуры плюс ЕДИНЫЕ
  // перевозки учёта: вкладка «Перевозки» в его модуле показывает те же
  // рейсы (ПЕР-...), что и раздел «Доставки», — он собирает их из своих
  // заборов/сдач, а водитель везёт один общий путевой лист.
  if (role === "wastepaper") {
    if (
      pathname === "/api/admin/transports" ||
      pathname.startsWith("/api/admin/transports/")
    ) {
      return true;
    }
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
