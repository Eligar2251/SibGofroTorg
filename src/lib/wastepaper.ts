// =========================================================
// FILE: src/lib/wastepaper.ts
// Цены приёма макулатуры — единый источник правды для сайта
// (главная, страница «Приём макулатуры», калькулятор) и админки.
//
// Значения хранятся в настройках (settings.main, ключи wp_rate_*).
// Здесь — только чистые константы и хелперы БЕЗ обращения к Firestore,
// чтобы файл можно было безопасно импортировать в клиентские компоненты.
// Серверное чтение цен — getWastepaperRates() в firestore-queries.ts.
// =========================================================

/** Идентификаторы видов сырья (ключ цены в настройках: wp_rate_<id>) */
export const WASTEPAPER_RATE_IDS = [
  "cardboard",
  "office_paper",
  "books",
  "mix",
] as const;

export type WastepaperRateId = (typeof WASTEPAPER_RATE_IDS)[number];

export type WastepaperRates = Record<WastepaperRateId, number>;

/** Дефолтные цены, ₽/кг (используются, пока в настройках пусто) */
export const WASTEPAPER_RATE_DEFAULTS: WastepaperRates = {
  cardboard: 8,
  office_paper: 11.5,
  books: 9,
  mix: 6,
};

/** Надбавка за самовывоз (привёз сам), ₽/кг */
export const WASTEPAPER_SELF_BONUS = 0.5;

/** Минимальный вес для вывоза, кг */
export const WASTEPAPER_PICKUP_MIN_KG = 200;

export const WP_PICKUP_MIN_SETTING_KEY = "wp_pickup_min_kg";
export const WP_SELF_BONUS_SETTING_KEY = "wp_self_bonus";
export const WP_PICKUP_PRICE_SETTING_KEY = "wp_pickup_price";
export const WP_ACCEPT_LIST_SETTING_KEY = "wp_accept_list";
export const WP_PHONE_SETTING_KEY = "wp_phone";

export const WASTEPAPER_ACCEPT_DEFAULTS = [
  "Гофрокартон — коробки, листы, обрезки",
  "Белая офисная бумага А4 и А3",
  "Архивные документы (без папок)",
  "Книги, журналы, газеты",
  "Рекламные листовки и каталоги",
  "Смешанная макулатура в связках",
];

export function parseWastepaperNumber(raw: unknown, fallback: number): number {
  return parseWastepaperRate(raw, fallback);
}

export function parseWastepaperAcceptList(raw: unknown): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [...WASTEPAPER_ACCEPT_DEFAULTS];
  const items = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : [...WASTEPAPER_ACCEPT_DEFAULTS];
}

export function getWastepaperPageConfig(settings: Record<string, string> = {}) {
  return {
    pickupMinKg: (() => {
      const raw = settings[WP_PICKUP_MIN_SETTING_KEY];
      const parsed = parseWastepaperNumber(raw, WASTEPAPER_PICKUP_MIN_KG);
      // Старый дефолт был 150 кг — поднимаем до актуальных 200.
      if (!String(raw ?? "").trim() || parsed === 150) return WASTEPAPER_PICKUP_MIN_KG;
      return parsed;
    })(),
    selfBonus: parseWastepaperNumber(
      settings[WP_SELF_BONUS_SETTING_KEY],
      WASTEPAPER_SELF_BONUS
    ),
    pickupPrice: parseWastepaperNumber(settings[WP_PICKUP_PRICE_SETTING_KEY], 0),
    acceptList: parseWastepaperAcceptList(settings[WP_ACCEPT_LIST_SETTING_KEY]),
    phone: String(settings[WP_PHONE_SETTING_KEY] || "").trim(),
  };
}

/** Ключ настройки для цены конкретного вида сырья */
export function wpRateSettingKey(id: WastepaperRateId): string {
  return `wp_rate_${id}`;
}

/**
 * Разбор цены из настроек: строка/число → число.
 * Пустое/некорректное/отрицательное значение → fallback.
 */
export function parseWastepaperRate(raw: unknown, fallback: number): number {
  const str = String(raw ?? "").replace(",", ".").trim();
  // Пустая строка → дефолт (Number("") дал бы 0 — нежелательно)
  if (str === "") return fallback;
  const num = Number(str);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

/** Цены из настроек, дополненные дефолтами (для клиента и страниц) */
export function withDefaultRates(
  rates?: Partial<WastepaperRates> | null
): WastepaperRates {
  return { ...WASTEPAPER_RATE_DEFAULTS, ...(rates || {}) };
}

/** Красивый вывод цены: 8 → «8», 11.5 → «11,5» */
export function formatRate(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}
