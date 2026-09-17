// =========================================================
// FILE: src/components/admin/TripStopsEditor.tsx
// Редактор точек маршрута: порядок (drag & drop + стрелки), пометки
// «забор груза / доставка / сдача», время, адрес и груз.
//
// Используется в двух местах:
//  • модалка «Новая перевозка» — сборка путевого листа;
//  • карточка сохранённой перевозки — поправить порядок уже созданного
//    документа перед печатью.
//
// ПОРЯДОК: массив stops и есть порядок. Перетаскивание переписывает
// массив на лету (live reorder), поэтому номер на карточке всегда
// актуальный, а сохранение — обычная отправка items[] в этом порядке.
//
// ТАЧ: drag стартует только от ручки ⠿ (touch-action: none на ней),
// иначе любой жест прокрутки срывал карточку в перетаскивание.
// =========================================================
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  GripVertical,
  Package,
  PackageSearch,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import {
  STOP_SORT_OPTIONS,
  TRIP_TYPES,
  isWpStop,
  moveStop,
  normalizeTripType,
  sortStops,
  stopLoadedLines,
  stopTotalQty,
  stopTitle,
  tripTypeDef,
  type StopSortMode,
  type TripStop,
  type TripType,
} from "@/lib/trip-stops";

/* ─────────────────────────────────────────────────────────
   Мелкие элементы
   ───────────────────────────────────────────────────────── */

export function TripTypePicker({
  value,
  onChange,
  compact = false,
}: {
  value: TripType;
  onChange: (next: TripType) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`trip-type-picker${compact ? " trip-type-picker--compact" : ""}`}
      role="group"
      aria-label="Пометка на точке"
    >
      {TRIP_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.hint}
          aria-pressed={normalizeTripType(value) === t.id}
          className={`trip-type-picker__btn trip-type-picker__btn--${t.id}${
            normalizeTripType(value) === t.id ? " trip-type-picker__btn--on" : ""
          }`}
          onClick={() => onChange(t.id)}
        >
          <span aria-hidden>{t.icon}</span>
          {t.short}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`trip-stop__field${wide ? " trip-stop__field--wide" : ""}`}>
      <span className="trip-stop__field-label">{label}</span>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Редактор
   ───────────────────────────────────────────────────────── */

export interface TripStopsEditorProps {
  stops: TripStop[];
  onChange: (next: TripStop[]) => void;
  /** Можно менять порядок (drag + стрелки). false — только просмотр. */
  sortable?: boolean;
  /** Можно править содержимое точки. */
  editable?: boolean;
  /** Можно удалять точку из маршрута. */
  removable?: boolean;
  /** Товары каталога — кнопка «из каталога» для своих точек. */
  products?: PickerProduct[];
  /** Быстрые сортировки (сначала забор / по адресу / по времени). */
  allowSort?: boolean;
  /** Кнопка «изменить в шаге состава» — если точка пришла из заказа. */
  onOpenDeal?: (stop: TripStop) => void;
  /** Заголовок блока и подсказка. */
  title?: string;
  hint?: string;
  emptyText?: string;
  /** Правый слот заголовка (например, кнопка «Добавить точку»). */
  actions?: ReactNode;
  /** Счётчик итога в подвале блока. */
  showTotals?: boolean;
  /**
   * Какие карточки раскрыты сразу: "all" — все (в модалке нужно ловить
   * количества), "first" — только первая, "none" — свернуто (просмотр).
   */
  defaultOpen?: "all" | "first" | "none";
}

