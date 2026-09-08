// =========================================================
// FILE: src/hooks/use-is-mobile.ts
// Единый определитель «сайт открыт с телефона».
//
// ЗАЧЕМ ХУК, А НЕ МЕДИАЗАПРОСЫ
// Мобильная админка строится отдельными компонентами
// (src/components/admin/mobile/*), а не переопределением десктопных
// стилей. Компоненту нужно решение «рендерить мобильный или
// десктопный вариант» ДО рендера — медиазапрос в CSS этого не даёт.
//
// ВАЖНО ПРО SSR
// На сервере окна нет, поэтому первый рендер всегда «не мобильный»
// (десктопная разметка = то, что отдаёт сервер). Настоящее значение
// появляется в useLayoutEffect до первой отрисовки в браузере, поэтому
// пользователь не видит «прыжка» макета, а гидрация не расходится:
// сервер и клиент на первом проходе отдают одинаковый HTML.
// =========================================================

"use client";

import { useLayoutEffect, useState } from "react";

/** Порог «телефон/вертикальный планшет» — совпадает с admin-mobile.css. */
export const MOBILE_BREAKPOINT = 768;

const QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

/**
 * Признак телефона: узкий экран ИЛИ тач-устройство без точного
 * указателя (планшет в портретной ориентации тоже считаем мобильным —
 * боковая панель там всё равно не нужна).
 */
function detect(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.matchMedia(QUERY).matches;
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return narrow || (coarse && window.innerWidth <= 1024);
}

/**
 * `true`, если сайт открыт с телефона/вертикального планшета.
 * Подписывается на resize/поворот экрана, значение живое.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useLayoutEffect(() => {
    const update = () => setIsMobile(detect());
    update();

    const media = window.matchMedia(QUERY);
    // Safari < 14 не знает addEventListener у MediaQueryList.
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      window.addEventListener("resize", update);
      window.addEventListener("orientationchange", update);
      return () => {
        media.removeEventListener("change", update);
        window.removeEventListener("resize", update);
        window.removeEventListener("orientationchange", update);
      };
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return isMobile;
}

/**
 * Высота нижней панели в пикселях — нужна, чтобы контент не прятался
 * под фиксированным меню (см. AdminBottomNav).
 */
export const MOBILE_BOTTOM_NAV_HEIGHT = 58;
