// =========================================================
// FILE: src/components/pwa/ServiceWorkerRegister.tsx
// Регистрация /sw.js на публичной части сайта.
// =========================================================

"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // Страницы админки уже зарегистрированы своим worker'ом.
    if (document.querySelector('[data-admin="true"]')) return;
    // PWA работает только по HTTPS (localhost — исключение браузера).
    const secure =
      window.isSecureContext ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1";
    if (!secure) return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* установка недоступна — сайт продолжает работать как обычная страница */
    });
  }, []);

  return null;
}
