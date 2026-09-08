// =========================================================
// FILE: src/components/admin/ModalPortal.tsx
// Рендерит модалку в отдельный корень #admin-modal-root у document.body.
//
// Зачем портал: внутри админки модалки часто находятся в карточках
// (.admin-card и т.п.). Если у предка есть transform/filter/animation
// с transform или CSS-containment, он становится «containing block»
// и position: fixed оверлея начинает работать относительно этого
// предка, а не окна — модалка «появляется внизу» страницы, и до неё
// приходится скроллить. Портал в body гарантирует, что оверлей всегда
// перекрывает весь экран и появляется поверх всего контента.
//
// Зачем ОТДЕЛЬНЫЙ КОРЕНЬ, а не просто body:
// почти весь мобильный слой (admin-mobile.css, ~630 селекторов)
// написан как `[data-admin="true"] .что-то`. Оверлей, смонтированный
// прямо в <body>, находится ВНЕ .admin-shell и под эти селекторы не
// попадал — мобильные модалки теряли сетки форм, таблицы, кнопки и
// поля, оставаясь в десктопной вёрстке (отсюда «всё криво и не
// листается»). Корень с data-admin="true" возвращает модалки в зону
// действия мобильных стилей — одним местом, для всех модалок сразу.
// =========================================================

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, unlockBodyScroll } from "@/hooks/use-body-lock";

const ROOT_ID = "admin-modal-root";

let rootEl: HTMLElement | null = null;
let rootUsers = 0;

/** Лениво создаём (и по последнему потребителю убираем) корень порталов. */
function acquireRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (!rootEl || !rootEl.isConnected) {
    const existing = document.getElementById(ROOT_ID);
    rootEl = existing ?? document.createElement("div");
    rootEl.id = ROOT_ID;
    // Мобильный слой стилей адресован потомкам [data-admin="true"].
    rootEl.setAttribute("data-admin", "true");
    // Корень не участвует в потоке: внутри только fixed-оверлеи.
    rootEl.style.display = "contents";
    if (!existing) document.body.appendChild(rootEl);
  }
  rootUsers += 1;
  return rootEl;
}

function releaseRoot(): void {
  rootUsers = Math.max(0, rootUsers - 1);
  if (rootUsers === 0 && rootEl && rootEl.parentNode && !rootEl.hasChildNodes()) {
    rootEl.parentNode.removeChild(rootEl);
    rootEl = null;
  }
}

export function ModalPortal({ children }: { children: ReactNode }) {
  // Монтируем портал только на клиенте (после гидрации),
  // иначе SSR и клиент разойдутся.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!mounted) return;
    const el = acquireRoot();
    setRoot(el);
    return () => {
      setRoot(null);
      releaseRoot();
    };
  }, [mounted]);

  // Пока любой портал-модалка смонтирован — фон заблокирован.
  // На iOS body{overflow:hidden} не останавливает «резиновый» скролл
  // страницы под модалкой, поэтому — позиционная блокировка через
  // use-body-lock.ts. Счётчик внутри корректно обрабатывает вложенные
  // модалки (разблокирует, когда закрыты все).
  useEffect(() => {
    if (!mounted) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [mounted]);

  if (!mounted || !root || typeof document === "undefined") return null;
  return createPortal(children, root);
}
