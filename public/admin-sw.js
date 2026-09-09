/* Минимальный service worker для установки админ-панели как PWA
   (открытие с домашнего экрана без адресной строки и панелей браузера).
   Данные и API намеренно не кешируются: учёт всегда читает свежий сервер.
   Обработчик fetch — пустой no-op без respondWith: запросы идут в сеть
   как обычно, но старые Chrome (до ~126) требуют наличия обработчика
   fetch, чтобы показать «Установить приложение». */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", () => {
  /* no-op: осознанно ничего не перехватываем и не кешируем */
});
