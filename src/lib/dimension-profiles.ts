// =========================================================
// FILE: src/lib/dimension-profiles.ts
// Типы размеров товара («профили размеров»).
//
// У коробки размеры — Длина × Ширина × Высота в мм, у скотча —
// Ширина (мм) × Длина (м) × Толщина (мкм), у стрейч-плёнки — то же.
// Профиль задаёт набор и порядок полей и единицу по умолчанию для
// каждого поля; профиль привязывается к категории (и при желании
// переопределяется у конкретного товара).
//
// Значения товара хранятся в products.dimension_values — массив
// [{ key, label, value, unit }] в порядке полей профиля. Каждое
// поле со своей единицей: «48 мм × 120 м × 45 мкм».
//
// Для совместимости (подбор коробок, объём, поиск по размерам)
// поля с ключами length/width/height дополнительно пишутся в старые
// колонки dimension_length/width/height в миллиметрах.
//
// Модуль общий для сервера и клиента — без серверных импортов.
// =========================================================

/** Единицы, которые предлагаются в выпадающем списке у каждого поля. */
export const DIMENSION_UNITS = ["мкм", "мм", "см", "м"] as const;

/** Множитель «единица → мм». Для прочих единиц (шт, кг…) — null. */
const UNIT_TO_MM: Record<string, number> = {
  "мкм": 0.001,
  "мк": 0.001,
  "µm": 0.001,
  "um": 0.001,
  "мм": 1,
  "mm": 1,
  "см": 10,
  "cm": 10,
  "м": 1000,
  "m": 1000,
};

export interface DimensionField {
  /** Машинное имя: length / width / height / thickness / … */
  key: string;
  /** Подпись: «Длина», «Ширина», «Толщина». */
  label: string;
  /** Единица по умолчанию: «мм», «м», «мкм». */
  unit: string;
}

export interface DimensionProfile {
  id: string;
  name: string;
  slug?: string | null;
  fields: DimensionField[];
  sortOrder?: number;
  isDefault?: boolean;
}

export interface DimensionValue {
  key: string;
  label: string;
  value: number | null;
  unit: string;
}

/** Профиль «Коробки (Д×Ш×В)» — поведение по умолчанию, как было раньше. */
export const BOX_DIMENSION_FIELDS: DimensionField[] = [
  { key: "length", label: "Длина", unit: "мм" },
  { key: "width", label: "Ширина", unit: "мм" },
  { key: "height", label: "Высота", unit: "мм" },
];

export const BUILTIN_BOX_PROFILE: DimensionProfile = {
  id: "",
  name: "Коробки (Д×Ш×В)",
  slug: "box",
  fields: BOX_DIMENSION_FIELDS,
  isDefault: true,
};

const LEGACY_KEYS = ["length", "width", "height"] as const;

export function unitToMm(unit: unknown): number | null {
  const u = String(unit ?? "").trim().toLowerCase();
  return UNIT_TO_MM[u] ?? null;
}

/** Ключ поля из подписи: «Толщина плёнки» → «tolshchina_plenki». */
export function makeFieldKey(label: string, taken: Iterable<string> = []): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh",
    щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const known: Record<string, string> = {
    длина: "length", ширина: "width", высота: "height",
    толщина: "thickness", микроны: "thickness", диаметр: "diameter",
  };
  const low = label.trim().toLowerCase();
  let base =
    known[low] ||
    low
      .split("")
      .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
      .join("")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") ||
    "field";
  base = base.slice(0, 40);
  const used = new Set(taken);
  let key = base;
  let i = 2;
  while (used.has(key)) key = `${base}_${i++}`;
  return key;
}

function cleanUnit(raw: unknown, fallback = "мм"): string {
  const s = String(raw ?? "").trim().slice(0, 12);
  return s || fallback;
}

/** Нормализация полей профиля из БД/формы. */
export function normalizeDimensionFields(raw: unknown): DimensionField[] {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: DimensionField[] = [];
  const keys = new Set<string>();
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const label = String((item as any).label ?? "").trim().slice(0, 40);
    if (!label) continue;
    let key = String((item as any).key ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 40);
    if (!key || keys.has(key)) key = makeFieldKey(label, keys);
    keys.add(key);
    out.push({ key, label, unit: cleanUnit((item as any).unit) });
  }
  return out;
}

/** Нормализация значений товара из БД/запроса. */
export function normalizeDimensionValues(raw: unknown): DimensionValue[] | null {
  let arr: unknown = raw;
  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: DimensionValue[] = [];
  for (const item of arr.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const key = String((item as any).key ?? "").trim().slice(0, 40);
    const label = String((item as any).label ?? "").trim().slice(0, 40);
    if (!key && !label) continue;
    const n = Number((item as any).value);
    out.push({
      key: key || label,
      label: label || key,
      value:
        (item as any).value === "" || (item as any).value == null || !Number.isFinite(n) || n <= 0
          ? null
          : n,
      unit: cleanUnit((item as any).unit),
    });
  }
  return out.some((v) => v.value != null) ? out : null;
}

