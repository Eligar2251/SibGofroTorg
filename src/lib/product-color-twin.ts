// =========================================================
// FILE: src/lib/product-color-twin.ts
// Чистая логика:
//  1) копирования карточки товара (черновик со всеми полями без остатка/штрихкода);
//  2) автоматического создания связанной парной карточки другого цвета
//     («Лоток № 60 бурый» ↔ «Лоток № 60 белый», «Коробка … бурая» ↔ «Коробка … белая»).
// =========================================================

export type CardboardColor = "brown" | "white";

export interface ColorTwinMeta {
  sourceColor: CardboardColor;
  targetColor: CardboardColor;
  /** Подпись кнопки («Есть белый вариант» или «Есть бурый вариант»). */
  buttonLabel: string;
  /** Короткая подпись исходного цвета для переключателя в карточке («Бурый» / «Белый»). */
  sourceLabel: string;
  /** Короткая подпись парного цвета («Белый» / «Бурый»). */
  targetLabel: string;
}

const BROWN_WORD_RE =
  /(^|[^а-яёa-z0-9])(бур)(ый|ая|ое|ые|ого|ому|ым|ом|ой|ую|ых|ыми)(?=$|[^а-яёa-z0-9])/giu;
const WHITE_WORD_RE =
  /(^|[^а-яёa-z0-9])(бел)(ый|ая|ое|ые|ого|ому|ым|ом|ой|ую|ых|ыми)(?=$|[^а-яёa-z0-9])/giu;

function hasBrownWord(text: string): boolean {
  BROWN_WORD_RE.lastIndex = 0;
  return BROWN_WORD_RE.test(text);
}

function hasWhiteWord(text: string): boolean {
  WHITE_WORD_RE.lastIndex = 0;
  return WHITE_WORD_RE.test(text);
}

/** Определяет цвет картона по названию (приоритетно) или материалу. */
export function detectCardboardColor(
  name?: string | null,
  material?: string | null,
): CardboardColor | null {
  const n = String(name || "");
  const nBrown = hasBrownWord(n);
  const nWhite = hasWhiteWord(n);
  if (nWhite && !nBrown) return "white";
  if (nBrown && !nWhite) return "brown";

  const m = String(material || "");
  const mBrown = hasBrownWord(m);
  const mWhite = hasWhiteWord(m);
  if (mWhite && !mBrown) return "white";
  if (mBrown && !mWhite) return "brown";

  return null;
}

/**
 * Возвращает параметры парного варианта:
 * если исходный товар белый → предлагает бурый вариант;
 * во всех остальных случаях (бурый или цвет не указан) → предлагает белый вариант.
 */
export function resolveColorTwinMeta(
  name?: string | null,
  material?: string | null,
): ColorTwinMeta {
  const detected = detectCardboardColor(name, material);
  if (detected === "white") {
    return {
      sourceColor: "white",
      targetColor: "brown",
      buttonLabel: "Есть бурый вариант",
      sourceLabel: "Белый",
      targetLabel: "Бурый",
    };
  }
  return {
    sourceColor: "brown",
    targetColor: "white",
    buttonLabel: "Есть белый вариант",
    sourceLabel: "Бурый",
    targetLabel: "Белый",
  };
}

type GrammaticalForm = "m" | "f" | "n" | "pl";

const PLURAL_HEADS = new Set([
  "коробки",
  "гофрокоробки",
  "лотки",
  "гофролотки",
  "листы",
  "гофролисты",
  "короба",
  "гофрокороба",
  "ящики",
  "гофроящики",
  "вкладыши",
  "прокладки",
  "решетки",
  "решётки",
  "уголки",
  "обечайки",
  "крышки",
  "папки",
]);

const FEMININE_HEADS = new Set([
  "коробка",
  "гофрокоробка",
  "крышка",
  "обечайка",
  "прокладка",
  "решетка",
  "решётка",
  "перегородка",
  "папка",
  "тара",
  "гофротара",
  "упаковка",
  "заготовка",
  "подложка",
  "стрейч",
  "пленка",
  "плёнка",
  "лента",
  "бумага",
  "втулка",
]);

const NEUTER_HEADS = new Set([
  "дно",
  "кольцо",
  "основание",
  "окошко",
  "окно",
]);

/** Определяет род/число первого существительного в названии товара. */
export function inferProductNameGrammar(name: string): GrammaticalForm {
  const clean = String(name || "")
    .trim()
    .toLowerCase();
  const words = clean.match(/[а-яё]+/giu) || [];
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (PLURAL_HEADS.has(w)) return "pl";
    if (FEMININE_HEADS.has(w)) return "f";
    if (NEUTER_HEADS.has(w)) return "n";
    // Если первое же существительное мужского рода («лоток», «короб», «лист», «ящик») — дальше не ищем
    if (
      [
        "лоток",
        "гофролоток",
        "короб",
        "гофрокороб",
        "ящик",
        "гофроящик",
        "лист",
        "гофролист",
        "картон",
        "гофрокартон",
        "микрогофрокартон",
        "вкладыш",
        "уголок",
        "тубус",
        "пенал",
        "рулон",
        "комплект",
        "набор",
      ].includes(w)
    ) {
      return "m";
    }
  }
  return "m";
}

function colorAdjective(color: CardboardColor, form: GrammaticalForm): string {
  const stem = color === "white" ? "бел" : "бур";
  if (form === "f") return `${stem}ая`;
  if (form === "n") return `${stem}ое`;
  if (form === "pl") return `${stem}ые`;
  return `${stem}ый`;
}

function applyStemCase(originalStem: string, targetStem: string): string {
  if (originalStem === originalStem.toUpperCase()) {
    return targetStem.toUpperCase();
  }
  if (
    originalStem[0] &&
    originalStem[0] === originalStem[0].toUpperCase()
  ) {
    return targetStem[0].toUpperCase() + targetStem.slice(1);
  }
  return targetStem;
}

