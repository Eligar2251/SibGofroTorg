// =========================================================
// FILE: src/lib/admin-nav.ts
// Навигация админки: каталог вкладок, иконки, группы.
//
// Раскладка (группы, порядок, иконки, подписи) хранится
// в базе отдельно для каждого администратора. Этот модуль
// не тянет React и lucide — его читают и API, и клиент.
// =========================================================

import { canAccessAdminPage, type AdminRole } from "@/lib/admin-rbac";

export const ADMIN_NAV_LAYOUT_VERSION = 1 as const;

/** Префикс ключа в таблице settings (запасное хранилище). */
export const ADMIN_NAV_LAYOUT_KEY_PREFIX = "admin_nav_layout:";

export function isAdminNavLayoutSettingKey(key: string): boolean {
  return key.startsWith(ADMIN_NAV_LAYOUT_KEY_PREFIX);
}

export function adminNavLayoutSettingKey(username: string): string {
  return `${ADMIN_NAV_LAYOUT_KEY_PREFIX}${username}`;
}

export type AdminNavIconMeta = {
  id: string;
  label: string;
  /** Группа в палитре иконок. */
  group: string;
};

/**
 * Полный набор иконок навигации. Идентификаторы совпадают
 * с картой компонентов в AdminNavIcon.tsx (lucide, уже
 * используемые в проекте — без «экзотики», которой может
 * не быть в установленной версии пакета).
 */
