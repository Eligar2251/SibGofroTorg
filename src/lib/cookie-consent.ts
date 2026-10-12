// =========================================================
// FILE: src/lib/cookie-consent.ts — согласие на использование cookie
// =========================================================
//
// Единый источник правды для cookie-баннера (152-ФЗ):
//  • ключ, под которым хранится решение пользователя;
//  • inline-скрипт, который отрабатывает ДО первой отрисовки и помечает
//    <html> атрибутом data-cookie-consent, если выбор уже был сделан.
//
// Зачем атрибут: баннер теперь рендерится на сервере (см.
// CookieConsent.tsx) и присутствует в исходном HTML каждой страницы —
// иначе его не видят ни посетители без JS, ни сканеры соответствия
// 152-ФЗ/РКН, которые читают только HTML и не выполняют скрипты.
// Тем, кто уже нажал «Принять»/«Отклонить», баннер прячет CSS-правило
// (globals.css), поэтому он не мигает до гидратации React.

/** Ключ localStorage с решением пользователя (accepted | declined). */
export const COOKIE_CONSENT_STORAGE_KEY = "sibgofrotorg_cookie_consent";

/** Атрибут <html>, выставляемый до отрисовки при уже принятом решении. */
export const COOKIE_CONSENT_ATTR = "data-cookie-consent";

/** Страница с условиями использования cookie-файлов. */
export const COOKIE_POLICY_PATH = "/cookie-policy";

/** Страница политики конфиденциальности. */
export const PRIVACY_POLICY_PATH = "/privacy";

/**
 * Скрипт для <head>: если пользователь уже принял/отклонил cookie,
 * помечаем <html> — CSS спрячет баннер ещё до первой отрисовки,
 * и он не «мигнёт» при каждой загрузке страницы.
 */
export function cookieConsentInitScript(): string {
  return (
    "(function(){try{" +
    "var v=localStorage.getItem(" +
    JSON.stringify(COOKIE_CONSENT_STORAGE_KEY) +
    ");" +
    'if(v==="accepted"||v==="declined"){' +
    "document.documentElement.setAttribute(" +
    JSON.stringify(COOKIE_CONSENT_ATTR) +
    ",v);" +
    "}}catch(e){}})();"
  );
}
