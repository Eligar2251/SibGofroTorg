// =========================================================
// FILE: src/hooks/use-windowed-list.ts
// «Окно» длинного списка: рендерим не все сотни строк сразу,
// а кусками по мере прокрутки — дешёвая альтернатива полной
// виртуализации (README-PERFORMANCE.md, п. «Виртуализация»).
//
// Почему не библиотека виртуализации:
//  • админские таблицы имеют строки разной высоты (адрес + телефон +
//    позиции), фиксированный row-height виртуализатор ломает их;
//  • нужен рабочий Ctrl+F и печать — у нас для этого есть «Показать все»;
//  • списки короче min (40) не меняются вообще: ни поведения, ни DOM.
//
// Как работает: рендерим первые `min` записей; «хвостовой» элемент
// (sentinel) через IntersectionObserver догружает следующий `step`,
// когда подъезжает к краю экрана/скролл-контейнера. Пока хвост видим —
// догружает ещё, то есть заполняет экран и останавливается.
// «Показать все» — для Ctrl+F по странице и печати.
//
// Сброс окна — ТОЛЬКО по resetKey (обычно состояние фильтров/поиска):
// realtime-обновление данных не должно схлопывать прокрученный список
// обратно к первым 40 строкам.
// =========================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface WindowedList<T> {
  /** Видимая часть списка (не больше limit). */
  visible: T[];
  /** Сколько записей всего (после фильтров). */
  total: number;
  /** Сколько ещё не показано. */
  hidden: number;
  /** Показан весь список (Ctrl+F/печать). */
  showingAll: boolean;
  /** Пока есть не показанные записи (есть что догружать). */
  hasMore: boolean;
  /**
   * Callback-ref хвостового элемента (кнопка «Показать ещё», последняя
   * строка). Ставится на любой элемент: подъезд к нему догружает кусок.
   */
  sentinelRef: (node: HTMLElement | null) => void;
  /** Показать всё сразу. */
  showAll: () => void;
}

export function useWindowedList<T>(
  items: T[],
  opts?: {
    /** Первый кусок (по умолчанию 40). Списки короче не «оконные» вовсе. */
    min?: number;
    /** Шаг догрузки (по умолчанию 40). */
    step?: number;
    /**
     * Ключ сброса окна: поменялись фильтры/поиск — начинаем с первого
     * куска. Не передавайте сюда сами данные: realtime-refresh не должен
     * сбрасывать прокрутку пользователя.
     */
    resetKey?: unknown;
  }
): WindowedList<T> {
  const min = opts?.min ?? 40;
  const step = opts?.step ?? 40;
  const resetKey = opts?.resetKey;
  const [limit, setLimit] = useState(min);
  const [showingAll, setShowingAll] = useState(false);
  const nodeRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Фильтры/поиск сменились — окно с первого куска. Сброс синхронно
  // в рендере (derived state), чтобы между кадрами не «мигали» строки
  // старого окна на новом наборе записей.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setLimit(min);
    setShowingAll(false);
  }

  // Хвостовой элемент переустанавливается через callback-ref: наблюдатель
  // переподключается к новому узлу и сразу видит, видим ли хвост сейчас.
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;
      if (!node) return;
      if (typeof IntersectionObserver === "undefined") return;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            // Догружаем следующий кусок; React передвинет хвост вниз,
            // наблюдатель сообщит isIntersecting=false — и цикл закончится.
            setLimit((v) => v + step);
          }
        },
        { rootMargin: "240px 0px" }
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [step]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const total = items.length;
  // Окно только растёт (кроме сброса по resetKey) и всегда зажато
  // фактической длиной списка — realtime-добавление строки не схлопывает
  // показанное, а фильтр до 3 строк мгновенно убирает хвост.
  const showing = showingAll ? total : Math.min(Math.max(limit, min), total);
  const hidden = total - showing;

  return {
    visible: showingAll ? items : items.slice(0, showing),
    total,
    hidden,
    showingAll: showingAll || total <= min,
    hasMore: hidden > 0,
    sentinelRef,
    showAll: () => setShowingAll(true),
  };
}
