// =========================================================
// FILE: src/lib/admin-nav.ts
// Реестр разделов админки + персональные настройки навигации.
//
// Реестр (ADMIN_NAV_ITEMS) — единственный источник списка разделов:
// его используют оболочка (сайдбар/планшет/телефон) и настройщик меню.
//
// Персональные настройки каждого пользователя (порядок, скрытые
// разделы, группы-выпадашки) хранятся в БД (таблица
// admin_nav_settings, ключ — логин) и применяются ко ВСЕМ вариантам
// навигации. Модель настроек:
//   entries — упорядоченный список «верхнего уровня»: ключ раздела
//             ИЛИ группа { id, title, icon, items: ключи[] };
//   hidden  — скрытые разделы (не рендерятся нигде).
// Разделы, которых нет в настройке (например, добавленные в коде
// позже), автоматически появляются в конце списка видимыми.
// =========================================================

import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Database,
  DoorOpen,
  Factory,
  FileText,
  Folder,
  FolderClosed,
  Gift,
  Grid2x2,
  Hammer,
  Headset,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Megaphone,
  Package,
  PackageOpen,
  Palette,
  PiggyBank,
  Printer,
  QrCode,
  Recycle,
  Ruler,
  Scale,
  Scissors,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Table2,
  Tags,
  Target,
  TrendingUp,
  Truck,
  UserSquare,
  Users,
  Wallet,
  Warehouse,
  Wrench,
} from "lucide-react";

// ── Реестр разделов ───────────────────────────────────────

export interface AdminNavItemDef {
  /** Стабильный ключ — часть URL после «/{админ-путь}». */
  key: string;
  label: string;
  /** Идентификатор иконки из NAV_ICON_MAP. */
  icon: string;
}

/** Ключ корневого раздела («Панель»). */
export const ADMIN_NAV_DASHBOARD_KEY = "dashboard";

/**
 * Полный список разделов админки в порядке по умолчанию.
 * Права роли фильтруют этот список в оболочке (canAccessAdminPage),
 * здесь — только реестр.
 */
export const ADMIN_NAV_ITEMS: AdminNavItemDef[] = [
  { key: "dashboard", label: "Панель", icon: "LayoutDashboard" },
  { key: "products", label: "Товары и категории", icon: "Package" },
  { key: "promotions", label: "Акции и окна", icon: "Megaphone" },
  {
    // Расчёт выгоды продаж за период: прибыль своего производства
    // против закупки у конкурента + печать сводки на A4.
    key: "profit-report",
    label: "Выгода продаж",
    icon: "TrendingUp",
  },
  { key: "reviews", label: "Отзывы", icon: "Star" },
  { key: "orders", label: "Заявки", icon: "ClipboardList" },
  { key: "client-requests", label: "Заявки клиентов", icon: "Headset" },
  {
    // Кабинет клиента глазами клиента + ручное управление его заявками.
    key: "user-cabinet",
    label: "Кабинет клиента",
    icon: "UserSquare",
  },
  {
    // Учёт СибГофроТорг (гофротара): склад, заказы, банк. Не путать
    // с учётом аренды и макулатуры — у них свои разделы ниже.
    key: "warehouse",
    label: "Учёт СибГофроТорг",
    icon: "Boxes",
  },
  {
    // Управленческий учёт аренды: банк аренды, арендаторы, просрочки.
    key: "rent",
    label: "Аренда",
    icon: "Building2",
  },
  {
    // Отдельный учёт макулатуры: виден admin и макулатурщику.
    key: "wastepaper-account",
    label: "Учёт макулатура",
    icon: "Recycle",
  },
  { key: "duty-schedule", label: "Охрана", icon: "ShieldCheck" },
  { key: "scan", label: "Сканер", icon: "QrCode" },
  {
    // Редактор таблицы для печати на А4 (шрифт, размеры, поля).
    key: "print-sheet",
    label: "Печать А4",
    icon: "Printer",
  },
  {
    // Табличка на дверь: A4 landscape, крупный телефон, ч/б печать.
    key: "door-sign",
    label: "Табличка на дверь",
    icon: "DoorOpen",
  },
  {
    // Подбор ближайшей коробки по габаритам Д×Ш×В (мм).
    key: "box-finder",
    label: "Подбор коробки",
    icon: "Ruler",
  },
  {
    // Калькулятор штанцформы: развертка, сборка 3D, раскладка, цены.
    key: "die-calc",
    label: "Штанцформа",
    icon: "Scissors",
  },
  {
    // Журнал сохранённых расчётов штанцформ.
    key: "die-calc/jobs",
    label: "Расчёты штанцформ",
    icon: "Table2",
  },
  {
    // Все таблицы базы данных: только admin и owner.
    key: "database",
    label: "База Данных",
    icon: "Database",
  },
  { key: "settings", label: "Настройки", icon: "Settings" },
];

