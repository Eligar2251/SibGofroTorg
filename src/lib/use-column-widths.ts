// =========================================================
// FILE: src/lib/use-column-widths.ts
// Ширины колонок таблицы: тянем мышью, храним в БД.
//
// ЗАЧЕМ В БД, А НЕ В localStorage
// Учёт ведут с нескольких устройств (компьютер на складе, ноутбук дома,
// планшет). Ширины, настроенные под свои ФИО и суммы, должны переезжать
// вместе с пользователем, поэтому они лежат в таблице settings под одним
// JSON-ключом — как планы зарплат и календарь выходных рядом.
//
// ПОЧЕМУ СОХРАНЕНИЕ ОТЛОЖЕННОЕ
// Во время перетаскивания ширина меняется на каждый mousemove — это
// десятки событий в секунду. Писать их в БД нельзя, поэтому в БД уходит
// только финальное значение, через debounce после отпускания мыши.
//
// ПОЧЕМУ ПЕРЕСЧЁТ БЕЗ ПЕРЕРИСОВКИ REACT
// Пока тянут за край, ширина применяется прямо в DOM через CSS-переменные
// (`--whsal-w-name` и т.п.). React-состояние обновляется один раз, на
// mouseup. Иначе таблица на 31 колонку и 40 строк перерисовывалась бы
// на каждый пиксель и заметно тормозила.
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ColumnSpec {
  /** Ключ колонки — под ним ширина хранится в настройках. */
  key: string;
  /** Ширина по умолчанию, px. */
  def: number;
  /** Минимальная ширина: уже неё колонка становится нечитаемой. */
  min: number;
  /** Максимальная ширина — защита от «утащил на 5000px и потерял таблицу». */
  max: number;
}

export type ColumnWidths = Record<string, number>;

interface Options {
  /** Ключ настройки в таблице settings. */
  settingKey: string;
  /** Описание колонок. */
  columns: ColumnSpec[];
  /** Сырые настройки, уже загруженные страницей (чтобы не читать их дважды). */
  settingsRaw: Record<string, string>;
  /** Сохранение в БД. Должно вернуть true при успехе. */
  onPersist: (key: string, value: string) => Promise<boolean> | boolean;
  /** Префикс CSS-переменных: `--{prefix}-w-{key}`. */
  cssPrefix: string;
}

/** Пауза перед записью в БД после окончания перетаскивания. */
const PERSIST_DEBOUNCE_MS = 700;

function clampWidth(spec: ColumnSpec, value: number): number {
  return Math.max(spec.min, Math.min(spec.max, Math.round(value)));
}

