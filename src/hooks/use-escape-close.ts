// =========================================================
// FILE: src/hooks/use-escape-close.ts
// Закрытие модалки клавишей Escape.
//
// Зачем отдельный хук: у модалок учёта макулатуры закрытие по клику
// на подложку убрали. Когда человек выделял текст в форме мышью и
// отпускал кнопку за пределами окна, браузер порождал click на
// подложке — модалка закрывалась, всё введённое пропадало. Теперь
// окно закрывается только крестиком и Escape (этим хуком).
// =========================================================

"use client";

import { useEffect, useRef } from "react";

/**
 * Пока `enabled` истинно, нажатие Escape вызывает `onClose`.
 * Колбэк хранится в ref (обновляется в эффекте, не в рендере) —
 * подписка не пересоздаётся на каждый рендер.
 */
export function useEscapeClose(onClose: () => void, enabled = true): void {
  const handler = useRef(onClose);

  useEffect(() => {
    handler.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Открытый <select>/<datalist> сам обрабатывает Escape — не мешаем.
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === "SELECT") return;
      event.preventDefault();
      handler.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
