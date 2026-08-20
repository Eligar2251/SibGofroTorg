// =========================================================
// FILE: src/lib/photo-template.ts
// Модель «шаблона фото» для авто-генерации карточек товаров:
// типы элементов канваса, плейсхолдеры ({{size}}, {{name}} …)
// и подстановка данных товара. Используется в админке
// (PhotoTemplateGenerator) — серверных зависимостей нет.
// =========================================================

export interface PhotoTextElement {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  /** 400 / 700 / 900 */
  fontWeight: number;
  italic: boolean;
  align: "left" | "center" | "right";
  /** Максимальная ширина текста (px) — по ней идёт перенос строк */
  width: number;
  /** Множитель межстрочного интервала (1 = размер шрифта) */
  lineHeight: number;
  /** Трекинг, px */
  letterSpacing: number;
  /** Поворот вокруг центра, градусы */
  rotation?: number;
  /** Фоновая подложка под текстом (видимый блок) */
  background?: { color: string; radius: number } | null;
  /** Горизонтальный отступ текста до краёв блока, px */
  paddingX?: number;
  /** Вертикальный отступ текста до краёв блока, px */
  paddingY?: number;
  /** Выравнивание текста внутри блока по вертикали */
  verticalAlign?: "top" | "middle" | "bottom";
}

export interface PhotoRectElement {
  id: string;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  radius: number;
  /** Поворот вокруг центра, градусы */
  rotation?: number;
}

export interface PhotoImageElement {
  id: string;
  type: "image";
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  fit: "cover" | "contain";
  radius: number;
  /** Поворот вокруг центра, градусы */
  rotation?: number;
}

/** Стрелка: прямая линия от (x, y) до (x2, y2) с наконечником. */
export interface PhotoArrowElement {
  id: string;
  type: "arrow";
  x: number;
  y: number;
  x2: number;
  y2: number;
  color: string;
  /** Толщина линии, px */
  width: number;
  /** Размер наконечника, px */
  headSize: number;
}

/**
 * Группа элементов. Дети хранятся в ЛОКАЛЬНЫХ координатах (относительно
 * левого верхнего угла общей обёртки детей). Трансформация группы:
 * translate(x, y) → rotate(rotation) вокруг центра обёртки. Дети при
 * этом сохраняют собственные координаты/поворот — как во Figma.
 */
export interface PhotoGroupElement {
  id: string;
  type: "group";
  x: number;
  y: number;
  rotation?: number;
  items: PhotoTemplateElement[];
}

export type PhotoTemplateElement =
  | PhotoTextElement
  | PhotoRectElement
  | PhotoImageElement
  | PhotoArrowElement
  | PhotoGroupElement;

export interface PhotoTemplate {
  width: number;
  height: number;
  background:
    | { type: "color"; color: string }
    | { type: "image"; src: string; fit: "cover" | "contain" };
  elements: PhotoTemplateElement[];
}

/** Товар, нужный для подстановки токенов и предпросмотра. */
export interface PhotoProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  categoryId: string | null;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string | null;
  material: string | null;
  volume: number | null;
  barcode: string | null;
  imageUrl: string | null;
}

/** Справочник доступных плейсхолдеров (для подсказок в UI). */
export const PHOTO_PLACEHOLDERS: {
  token: string;
  label: string;
  example: string;
}[] = [
  { token: "{{size}}", label: "Размер (Д×Ш×В)", example: "600×400×400 мм" },
  { token: "{{length}}", label: "Длина", example: "600" },
  { token: "{{width}}", label: "Ширина", example: "400" },
  { token: "{{height}}", label: "Высота", example: "400" },
  { token: "{{unit}}", label: "Ед. измерения", example: "мм" },
  { token: "{{name}}", label: "Название товара", example: "Короб Т-23" },
  { token: "{{sku}}", label: "Артикул", example: "Т-23" },
  { token: "{{price}}", label: "Цена", example: "35 ₽" },
  { token: "{{volume}}", label: "Объём", example: "96 л" },
  { token: "{{material}}", label: "Материал", example: "3-слойный" },
  { token: "{{barcode}}", label: "Штрихкод", example: "2000000000007" },
];

const FONT_FAMILIES = ["Oswald", "Inter", "Montserrat", "Georgia", "Arial"];

export function photoFontFamilies(): string[] {
  return FONT_FAMILIES;
}

/** Число без хвостовых нулей: 600 → "600", 600.5 → "600.5". */
function trimNum(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(parseFloat(value.toFixed(2)));
}

/**
 * Формирует карту токенов для товара. Ключи — без фигурных скобок.
 * {{size}} собирается из длины/ширины/высоты и единицы измерения.
 */