function parseStored(raw: string | undefined, columns: ColumnSpec[]): ColumnWidths {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: ColumnWidths = {};
    for (const spec of columns) {
      const value = Number((parsed as Record<string, unknown>)[spec.key]);
      // Игнорируем мусор и значения вне допустимого диапазона: настройка
      // могла быть записана прошлой версией с другими колонками.
      if (Number.isFinite(value) && value > 0) {
        result[spec.key] = clampWidth(spec, value);
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function useColumnWidths({
  settingKey,
  columns,
  settingsRaw,
  onPersist,
  cssPrefix,
}: Options) {
  const [widths, setWidths] = useState<ColumnWidths>({});
  /** Колонка, которую тянут прямо сейчас (для подсветки границы). */
  const [resizing, setResizing] = useState<string | null>(null);
  /** Успели ли принять ширины из настроек — чтобы не затереть их пустышкой. */
  const hydratedRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Узел, на котором живут CSS-переменные.
   *  Наружу отдаём ref-КОЛБЭК, а не сам ref-объект: так вызывающий
   *  компонент не «читает ref во время рендера» (правило react-hooks/refs),
   *  и мы сразу узнаём о появлении/замене узла. */
  const hostRef = useRef<HTMLElement | null>(null);
  const widthsRef = useRef<ColumnWidths>(widths);

  // Описание колонок задаётся модулем-константой и за время жизни
  // страницы не меняется, поэтому держим его в стабильной Map по ключу,
  // а не в ref (запись в ref во время рендера — нарушение правил React).
  const specByKey = useMemo(() => {
    const map = new Map<string, ColumnSpec>();
    for (const spec of columns) map.set(spec.key, spec);
    return map;
  }, [columns]);

  const specOf = useCallback((key: string) => specByKey.get(key), [specByKey]);

  const widthOf = useCallback(
    (key: string): number => {
      const spec = specOf(key);
      if (!spec) return 0;
      return widths[key] ?? spec.def;
    },
    [widths, specOf]
  );

  /** Записать ширину прямо в DOM — быстрый путь во время drag. */
  const applyToDom = useCallback(
    (key: string, value: number) => {
      const host = hostRef.current;
      if (!host) return;
      host.style.setProperty(`--${cssPrefix}-w-${key}`, `${value}px`);
    },
    [cssPrefix]
  );

  // ── Приём сохранённых значений ──
  useEffect(() => {
    const raw = settingsRaw[settingKey];
    if (raw === undefined) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const stored = parseStored(raw, columns);
    if (Object.keys(stored).length) setWidths(stored);
  }, [settingsRaw, settingKey, columns]);

  // ── Синхронизация состояния с CSS-переменными ──
  const applyAll = useCallback(
    (host: HTMLElement | null, values: ColumnWidths) => {
      if (!host) return;
      for (const spec of columns) {
        host.style.setProperty(
          `--${cssPrefix}-w-${spec.key}`,
          `${values[spec.key] ?? spec.def}px`
        );
      }
    },
    [columns, cssPrefix]
  );

  useEffect(() => {
    widthsRef.current = widths;
    applyAll(hostRef.current, widths);
  }, [widths, applyAll]);

  /** Ref-колбэк для узла таблицы. */
  const setHostRef = useCallback(
    (node: HTMLElement | null) => {
      hostRef.current = node;
      // Узел появился уже после того, как ширины загрузились из настроек —
      // применяем их сразу, иначе таблица отрисуется дефолтной.
      applyAll(node, widthsRef.current);
    },
    [applyAll]
  );

  const persist = useCallback(
    (next: ColumnWidths) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        persistTimer.current = null;
        // Пишем только реально изменённые колонки: так настройка остаётся
        // маленькой, а колонки, которых пользователь не трогал, продолжат
        // следовать за дефолтом, если он поменяется в коде.
        const payload: ColumnWidths = {};
        for (const spec of columns) {
          const value = next[spec.key];
          if (value !== undefined && value !== spec.def) payload[spec.key] = value;
        }
        void onPersist(settingKey, JSON.stringify(payload));
      }, PERSIST_DEBOUNCE_MS);
    },
    [onPersist, settingKey, columns]
  );

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    []
  );

  /**
   * Начать перетаскивание границы колонки.
   * Работает и мышью, и пальцем: слушаем pointer-события.
   */
  const startResize = useCallback(
    (key: string, event: React.PointerEvent) => {
      const spec = specOf(key);
      if (!spec) return;
      // Не даём событию уйти в th (сортировка/клик по заголовку) и не
      // позволяем браузеру начать выделение текста.
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = widths[key] ?? spec.def;
      let latest = startWidth;

      setResizing(key);
      document.body.classList.add("is-col-resizing");

      const onMove = (moveEvent: PointerEvent) => {
        latest = clampWidth(spec, startWidth + (moveEvent.clientX - startX));
        applyToDom(key, latest);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        document.body.classList.remove("is-col-resizing");
        setResizing(null);
        setWidths((prev) => {
          const next = { ...prev, [key]: latest };
          persist(next);
          return next;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [widths, specOf, applyToDom, persist]
  );

  /** Двойной клик по границе — вернуть колонке ширину по умолчанию. */
  const resetColumn = useCallback(
    (key: string) => {
      const spec = specOf(key);
      if (!spec) return;
      setWidths((prev) => {
        const next = { ...prev };
        delete next[key];
        persist(next);
        return next;
      });
      applyToDom(key, spec.def);
    },
    [specOf, applyToDom, persist]
  );

  /** Сдвинуть границу на шаг — клавиатурная альтернатива перетаскиванию. */
  const nudge = useCallback(
    (key: string, deltaPx: number) => {
      const spec = specOf(key);
      if (!spec) return;
      setWidths((prev) => {
        const current = prev[key] ?? spec.def;
        const value = clampWidth(spec, current + deltaPx);
        if (value === current) return prev;
        const next = { ...prev, [key]: value };
        persist(next);
        return next;
      });
    },
    [specOf, persist]
  );

  /** Сбросить все колонки (кнопка в интерфейсе). */
  const resetAll = useCallback(() => {
    setWidths({});
    for (const spec of columns) applyToDom(spec.key, spec.def);
    persist({});
  }, [applyToDom, persist, columns]);

  /** Есть ли отличия от дефолта — чтобы показывать кнопку сброса. */
  const isCustomized = columns.some(
    (spec) => widths[spec.key] !== undefined && widths[spec.key] !== spec.def
  );

  return {
    /** Повесить на элемент таблицы: ref={setHostRef} */
    setHostRef,
    widths,
    widthOf,
    resizing,
    startResize,
    nudge,
    resetColumn,
    resetAll,
    isCustomized,
  };
}
