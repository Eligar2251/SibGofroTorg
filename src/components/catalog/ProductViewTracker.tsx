"use client";

import { useEffect, useRef } from "react";

const STORAGE_KEY = "sgt_vid";

/**
 * Отслеживает просмотр страницы товара.
 * Анонимному посетителю один раз выдаётся долгоживущий ID в localStorage —
 * обновления страницы и повторные переходы не засчитываются повторно
 * (дедупликация также подстрахована транзакцией на сервере).
 */
export function ProductViewTracker({ productId }: { productId: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    try {
      let sid = localStorage.getItem(STORAGE_KEY);
      if (!sid) {
        sid =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(STORAGE_KEY, sid);
      }

      fetch(`/api/products/${productId}/views`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          userAgent: navigator.userAgent,
          referrer: document.referrer || null,
        }),
        // запрос фоновый: не блокируем рендер, ошибки не критичны
      }).catch(() => {});
    } catch {
      /* localStorage недоступен (приватный режим и т.п.) — пропускаем */
    }
  }, [productId]);

  return null;
}
