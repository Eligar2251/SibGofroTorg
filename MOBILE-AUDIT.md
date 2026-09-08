# 📱 Аудит мобильной вёрстки админ-панели (iPhone X, 375×812)

Дата аудита: 08.09.2026 · Ветка: `arena/01a08000-sibgofrotorg`
Объект: `[adminPath]/*` — 35 страниц, 82 клиентских экрана, 39 модалок,
23 файла с таблицами, ~19 800 строк CSS админки.

Целевое устройство: **iPhone X (375×812, notch, safe-area 44px сверху /
34px снизу)**, режим standalone (PWA без адресной строки).

---

## 1. Главная ошибка: в модалках физически не было скролла

Это и есть причина «не могу листать вниз, приходится поворачивать телефон».

Мобильный слой описывал модалки **дважды и противоположным образом**:

| Слой | Оверлей `.admin-modal-overlay` | Лист `.admin-modal` |
|---|---|---|
| `admin-mobile.css:677` | `height: 100dvh; overflow: hidden` | `height: 100dvh; overflow-y: auto` |
| `admin-mobile.css:1627` | `overflow-y: auto !important` | `height: auto !important; max-height: none !important` |

Второй блок идёт позже и с `!important`, поэтому в браузере складывалось:
**оверлей — `overflow: hidden` (не листается), лист — `height: auto`
(растёт по контенту, собственный `overflow-y: auto` при авто-высоте
скролл не создаёт)**. Ни один из двух контейнеров не прокручивается.
Всё, что ниже первого экрана модалки, недостижимо.

Проверено исполняемым прогоном каскада (jsdom + postcss, ширина 375px),
а не «на глаз»:

```
ДО (HEAD):
  оверлей .admin-modal-overlay   overflow-y = hidden      [admin-mobile.css:677]
  лист    .admin-modal           height     = auto !      [admin-mobile.css:1637]
                                 max-height = none !      [admin-mobile.css:1637]

ПОСЛЕ (ветка):
  оверлей .admin-modal-overlay   overflow-y = hidden !    [admin-mobile.css:3388]
  лист    .admin-modal           height     = 100% !      [admin-mobile.css:3413]
                                 overflow-y = auto !      [admin-mobile.css:3413]
```

**Решение (одно правило вместо двух):** оверлей — неподвижная подложка
(`overflow: hidden`), полноэкранный лист модалки — единственный
скролл-контейнер (`height: 100%; overflow-y: auto`). Тогда sticky-шапка
и sticky-кнопки живут в одном скроллпорте, клавиатура iOS не съедает
низ формы, а поворот телефона больше не нужен.

---

## 2. Вторая ошибка: 2/3 мобильных стилей не доезжали до модалок

Мобильный слой написан как `[data-admin="true"] .что-то` — **634 селектора**.
Fallback для порталов (`body:has(.admin-shell) > .admin-modal-overlay`) —
всего **11 селекторов**.

`ModalPortal` монтировал оверлей прямо в `document.body`, то есть **вне**
`.admin-shell[data-admin="true"]`. Поэтому портированная модалка теряла
почти весь мобильный слой. Замеры на реальном дереве модалки (22 элемента):

```
ДО:   элементов с мобильными стилями  8 из 22 · применений правил:  12
ПОСЛЕ: элементов с мобильными стилями 22 из 22 · применений правил: 122
```

Частично это обходили костылём `data-admin="true"` прямо на оверлее —
он есть только у 12 модалок из 39. Без него остались, например:
`CashSessions:221`, `ReviewsManager:238,278`,
`WarehouseCounterparties:444`, `WarehouseDeals:1503,1562`,
`WarehouseManager:3147`, `WarehousePayments:435,996`,
`WarehouseReceipts:494`, `WarehouseSalaries:371,651,936,1094`.

**Решение:** `ModalPortal` теперь монтирует модалки в отдельный корень
`#admin-modal-root[data-admin="true"]` у `body`. Одно изменение — и все
39 модалок (включая будущие) попадают в зону действия мобильных стилей.
Костыль `data-admin` на оверлеях можно постепенно убирать.

---

## 3. CSS-containment ломал inline-модалки

`admin.css:2329-2354` задаёт оптимизацию отрисовки:

```css
[data-admin="true"] .admin-card        { contain: layout style; }
[data-admin="true"] .admin-stat        { contain: layout style paint; }
[data-admin="true"] .admin-modal       { contain: layout style paint; }
[data-admin="true"] .admin-table-wrap  { contain: layout style; }
[data-admin="true"] .admin-order       { contain: layout style; }
```

Два следствия, оба подтверждены спецификацией CSS Containment:

1. `contain: layout` делает элемент **containing block для `position: fixed`**.
   Модалка, отрендеренная внутри такой карточки, «прилипает» к карточке,
   а не к окну. При заблокированном скролле `body` (use-body-lock) до неё
   нельзя доскроллить — она оказывается ниже экрана.
2. `contain: paint` на `.admin-modal` **обрезает содержимое по padding-box** —
   sticky-шапка, ушедшая отрицательным `top` под вырез iPhone, срезалась.

**Решение:**
- на мобильном у листа модалки `contain: none !important`;
- страховка для inline-модалок — правило через `:has()` в отдельном блоке
  (чтобы неподдерживающий браузер не потерял соседние правила):

```css
@supports selector(:has(*)) {
  [data-admin="true"] :is(.admin-card, .admin-stat, .admin-order,
    .admin-table-wrap, .admin-content, .admin-main, .admin-shell,
    .admin-card__pad):has(.admin-modal-overlay) {
    contain: none !important; transform: none !important; filter: none !important;
  }
}
```

---

## 4. Вкладки: три реализации, адаптирована была одна

| Вкладки | Где | Было на 375px | Стало |
|---|---|---|---|
| `.admin-filters` | Учёт, Заявки, Макулатура и др. | лента со скроллом, цель 42px | цель 44px + прилипает под шапкой |
| `.md-tabs` | `ProductFormClient:526` | `inline-flex` + `overflow: hidden` → вторая вкладка **обрезалась** | `flex-wrap: wrap`, `overflow: visible`, цель 40px |
| `.settings-tabs` | `SettingsForm:441` | `flex-wrap: wrap`, pills 34px → 3 строки, цель ниже 44px | лента со скроллом и snap, цель 44px |
| `.sp-side__tabs` | `SupplyPlanning:336` | кнопки 34px | 44px |
| `.featured-sort-tabs` | `FeaturedProductsOrderClient:378` | уже было `@media 520px` | 44px |

Проверено каскадом:

```
.md-tabs        display = flex !  flex-wrap = wrap !  overflow-y = visible !   [admin-mobile.css:3608]
.settings-tabs  display = flex !  flex-wrap = nowrap ! overflow-x = auto !     [admin-mobile.css:3623]
.settings-tab   min-height = 44px !                                           [admin-mobile.css:3641]
.admin-filter   min-height = 44px !                                           [admin-mobile.css:3657]
.admin-tabs-with-actions  position = sticky !  top = calc(safe-top + 56px) !   [admin-mobile.css:3667]
```

---

## 5. Нижнее меню вместо бургера

По требованию мобильной вёрстки навигация вынесена вниз: на iPhone X
(812px высоты) большой палец до верхней панели не дотягивается.

- `src/hooks/use-is-mobile.ts` — единый `useIsMobile()` (SSR-safe,
  подписка на resize/поворот).
- `src/components/admin/mobile/AdminBottomNav.tsx` + `*.module.css` —
  4 частых раздела + лист «Ещё» (все разделы, выход, переход на сайт).
  Стили в CSS-модуле, **без медиазапросов** — мобильность решает хук.
- Десктопная оболочка не изменена: на десктопе компонент не рендерится.
- Тост о новых заявках поднят над меню (`AdminRequestAlerts:397`).

---

## 6. Таблицы → карточки

Добавлен `src/components/admin/mobile/MobileCardList.tsx` — типизированный
карточный список (заголовок, бейдж, пары «подпись: значение», действия,
empty-state) + CSS-модуль без медиазапросов.

⚠️ **Честно про охват:** в админке 23 файла с `.admin-table`. Перевести их
все на карточки в рамках этой задачи нельзя — это правки в каждом экране.
Пока таблицы остаются с горизонтальным скроллом внутри `.admin-table-wrap`
(это рабочий, но не идеальный вариант). `MobileCardList` — готовый
референс для перевода; рецепт подключения есть в шапке файла.

---

## 7. PWA / «безрамочная веб-версия»