export const ADMIN_NAV_ICONS: readonly AdminNavIconMeta[] = [
  { id: "layout-dashboard", label: "Панель", group: "Навигация" },
  { id: "layout", label: "Макет", group: "Навигация" },
  { id: "layout-grid", label: "Сетка", group: "Навигация" },
  { id: "layout-list", label: "Список", group: "Навигация" },
  { id: "list", label: "Строки", group: "Навигация" },
  { id: "rows-3", label: "Ряды", group: "Навигация" },
  { id: "grid-3x3", label: "Плитки", group: "Навигация" },
  { id: "panel-top", label: "Шапка", group: "Навигация" },
  { id: "menu", label: "Меню", group: "Навигация" },
  { id: "sliders", label: "Настройки вида", group: "Навигация" },
  { id: "folder-open", label: "Папка", group: "Группы" },
  { id: "layers", label: "Слои", group: "Группы" },
  { id: "archive", label: "Архив", group: "Группы" },
  { id: "group", label: "Группа", group: "Группы" },
  { id: "briefcase", label: "Портфель", group: "Группы" },
  { id: "package", label: "Коробка", group: "Товары" },
  { id: "box", label: "Ящик", group: "Товары" },
  { id: "boxes", label: "Коробки", group: "Товары" },
  { id: "package-open", label: "Открытая", group: "Товары" },
  { id: "package-search", label: "Поиск товара", group: "Товары" },
  { id: "package-check", label: "Проверен", group: "Товары" },
  { id: "package-plus", label: "Новый товар", group: "Товары" },
  { id: "warehouse", label: "Склад", group: "Товары" },
  { id: "factory", label: "Производство", group: "Товары" },
  { id: "store", label: "Магазин", group: "Товары" },
  { id: "shopping-cart", label: "Корзина", group: "Товары" },
  { id: "tag", label: "Бирка", group: "Товары" },
  { id: "tags", label: "Бирки", group: "Товары" },
  { id: "barcode", label: "Штрихкод", group: "Товары" },
  { id: "qr-code", label: "QR", group: "Товары" },
  { id: "scan-line", label: "Сканер", group: "Товары" },
  { id: "ruler", label: "Линейка", group: "Товары" },
  { id: "scissors", label: "Ножницы", group: "Товары" },
  { id: "truck", label: "Доставка", group: "Товары" },
  { id: "recycle", label: "Макулатура", group: "Товары" },
  { id: "droplet", label: "Капля", group: "Товары" },
  { id: "landmark", label: "Учёт", group: "Деньги" },
  { id: "wallet", label: "Кошелёк", group: "Деньги" },
  { id: "wallet-cards", label: "Карты", group: "Деньги" },
  { id: "credit-card", label: "Карта", group: "Деньги" },
  { id: "banknote", label: "Купюра", group: "Деньги" },
  { id: "coins", label: "Монеты", group: "Деньги" },
  { id: "hand-coins", label: "Оплата", group: "Деньги" },
  { id: "piggy-bank", label: "Копилка", group: "Деньги" },
  { id: "receipt", label: "Чек", group: "Деньги" },
  { id: "badge-dollar", label: "Цена", group: "Деньги" },
  { id: "badge-percent", label: "Скидка", group: "Деньги" },
  { id: "trending-up", label: "Рост", group: "Деньги" },
  { id: "trending-down", label: "Спад", group: "Деньги" },
  { id: "chart-bar", label: "Столбцы", group: "Деньги" },
  { id: "chart-line", label: "График", group: "Деньги" },
  { id: "chart-pie", label: "Доли", group: "Деньги" },
  { id: "gauge", label: "Датчик", group: "Деньги" },
  { id: "target", label: "Цель", group: "Деньги" },
  { id: "calculator", label: "Калькулятор", group: "Деньги" },
  { id: "scale", label: "Весы", group: "Деньги" },
  { id: "users", label: "Люди", group: "Люди" },
  { id: "user", label: "Человек", group: "Люди" },
  { id: "user-square", label: "Карточка", group: "Люди" },
  { id: "user-check", label: "Проверен", group: "Люди" },
  { id: "user-plus", label: "Новый", group: "Люди" },
  { id: "user-star", label: "VIP", group: "Люди" },
  { id: "contact", label: "Контакт", group: "Люди" },
  { id: "headset", label: "Поддержка", group: "Люди" },
  { id: "handshake", label: "Сделка", group: "Люди" },
  { id: "shield", label: "Щит", group: "Люди" },
  { id: "shield-check", label: "Охрана", group: "Люди" },
  { id: "file-text", label: "Документ", group: "Документы" },
  { id: "file-spreadsheet", label: "Таблица", group: "Документы" },
  { id: "file-bar-chart", label: "Отчёт", group: "Документы" },
  { id: "table-2", label: "Таблица 2", group: "Документы" },
  { id: "clipboard-list", label: "Заявки", group: "Документы" },
  { id: "clipboard-check", label: "Чеклист", group: "Документы" },
  { id: "list-checks", label: "Галочки", group: "Документы" },
  { id: "printer", label: "Печать", group: "Документы" },
  { id: "database", label: "База", group: "Документы" },
  { id: "notebook", label: "Блокнот", group: "Документы" },
  { id: "settings", label: "Шестерёнка", group: "Система" },
  { id: "settings-2", label: "Тумблеры", group: "Система" },
  { id: "wrench", label: "Ключ", group: "Система" },
  { id: "key", label: "Ключ доступа", group: "Система" },
  { id: "lock", label: "Замок", group: "Система" },
  { id: "eye", label: "Просмотр", group: "Система" },
  { id: "search", label: "Поиск", group: "Система" },
  { id: "bell", label: "Колокол", group: "Система" },
  { id: "calendar", label: "Календарь", group: "Система" },
  { id: "calendar-days", label: "Дни", group: "Система" },
  { id: "clock", label: "Часы", group: "Система" },
  { id: "history", label: "История", group: "Система" },
  { id: "hourglass", label: "Песочные", group: "Система" },
  { id: "star", label: "Звезда", group: "Метки" },
  { id: "flame", label: "Огонь", group: "Метки" },
  { id: "zap", label: "Молния", group: "Метки" },
  { id: "sparkles", label: "Искры", group: "Метки" },
  { id: "gift", label: "Подарок", group: "Метки" },
  { id: "megaphone", label: "Акция", group: "Метки" },
  { id: "rocket", label: "Ракета", group: "Метки" },
  { id: "info", label: "Инфо", group: "Метки" },
  { id: "badge-check", label: "Ок", group: "Метки" },
  { id: "circle-alert", label: "Внимание", group: "Метки" },
  { id: "check-circle", label: "Готово", group: "Метки" },
  { id: "door-open", label: "Дверь", group: "Место" },
  { id: "building-2", label: "Здание", group: "Место" },
  { id: "map-pin", label: "Метка", group: "Место" },
  { id: "globe", label: "Сайт", group: "Место" },
  { id: "phone", label: "Телефон", group: "Связь" },
  { id: "mail", label: "Почта", group: "Связь" },
  { id: "message-circle", label: "Чат", group: "Связь" },
  { id: "bot", label: "Бот", group: "Связь" },
  { id: "camera", label: "Камера", group: "Медиа" },
  { id: "image", label: "Фото", group: "Медиа" },
  { id: "palette", label: "Палитра", group: "Медиа" },
  { id: "pencil", label: "Карандаш", group: "Медиа" },
] as const;

