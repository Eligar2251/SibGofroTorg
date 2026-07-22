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

export function ModalPortal({ children }: { children: ReactNode }) {
  // Монтируем портал только на клиенте (после гидрации),
  // иначе SSR и клиент разойдутся.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