Проверено на живом dev-сервере, а не по коду — `GET /admin` отдаёт:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="theme-color" content="#1b2b4b"/>
<link rel="manifest" href="/admin-manifest.webmanifest"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-title" content="СибГофроТорг Админ"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
```

| Требование | Статус |
|---|---|
| Манифест с `display: standalone` | ✅ был: `/admin-manifest.webmanifest` (route.ts) + `/manifest.webmanifest` (manifest.ts), есть `display_override`, `orientation: portrait-primary`, `shortcuts` |
| Иконки 192 и 512 | ✅ были: `icon-192/512.png` + maskable-варианты + `apple-touch-icon.png` 180×180 (размеры проверены чтением PNG-заголовка) |
| Service Worker | ⚠️ был только `/admin-sw.js` для админки. **Добавлен `public/sw.js`** для публичной части + регистрация `ServiceWorkerRegister` (не мешает админскому worker'у, работает только по HTTPS/localhost) |
| Мета-теги для iOS | ✅ были, проверены в отдаче |
| `viewport-fit=cover` + `env(safe-area-inset-*)` | ✅ есть; все новые отступы считают safe-area |

Про установку: манифест называется `manifest.webmanifest`, а не
`manifest.json` — это не ошибка, браузеру важен тег `<link rel="manifest">`,
а не имя файла. Переименовывать не стал: путь зашит в
`next.config.ts` (кеш-заголовки) и в metadata двух layout'ов.

---

## 8. Что осталось сделать (бэклог, по приоритету)

1. **Таблицы → карточки** в 23 экранах через `MobileCardList`
   (начать с «Учёт → Заказы» и «Товары»: там таблиц больше всего).
2. **Дубли в `admin-mobile.css`.** Файл содержит два больших блока
   `@media (max-width: 768px)` (строки 38–1090 и 1143–2839), где одни и те
   же селекторы заданы дважды. Новый финальный слой это перекрывает,
   но старый мусор надо вычистить — иначе следующая правка снова
   упрётся в «кто кого перебил».
3. **Медиазапросы в `admin.css`: 153 штуки.** Десктопный файл правит
   мобильную вёрстку в обход мобильного слоя (например,
   `admin.css:10104` задаёт `padding` оверлея на ≤640px). Их надо
   перенести в `admin-mobile.css` и оставить десктоп чистым.
4. **Перевести 10 inline-модалок на `ModalPortal`**:
   `WastepaperAccountManager` (6), `ClientRequestsManager` (3),
   `StockRevisionSheet` (1). Сейчас они работают, но держатся на
   страховке из п. 3 вместо правильного портала.
5. **Убрать костыль `data-admin="true"` с оверлеев** (12 мест) —
   после перехода на `#admin-modal-root` он не нужен.
6. **Заголовок раздела в шапке** на 375px получает ~173px
   (4 кнопки по 40px + зазоры = 190px). Можно убрать бургер из шапки —
   его заменило нижнее меню — и вернуть заголовку ~40px.
7. **`apple-touch-startup-image`** (splash-экраны для iOS) — сейчас при
   запуске с домашнего экрана короткая белая вспышка.
8. **Проверка на реальном устройстве.** Всё, что сделано, проверено
   каскадом и dev-сервером, но не глазами на iPhone — в песочнице нет
   браузера (Chromium не ставится: закрыт доступ к CDN).

---

## 9. Как это проверялось

| Проверка | Команда | Результат |
|---|---|---|
| Типы | `npm run typecheck` (`tsc --noEmit`, TS 5.9.3) | **exit 0**, ошибок нет |
| Линт репозитория | `npm run lint` | 4 ошибки + 1 warning — **все до правок**, в `src/components/catalog/CatalogShopClient.tsx` и `MadeToOrderManagerClient.tsx` (этих файлов нет в диффе) |
| Линт изменённых файлов | `npx eslint src/hooks/use-is-mobile.ts src/components/admin/mobile src/components/pwa …` | **exit 0** |
| Каскад CSS на реальном DOM | jsdom + postcss, ширина 375px | см. таблицы выше |
| Покрытие модалки стилями | jsdom, 22 элемента | 8 → 22 элемента |
| Дым-тест страниц (dev-сервер) | `curl` с подписанной dev-сессией | `/`, `/admin`, `/orders`, `/products`, `/warehouse`, `/settings`, `/wastepaper-account`, `/client-requests`, `/reviews` → **все 200**; в логе только ожидаемые `fetch failed` к Supabase (БД в песочнице нет) |
| Компиляция нового компонента | `curl` CSS-чанка админки | `AdminBottomNav.module.css` собран и отдаётся: `.AdminBottomNav-module__nK7Chq__spacer`, `__nav` с `--nav-h: 58px` |
| PWA-ассеты | `curl` | `/sw.js` 200 `application/javascript`, `/admin-sw.js` 200, оба манифеста 200 `application/manifest+json` |
| Мета-теги PWA в отдаче | `curl /admin` + grep `<head>` | `viewport-fit=cover`, `theme-color`, `manifest`, `apple-mobile-web-app-capable: yes`, `apple-mobile-web-app-status-bar-style: black-translucent` — все на месте |

Что **не** проверялось: визуальный рендер и touch-скролл на живом
устройстве/эмуляторе — в песочнице недоступен headless-браузер
(Chromium не устанавливается: CDN `googlechromelabs.github.io` и
`cdn.playwright.dev` закрыты, системного браузера нет).