const ICON_ID_SET = new Set(ADMIN_NAV_ICONS.map((icon) => icon.id));

export function isAdminNavIconId(value: unknown): value is string {
  return typeof value === "string" && ICON_ID_SET.has(value);
}

export const DEFAULT_GROUP_ICON = "folder-open";

export const ADMIN_NAV_ICON_GROUPS = [
  "Все",
  ...Array.from(new Set(ADMIN_NAV_ICONS.map((icon) => icon.group))),
];

export type AdminNavCatalogItem = {
  id: string;
  /** Хвост пути после /{adminPath}. Пустая строка — корень панели. */
  suffix: string;
  label: string;
  icon: string;
};

/** Вкладки бокового меню. Порядок — порядок по умолчанию. */
export const ADMIN_NAV_CATALOG: readonly AdminNavCatalogItem[] = [
  { id: "dashboard", suffix: "", label: "Панель", icon: "layout-dashboard" },
  { id: "products", suffix: "/products", label: "Товары и категории", icon: "package" },
  { id: "promotions", suffix: "/promotions", label: "Акции и окна", icon: "megaphone" },
  { id: "profit-report", suffix: "/profit-report", label: "Выгода продаж", icon: "trending-up" },
  { id: "reviews", suffix: "/reviews", label: "Отзывы", icon: "star" },
  { id: "orders", suffix: "/orders", label: "Заявки", icon: "clipboard-list" },
  { id: "client-requests", suffix: "/client-requests", label: "Заявки клиентов", icon: "headset" },
  { id: "user-cabinet", suffix: "/user-cabinet", label: "Кабинет клиента", icon: "user-square" },
  { id: "warehouse", suffix: "/warehouse", label: "Учёт СибГофроТорг", icon: "boxes" },
  { id: "rent", suffix: "/rent", label: "Учёт аренды", icon: "building-2" },
  { id: "wastepaper", suffix: "/wastepaper-account", label: "Учёт макулатура", icon: "recycle" },
  { id: "duty-schedule", suffix: "/duty-schedule", label: "Охрана", icon: "shield-check" },
  { id: "scan", suffix: "/scan", label: "Сканер", icon: "qr-code" },
  { id: "print-sheet", suffix: "/print-sheet", label: "Печать А4", icon: "printer" },
  { id: "door-sign", suffix: "/door-sign", label: "Табличка на дверь", icon: "door-open" },
  { id: "box-finder", suffix: "/box-finder", label: "Подбор коробки", icon: "ruler" },
  { id: "die-calc", suffix: "/die-calc", label: "Штанцформа", icon: "scissors" },
  { id: "die-calc-jobs", suffix: "/die-calc/jobs", label: "Расчёты штанцформ", icon: "table-2" },
  { id: "database", suffix: "/database", label: "База Данных", icon: "database" },
  { id: "settings", suffix: "/settings", label: "Настройки", icon: "settings" },
];

export type AdminNavItemDef = {
  id: string;
  href: string;
  label: string;
  icon: string;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  icon: string;
  itemIds: string[];
};

export type AdminNavOrderNode =
  | { type: "item"; id: string }
  | { type: "group"; id: string };

export type AdminNavLayout = {
  version: typeof ADMIN_NAV_LAYOUT_VERSION;
  order: AdminNavOrderNode[];
  groups: AdminNavGroup[];
  /** Подмена иконки вкладки. Нет ключа — иконка по умолчанию. */
  icons: Record<string, string>;
  /** Подмена подписи вкладки. Нет ключа — подпись каталога. */
  labels: Record<string, string>;
};

export type ResolvedNavItem = {
  item: AdminNavItemDef;
  icon: string;
  label: string;
};

export type ResolvedNavEntry =
  | ({ type: "item" } & ResolvedNavItem)
  | {
      type: "group";
      id: string;
      label: string;
      icon: string;
      items: ResolvedNavItem[];
    };

const GROUP_ID_RE = /^g_[a-zA-Z0-9_-]{4,40}$/;
const MAX_GROUPS = 24;
const MAX_LABEL = 40;

export function cleanNavLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

