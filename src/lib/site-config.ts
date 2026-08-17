// src/lib/site-config.ts — ПОЛНАЯ ЗАМЕНА
//
// Дефолтные значения ниже используются только как fallback, если в БД ещё
// не сохранены настройки (на свежей установке до первого захода в админку).
// После сохранения настроек через /[adminPath]/settings эти значения
// подхватываются через /api/settings/public и накладываются поверх дефолтов
// в клиентских компонентах (см. useSiteSettings()).
export const SITE_ADDRESS =
  process.env.NEXT_PUBLIC_COMPANY_ADDRESS ||
  "г. Новосибирск, ул. Ватутина, 42а к1";

/** Основной телефон компании (отдел продаж, шапка сайта и т. п.). */
export const SITE_PHONE =
  process.env.NEXT_PUBLIC_COMPANY_PHONE || "+7 (913) 915-81-46";

export const SITE_PHONE_HREF = `tel:${SITE_PHONE.replace(/[^\d+]/g, "")}`;

export const SITE_HOURS_WEEKDAY =
  process.env.NEXT_PUBLIC_COMPANY_HOURS_WEEKDAY || "8:30–17:00";

/** Работаем только Пн–Пт; Сб и Вс — выходные */
export const SITE_HOURS_WEEKEND = "выходные";

/** Единая фраза режима работы для всего сайта */
export const SITE_HOURS_LABEL = `Пн–Пт ${SITE_HOURS_WEEKDAY} · Сб, Вс — выходные`;

/** Email для связи (показывается в шапке, футере и на странице контактов). */
export const SITE_EMAIL =
  process.env.NEXT_PUBLIC_COMPANY_EMAIL || "sk2-tdstm@mail.ru";

// Точные координаты ул. Ватутина 42а к1, Новосибирск
// (можно уточнить через yandex.ru/maps — правая кнопка → «Что здесь?»)
const LAT = "54.965649";
const LNG = "82.926598";
const ADDRESS_ENCODED = encodeURIComponent("Новосибирск, ул. Ватутина, 42а к1");

// Виджет с меткой, балуном и нужным зумом
export const SITE_MAP_EMBED_URL =
  `https://yandex.ru/map-widget/v1/` +
  `?ll=${LNG}%2C${LAT}` +
  `&z=16` +
  `&pt=${LNG}%2C${LAT}%2Cpm2rdm` +
  `&text=${ADDRESS_ENCODED}` +
  `&l=map` +
  `&from=mapframe` +
  `&lang=ru_RU`;

export const SITE_MAP_LINK =
  `https://yandex.ru/maps/?ll=${LNG}%2C${LAT}` +
  `&z=16` +
  `&pt=${LNG}%2C${LAT}%2Cpm2rdm` +
  `&text=${ADDRESS_ENCODED}`;

// ── Реквизиты владельца сайта ────────────────────────────────
// Источник: ЕГРЮЛ / rusprofile (ООО «СИБГОФРОТОРГ»).
export const COMPANY_LEGAL_NAME = "ООО «СибГофроТорг»";
export const COMPANY_FULL_NAME =
  "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ «СИБГОФРОТОРГ»";
export const COMPANY_INN = "5403059052";
export const COMPANY_KPP = "540301001";
export const COMPANY_OGRN = "1205400033992";
export const COMPANY_LEGAL_ADDRESS =
  "630024, Новосибирская обл., г. Новосибирск, ул. Ватутина, зд. 42/2";
export const COMPANY_DIRECTOR = "Директор: Пакин Вадим Маркович";