export function TripStopsEditor({
  stops,
  onChange,
  sortable = true,
  editable = true,
  removable = true,
  products = [],
  allowSort = true,
  onOpenDeal,
  title = "Порядок точек маршрута",
  hint,
  emptyText = "Точек пока нет. Отметьте заказы или добавьте свою точку.",
  actions,
  showTotals = true,
  defaultOpen = "first",
}: TripStopsEditorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultOpen === "all" ? stops.map((s) => s.key) : defaultOpen === "first" && stops[0] ? [stops[0].key] : [])
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stopsRef = useRef(stops);
  const knownKeysRef = useRef<Set<string>>(new Set(stops.map((s) => s.key)));
  const pointerRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    stopsRef.current = stops;
    if (defaultOpen !== "all") return;
    const known = knownKeysRef.current;
    const fresh = stops.filter((s) => !known.has(s.key)).map((s) => s.key);
    if (fresh.length === 0) return;
    fresh.forEach((key) => known.add(key));
    setExpanded((prev) => new Set([...prev, ...fresh]));
  }, [stops, defaultOpen]);

  const canDrag = sortable && stops.length > 1;

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* ── Обновление точек ── */
  function patchStop(key: string, patch: Partial<TripStop>) {
    onChange(stops.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function patchLine(stopKeyArg: string, lineIndex: number, patch: Partial<TripStop["lines"][number]>) {
    onChange(
      stops.map((s) =>
        s.key === stopKeyArg
          ? {
              ...s,
              lines: s.lines.map((l, i) => (i === lineIndex ? { ...l, ...patch } : l)),
            }
          : s
      )
    );
  }

  function removeLine(stopKeyArg: string, lineIndex: number) {
    onChange(
      stops.map((s) =>
        s.key === stopKeyArg ? { ...s, lines: s.lines.filter((_, i) => i !== lineIndex) } : s
      )
    );
  }

  function addLine(stopKeyArg: string) {
    onChange(
      stops.map((s) =>
        s.key === stopKeyArg
          ? { ...s, lines: [...s.lines, { productId: null, name: "", qty: 1 }] }
          : s
      )
    );
  }

  function reorder(from: number, to: number) {
    onChange(moveStop(stops, from, to));
  }

  /* ── Перетаскивание (pointer events: мышь + тач) ──────
     Порядок массива и есть порядок маршрута, поэтому drag просто
     переписывает массив на лету. Все DOM-мутации (запрет выделения,
     автопрокрутка) — внутри эффекта: вне хуков React Compiler менять
     ничего нельзя, и такие правки легче читать.                    */

  /** Под какой индекс поставить карточку по позиции курсора/пальца. */
  function dropIndexFor(clientY: number, list: HTMLElement | null, activeIndex: number) {
    const nodes = list?.querySelectorAll<HTMLElement>("[data-stop-card]");
    if (!nodes || nodes.length === 0) return activeIndex;
    let index = 0;
    nodes.forEach((node, i) => {
      if (i === activeIndex) return;
      const rect = node.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index += 1;
    });
    return index;
  }

  useEffect(() => {
    if (dragIndex === null) return;

    const list = listRef.current;
    // Ближайший реально скроллящийся контейнер (модалка, карточка перевозки).
    let scroller: HTMLElement | null = null;
    for (let node: HTMLElement | null = list; node; node = node.parentElement) {
      const overflow = window.getComputedStyle(node).overflowY;
      if (/(auto|scroll)/.test(overflow) && node.scrollHeight > node.clientHeight + 1) {
        scroller = node;
        break;
      }
    }

    document.body.style.userSelect = "none";

    let pointerY = pointerRef.current.y;
    let raf = 0;

    // У краёв контейнера листаем сами — иначе длинный маршрут
    // невозможно перетащить дальше видимой области.
    const scrollAtEdges = () => {
      const EDGE = 56;
      const box = scroller
        ? { top: scroller.getBoundingClientRect().top, bottom: scroller.getBoundingClientRect().bottom }
        : { top: 0, bottom: window.innerHeight };
      let delta = 0;
      if (pointerY < box.top + EDGE) delta = -Math.ceil((box.top + EDGE - pointerY) / 5);
      else if (pointerY > box.bottom - EDGE) delta = Math.ceil((pointerY - (box.bottom - EDGE)) / 5);
      if (!delta) return;
      if (scroller) scroller.scrollBy(0, delta);
      else window.scrollBy(0, delta);
    };

    const onMove = (event: PointerEvent) => {
      pointerY = event.clientY;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      const next = dropIndexFor(event.clientY, list, dragIndex);
      if (next === dragIndex) return;
      const nextStops = moveStop(stopsRef.current, dragIndex, next);
      stopsRef.current = nextStops;
      onChange(nextStops);
      setDragIndex(next);
    };

    const onEnd = () => setDragIndex(null);

    const loop = () => {
      scrollAtEdges();
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      document.body.style.userSelect = "";
    };
  }, [dragIndex, onChange]);

  function startDrag(index: number, e: React.PointerEvent<HTMLElement>) {
    if (!canDrag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerRef.current = { x: e.clientX, y: e.clientY };
    setDragIndex(index);
  }

  function onHandleKeyDown(index: number, e: React.KeyboardEvent<HTMLElement>) {
    if (!canDrag) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      reorder(index, index - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      reorder(index, index + 1);
    }
  }

  /* ── Быстрые сортировки ── */
  function applySort(mode: StopSortMode) {
    onChange(sortStops(stops, mode));
  }

  const totals = stops.reduce(
    (acc, s) => {
      // Макулатура считается в кг — отдельно от единиц товара учёта,
      // иначе итог «единиц груза» складывал бы штуки с килограммами.
      if (isWpStop(s)) acc.kg += stopTotalQty(s);
      else acc.qty += stopTotalQty(s);
      acc.positions += stopLoadedLines(s).length;
      return acc;
    },
    { qty: 0, kg: 0, positions: 0 }
  );

  return (
    <div className="trip-stops-block">
      {(title || actions) && (
        <div className="trip-stops-block__head">
          <div className="trip-stops-block__titles">
            <span className="trip-stops-block__title">{title}</span>
            <span className="trip-stops-block__count">{stops.length} точ.</span>
            {hint && <span className="trip-stops-block__hint">{hint}</span>}
          </div>
          <div className="trip-stops-block__head-actions">
            {allowSort && stops.length > 1 && (
              <div className="trip-stops-block__sort" role="group" aria-label="Быстрая сортировка">
                {STOP_SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => applySort(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            {actions}
          </div>
        </div>
      )}

      {stops.length === 0 ? (
        <div className="admin-empty" style={{ padding: 18 }}>
          <p style={{ margin: 0 }}>{emptyText}</p>
        </div>
      ) : (
        <div ref={listRef} className={`trip-stops${dragIndex !== null ? " trip-stops--dragging" : ""}`}>
          {stops.map((stop, index) => {
            const type = tripTypeDef(stop.tripType);
            const open = expanded.has(stop.key);
            const loaded = stopLoadedLines(stop);
            const qty = stopTotalQty(stop);
            return (
              <div
                key={stop.key}
                data-stop-card
                className={`trip-stop trip-stop--${type.id}${
                  dragIndex === index ? " trip-stop--dragging" : ""
                }${open ? " trip-stop--open" : ""}`}
              >
                <div className="trip-stop__main">
                  {/* Ручка = номер точки. Тянем только за неё. */}
                  <button
                    type="button"
                    className="trip-stop__grip"
                    title={canDrag ? "Тяните, чтобы изменить порядок" : `Точка ${index + 1}`}
                    aria-label={`Точка ${index + 1}${canDrag ? " — перетащите или стрелками ↑↓" : ""}`}
                    onPointerDown={(e) => startDrag(index, e)}
                    onKeyDown={(e) => onHandleKeyDown(index, e)}
                  >
                    <GripVertical size={14} />
                    <span className="trip-stop__grip-num">{index + 1}</span>
                  </button>

                  <div className="trip-stop__head">
                    <div className="trip-stop__head-top">
                      <span className={`trip-stop__mark trip-stop__mark--${type.id}`}>
                        <span aria-hidden>{type.icon}</span> {type.mark}
                      </span>
                      <span className="trip-stop__title">{stopTitle(stop)}</span>
                      <strong className="trip-stop__customer">
                        {stop.customerName.trim() || "без названия"}
                      </strong>
                      {editable ? (
                        <input
                          type="time"
                          className="admin-input trip-stop__time"
                          value={stop.plannedTime || ""}
                          onChange={(e) => patchStop(stop.key, { plannedTime: e.target.value })}
                          title="Ориентировочное время на точке — печатается в бланке"
                        />
                      ) : (
                        stop.plannedTime && (
                          <span className="trip-stop__time-static">⏱ {stop.plannedTime}</span>
                        )
                      )}
                      <span className="trip-stop__spacer" />
                      <span
                        className="trip-stop__qty"
                        title={isWpStop(stop) ? "Килограммов макулатуры на точке" : "Единиц груза на точке"}
                      >
                        {qty} {isWpStop(stop) ? "кг" : "ед."}
                      </span>
                      {canDrag && (
                        <span className="trip-stop__moves">
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            disabled={index === 0}
                            title="Выше"
                            aria-label="Выше"
                            onClick={() => reorder(index, index - 1)}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            disabled={index === stops.length - 1}
                            title="Ниже"
                            aria-label="Ниже"
                            onClick={() => reorder(index, index + 1)}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--icon"
                            disabled={index === 0}
                            title="В начало маршрута"
                            aria-label="В начало маршрута"
                            onClick={() => reorder(index, 0)}
                          >
                            <CornerUpLeft size={13} />
                          </button>
                        </span>
                      )}
                      <button
                        type="button"
                        className="admin-btn admin-btn--icon"
                        onClick={() => toggleExpanded(stop.key)}
                        aria-expanded={open}
                        title={open ? "Свернуть точку" : "Раскрыть точку"}
                      >
                        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {removable && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--icon trip-stop__remove"
                          title="Убрать точку из маршрута"
                          aria-label="Убрать точку из маршрута"
                          onClick={() => onChange(stops.filter((s) => s.key !== stop.key))}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div className="trip-stop__summary">
                      <span className="trip-stop__addr" title={stop.address || ""}>
                        {stop.address?.trim() || "адрес не указан"}
                      </span>
                      {stop.phone && <span className="trip-stop__phone">{stop.phone}</span>}
                      {stop.contactName && (
                        <span className="trip-stop__contact">контакт: {stop.contactName}</span>
                      )}
                      {loaded.length > 0 && (
                        <span className="trip-stop__cargo">
                          {loaded
                            .map(
                              (l) =>
                                `${l.name || "без названия"} ×${l.qty}${isWpStop(stop) ? " кг" : ""}`
                            )
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {open && (
                  <div className="trip-stop__body">
                    <div className="trip-stop__row">
                      <span className="trip-stop__row-label">Пометка</span>
                      <TripTypePicker
                        value={type.id}
                        compact
                        onChange={(next) => patchStop(stop.key, { tripType: next as TripType })}
                      />
                      {stop.kind === "deal" && onOpenDeal && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          style={{ marginLeft: "auto" }}
                          onClick={() => onOpenDeal(stop)}
                        >
                          К заказам
                        </button>
                      )}
                    </div>

                    {editable ? (
                      <div className="trip-stop__fields">
                        {stop.kind === "custom" ? (
                          <>
                            <Field label="Контрагент">
                              <input
                                className="admin-input"
                                value={stop.customerName}
                                placeholder="ООО «Приёмка», склад на Лесной…"
                                onChange={(e) => patchStop(stop.key, { customerName: e.target.value })}
                              />
                            </Field>
                            <Field label="Куда / откуда (адрес)">
                              <input
                                className="admin-input"
                                value={stop.address || ""}
                                placeholder="ул. Сибирская, 10, ворота 3"
                                onChange={(e) => patchStop(stop.key, { address: e.target.value })}
                              />
                            </Field>
                            <Field label="Телефон">
                              <input
                                className="admin-input"
                                value={stop.phone || ""}
                                placeholder="+7…"
                                onChange={(e) => patchStop(stop.key, { phone: e.target.value })}
                              />
                            </Field>
                            <Field label="Контактное лицо">
                              <input
                                className="admin-input"
                                value={stop.contactName || ""}
                                placeholder="Кому звонить на месте"
                                onChange={(e) => patchStop(stop.key, { contactName: e.target.value })}
                              />
                            </Field>
                            <Field label="Заметка водителю" wide>
                              <input
                                className="admin-input"
                                value={stop.deliveryNote || ""}
                                placeholder="Заехать в ворота со двора, спросить Марину"
                                onChange={(e) => patchStop(stop.key, { deliveryNote: e.target.value })}
                              />
                            </Field>
                          </>
                        ) : (
                          /* Точка из документа: адрес/телефон/заметка приходят из
                             заказа ЗК-N, приёма ПМ-N или сдачи СМ-N. Правки здесь —
                             только для этого бланка (в документ не пишутся), чтобы
                             можно было доуказать ворота, этаж, время. */
                          <div className="trip-stop__deal-info">
                            <span className="trip-stop__deal-hint">
                              {stop.kind === "wp_intake" && (
                                <>
                                  Данные из приёма
                                  {stop.wpDocNumber != null ? ` ПМ-${stop.wpDocNumber}` : ""} (забор
                                  макулатуры). Поля ниже уточняют только этот бланк.
                                </>
                              )}
                              {stop.kind === "wp_shipment" && (
                                <>
                                  Данные из сдачи
                                  {stop.wpDocNumber != null ? ` СМ-${stop.wpDocNumber}` : ""} (везём на
                                  предприятие). Поля ниже уточняют только этот бланк.
                                </>
                              )}
                              {stop.kind === "deal" && (
                                <>
                                  Данные из заказа{stop.dealNumber ? ` ЗК-${stop.dealNumber}` : ""}.
                                  Поля ниже уточняют только этот бланк.
                                </>
                              )}
                            </span>
                            <Field label="Адрес в бланке">
                              <input
                                className="admin-input"
                                value={stop.address || ""}
                                onChange={(e) => patchStop(stop.key, { address: e.target.value })}
                              />
                            </Field>
                            <Field label="Телефон в бланке">
                              <input
                                className="admin-input"
                                value={stop.phone || ""}
                                onChange={(e) => patchStop(stop.key, { phone: e.target.value })}
                              />
                            </Field>
                            <Field label="Контактное лицо">
                              <input
                                className="admin-input"
                                value={stop.contactName || ""}
                                onChange={(e) => patchStop(stop.key, { contactName: e.target.value })}
                              />
                            </Field>
                            <Field label="Инструкция водителю" wide>
                              <input
                                className="admin-input"
                                value={stop.deliveryNote || ""}
                                placeholder="Ворота со двора, звонить за 10 минут, приёмка до 12:00…"
                                onChange={(e) => patchStop(stop.key, { deliveryNote: e.target.value })}
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Груз точки */}
                    <div className="trip-stop__cargo-block">
                      <div className="trip-stop__cargo-head">
                        <span className="trip-stop__row-label">
                          <Package size={12} /> {type.cargoLabel}
                        </span>
                        {editable && (
                          <div className="trip-stop__cargo-head-actions">
                            {stop.kind === "custom" && products.length > 0 && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--outline admin-btn--sm"
                                onClick={() => setPickerFor(pickerFor === stop.key ? null : stop.key)}
                              >
                                <PackageSearch size={12} /> Из каталога
                              </button>
                            )}
                            {stop.kind === "custom" && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                onClick={() => addLine(stop.key)}
                              >
                                <Plus size={12} /> Строка груза
                              </button>
                            )}
                            {stop.kind !== "custom" && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--ghost admin-btn--sm"
                                onClick={() =>
                                  patchStop(stop.key, {
                                    lines: stop.lines.map((l) => ({
                                      ...l,
                                      qty: l.maxQty ?? l.orderedQty ?? l.qty,
                                    })),
                                  })
                                }
                              >
                                Всё, что можно
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {pickerFor === stop.key && stop.kind === "custom" && (
                        <div style={{ marginBottom: 8 }}>
                          <ProductPicker
                            products={products}
                            placeholder="Поиск товара по складу…"
                            onPick={(p) => {
                              onChange(
                                stops.map((s) =>
                                  s.key === stop.key
                                    ? {
                                        ...s,
                                        lines: [
                                          ...s.lines.filter(
                                            (l) => !(l.name.trim() === "" && (Number(l.qty) || 0) === 0)
                                          ),
                                          { productId: p.id, name: p.name, qty: 1 },
                                        ],
                                      }
                                    : s
                                )
                              );
                              setPickerFor(null);
                            }}
                          />
                        </div>
                      )}

                      <div className="trip-stop__lines">
                        {stop.lines.length === 0 && (
                          <span className="trip-stop__nolines">Груз не указан</span>
                        )}
                        {stop.lines.map((line, lineIndex) => {
                          // Точка из документа: больше, чем в документе, увезти
                          // нельзя (у заказа — ещё и не больше остатка склада).
                          const max =
                            stop.kind === "custom"
                              ? null
                              : (line.maxQty ?? line.orderedQty ?? line.qty);
                          return (
                            <div className="trip-stop__line" key={`${stop.key}-${lineIndex}`}>
                              {editable && stop.kind === "custom" ? (
                                <input
                                  className="admin-input"
                                  value={line.name}
                                  placeholder="Что везём — можно что угодно (макулатура, поддоны…)"
                                  onChange={(e) =>
                                    patchLine(stop.key, lineIndex, {
                                      name: e.target.value,
                                      // Правим название вручную — отвязываем от каталога
                                      productId: e.target.value === line.name ? line.productId : null,
                                    })
                                  }
                                />
                              ) : (
                                <span className="trip-stop__line-name">
                                  {line.name}
                                  {stop.kind === "deal" && line.orderedQty != null && (
                                    <span className="trip-stop__line-ordered">
                                      {" "}
                                      (заказано {line.orderedQty}
                                      {line.maxQty != null && line.maxQty < line.orderedQty
                                        ? `, можно ${line.maxQty}`
                                        : ""}
                                      )
                                    </span>
                                  )}
                                  {isWpStop(stop) && line.orderedQty != null && (
                                    <span className="trip-stop__line-ordered">
                                      {" "}
                                      (в документе {line.orderedQty} кг)
                                    </span>
                                  )}
                                </span>
                              )}
                              {editable ? (
                                <div className="trip-stop__line-qty">
                                  <input
                                    className="admin-input"
                                    type="number"
                                    min={0}
                                    max={max ?? undefined}
                                    value={line.qty || ""}
                                    placeholder="0"
                                    title={
                                      isWpStop(stop)
                                        ? "Килограммов макулатуры в этом рейсе (можно меньше, чем в документе)"
                                        : undefined
                                    }
                                    onChange={(e) => {
                                      const raw = Math.max(0, Number(e.target.value) || 0);
                                      patchLine(stop.key, lineIndex, {
                                        qty: max != null ? Math.min(raw, max) : raw,
                                      });
                                    }}
                                  />
                                  {isWpStop(stop) && (
                                    <span className="trip-stop__line-unit" aria-hidden>
                                      кг
                                    </span>
                                  )}
                                  {stop.kind === "custom" && (
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--icon"
                                      title="Удалить строку"
                                      aria-label="Удалить строку"
                                      onClick={() => removeLine(stop.key, lineIndex)}
                                      disabled={stop.lines.length <= 1}
                                    >
                                      <X size={13} />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="trip-stop__line-qty-static">
                                  ×{line.qty}
                                  {isWpStop(stop) ? " кг" : ""}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showTotals && stops.length > 0 && (
        <div className="trip-stops-block__totals">
          Точек: <strong>{stops.length}</strong> · позиций: <strong>{totals.positions}</strong> ·
          единиц груза: <strong>{totals.qty}</strong>
          {totals.kg > 0 && (
            <>
              {" "}· макулатура: <strong>{totals.kg} кг</strong>
            </>
          )}
          <span className="trip-stops-block__totals-hint">
            {canDrag
              ? "Порядок — как в бланке: тяните карточку за ⠿ или жмите ↑↓"
              : "Порядок точек зафиксирован (перевозка закрыта)"}
          </span>
        </div>
      )}
    </div>
  );
}
