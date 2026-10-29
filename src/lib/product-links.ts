// =========================================================
// FILE: src/lib/product-links.ts
// Связь карточек товаров в одну объединённую карточку (как на Ozon).
// Чистая логика без Node/БД-импортов — используется на сервере,
// в клиенте и в модульных тестах.
// =========================================================

import type { DimensionValue } from "./dimension-profiles";
import { formatProductSize } from "./product-size";
import { isProductAvailable } from "./stock-availability";
import type { FirestoreProduct } from "./types";

/** Специальный токен для ещё не сохранённого (создаваемого) товара в форме админки. */
export const NEW_PRODUCT_LINK_TOKEN = "__self__";

export interface ProductLinkGroup {
  id: string;
  /** ID главной карточки (отображается первой и представляет связку в каталоге). */
  primaryProductId: string;
  /** Упорядоченный список ID карточек связки (всегда содержит primaryProductId первым). */
  productIds: string[];
  /** Пользовательские короткие подписи кнопок переключения: productId -> label. */
  labels: Record<string, string>;
  /** Заголовок блока выбора (например: «Вариант», «Размер», «Цвет»). */
  groupTitle: string | null;
}

export interface ProductLinkUpdateInput {
  /** Упорядоченный список ID карточек в связке (может включать NEW_PRODUCT_LINK_TOKEN или сам targetProductId). Пустой массив или < 2 карточек = отвязать товар. */
  linkedProductIds: string[];
  /** Какая карточка должна быть главной в связке (может быть NEW_PRODUCT_LINK_TOKEN). */
  primaryProductId?: string | null;
  /** Короткие подписи для кнопок вариантов (ключ может быть NEW_PRODUCT_LINK_TOKEN). */
  labels?: Record<string, string> | null;
  /** Заголовок блока переключения (необязательно). */
  groupTitle?: string | null;
}

/** Данные одного варианта (связанной карточки) внутри компактной плитки каталога. */
export interface LinkedCardOption {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  label: string;
  isPrimary: boolean;
  price: number | null;
  basePrice: number | null;
  priceWholesale: number | null;
  minWholesaleQty: number | null;
  packQty: number | null;
  imageUrl: string | null;
  inStock: boolean;
  stockQty: number | null;
  promoLabel: string | null;
  promoLabelColor: string | null;
  promoLabelTextColor: string | null;
  madeToOrder: boolean;
  madeToOrderMinQty: number | null;
  isCuttable: boolean;
  cutMetersPerRoll: number | null;
  cutPricePerMeter: number | null;
  cutUnitName: string;
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string | null;
  dimensionValues: DimensionValue[] | null;
  material: string | null;
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
  discountBadge: string | null;
}

function cleanId(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function cleanLabel(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 80) : "";
}

/** Гарантирует, что главная карточка стоит первой в списке ID и дубли удалены. */
export function orderGroupProductIds(
  productIds: readonly string[],
  primaryProductId: string,
): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of productIds) {
    const id = cleanId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) return [];
  const primary = seen.has(primaryProductId) ? primaryProductId : unique[0];
  return [primary, ...unique.filter((id) => id !== primary)];
}

/**
 * Нормализует массив групп связок:
 * - убирает пустые/битые ID;
 * - гарантирует, что один товар входит максимум в одну группу;
 * - удаляет группы, в которых осталось меньше 2 товаров;
 * - ставит primaryProductId на первое место.
 */
