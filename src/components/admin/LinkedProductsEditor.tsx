// =========================================================
// FILE: src/components/admin/LinkedProductsEditor.tsx
// Объединение самостоятельных карточек товаров в одну карточку
// с мгновенным переключением вариантов (как на Ozon).
// Работает и при создании нового товара, и при редактировании.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Crown,
  ExternalLink,
  Layers,
  Package,
  Plus,
  Search,
  Unlink,
  X,
} from "lucide-react";
import type { DimensionValue } from "@/lib/dimension-profiles";
import {
  NEW_PRODUCT_LINK_TOKEN,
  resolveLinkedCardLabels,
  resolveLinkedGroupTitle,
  type ProductLinkUpdateInput,
} from "@/lib/product-links";
import { formatProductSize } from "@/lib/product-size";
import { CLIENT_ADMIN_PATH } from "@/lib/admin-path-client";

export interface LinkableProductSummary {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  stockQty: number | null;
  imageUrl: string | null;
  categoryId: string | null;
  isVisible: boolean;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  dimensionValues?: DimensionValue[] | null;
  linkGroupId?: string | null;
  isGroupPrimary?: boolean;
  linkedProductIds?: string[];
  linkedGroupTitle?: string | null;
  linkedVariantLabel?: string | null;
}

interface CurrentDraftCardInfo {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  stockQty: number | null;
  imageUrl: string | null;
  categoryId: string | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  dimensionValues?: DimensionValue[] | null;
}

interface LinkedProductsEditorProps {
  /** Существующий ID товара (при редактировании) или undefined (при создании). */
  productId?: string;
  /** Текущие данные редактируемой/создаваемой карточки для живого превью чипа. */
  currentCard: CurrentDraftCardInfo;
  /** Все товары каталога для мгновенного поиска и подтягивания существующих связок. */
  allProducts: LinkableProductSummary[];
  /** Начальное состояние связки (из БД при редактировании). */
  initialLinkedIds?: string[];
  initialPrimaryId?: string | null;
  initialLabels?: Record<string, string>;
  initialGroupTitle?: string | null;
  /** Колбэк синхронизации состояния с родительской формой ProductFormClient. */
  onChange: (value: ProductLinkUpdateInput) => void;
}

