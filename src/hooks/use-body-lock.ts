// =========================================================
// FILE: src/hooks/use-body-lock.ts
// Блокировка прокрутки фона, пока открыта модалка / меню.
//
// ПОЧЕМУ НЕ `body { overflow: hidden }`:
// На iOS Safari такой блокировки недостаточно — страница под
// модалкой продолжает «резиново» прокручиваться, а палец при этом
// не докручивает контент самой модалки до низа. Надёжный способ —
// position: fixed на body с запоминанием scrollY и возвратом
// страницы в ту же точку при закрытии. Это стандартный приём
// (так же делает, например, Radix UI).
//
// Счётчик lockCount — для случаев, когда модалки блокируют
// скролл одновременно (мобильное меню + модалка поверх него):
// разблокировка происходит только после закрытия ВСЕХ.
// =========================================================

"use client";

import { useLayoutEffect } from "react";

interface SavedBodyStyle {
  overflow: string;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  paddingRight: string;
  scrollY: number;
}

let lockCount = 0;
let saved: SavedBodyStyle = {
  overflow: "",
  position: "",
  top: "",
  left: "",
  right: "",
  width: "",
  paddingRight: "",
  scrollY: 0,
};

/** Заблокировать прокрутку страницы (сохранить текущую позицию). */
export function lockBodyScroll(): void {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    const body = document.body;
    saved = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      paddingRight: body.style.paddingRight,
      scrollY: window.scrollY,
    };
    // Компенсация скроллбара на десктопе: без неё контент «прыгает»
    // вправо на ширину исчезнувшего скроллбара.
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${saved.scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  lockCount += 1;
}

/** Снять блокировку (когда все потребители её отпустили). */
export function unlockBodyScroll(): void {
  if (typeof document === "undefined" || lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;
  const body = document.body;
  body.style.overflow = saved.overflow;
  body.style.position = saved.position;
  body.style.top = saved.top;
  body.style.left = saved.left;
  body.style.right = saved.right;
  body.style.width = saved.width;
  body.style.paddingRight = saved.paddingRight;
  // Возвращаем страницу в точку, где пользователь её оставил.
  window.scrollTo(0, saved.scrollY);
}

/**
 * Хук: пока `locked` истинно — фон не прокручивается.
 * Использовать в компонентах модалок/меню вместо ручной
 * установки `document.body.style.overflow = "hidden"`.
 */
export function useBodyLock(locked: boolean): void {
  useLayoutEffect(() => {
    if (!locked) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [locked]);
}