export function newNavGroupId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let tail = "";
  for (let i = 0; i < 8; i += 1) {
    tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `g_${tail}`;
}

/**
 * Вкладки, которые роль реально видит. adminPath нужен только
 * чтобы собрать pathname для canAccessAdminPage.
 */
export function buildAccessibleNav(
  role: AdminRole,
  adminPath: string,
): AdminNavItemDef[] {
  return ADMIN_NAV_CATALOG.filter((item) =>
    canAccessAdminPage(role, `/${adminPath}${item.suffix}`, adminPath),
  ).map((item) => ({
    id: item.id,
    href: `/${adminPath}${item.suffix}`,
    label: item.label,
    icon: item.icon,
  }));
}

export function sanitizeNavLayout(
  raw: unknown,
  allowedItemIds: readonly string[],
): AdminNavLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== ADMIN_NAV_LAYOUT_VERSION) return null;

  const allowed = new Set(allowedItemIds);
  const groups: AdminNavGroup[] = [];
  const seenGroups = new Set<string>();
  const usedItems = new Set<string>();
  const groupsRaw = Array.isArray(obj.groups) ? obj.groups : [];

  for (const entry of groupsRaw) {
    if (groups.length >= MAX_GROUPS) break;
    if (!entry || typeof entry !== "object") continue;
    const group = entry as Record<string, unknown>;
    const id = typeof group.id === "string" ? group.id : "";
    if (!GROUP_ID_RE.test(id) || seenGroups.has(id)) continue;
    seenGroups.add(id);
    const itemIds: string[] = [];
    if (Array.isArray(group.itemIds)) {
      for (const itemId of group.itemIds) {
        if (typeof itemId !== "string") continue;
        if (!allowed.has(itemId) || usedItems.has(itemId)) continue;
        usedItems.add(itemId);
        itemIds.push(itemId);
      }
    }
    groups.push({
      id,
      label: cleanNavLabel(group.label) || "Группа",
      icon: isAdminNavIconId(group.icon) ? group.icon : DEFAULT_GROUP_ICON,
      itemIds,
    });
  }

  const groupIds = new Set(groups.map((group) => group.id));
  const order: AdminNavOrderNode[] = [];
  const seenOrder = new Set<string>();
  const orderRaw = Array.isArray(obj.order) ? obj.order : [];

  for (const entry of orderRaw) {
    if (!entry || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    if (node.type === "group" && typeof node.id === "string") {
      if (!groupIds.has(node.id) || seenOrder.has(node.id)) continue;
      order.push({ type: "group", id: node.id });
      seenOrder.add(node.id);
      continue;
    }
    if (node.type === "item" && typeof node.id === "string") {
      if (!allowed.has(node.id) || usedItems.has(node.id) || seenOrder.has(node.id)) continue;
      order.push({ type: "item", id: node.id });
      seenOrder.add(node.id);
      usedItems.add(node.id);
    }
  }

  for (const group of groups) {
    if (!seenOrder.has(group.id)) order.push({ type: "group", id: group.id });
  }
  for (const id of allowedItemIds) {
    if (!usedItems.has(id)) order.push({ type: "item", id });
  }

  const icons: Record<string, string> = {};
  if (obj.icons && typeof obj.icons === "object" && !Array.isArray(obj.icons)) {
    for (const [key, value] of Object.entries(obj.icons as Record<string, unknown>)) {
      if (!allowed.has(key) || !isAdminNavIconId(value)) continue;
      icons[key] = value;
    }
  }

  const labels: Record<string, string> = {};
  if (obj.labels && typeof obj.labels === "object" && !Array.isArray(obj.labels)) {
    for (const [key, value] of Object.entries(obj.labels as Record<string, unknown>)) {
      const label = cleanNavLabel(value);
      if (!allowed.has(key) || !label) continue;
      labels[key] = label;
    }
  }

  return {
    version: ADMIN_NAV_LAYOUT_VERSION,
    order,
    groups,
    icons,
    labels,
  };
}

