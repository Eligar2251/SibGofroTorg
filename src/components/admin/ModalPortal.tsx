// =========================================================
// FILE: src/components/admin/ModalPortal.tsx
// Рендерит модалку в document.body через портал.
//
// Зачем: внутри админки модалки часто находятся в карточках
// (.admin-card и т.п.). Если у предка есть transform/filter/animation
// с transform, он становится «containing block» и position: fixed
// оверлея начинает работать относительно этого предка, а не окна —
// модалка «появляется внизу» страницы, и до неё приходится скроллить.
// Портал в body гарантирует, что оверлей всегда перекрывает весь
// экран и появляется поверх всего контента.
// =========================================================

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, unlockBodyScroll } from "@/hooks/use-body-lock";

export function ModalPortal({ children }: { children: ReactNode }) {
  // Монтируем портал только на клиенте (после гидрации),
  // иначе SSR и клиент разойдутся.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