export function buildProductTokens(
  product: PhotoProduct | null | undefined
): Record<string, string> {
  const p = product;
  if (!p) {
    return Object.fromEntries(
      PHOTO_PLACEHOLDERS.map((ph) => [
        ph.token.slice(2, -2),
        `[${ph.label}]`,
      ])
    );
  }

  const dims = [p.dimensionLength, p.dimensionWidth, p.dimensionHeight]
    .map((v) => (v != null && v > 0 ? trimNum(v) : null))
    .filter((v): v is string => v !== null);
  const unit = (p.dimensionUnit || "мм").trim();
  const size = dims.length > 0 ? `${dims.join("×")} ${unit}` : "";

  const price =
    p.price != null ? `${p.price.toLocaleString("ru-RU")} ₽` : "по запросу";
  const volume = p.volume != null ? `${trimNum(p.volume)} л` : "";

  return {
    size,
    length:
      p.dimensionLength != null && p.dimensionLength > 0
        ? trimNum(p.dimensionLength)
        : "",
    width: p.dimensionWidth != null && p.dimensionWidth > 0 ? trimNum(p.dimensionWidth) : "",
    height: p.dimensionHeight != null && p.dimensionHeight > 0 ? trimNum(p.dimensionHeight) : "",
    unit,
    name: p.name || "",
    sku: p.sku || "",
    price,
    volume,
    material: p.material || "",
    barcode: p.barcode || "",
  };
}

/** Подставляет {{токены}} в строку по карте значений. */
export function substituteTokens(
  text: string,
  tokens: Record<string, string>
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = tokens[key];
    return value != null ? value : match;
  });
}

export function createElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createDefaultTemplate(): PhotoTemplate {
  const W = 1000;
  const H = 1000;
  return {
    width: W,
    height: H,
    background: { type: "color", color: "#f4f1ea" },
    elements: [
      {
        id: createElementId(),
        type: "rect",
        x: 0,
        y: 0,
        width: W,
        height: 120,
        color: "#2d6a4f",
        radius: 0,
      },
      {
        id: createElementId(),
        type: "text",
        x: 60,
        y: 34,
        text: "{{name}}",
        fontSize: 64,
        fontFamily: "Oswald",
        color: "#ffffff",
        fontWeight: 700,
        italic: false,
        align: "left",
        width: 880,
        lineHeight: 1.1,
        letterSpacing: 0,
      },
      {
        id: createElementId(),
        type: "rect",
        x: 380,
        y: 400,
        width: 240,
        height: 150,
        color: "#2d6a4f",
        radius: 18,
      },
      {
        id: createElementId(),
        type: "text",
        x: 500,
        y: 430,
        text: "{{size}}",
        fontSize: 78,
        fontFamily: "Oswald",
        color: "#ffffff",
        fontWeight: 700,
        italic: false,
        align: "center",
        width: 900,
        lineHeight: 1,
        letterSpacing: 0,
      },
      {
        id: createElementId(),
        type: "text",
        x: 500,
        y: 700,
        text: "Гофротара · Новосибирск",
        fontSize: 40,
        fontFamily: "Inter",
        color: "#1e4d38",
        fontWeight: 700,
        italic: false,
        align: "center",
        width: 900,
        lineHeight: 1.1,
        letterSpacing: 0,
      },
    ],
  };
}

/* ─────────────────  Сохранённые шаблоны  ───────────────── */

/**
 * Именованный шаблон карточки. Хранится в settings под ключом
 * PHOTO_TEMPLATES_SETTING_KEY (JSON-массив). Нужен, чтобы не собирать
 * дизайн заново: шаблон можно применить, скопировать и доработать.
 */
export interface SavedPhotoTemplate {
  id: string;
  name: string;
  /** ISO-дата последнего сохранения */
  updatedAt: string;
  template: PhotoTemplate;
}

export const PHOTO_TEMPLATES_SETTING_KEY = "photo_templates";

/** Максимум шаблонов в библиотеке (защита от разрастания настроек). */
export const PHOTO_TEMPLATES_LIMIT = 50;

export function createTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/** Глубокая копия шаблона с новыми id элементов (чтобы не пересекались). */
export function cloneTemplate(template: PhotoTemplate): PhotoTemplate {
  const cloneElements = (items: PhotoTemplateElement[]): PhotoTemplateElement[] =>
    items.map((el) =>
      el.type === "group"
        ? { ...el, id: createElementId(), items: cloneElements(el.items) }
        : { ...el, id: createElementId() }
    );
  return {
    ...template,
    background: { ...template.background },
    elements: cloneElements(template.elements || []),
  };
}

/** Разбор JSON из настроек в список шаблонов (без падений на мусоре). */
export function parseSavedTemplates(raw: unknown): SavedPhotoTemplate[] {
  if (!raw) return [];
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (item): item is SavedPhotoTemplate =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as any).id === "string" &&
        Boolean((item as any).template)
    )
    .map((item) => ({
      id: item.id,
      name: String(item.name || "Без названия").slice(0, 120),
      updatedAt: String(item.updatedAt || ""),
      template: item.template,
    }))
    .slice(0, PHOTO_TEMPLATES_LIMIT);
}