function applyEndingCase(originalEnding: string, ending: string): string {
  if (originalEnding === originalEnding.toUpperCase()) {
    return ending.toUpperCase();
  }
  return ending.toLowerCase();
}

/**
 * Строит название парной карточки противоположного цвета:
 * - «Лоток № 60 бурый» → «Лоток № 60 белый»
 * - «Лоток № 60 белый» → «Лоток № 60 бурый»
 * - «Коробка 600×400×400 бурая» → «Коробка 600×400×400 белая»
 * - «Лоток № 60» (без цвета) → «Лоток № 60 белый» (или «бурый»)
 */
export function buildColorTwinName(
  name: string,
  targetColor: CardboardColor,
): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return targetColor === "white" ? "Товар белый" : "Товар бурый";
  }

  if (targetColor === "white" && hasBrownWord(trimmed)) {
    BROWN_WORD_RE.lastIndex = 0;
    return trimmed.replace(
      BROWN_WORD_RE,
      (_m, prefix: string, stem: string, ending: string) =>
        `${prefix}${applyStemCase(stem, "бел")}${applyEndingCase(ending, ending)}`,
    );
  }

  if (targetColor === "brown" && hasWhiteWord(trimmed)) {
    WHITE_WORD_RE.lastIndex = 0;
    return trimmed.replace(
      WHITE_WORD_RE,
      (_m, prefix: string, stem: string, ending: string) =>
        `${prefix}${applyStemCase(stem, "бур")}${applyEndingCase(ending, ending)}`,
    );
  }

  // Если целевой цвет уже явно присутствует в строке — возвращаем как есть
  if (
    (targetColor === "white" && hasWhiteWord(trimmed)) ||
    (targetColor === "brown" && hasBrownWord(trimmed))
  ) {
    return trimmed;
  }

  const form = inferProductNameGrammar(trimmed);
  return `${trimmed} ${colorAdjective(targetColor, form)}`;
}

/**
 * Если в исходном названии цвет ещё не написан («Лоток № 60»), возвращает
 * вариант с явно добавленным исходным цветом («Лоток № 60 бурый»).
 */
export function ensureColorInName(
  name: string,
  color: CardboardColor,
): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  if (hasBrownWord(trimmed) || hasWhiteWord(trimmed)) return trimmed;
  const form = inferProductNameGrammar(trimmed);
  return `${trimmed} ${colorAdjective(color, form)}`;
}

/** Меняет упоминание цвета в поле «Материал / марка картона», если оно там было. */
export function buildColorTwinMaterial(
  material: string | null | undefined,
  targetColor: CardboardColor,
): string | null {
  const trimmed = String(material || "").trim();
  if (!trimmed) return null;
  if (targetColor === "white" && hasBrownWord(trimmed)) {
    return buildColorTwinName(trimmed, "white");
  }
  if (targetColor === "brown" && hasWhiteWord(trimmed)) {
    return buildColorTwinName(trimmed, "brown");
  }
  return trimmed;
}

/** Строит артикул для парной цветной карточки (если артикул задан). */
export function buildColorTwinSku(
  sku: string | null | undefined,
  targetColor: CardboardColor,
): string | null {
  const trimmed = String(sku || "").trim();
  if (!trimmed) return null;

  if (targetColor === "white") {
    if (/([-_/\s])(бур|бр|bur)$/iu.test(trimmed)) {
      return trimmed.replace(/([-_/\s])(бур|бр|bur)$/iu, (_m, sep: string, tok: string) => {
        if (/^bur$/i.test(tok)) return `${sep}${tok === tok.toUpperCase() ? "BEL" : "bel"}`;
        if (/^бр$/iu.test(tok)) return `${sep}${tok === tok.toUpperCase() ? "БЛ" : "бл"}`;
        return `${sep}${tok === tok.toUpperCase() ? "БЕЛ" : "бел"}`;
      });
    }
    return `${trimmed}-БЕЛ`;
  }

  if (/([-_/\s])(бел|бл|bel)$/iu.test(trimmed)) {
    return trimmed.replace(/([-_/\s])(бел|бл|bel)$/iu, (_m, sep: string, tok: string) => {
      if (/^bel$/i.test(tok)) return `${sep}${tok === tok.toUpperCase() ? "BUR" : "bur"}`;
      if (/^бл$/iu.test(tok)) return `${sep}${tok === tok.toUpperCase() ? "БР" : "бр"}`;
      return `${sep}${tok === tok.toUpperCase() ? "БУР" : "бур"}`;
    });
  }
  return `${trimmed}-БУР`;
}

/**
 * Подготавливает данные карточки-образца для открытия формы «Копия товара»:
 * все размеры, цены, описание, теги и фото сохраняются, а ID, штрихкод,
 * артикул и складской остаток очищаются, чтобы не задвоить склад.
 */
export function prepareProductCopyDraft<T extends Record<string, any>>(
  source: T,
): Omit<T, "id"> & {
  id: undefined;
  sku: string;
  barcode: null;
  stockQty: number;
  inStock: boolean;
  isFeatured: boolean;
  featuredOrder: null;
  linkGroupId: null;
  isGroupPrimary: null;
  linkedProductIds: string[];
  linkedGroupTitle: null;
  linkedGroupLabels: null;
} {
  return {
    ...source,
    id: undefined,
    sku: "",
    barcode: null,
    stockQty: 0,
    inStock: false,
    isFeatured: false,
    featuredOrder: null,
    linkGroupId: null,
    isGroupPrimary: null,
    linkedProductIds: [],
    linkedGroupTitle: null,
    linkedGroupLabels: null,
  };
}
