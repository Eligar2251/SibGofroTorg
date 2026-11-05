// =========================================================
// FILE: src/lib/cookie-consent.ts — согласие на использование cookie
// =========================================================
//
// Единый источник правды для cookie-баннера (152-ФЗ):
//  • ключ, под которым хранится решение пользователя;
//  • inline-скрипт, который отрабатывает ДО первой отрисовки:
//      1) помечает <html> атрибутом data-cookie-consent, если выбор уже сделан;
//      2) вешает мгновенный делегированный обработчик клика на кнопки
//         «Принять» и «Отклонить», чтобы кнопки срабатывали с первого клика
//         даже ДО завершения гидратации React или при медленной сети.

/** Ключ localStorage и технической cookie с решением пользователя (accepted | declined). */
export const COOKIE_CONSENT_STORAGE_KEY = "sibgofrotorg_cookie_consent";

/** Атрибут <html>, выставляемый до отрисовки при уже принятом решении. */
export const COOKIE_CONSENT_ATTR = "data-cookie-consent";

/** Пользовательское DOM-событие для синхронизации с React после гидратации. */
export const COOKIE_CONSENT_EVENT = "sgt-cookie-consent";
/** Open the existing choice without discarding consent until a new decision. */
export const COOKIE_SETTINGS_EVENT = "sgt-cookie-settings";

/** Страница с условиями использования cookie-файлов. */
export const COOKIE_POLICY_PATH = "/cookie-policy";

/** Страница политики конфиденциальности. */
export const PRIVACY_POLICY_PATH = "/privacy";

/**
 * Скрипт для <head>:
 * 1) читает сохранённый выбор из localStorage или cookie и ставит атрибут на <html>;
 * 2) обрабатывает клик по кнопкам `.cookie-banner__accept` / `.cookie-banner__decline`
 *    напрямую на уровне документа, не дожидаясь гидратации бандлов.
 */
export function cookieConsentInitScript(): string {
  const key = JSON.stringify(COOKIE_CONSENT_STORAGE_KEY);
  const attr = JSON.stringify(COOKIE_CONSENT_ATTR);
  const evt = JSON.stringify(COOKIE_CONSENT_EVENT);

  return (
    "(function(){try{" +
    "var K=" + key + ",A=" + attr + ",E=" + evt + ";" +
    "function readCookie(){" +
    "var m=document.cookie.match(new RegExp('(?:^|;\\\\s*)'+K+'=(accepted|declined)(?:;|$)'));" +
    "return m?m[1]:null;}" +
    "var v=null;try{v=localStorage.getItem(K);}catch(e){}" +
    "if(v!=='accepted'&&v!=='declined'){v=readCookie();}" +
    "if(v==='accepted'||v==='declined'){document.documentElement.setAttribute(A,v);}" +
    "document.addEventListener('click',function(ev){" +
    "var t=ev.target&&ev.target.closest?ev.target.closest('[data-cookie-action],.cookie-banner__accept,.cookie-banner__decline'):null;" +
    "if(!t)return;" +
    "var c=t.getAttribute('data-cookie-action')||(t.classList.contains('cookie-banner__accept')?'accepted':'declined');" +
    "try{localStorage.setItem(K,c);}catch(e){}" +
    "try{document.cookie=K+'='+c+'; Path=/; Max-Age=31536000; SameSite=Lax';}catch(e){}" +
    "document.documentElement.setAttribute(A,c);" +
    "if(document.body)document.body.classList.remove('cookie-banner-visible');" +
    "try{window.dispatchEvent(new CustomEvent(E,{detail:c}));}catch(e){}" +
    "},true);" +
    "}catch(e){}})();"
  );
}