export function normalizeProductLinkGroups(raw: unknown): ProductLinkGroup[] {
  if (!Array.isArray(raw)) return [];
  const claimedProducts = new Set<string>();
  const result: ProductLinkGroup[] = [];

  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown> | null;
    if (!entry || typeof entry !== "object") continue;

    const rawIds = Array.isArray(entry.productIds)
      ? entry.productIds
      : Array.isArray((entry as any).product_ids)
        ? (entry as any).product_ids
        : [];

    const availableIds: string[] = [];
    for (const candidate of rawIds) {
      const id = cleanId(candidate);
      if (!id || claimedProducts.has(id)) continue;
      claimedProducts.add(id);
      availableIds.push(id);
    }

    if (availableIds.length < 2) {
      // Освобождаем одиночный ID, чтобы не блокировать его для следующих записей
      for (const id of availableIds) claimedProducts.delete(id);
      continue;
    }

    const rawPrimary = cleanId(
      entry.primaryProductId ?? (entry as any).primary_product_id,
    );
    const primaryProductId = availableIds.includes(rawPrimary)
      ? rawPrimary
      : availableIds[0];
    const orderedIds = orderGroupProductIds(availableIds, primaryProductId);

    const rawLabels =
      entry.labels && typeof entry.labels === "object" && !Array.isArray(entry.labels)
        ? (entry.labels as Record<string, unknown>)
        : {};
    const labels: Record<string, string> = {};
    for (const id of orderedIds) {
      const lbl = cleanLabel(rawLabels[id]);
      if (lbl) labels[id] = lbl;
    }

    const rawTitle = cleanLabel(
      entry.groupTitle ?? (entry as any).group_title,
    );
    const id = cleanId(entry.id) || `grp-${primaryProductId}`;

    result.push({
      id,
      primaryProductId,
      productIds: orderedIds,
      labels,
      groupTitle: rawTitle || null,
    });
  }

  return result;
}

/** Находит группу, в которую входит указанный товар. */
export function findProductLinkGroup(
  groups: readonly ProductLinkGroup[],
  productId: string,
): ProductLinkGroup | null {
  const target = cleanId(productId);
  if (!target) return null;
  return groups.find((g) => g.productIds.includes(target)) || null;
}

/**
 * Применяет сохранение связки из формы создания/редактирования товара.
 * Поддерживает NEW_PRODUCT_LINK_TOKEN ("__self__"), подменяя его на реальный ID товара.
 */
export function applyProductLinkUpdate(
  existingGroups: readonly ProductLinkGroup[],
  targetProductId: string,
  input: ProductLinkUpdateInput | null | undefined,
): ProductLinkGroup[] {
  const selfId = cleanId(targetProductId);
  const normalized = normalizeProductLinkGroups(existingGroups);
  if (!selfId || !input) return normalized;

  const resolveToken = (id: string): string =>
    id === NEW_PRODUCT_LINK_TOKEN ? selfId : cleanId(id);

  const requestedIds: string[] = [];
  const seen = new Set<string>();
  for (const rawId of Array.isArray(input.linkedProductIds) ? input.linkedProductIds : []) {
    const resolved = resolveToken(String(rawId || ""));
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    requestedIds.push(resolved);
  }

  // Если кроме самого товара других карточек не выбрано — отвязываем targetProductId от его группы.
  const otherIds = requestedIds.filter((id) => id !== selfId);
  if (otherIds.length === 0) {
    return removeProductFromLinkGroups(normalized, selfId);
  }

  // Гарантируем, что сам редактируемый/создаваемый товар включён в группу.
  if (!seen.has(selfId)) {
    requestedIds.push(selfId);
    seen.add(selfId);
  }

  const rawPrimary = input.primaryProductId
    ? resolveToken(String(input.primaryProductId))
    : "";
  const primaryProductId = seen.has(rawPrimary) ? rawPrimary : requestedIds[0];
  const orderedIds = orderGroupProductIds(requestedIds, primaryProductId);

  // Сохраняем существующий id группы, если редактируем уже существовавшую связку,
  // чтобы не плодить лишние ключи в БД.
  const matchedExisting = normalized.find((g) =>
    g.productIds.some((id) => seen.has(id)),
  );
  const nextGroupId = matchedExisting?.id || `grp-${primaryProductId}`;

  // Собираем подписи кнопок: берём старые подписи из пересекающихся групп + новые из формы.
  const mergedLabels: Record<string, string> = {};
  for (const g of normalized) {
    for (const [pid, lbl] of Object.entries(g.labels || {})) {
      if (seen.has(pid) && lbl) mergedLabels[pid] = lbl;
    }
  }
  if (input.labels && typeof input.labels === "object") {
    for (const [rawKey, rawVal] of Object.entries(input.labels)) {
      const pid = resolveToken(rawKey);
      if (!seen.has(pid)) continue;
      const cleaned = cleanLabel(rawVal);
      if (cleaned) {
        mergedLabels[pid] = cleaned;
      } else {
        delete mergedLabels[pid];
      }
    }
  }

  const groupTitle =
    input.groupTitle !== undefined
      ? cleanLabel(input.groupTitle) || null
      : matchedExisting?.groupTitle ?? null;

  // Убираем все выбранные карточки из старых групп; группы с < 2 карточками исчезают автоматически.
  const remainingGroups: ProductLinkGroup[] = [];
  for (const g of normalized) {
    const leftIds = g.productIds.filter((id) => !seen.has(id));
    if (leftIds.length < 2) continue;
    const nextPrimary = leftIds.includes(g.primaryProductId)
      ? g.primaryProductId
      : leftIds[0];
    const nextLabels: Record<string, string> = {};
    for (const id of leftIds) {
      if (g.labels[id]) nextLabels[id] = g.labels[id];
    }
    remainingGroups.push({
      id: g.id === nextGroupId ? `grp-${nextPrimary}` : g.id,
      primaryProductId: nextPrimary,
      productIds: orderGroupProductIds(leftIds, nextPrimary),
      labels: nextLabels,
      groupTitle: g.groupTitle,
    });
  }

  remainingGroups.push({
    id: nextGroupId,
    primaryProductId,
    productIds: orderedIds,
    labels: mergedLabels,
    groupTitle,
  });

  return normalizeProductLinkGroups(remainingGroups);
}