/** href раздела: корень — «/{админ}», остальные — «/{админ}/{ключ}». */
export function navItemHref(adminPath: string, key: string): string {
  return key === ADMIN_NAV_DASHBOARD_KEY
    ? `/${adminPath}`
    : `/${adminPath}/${key}`;
}

/** Активен ли раздел при текущем пути (корень — только точное совпадение). */
export function isNavHrefActive(
  href: string,
  pathname: string,
  adminPath: string
): boolean {
  return href === `/${adminPath}`
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

// ── Иконки ────────────────────────────────────────────────

/** Все иконки, доступные разделам и группам (ид → компонент). */
export const NAV_ICON_MAP: Record<string, LucideIcon> = {
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Database,
  DoorOpen,
  Factory,
  FileText,
  Folder,
  FolderClosed,
  Gift,
  Grid2x2,
  Hammer,
  Headset,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Megaphone,
  Package,
  PackageOpen,
  Palette,
  PiggyBank,
  Printer,
  QrCode,
  Recycle,
  Ruler,
  Scale,
  Scissors,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Star,
  Store,
  Table2,
  Tags,
  Target,
  TrendingUp,
  Truck,
  UserSquare,
  Users,
  Wallet,
  Warehouse,
  Wrench,
};

/** Иконки, предлагаемые при создании группы (порядок = сетка выбора). */
export const NAV_GROUP_ICON_CHOICES: string[] = [
  "Folder",
  "FolderClosed",
  "Tags",
  "ShoppingCart",
  "Users",
  "FileText",
  "Calculator",
  "BarChart3",
  "Wallet",
  "PiggyBank",
  "Coins",
  "Wrench",
  "Hammer",
  "Palette",
  "Grid2x2",
  "LayoutGrid",
  "Briefcase",
  "Calendar",
  "PackageOpen",
  "ClipboardCheck",
  "Scale",
  "Sparkles",
  "Store",
  "Truck",
  "Bell",
  "Gift",
  "BookOpen",
  "Landmark",
  "Factory",
  "Target",
  "Archive",
  "Warehouse",
  "ListChecks",
  "Database",
  "QrCode",
  "Printer",
  "Recycle",
  "ShieldCheck",
  "Star",
];

const DEFAULT_GROUP_ICON = "Folder";

export function getNavIcon(id: string | undefined | null): LucideIcon {
  return (id && NAV_ICON_MAP[id]) || NAV_ICON_MAP[DEFAULT_GROUP_ICON];
}

// ── Модель настроек (то, что лежит в БД) ──────────────────

export interface AdminNavGroupDto {
  id: string;
  title: string;
  icon: string;
  /** Упорядоченные ключи разделов внутри группы. */
  items: string[];
}

/** Элемент верхнего уровня: ключ раздела или группа. */
export type AdminNavEntryDto = string | AdminNavGroupDto;

export interface AdminNavSettingsDto {
  version: 1;
  entries: AdminNavEntryDto[];
  hidden: string[];
}

const MAX_ENTRIES = 64;
const MAX_GROUPS = 16;
const MAX_GROUP_ITEMS = 40;
const MAX_TITLE_LEN = 48;
const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,48}$/;

export function isNavGroupDto(value: unknown): value is AdminNavGroupDto {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Array.isArray((value as AdminNavGroupDto).items)
  );
}

/**
 * Приводит произвольные данные (из БД/запроса) к валидной модели.
 * Возвращает null, если настроек нет/они пусты. Неизвестные ключи
 * и дубли отбрасываются — навигация не ломается от старых данных.
 */
