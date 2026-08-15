/* Минимальный service worker для установки админ-панели как PWA.
   Данные и API намеренно не кешируются: учёт всегда читает свежий сервер. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", () => {
  // Без respondWith: браузер выполняет обычный сетевой запрос.
});
