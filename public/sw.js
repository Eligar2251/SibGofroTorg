/* =========================================================
   FILE: public/sw.js
   Service worker сайта (подключается /sw.js на всех публичных
   страницах; админка использует свой /admin-sw.js).

   ЗАЧЕМ ОН НУЖЕН, ЕСЛИ НИЧЕГО НЕ КЕШИРУЕТ
   Без зарегистрированного service worker браузер не предлагает
   «Установить приложение» / «Добавить на главный экран» в режиме
   standalone, то есть сайт открывается в обычной вкладке с адресной
   строкой. Пустой worker — минимальная цена за безрамочный режим.

   ЧЕГО ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО
   Обработчика fetch нет: any-кеш на Next.js (ISR, RSC-пейлоады,
   API-роуты) быстро устаревает и ломает обновления. Страницы всегда
   идут в сеть, кеш ассетов отдаёт сам Next (immutable-заголовки).
   ========================================================= */

const VERSION = "sibgofrotorg-sw-1";

self.addEventListener("install", (event) => {
  // Не ждём закрытия старых вкладок — новая версия включается сразу.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Чистим чужие кеши, если они когда-либо появятся.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});