/** Готовые группы «по смыслу». Пустые для текущей роли не попадают в меню. */
export function presetNavLayout(allowedItemIds: readonly string[]): AdminNavLayout {
  const allowed = new Set(allowedItemIds);
  const presets: AdminNavGroup[] = [
    {
      id: "g_sales",
      label: "Продажи",
      icon: "shopping-cart",
      itemIds: [
        "products",
        "promotions",
        "profit-report",
        "reviews",
        "orders",
        "client-requests",
        "user-cabinet",
      ],
    },
    {
      id: "g_accounts",
      label: "Учёт",
      icon: "landmark",
      itemIds: ["warehouse", "rent", "wastepaper"],
    },
    {
      id: "g_tools",
      label: "Инструменты",
      icon: "wrench",
      itemIds: [
        "duty-schedule",
        "scan",
        "print-sheet",
        "door-sign",
        "box-finder",
        "die-calc",
        "die-calc-jobs",
      ],
    },
    {
      id: "g_system",
      label: "Система",
      icon: "settings-2",
      itemIds: ["database", "settings"],
    },
  ];

  const used = new Set<string>();
  const groups = presets
    .map((group) => ({
      ...group,
      itemIds: group.itemIds.filter((id) => allowed.has(id) && !used.has(id) && used.add(id)),
    }))
    .filter((group) => group.itemIds.length > 0);

  const order: AdminNavOrderNode[] = [];
  if (allowed.has("dashboard")) order.push({ type: "item", id: "dashboard" });
  for (const group of groups) order.push({ type: "group", id: group.id });
  for (const id of allowedItemIds) {
    if (id === "dashboard" || used.has(id)) continue;
    order.push({ type: "item", id });
  }

  return sanitizeNavLayout(
    { version: ADMIN_NAV_LAYOUT_VERSION, order, groups, icons: {}, labels: {} },
    allowedItemIds,
  ) ?? {
    version: ADMIN_NAV_LAYOUT_VERSION,
    order: allowedItemIds.map((id) => ({ type: "item", id })),
    groups: [],
    icons: {},
    labels: {},
  };
}

export function resolveNavTree(
  items: readonly AdminNavItemDef[],
  layout: AdminNavLayout | null,
): ResolvedNavEntry[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  if (!layout) {
    return items.map((item) => ({
      type: "item",
      item,
      icon: item.icon,
      label: item.label,
    }));
  }

  const used = new Set<string>();
  const decorate = (id: string): ResolvedNavItem | null => {
    const item = byId.get(id);
    if (!item || used.has(id)) return null;
    used.add(id);
    const icon = isAdminNavIconId(layout.icons[id]) ? layout.icons[id] : item.icon;
    const label = cleanNavLabel(layout.labels[id]) || item.label;
    return { item, icon, label };
  };

  const groupById = new Map(layout.groups.map((group) => [group.id, group]));
  const entries: ResolvedNavEntry[] = [];

  for (const node of layout.order) {
    if (node.type === "item") {
      const decorated = decorate(node.id);
      if (decorated) entries.push({ type: "item", ...decorated });
      continue;
    }
    const group = groupById.get(node.id);
    if (!group) continue;
    const children = group.itemIds
      .map(decorate)
      .filter((child): child is ResolvedNavItem => Boolean(child));
    if (children.length === 0) continue;
    entries.push({
      type: "group",
      id: group.id,
      label: group.label,
      icon: isAdminNavIconId(group.icon) ? group.icon : DEFAULT_GROUP_ICON,
      items: children,
    });
  }

  for (const item of items) {
    if (used.has(item.id)) continue;
    entries.push({ type: "item", item, icon: item.icon, label: item.label });
  }
  return entries;
}

export function flattenNavTree(
  tree: readonly ResolvedNavEntry[],
): Array<{ href: string; label: string; icon: string }> {
  const out: Array<{ href: string; label: string; icon: string }> = [];
  for (const entry of tree) {
    if (entry.type === "item") {
      out.push({ href: entry.item.href, label: entry.label, icon: entry.icon });
      continue;
    }
    for (const child of entry.items) {
      out.push({ href: child.item.href, label: child.label, icon: child.icon });
    }
  }
  return out;
}

/**
 * Активна самая конкретная вкладка. Иначе «Штанцформа»
 * подсвечивалась бы вместе с «Расчёты штанцформ».
 */
export function isAdminNavItemActive(
  pathname: string,
  href: string,
  hrefs: readonly string[],
  adminRoot: string,
): boolean {
  if (href === adminRoot) return pathname === href || pathname === `${href}/`;
  if (pathname === href || pathname === `${href}/`) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  return !hrefs.some(
    (other) =>
      other !== href &&
      other.length > href.length &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
}