/** Удаляет товар из всех групп связок (например, при удалении товара или отвязке). */
export function removeProductFromLinkGroups(
  existingGroups: readonly ProductLinkGroup[],
  productId: string,
): ProductLinkGroup[] {
  const target = cleanId(productId);
  if (!target) return normalizeProductLinkGroups(existingGroups);

  const next: ProductLinkGroup[] = [];
  for (const g of normalizeProductLinkGroups(existingGroups)) {
    if (!g.productIds.includes(target)) {
      next.push(g);
      continue;
    }
    const leftIds = g.productIds.filter((id) => id !== target);
    if (leftIds.length < 2) continue;
    const nextPrimary = leftIds.includes(g.primaryProductId)
      ? g.primaryProductId
      : leftIds[0];
    const nextLabels: Record<string, string> = {};
    for (const id of leftIds) {
      if (g.labels[id]) nextLabels[id] = g.labels[id];
    }
    next.push({
      id: g.id,
      primaryProductId: nextPrimary,
      productIds: orderGroupProductIds(leftIds, nextPrimary),
      labels: nextLabels,
      groupTitle: g.groupTitle,
    });
  }
  return next;
}

function capitalizeFirst(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Вычисляет компактную понятную подпись для чипа переключения карточки (как на Ozon):
 * 1) Если админ явно задал подпись — используем её;
 * 2) Если у карточек в связке уникальные габариты — используем габарит (например, «600×400×400 мм»);
 * 3) Если названия начинаются с общего префикса («Скотч 48 мм прозрачный» / «Скотч 48 мм коричневый») —
 *    оставляем отличающуюся часть («Прозрачный» / «Коричневый»);
 * 4) Иначе — габарит + короткое имя или само название.
 */
