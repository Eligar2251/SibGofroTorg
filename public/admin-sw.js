/* Минимальный service worker для установки админ-панели как PWA.
   Данные и API намеренно не кешируются: учёт всегда читает свежий сервер.
   Обработчика fetch здесь нет намеренно — пустой (no-op) слушатель только
   добавлял накладные расходы на каждую навигацию, а современные браузеры
   не требуют его для установки PWA. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