export function LinkedProductsEditor({
  productId,
  currentCard,
  allProducts,
  initialLinkedIds = [],
  initialPrimaryId = null,
  initialLabels = {},
  initialGroupTitle = null,
  onChange,
}: LinkedProductsEditorProps) {
  const selfKey = productId || NEW_PRODUCT_LINK_TOKEN;

  const [memberIds, setMemberIds] = useState<string[]>(() => {
    const clean = initialLinkedIds.filter(Boolean);
    if (clean.length < 2) return [];
    if (!clean.includes(selfKey)) return [...clean, selfKey];
    return clean;
  });

  const [primaryId, setPrimaryId] = useState<string>(() => {
    if (initialPrimaryId && initialLinkedIds.includes(initialPrimaryId)) {
      return initialPrimaryId;
    }
    return initialLinkedIds[0] || selfKey;
  });

  const [labels, setLabels] = useState<Record<string, string>>(
    () => ({ ...(initialLabels || {}) }),
  );
  const [groupTitle, setGroupTitle] = useState<string>(initialGroupTitle || "");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const productsById = useMemo(() => {
    const m = new Map<string, LinkableProductSummary>();
    for (const p of allProducts) m.set(p.id, p);
    return m;
  }, [allProducts]);

  function emitNext(
    nextMembers: string[],
    nextPrimary: string,
    nextLabels: Record<string, string>,
    nextTitle: string,
  ) {
    const unique = [...new Set(nextMembers.filter(Boolean))];
    const hasOthers = unique.some((id) => id !== selfKey);
    if (!hasOthers) {
      setMemberIds([]);
      setPrimaryId(selfKey);
      onChange({
        linkedProductIds: [],
        primaryProductId: null,
        labels: {},
        groupTitle: null,
      });
      return;
    }

    const withSelf = unique.includes(selfKey) ? unique : [...unique, selfKey];
    const resolvedPrimary = withSelf.includes(nextPrimary)
      ? nextPrimary
      : withSelf[0];
    const ordered = [
      resolvedPrimary,
      ...withSelf.filter((id) => id !== resolvedPrimary),
    ];

    setMemberIds(ordered);
    setPrimaryId(resolvedPrimary);
    setLabels(nextLabels);
    setGroupTitle(nextTitle);

    onChange({
      linkedProductIds: ordered,
      primaryProductId: resolvedPrimary,
      labels: nextLabels,
      groupTitle: nextTitle.trim() || null,
    });
  }

  function handleAddProduct(candidate: LinkableProductSummary) {
    // Если выбранная карточка уже состоит в связке — подтягиваем всю её связку целиком,
    // чтобы существующая группа не развалилась, а пополнилась текущей карточкой.
    const incomingIds =
      candidate.linkedProductIds && candidate.linkedProductIds.length >= 2
        ? candidate.linkedProductIds
        : [candidate.id];

    const wasEmpty = memberIds.length < 2;
    const base = wasEmpty ? [] : [...memberIds];
    for (const id of incomingIds) {
      if (!base.includes(id)) base.push(id);
    }
    if (!base.includes(selfKey)) base.push(selfKey);

    // Если привязываем новый/одиночный товар к существующей карточке —
    // делаем выбранную существующую карточку (или главную её связки) главной по умолчанию.
    let nextPrimary = primaryId;
    if (wasEmpty) {
      const incomingPrimary =
        incomingIds.find((id) => productsById.get(id)?.isGroupPrimary) ||
        candidate.id;
      nextPrimary = incomingPrimary;
    }

    const nextLabels = { ...labels };
    for (const id of incomingIds) {
      const p = productsById.get(id);
      if (p?.linkedVariantLabel && !nextLabels[id]) {
        // Не перезаписываем ручные подписи, подхватываем только сохранённые при необходимости
      }
    }

    const nextTitle =
      groupTitle || candidate.linkedGroupTitle || "";

    emitNext(base, nextPrimary, nextLabels, nextTitle);
    setQuery("");
  }

  function handleRemoveMember(idToRemove: string) {
    if (idToRemove === selfKey) {
      // Отвязать текущую карточку от всех остальных
      emitNext([], selfKey, {}, "");
      return;
    }
    const left = memberIds.filter((id) => id !== idToRemove);
    const hasOthers = left.some((id) => id !== selfKey);
    if (!hasOthers) {
      emitNext([], selfKey, {}, "");
      return;
    }
    const nextPrimary =
      primaryId === idToRemove ? left[0] || selfKey : primaryId;
    emitNext(left, nextPrimary, labels, groupTitle);
  }

  function handleSetPrimary(newPrimaryId: string) {
    emitNext(memberIds, newPrimaryId, labels, groupTitle);
  }

  function handleMove(index: number, delta: -1 | 1) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= memberIds.length) return;
    // Перемещение на 0-ю позицию также делает карточку главной (главная всегда стоит первой)
    const copy = [...memberIds];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIndex, 0, moved);
    const nextPrimary = copy[0];
    emitNext(copy, nextPrimary, labels, groupTitle);
  }

  function handleLabelChange(id: string, val: string) {
    const nextLabels = { ...labels };
    if (val) {
      nextLabels[id] = val;
    } else {
      delete nextLabels[id];
    }
    emitNext(memberIds, primaryId, nextLabels, groupTitle);
  }

  function handleTitleChange(val: string) {
    emitNext(memberIds, primaryId, labels, val);
  }

  // Строим полные данные карточек связки для расчёта умных авто-подписей и превью
  const resolvedMembers = useMemo(() => {
    if (memberIds.length < 2) return [];
    return memberIds.map((id) => {
      if (id === selfKey) {
        return {
          id: selfKey,
          name: currentCard.name?.trim() || "Текущая карточка",
          sku: currentCard.sku,
          price: currentCard.price,
          stockQty: currentCard.stockQty,
          imageUrl: currentCard.imageUrl,
          isSelf: true,
          isVisible: true,
          dimensionLength: currentCard.dimensionLength ?? null,
          dimensionWidth: currentCard.dimensionWidth ?? null,
          dimensionHeight: currentCard.dimensionHeight ?? null,
          dimensionUnit: currentCard.dimensionUnit ?? null,
          dimensionValues: currentCard.dimensionValues ?? null,
        };
      }
      const found = productsById.get(id);
      return {
        id,
        name: found?.name || `Товар #${id.slice(0, 6)}`,
        sku: found?.sku ?? null,
        price: found?.price ?? null,
        stockQty: found?.stockQty ?? null,
        imageUrl: found?.imageUrl ?? null,
        isSelf: false,
        isVisible: found?.isVisible !== false,
        dimensionLength: found?.dimensionLength ?? null,
        dimensionWidth: found?.dimensionWidth ?? null,
        dimensionHeight: found?.dimensionHeight ?? null,
        dimensionUnit: found?.dimensionUnit ?? null,
        dimensionValues: found?.dimensionValues ?? null,
      };
    });
  }, [memberIds, selfKey, currentCard, productsById]);

  const autoLabels = useMemo(
    () => resolveLinkedCardLabels(resolvedMembers, null),
    [resolvedMembers],
  );

  const effectiveLabels = useMemo(
    () => resolveLinkedCardLabels(resolvedMembers, labels),
    [resolvedMembers, labels],
  );

  const autoGroupTitle = useMemo(
    () => resolveLinkedGroupTitle(resolvedMembers, null),
    [resolvedMembers],
  );

  // Поиск существующих карточек для добавления в связку
  const candidates = useMemo(() => {
    const excluded = new Set<string>([
      selfKey,
      ...(productId ? [productId] : []),
      ...memberIds,
    ]);
    const q = query.trim().toLowerCase();

    const pool = allProducts.filter((p) => !excluded.has(p.id));
    if (!q) {
      // Без поискового запроса подсказываем товары из той же категории первыми
      return [...pool]
        .sort((a, b) => {
          const sameCatA =
            currentCard.categoryId && a.categoryId === currentCard.categoryId
              ? 1
              : 0;
          const sameCatB =
            currentCard.categoryId && b.categoryId === currentCard.categoryId
              ? 1
              : 0;
          if (sameCatA !== sameCatB) return sameCatB - sameCatA;
          return a.name.localeCompare(b.name, "ru");
        })
        .slice(0, 12);
    }

    return pool
      .map((p) => {
        const name = p.name.toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        const size = (formatProductSize(p as any) || "").toLowerCase();
        let score = 0;
        if (name === q || sku === q) score += 50;
        else if (name.startsWith(q)) score += 30;
        else if (name.includes(q)) score += 18;
        if (sku && sku.includes(q)) score += 25;
        if (size && size.includes(q)) score += 20;
        if (currentCard.categoryId && p.categoryId === currentCard.categoryId) {
          score += 4;
        }
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((x) => x.p);
  }, [allProducts, currentCard.categoryId, memberIds, productId, query, selfKey]);

  const isLinked = resolvedMembers.length >= 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Пояснение и быстрый статус */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <p style={{ margin: 0, fontSize: 12.5, color: "#6A635C", lineHeight: 1.5 }}>
          Объедините несколько отдельных товаров (разные размеры, цвета, намотки или марки)
          в <strong>одну карточку как на Ozon</strong>. У каждого товара остаётся свой артикул,
          цена, штрихкод и складской остаток, а покупатель переключается между ними в один клик
          без перезагрузки страницы.
        </p>
        {isLinked && (
          <button
            type="button"
            onClick={() => emitNext([], selfKey, {}, "")}
            className="admin-btn admin-btn--secondary"
            style={{
              padding: "6px 11px",
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#A43D2B",
              flexShrink: 0,
            }}
          >
            <Unlink size={13} />
            Отвязать эту карточку
          </button>
        )}
      </div>

      {/* Поиск карточки, с которой нужно показывать этот товар */}
      <div style={{ position: "relative" }}>
        <label className="admin-label" style={{ marginBottom: 6 }}>
          {isLinked
            ? "Добавить ещё карточку в эту связку"
            : "С какой карточкой показывать вместе"}
        </label>
        <div style={{ position: "relative" }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#8B8177",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={query}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Введите название, артикул (SKU) или размер (например, 600×400)..."
            className="admin-input"
            style={{ paddingLeft: 36, paddingRight: query ? 34 : 12 }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#8B8177",
                padding: 4,
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {(searchFocused || query.trim().length > 0) && (
          <div
            style={{
              marginTop: 6,
              border: "1px solid #DDD6CB",
              borderRadius: 10,
              background: "#FFFFFF",
              boxShadow: "0 10px 28px rgba(31, 25, 20, 0.09)",
              maxHeight: 280,
              overflowY: "auto",
              zIndex: 20,
            }}
          >
            <div
              style={{
                padding: "7px 12px",
                fontSize: 11,
                fontWeight: 600,
                color: "#8B8177",
                borderBottom: "1px solid #EFEAE2",
                background: "#FAF8F4",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>
                {query.trim()
                  ? `Найдено карточек: ${candidates.length}`
                  : currentCard.categoryId
                    ? "Карточки из этой категории и каталога"
                    : "Выберите карточку из каталога"}
              </span>
              <span>Нажмите, чтобы связать</span>
            </div>

            {candidates.length === 0 ? (
              <div
                style={{
                  padding: "16px 14px",
                  fontSize: 13,
                  color: "#8B8177",
                  textAlign: "center",
                }}
              >
                Подходящих карточек не найдено
              </div>
            ) : (
              candidates.map((cand) => {
                const size = formatProductSize(cand as any);
                const groupCount = cand.linkedProductIds?.length || 0;
                const stock = Math.max(0, Math.floor(Number(cand.stockQty) || 0));
                return (
                  <button
                    key={cand.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleAddProduct(cand);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid #F3EFE8",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 7,
                        background: "#F5F2EC",
                        border: "1px solid #E6E0D6",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {cand.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cand.imageUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <Package size={16} color="#9A9086" />
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1F1B16",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {cand.name}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          fontSize: 11.5,
                          color: "#7B7268",
                          marginTop: 2,
                        }}
                      >
                        {cand.sku && <span>Арт. {cand.sku}</span>}
                        {size && <span>{size}</span>}
                        <span>
                          {cand.price != null
                            ? `${cand.price.toLocaleString("ru-RU")} ₽`
                            : "По запросу"}
                        </span>
                        <span
                          style={{
                            color: stock > 0 ? "#246B3D" : "#8B8177",
                            fontWeight: 600,
                          }}
                        >
                          {stock > 0 ? `${stock} шт.` : "Под заказ"}
                        </span>
                        {groupCount >= 2 && (
                          <span
                            style={{
                              background: "#EEF4FF",
                              color: "#2356A8",
                              padding: "0 6px",
                              borderRadius: 4,
                              fontWeight: 600,
                            }}
                          >
                            Уже в связке ({groupCount})
                          </span>
                        )}
                      </div>
                    </div>

                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#C8860A",
                        padding: "5px 10px",
                        borderRadius: 7,
                        background: "#FFF8EB",
                        border: "1px solid #F0D49B",
                        flexShrink: 0,
                      }}
                    >
                      <Plus size={13} />
                      Связать
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Пустое состояние */}
      {!isLinked && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "#FAF8F4",
            border: "1px dashed #DED7CC",
            fontSize: 12.5,
            color: "#7A7167",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Layers size={16} color="#9C9286" style={{ flexShrink: 0 }} />
          <span>
            Сейчас этот товар отображается как отдельная карточка. Выберите другой товар
            в поиске выше, чтобы показывать их вместе в одной карточке.
          </span>
        </div>
      )}

      {/* Настройка связки + живое превью как на Ozon */}
      {isLinked && (
        <div
          style={{
            border: "1px solid #E3DCD1",
            borderRadius: 12,
            background: "#FCFBF9",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Живое превью переключателя на витрине */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 9,
              background: "#FFFFFF",
              border: "1px solid #EAE4DA",
            }}
          >
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: "#6A635C",
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                Предпросмотр на сайте ·{" "}
                <strong style={{ color: "#1F1B16" }}>
                  {(groupTitle.trim() || autoGroupTitle) + ":"}
                </strong>
              </span>
              <span style={{ fontWeight: 500, color: "#8B8177" }}>
                Всего вариантов: {resolvedMembers.length}
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {resolvedMembers.map((m) => {
                const isSelf = m.id === selfKey;
                const isPrimary = m.id === primaryId;
                const stock = Math.max(0, Math.floor(Number(m.stockQty) || 0));
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 10px 5px 6px",
                      borderRadius: 9,
                      border: isSelf
                        ? "2px solid #1E6B4B"
                        : "1px solid #DCD5C9",
                      background: isSelf ? "#F1FAF5" : "#FFFFFF",
                      opacity: stock > 0 ? 1 : 0.72,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: "#F5F2EC",
                        overflow: "hidden",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {m.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.imageUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      ) : (
                        <Package size={13} color="#9A9086" />
                      )}
                    </div>
                    <div style={{ lineHeight: 1.2 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#1F1B16",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {effectiveLabels[m.id] || m.name}
                        {isPrimary && (
                          <span
                            title="Главная карточка в каталоге"
                            style={{ color: "#C8860A", display: "inline-flex" }}
                          >
                            <Crown size={11} />
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#6F675E" }}>
                        {m.price != null
                          ? `${m.price.toLocaleString("ru-RU")} ₽`
                          : "По запросу"}
                        {stock <= 0 ? " · под заказ" : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Заголовок блока выбора */}
          <div style={{ maxWidth: 340 }}>
            <label className="admin-label">
              Заголовок переключателя на карточке
            </label>
            <input
              type="text"
              value={groupTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={`Авто: ${autoGroupTitle} (например: Размер, Цвет, Намотка)`}
              className="admin-input"
              style={{ fontSize: 13 }}
            />
          </div>

          {/* Список карточек в связке */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#4E473F" }}>
              Карточки в одной связке (главная показывается в каталоге первой):
            </div>

            {resolvedMembers.map((member, index) => {
              const isPrimary = member.id === primaryId;
              const stock = Math.max(0, Math.floor(Number(member.stockQty) || 0));
              const size = formatProductSize(member as any);

              return (
                <div
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 11px",
                    borderRadius: 10,
                    background: isPrimary ? "#FFFDF7" : "#FFFFFF",
                    border: isPrimary
                      ? "1.5px solid #E2B866"
                      : "1px solid #E5DFD5",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Кнопка выбора главной карточки */}
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(member.id)}
                    title={
                      isPrimary
                        ? "Главная карточка связки (представляет группу в каталоге)"
                        : "Сделать главной карточкой связки"
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "5px 9px",
                      borderRadius: 7,
                      border: isPrimary
                        ? "1px solid #D99B26"
                        : "1px solid #DDD6CB",
                      background: isPrimary ? "#FFF3D6" : "#F8F6F2",
                      color: isPrimary ? "#966000" : "#6F675E",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: isPrimary ? "default" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <Crown size={12} />
                    {isPrimary ? "Главная" : "Сделать главной"}
                  </button>

                  {/* Миниатюра */}
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 7,
                      background: "#F5F2EC",
                      border: "1px solid #E6E0D6",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {member.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.imageUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <Package size={15} color="#9A9086" />
                    )}
                  </div>

                  {/* Название и параметры */}
                  <div style={{ flex: "1 1 200px", minWidth: 160 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#1F1B16",
                      }}
                    >
                      <span>{member.name}</span>
                      {member.isSelf && (
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "#E7F6EE",
                            color: "#1E6B4B",
                          }}
                        >
                          {productId ? "Эта карточка" : "Создаваемая карточка"}
                        </span>
                      )}
                      {!member.isVisible && (
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "#F2EFEA",
                            color: "#7B7268",
                          }}
                        >
                          Скрыт
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#7B7268",
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                        marginTop: 2,
                      }}
                    >
                      {member.sku && <span>Арт. {member.sku}</span>}
                      {size && <span>{size}</span>}
                      <span>
                        {member.price != null
                          ? `${member.price.toLocaleString("ru-RU")} ₽`
                          : "По запросу"}
                      </span>
                      <span
                        style={{
                          color: stock > 0 ? "#246B3D" : "#8B8177",
                          fontWeight: 600,
                        }}
                      >
                        {stock > 0 ? `${stock} шт.` : "Под заказ"}
                      </span>
                    </div>
                  </div>

                  {/* Короткая подпись на кнопке переключения */}
                  <div style={{ flex: "0 1 190px", minWidth: 150 }}>
                    <input
                      type="text"
                      value={labels[member.id] || ""}
                      onChange={(e) =>
                        handleLabelChange(member.id, e.target.value)
                      }
                      placeholder={`Кнопка: ${autoLabels[member.id] || "Авто"}`}
                      title="Короткая подпись на кнопке выбора варианта (если пусто — формируется автоматически из размера или названия)"
                      className="admin-input"
                      style={{
                        padding: "5px 9px",
                        fontSize: 12,
                        height: 32,
                      }}
                    />
                  </div>

                  {/* Порядок + переход + удаление из связки */}
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMove(index, -1)}
                      title="Поднять выше"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: "1px solid #E1DBD0",
                        background: "#FFFFFF",
                        cursor: index === 0 ? "not-allowed" : "pointer",
                        opacity: index === 0 ? 0.35 : 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={index === resolvedMembers.length - 1}
                      onClick={() => handleMove(index, 1)}
                      title="Опустить ниже"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: "1px solid #E1DBD0",
                        background: "#FFFFFF",
                        cursor:
                          index === resolvedMembers.length - 1
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          index === resolvedMembers.length - 1 ? 0.35 : 1,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowDown size={13} />
                    </button>
                    {!member.isSelf && (
                      <Link
                        href={`/${CLIENT_ADMIN_PATH}/products/${member.id}`}
                        target="_blank"
                        title="Открыть эту карточку в новой вкладке"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid #E1DBD0",
                          background: "#FFFFFF",
                          color: "#5E564E",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <ExternalLink size={13} />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.id)}
                      title={
                        member.isSelf
                          ? "Отвязать текущую карточку от группы"
                          : "Убрать эту карточку из связки"
                      }
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: "1px solid #ECD2CE",
                        background: "#FFF6F5",
                        color: "#B43E2F",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