export function resolveLinkedCardLabels(
  products: readonly Pick<
    FirestoreProduct,
    | "id"
    | "name"
    | "dimensionLength"
    | "dimensionWidth"
    | "dimensionHeight"
    | "dimensionUnit"
    | "dimensionValues"
  >[],
  explicitLabels?: Record<string, string> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (products.length === 0) return out;

  const sizes = products.map((p) => formatProductSize(p as any) || "");
  const nonEmptySizes = sizes.filter(Boolean);
  const allSizesUnique =
    nonEmptySizes.length === products.length &&
    new Set(nonEmptySizes).size === products.length;

  // Ищем общий префикс по словам среди всех карточек связки
  const splitWords = products.map((p) =>
    String(p.name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
  let commonWordCount = 0;
  if (splitWords.length >= 2 && splitWords.every((w) => w.length > 1)) {
    const first = splitWords[0];
    while (
      commonWordCount < first.length - 1 &&
      splitWords.every(
        (words) =>
          commonWordCount < words.length - 1 &&
          words[commonWordCount].toLowerCase() ===
            first[commonWordCount].toLowerCase(),
      )
    ) {
      commonWordCount++;
    }
  }

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const custom = explicitLabels?.[p.id]?.trim();
    if (custom) {
      out[p.id] = custom;
      continue;
    }

    if (allSizesUnique && sizes[i]) {
      out[p.id] = sizes[i];
      continue;
    }

    if (commonWordCount > 0) {
      const tail = splitWords[i]
        .slice(commonWordCount)
        .join(" ")
        .replace(/^[-–—,:;/|()]+\s*/, "")
        .replace(/\s*[-–—,:;/|()]+$/, "")
        .trim();
      if (tail && tail.length <= 44) {
        out[p.id] = capitalizeFirst(tail);
        continue;
      }
    }

    if (sizes[i] && nonEmptySizes.filter((s) => s === sizes[i]).length === 1) {
      out[p.id] = sizes[i];
      continue;
    }

    const fallbackName = String(p.name || "").trim();
    out[p.id] =
      fallbackName.length > 36 ? `${fallbackName.slice(0, 34).trim()}…` : fallbackName || "Вариант";
  }

  return out;
}

/** Автоматический заголовок блока выбора: «Размер», если все чипы — размеры, иначе «Вариант». */
export function resolveLinkedGroupTitle(
  products: readonly Pick<
    FirestoreProduct,
    | "id"
    | "name"
    | "dimensionLength"
    | "dimensionWidth"
    | "dimensionHeight"
    | "dimensionUnit"
    | "dimensionValues"
  >[],
  explicitTitle?: string | null,
): string {
  const custom = cleanLabel(explicitTitle);
  if (custom) return custom;
  const sizes = products.map((p) => formatProductSize(p as any) || "");
  const nonEmpty = sizes.filter(Boolean);
  if (
    products.length >= 2 &&
    nonEmpty.length === products.length &&
    new Set(nonEmpty).size === products.length
  ) {
    return "Размер";
  }
  return "Вариант";
}

export function toLinkedCardOption(
  p: FirestoreProduct,
  label: string,
  isPrimary: boolean,
): LinkedCardOption {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    label,
    isPrimary,
    price: p.price,
    basePrice: p.basePrice ?? null,
    priceWholesale: p.priceWholesale ?? null,
    minWholesaleQty: p.minWholesaleQty ?? null,
    packQty: p.packQty ?? null,
    imageUrl: p.imageUrl ?? null,
    inStock: p.inStock,
    stockQty: p.stockQty ?? null,
    promoLabel: p.promoLabel ?? null,
    promoLabelColor: p.promoLabelColor ?? null,
    promoLabelTextColor: p.promoLabelTextColor ?? null,
    madeToOrder: p.madeToOrder ?? false,
    madeToOrderMinQty: p.madeToOrderMinQty ?? null,
    isCuttable: p.isCuttable ?? false,
    cutMetersPerRoll: p.cutMetersPerRoll ?? null,
    cutPricePerMeter: p.cutPricePerMeter ?? null,
    cutUnitName: p.cutUnitName || "м",
    dimensionLength: p.dimensionLength ?? null,
    dimensionWidth: p.dimensionWidth ?? null,
    dimensionHeight: p.dimensionHeight ?? null,
    dimensionUnit: p.dimensionUnit ?? null,
    dimensionValues: (p.dimensionValues ?? null) as DimensionValue[] | null,
    material: p.material ?? null,
    discountType: p.discountType ?? null,
    discountValue: p.discountValue ?? null,
    discountBadge: p.discountBadge ?? null,
  };
}

/**
 * Обогащает базовый список товаров информацией о связках, не мутируя исходные объекты.
 */
export function enrichProductsWithLinks(
  baseProducts: readonly FirestoreProduct[],
  groups: readonly ProductLinkGroup[],
): FirestoreProduct[] {
  const normalized = normalizeProductLinkGroups(groups);
  if (normalized.length === 0) {
    return baseProducts.map((p) => ({
      ...p,
      linkGroupId: null,
      isGroupPrimary: true,
      linkedProductIds: [],
      linkedGroupTitle: null,
      linkedVariantLabel: null,
    }));
  }

  const byId = new Map<string, FirestoreProduct>();
  for (const p of baseProducts) byId.set(p.id, p);

  const metaByProductId = new Map<
    string,
    {
      groupId: string;
      isPrimary: boolean;
      productIds: string[];
      groupTitle: string;
      label: string;
    }
  >();

  for (const g of normalized) {
    const existingMembers = g.productIds
      .map((id) => byId.get(id))
      .filter((p): p is FirestoreProduct => Boolean(p));
    if (existingMembers.length < 2) continue;

    const primaryId = existingMembers.some((p) => p.id === g.primaryProductId)
      ? g.primaryProductId
      : existingMembers[0].id;
    const orderedMembers = [
      existingMembers.find((p) => p.id === primaryId)!,
      ...existingMembers.filter((p) => p.id !== primaryId),
    ];
    const labels = resolveLinkedCardLabels(orderedMembers, g.labels);
    const title = resolveLinkedGroupTitle(orderedMembers, g.groupTitle);
    const orderedIds = orderedMembers.map((p) => p.id);

    for (const member of orderedMembers) {
      metaByProductId.set(member.id, {
        groupId: g.id,
        isPrimary: member.id === primaryId,
        productIds: orderedIds,
        groupTitle: title,
        label: labels[member.id] || member.name,
      });
    }
  }

  return baseProducts.map((base) => {
    const meta = metaByProductId.get(base.id);
    if (!meta) {
      return {
        ...base,
        linkGroupId: null,
        isGroupPrimary: true,
        linkedProductIds: [],
        linkedGroupTitle: null,
        linkedVariantLabel: null,
      };
    }
    return {
      ...base,
      linkGroupId: meta.groupId,
      isGroupPrimary: meta.isPrimary,
      linkedProductIds: meta.productIds,
      linkedGroupTitle: meta.groupTitle,
      linkedVariantLabel: meta.label,
    };
  });
}