export function normalizeNavSettings(
  raw: unknown,
  knownKeys: readonly string[]
): AdminNavSettingsDto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Partial<AdminNavSettingsDto>;
  if (!Array.isArray(obj.entries)) return null;

  const known = new Set(knownKeys);
  const hiddenRaw = Array.isArray(obj.hidden) ? obj.hidden : [];
  const hidden: string[] = [];
  const hiddenSet = new Set<string>();
  for (const key of hiddenRaw) {
    if (typeof key === "string" && known.has(key) && !hiddenSet.has(key)) {
      hiddenSet.add(key);
      hidden.push(key);
    }
  }

  const used = new Set<string>();
  const entries: AdminNavEntryDto[] = [];
  let groupCount = 0;

  for (const entry of obj.entries.slice(0, MAX_ENTRIES)) {
    if (typeof entry === "string") {
      if (known.has(entry) && !used.has(entry) && !hiddenSet.has(entry)) {
        used.add(entry);
        entries.push(entry);
      }
      continue;
    }
    if (!isNavGroupDto(entry) || groupCount >= MAX_GROUPS) continue;
    const id =
      typeof entry.id === "string" && GROUP_ID_RE.test(entry.id)
        ? entry.id
        : `group-${groupCount + 1}`;
    const title =
      typeof entry.title === "string"
        ? entry.title.trim().slice(0, MAX_TITLE_LEN)
        : "";
    const icon =
      typeof entry.icon === "string" && NAV_ICON_MAP[entry.icon]
        ? entry.icon
        : DEFAULT_GROUP_ICON;
    const items: string[] = [];
    for (const key of entry.items.slice(0, MAX_GROUP_ITEMS)) {
      if (typeof key === "string" && known.has(key) && !used.has(key) && !hiddenSet.has(key)) {
        used.add(key);
        items.push(key);
      }
    }
    groupCount += 1;
    entries.push({ id, title: title || "Группа", icon, items });
  }

  if (entries.length === 0 && hidden.length === 0) return null;
  return { version: 1, entries, hidden };
}

// ── Разрешение настроек в модель рендера ──────────────────

export interface NavItemModel {
  kind: "item";
  key: string;
  href: string;
  label: string;
  icon: string;
}

export interface NavGroupModel {
  kind: "group";
  id: string;
  title: string;
  icon: string;
  items: NavItemModel[];
}

export type NavModelEntry = NavItemModel | NavGroupModel;

function toItemModel(
  def: AdminNavItemDef,
  adminPath: string
): NavItemModel {
  return {
    kind: "item",
    key: def.key,
    href: navItemHref(adminPath, def.key),
    label: def.label,
    icon: def.icon,
  };
}

/**
 * Собирает финальную структуру навигации: порядок и группы из
 * настроек пользователя, скрытые разделы исключены, разделы без
 * упоминания в настройках добавляются в конец видимыми.
 */
export function buildNavModel(
  available: AdminNavItemDef[],
  settings: AdminNavSettingsDto | null,
  adminPath: string
): NavModelEntry[] {
  const defs = new Map(available.map((def) => [def.key, def]));
  const hidden = new Set(settings?.hidden ?? []);
  const used = new Set<string>();
  const result: NavModelEntry[] = [];

  for (const entry of settings?.entries ?? []) {
    if (typeof entry === "string") {
      const def = defs.get(entry);
      if (!def || used.has(entry) || hidden.has(entry)) continue;
      used.add(entry);
      result.push(toItemModel(def, adminPath));
      continue;
    }
    if (!isNavGroupDto(entry)) continue;
    const items: NavItemModel[] = [];
    for (const key of entry.items) {
      const def = defs.get(key);
      if (!def || used.has(key) || hidden.has(key)) continue;
      used.add(key);
      items.push(toItemModel(def, adminPath));
    }
    // Пустая группа (все разделы скрыты/недоступны роли) не рендерится.
    if (items.length === 0) continue;
    result.push({
      kind: "group",
      id: entry.id,
      title: entry.title,
      icon: entry.icon,
      items,
    });
  }

  // Не упомянутые в настройке разделы — в конец, в исходном порядке.
  for (const def of available) {
    if (used.has(def.key) || hidden.has(def.key)) continue;
    result.push(toItemModel(def, adminPath));
  }

  return result;
}

/** Плоский список всех видимых разделов модели (для нижних меню). */
export function flattenNavModel(model: NavModelEntry[]): NavItemModel[] {
  const flat: NavItemModel[] = [];
  for (const entry of model) {
    if (entry.kind === "item") flat.push(entry);
    else flat.push(...entry.items);
  }
  return flat;
}
