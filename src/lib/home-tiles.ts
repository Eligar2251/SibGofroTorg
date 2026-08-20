// =========================================================
// FILE: src/lib/home-tiles.ts
// Плитки главной страницы: типы, нормализация меток и правило
// «какие товары попадают в плитку».
//
// Модуль изоморфный (без next/server, без supabase) — используется
// и на сервере (страница главной, API), и в клиентских компонентах
// (мгновенное переключение между плитками без запроса к серверу).
// =========================================================

export const HOME_TILE_KINDS = [
  "category",
  "tag",
  "featured",
  "sale",
  "all",
] as const;

export type HomeTileKind = (typeof HOME_TILE_KINDS)[number];

export interface HomeTile {
  id: string;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  icon?: string | null;
  kind: HomeTileKind;
  /** Для kind = "category": id категории каталога. */
  categoryId?: string | null;
  /** Для kind = "tag": метка или несколько через запятую («озон, ozon»). */
  tag?: string | null;
  /** Акцентный цвет плитки (подложка под фото/иконку). */
  accent?: string | null;
  sortOrder: number;
  isVisible: boolean;
}

/** Минимум полей товара, нужный для подбора в плитку. */
export interface TileMatchableProduct {
  categoryId?: string | null;
  tags?: string[] | null;
  promoLabel?: string | null;
  discountBadge?: string | null;
  isFeatured?: boolean | null;
  isSale?: boolean | null;
}

export function parseHomeTileKind(value: unknown): HomeTileKind {
  return typeof value === "string" &&
    (HOME_TILE_KINDS as readonly string[]).includes(value)
    ? (value as HomeTileKind)
    : "category";
}

/**
 * Приводит метку к сравнимому виду: нижний регистр, ё→е,
 * без лишних пробелов/дефисов. «Озон» = «озон» = «ОЗОН».
 */
export function normalizeTag(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/** Разбирает строку меток («озон, ozon; вб») в нормализованный список. */
export function parseTagList(value: unknown): string[] {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[,;|\n]/)
        .map(normalizeTag)
        .filter(Boolean)
    ),
  ];
}

/** Метки товара для сравнения: собственные tags + бейджи товара. */
export function productTagValues(product: TileMatchableProduct): string[] {
  const list: string[] = [];
  for (const t of product.tags || []) {
    const n = normalizeTag(t);
    if (n) list.push(n);
  }
  // «Берутся с бейджей»: одиночная метка товара (promo_label) и
  // бейдж скидки тоже считаются метками — чтобы плитка «Хит»
  // работала без перепроставления тегов у каждого товара.
  for (const badge of [product.promoLabel, product.discountBadge]) {
    for (const n of parseTagList(badge)) list.push(n);
  }
  return [...new Set(list)];
}

/** Есть ли у товара хотя бы одна из перечисленных меток. */
export function productHasAnyTag(
  product: TileMatchableProduct,
  tags: string[]
): boolean {
  if (tags.length === 0) return false;
  const own = productTagValues(product);
  return tags.some((t) => own.includes(t));
}

/** Попадает ли товар в плитку. */
export function productMatchesTile(
  product: TileMatchableProduct,
  tile: Pick<HomeTile, "kind" | "categoryId" | "tag">
): boolean {
  switch (tile.kind) {
    case "category":
      return Boolean(tile.categoryId) && product.categoryId === tile.categoryId;
    case "tag":
      return productHasAnyTag(product, parseTagList(tile.tag));
    case "featured":
      return Boolean(product.isFeatured);
    case "sale":
      return Boolean(product.isSale);
    case "all":
      return true;
    default:
      return false;
  }
}

/** Человеческое описание правила плитки — для админки. */
export function describeHomeTileRule(
  tile: Pick<HomeTile, "kind" | "tag">,
  categoryName?: string | null
): string {
  switch (tile.kind) {
    case "category":
      return categoryName ? `Категория: ${categoryName}` : "Категория не выбрана";
    case "tag": {
      const tags = parseTagList(tile.tag);
      return tags.length ? `Метки: ${tags.join(", ")}` : "Метка не указана";
    }
    case "featured":
      return "Популярные товары (флаг «Популярный»)";
    case "sale":
      return "Распродажа остатков (флаг «Распродажа»)";
    case "all":
      return "Весь каталог";
    default:
      return "";
  }
}

/** Сортировка плиток: sort_order, затем название. */
export function sortHomeTiles<T extends { sortOrder: number; title: string }>(
  tiles: T[]
): T[] {
  return [...tiles].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.title.localeCompare(b.title, "ru")
  );
}

/** Собирает уникальный список меток из товаров (подсказки в админке). */
export function collectProductTags(
  products: { tags?: string[] | null; promoLabel?: string | null }[]
): string[] {
  const set = new Set<string>();
  for (const p of products) {
    for (const t of p.tags || []) {
      const n = normalizeTag(t);
      if (n) set.add(n);
    }
    for (const n of parseTagList(p.promoLabel)) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}

/** Нормализация меток перед записью в БД (уникальные, без пустых, до 20 шт). */
export function sanitizeTagsForSave(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : parseTagList(value);
  return [
    ...new Set(
      raw
        .map((t) => normalizeTag(t).slice(0, 40))
        .filter(Boolean)
    ),
  ].slice(0, 20);
}