function fmtNum(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Строка размеров по значениям профиля.
 *  - одна единица у всех полей → «600×400×400 мм»;
 *  - разные единицы → «48 мм × 120 м × 45 мкм».
 */
export function formatDimensionValues(values: DimensionValue[] | null | undefined): string | null {
  const filled = (values || []).filter((v) => v.value != null && v.value > 0);
  if (filled.length === 0) return null;
  const units = new Set(filled.map((v) => v.unit));
  if (units.size === 1) {
    return `${filled.map((v) => fmtNum(v.value as number)).join("×")} ${filled[0].unit}`;
  }
  return filled.map((v) => `${fmtNum(v.value as number)} ${v.unit}`).join(" × ");
}

/** Короткая подпись порядка полей: «Ш×Д×Т». */
export function dimensionOrderLabel(values: { label: string }[] | null | undefined): string {
  return (values || [])
    .map((v) => (v.label.trim()[0] || "").toUpperCase())
    .filter(Boolean)
    .join("×");
}

/** Значения → строки для таблицы характеристик: «Ширина — 48 мм». */
export function describeDimensionValues(
  values: DimensionValue[] | null | undefined,
  profile?: DimensionProfile | null,
): { label: string; value: string }[] {
  const labelByKey = new Map((profile?.fields || []).map((f) => [f.key, f.label]));
  return (values || [])
    .filter((v) => v.value != null && v.value > 0)
    .map((v) => ({
      label: labelByKey.get(v.key) || v.label,
      value: `${fmtNum(v.value as number)} ${v.unit}`,
    }));
}

/**
 * Совместимость со старыми колонками: length/width/height → мм.
 * Пишем их только для «габаритных» типов (все поля — из length/width/
 * height: коробки, листы). У скотча/плёнки есть «толщина» — такие
 * товары не должны попадать в подбор коробок, колонки очищаются.
 */
export function legacyColumnsFromValues(values: DimensionValue[] | null | undefined): {
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string;
} {
  const isBoxLike =
    (values || []).length > 0 &&
    (values || []).every((x) => (LEGACY_KEYS as readonly string[]).includes(x.key));
  const pick = (key: string): number | null => {
    if (!isBoxLike) return null;
    const v = (values || []).find((x) => x.key === key);
    if (!v || v.value == null) return null;
    const k = unitToMm(v.unit);
    if (k == null) return null;
    return Math.round(v.value * k * 1000) / 1000;
  };
  return {
    dimensionLength: pick("length"),
    dimensionWidth: pick("width"),
    dimensionHeight: pick("height"),
    dimensionUnit: "мм",
  };
}

/** Начальные значения формы: из dimension_values, иначе из старых колонок. */
export function initialDimensionValues(
  fields: DimensionField[],
  product: {
    dimensionValues?: DimensionValue[] | null;
    dimensionLength?: number | null;
    dimensionWidth?: number | null;
    dimensionHeight?: number | null;
    dimensionUnit?: string | null;
  } | null | undefined,
): Record<string, { value: string; unit: string }> {
  const out: Record<string, { value: string; unit: string }> = {};
  const stored = new Map((product?.dimensionValues || []).map((v) => [v.key, v]));
  const legacy: Record<string, number | null | undefined> = {
    length: product?.dimensionLength,
    width: product?.dimensionWidth,
    height: product?.dimensionHeight,
  };
  for (const f of fields) {
    const s = stored.get(f.key);
    if (s) {
      out[f.key] = { value: s.value != null ? String(s.value) : "", unit: s.unit || f.unit };
    } else if ((LEGACY_KEYS as readonly string[]).includes(f.key) && legacy[f.key] != null) {
      out[f.key] = { value: String(legacy[f.key]), unit: product?.dimensionUnit || "мм" };
    } else {
      out[f.key] = { value: "", unit: f.unit };
    }
  }
  return out;
}

/** Выбор профиля: товар → категория → профиль по умолчанию → встроенный. */
export function resolveDimensionProfile(
  profiles: DimensionProfile[],
  productProfileId?: string | null,
  categoryProfileId?: string | null,
): DimensionProfile {
  const byId = (id?: string | null) => (id ? profiles.find((p) => p.id === id) : undefined);
  return (
    byId(productProfileId) ||
    byId(categoryProfileId) ||
    profiles.find((p) => p.isDefault) ||
    BUILTIN_BOX_PROFILE
  );
}

/** Числа для поиска по размерам («48 120»): значения как ввели. */
export function searchableDimensionNumbers(values: DimensionValue[] | null | undefined): number[] {
  return (values || [])
    .map((v) => v.value)
    .filter((n): n is number => n != null && n > 0);
}