/**
 * Схлопывает связанные карточки в одну объединённую карточку для витрины (каталога, поиска, главной).
 *
 * - Группа показывается ровно ОДИН раз (без дублей в сетке каталога).
 * - По умолчанию лицевой карточкой выступает главная карточка связки (`primaryProductId`).
 * - Если включён поиск (`preferMatchedVariant: true`), фильтр «только в наличии» и т.п.,
 *   и главная карточка не попала в выборку, а второстепенная попала — на плитке сразу
 *   открывается совпавший вариант, но переключатель всех видимых вариантов связки сохраняется.
 */
export function collapseLinkedProductsForStorefront(
  matchedProducts: readonly FirestoreProduct[],
  allVisibleProducts: readonly FirestoreProduct[],
  opts: {
    preferMatchedVariant?: boolean;
  } = {},
): FirestoreProduct[] {
  const visibleById = new Map<string, FirestoreProduct>();
  for (const p of allVisibleProducts) {
    if (p.isVisible !== false) visibleById.set(p.id, p);
  }

  const emittedGroups = new Set<string>();
  const out: FirestoreProduct[] = [];

  for (const matched of matchedProducts) {
    const groupId = matched.linkGroupId;
    const memberIds = matched.linkedProductIds || [];
    if (!groupId || memberIds.length < 2) {
      out.push(matched);
      continue;
    }

    if (emittedGroups.has(groupId)) continue;
    emittedGroups.add(groupId);

    const visibleMembers = memberIds
      .map((id) => visibleById.get(id))
      .filter((p): p is FirestoreProduct => Boolean(p));

    if (visibleMembers.length < 2) {
      out.push(matched);
      continue;
    }

    const primaryMember =
      visibleMembers.find((p) => p.isGroupPrimary) || visibleMembers[0];
    const orderedMembers = [
      primaryMember,
      ...visibleMembers.filter((p) => p.id !== primaryMember.id),
    ];

    const labels = resolveLinkedCardLabels(
      orderedMembers,
      Object.fromEntries(
        orderedMembers
          .filter((m) => m.linkedVariantLabel)
          .map((m) => [m.id, m.linkedVariantLabel as string]),
      ),
    );

    const linkedCards: LinkedCardOption[] = orderedMembers.map((m) =>
      toLinkedCardOption(m, labels[m.id] || m.name, m.id === primaryMember.id),
    );

    // Какую карточку показывать активной при первом рендере плитки:
    // при поиске или спец-фильтре (когда главная не совпала, а вариант совпал) — совпавшую,
    // в обычном каталоге — главную карточку связки (если она не в наличии, а в связке есть
    // вариант в наличии, главная всё равно остаётся первой вкладкой или, если preferMatchedVariant, совпавшая).
    const activeCard = opts.preferMatchedVariant ? matched : primaryMember;

    // Если в связке хотя бы один вариант есть в наличии — связка не должна улетать
    // в конец каталога при стандартной сортировке.
    const anyAvailableInGroup = orderedMembers.some((m) => isProductAvailable(m));

    out.push({
      ...activeCard,
      linkedCards,
      linkedGroupAnyInStock: anyAvailableInGroup,
    });
  }

  return out;
}
