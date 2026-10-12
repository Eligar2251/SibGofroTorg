"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { Cookie } from "lucide-react";
import {
  COOKIE_CONSENT_ATTR,
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_POLICY_PATH,
  PRIVACY_POLICY_PATH,
} from "@/lib/cookie-consent";

const METRIKA_ID = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

type ConsentState = "accepted" | "declined" | null;

/**
 * Cookie-баннер (152-ФЗ): трекеры (Яндекс.Метрика) не загружаются до тех
 * пор, пока пользователь не нажал «Принять». Решение сохраняется в
 * localStorage и действует при следующих визитах.
 *
 * ★ Баннер рендерится на сервере и присутствует в исходном HTML каждой
 *   страницы. Раньше он появлялся только после гидратации (`mounted`),
 *   и в HTML не было ни баннера, ни ссылки на политику cookie — из-за
 *   этого сканеры соответствия 152-ФЗ (SaitScan и аналоги) сообщали
 *   «Ссылка на политику использования cookie не найдена ни в баннере,
 *   ни на странице»: они не выполняют JS и видят только HTML.
 *
 *   Тем, кто уже сделал выбор, баннер не показываем: решение подхватывается
 *   из localStorage после гидратации, а до неё баннер прячет CSS по
 *   атрибуту data-cookie-consent на <html> (см. cookieConsentInitScript).
 */
export function CookieConsent() {
  const [consent, setConsent] = useState<ConsentState>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let value: ConsentState = null;
    try {
      const stored = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
      if (stored === "accepted") value = "accepted";
      else if (stored === "declined") value = "declined";
    } catch {
      /* localStorage недоступен — показываем баннер как есть */
    }
    setConsent(value);
    setHydrated(true);
  }, []);

  // До гидратации считаем баннер видимым — так разметка сервера и клиента
  // совпадают (иначе React ругается на hydration mismatch).
  const bannerVisible = !hydrated || consent === null;

  // Пока баннер висит, плавающую корзину (и попап над ней) поднимаем
  // выше него — иначе баннер их перекрывает (жалоба тестировки).
  useEffect(() => {
    if (!bannerVisible) return;
    // Решение уже принято (скрипт в <head> выставил атрибут) — баннер скрыт
    // правилом CSS, поэтому плавающую корзину не поднимаем: иначе она
    // дёрнется вверх и тут же вернётся на место после гидратации.
    if (document.documentElement.hasAttribute(COOKIE_CONSENT_ATTR)) return;
    document.body.classList.add("cookie-banner-visible");
    return () => {
      document.body.classList.remove("cookie-banner-visible");
    };
  }, [bannerVisible]);

  function decide(value: "accepted" | "declined") {
    try {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    try {
      document.documentElement.setAttribute(COOKIE_CONSENT_ATTR, value);
    } catch {
      /* ignore */
    }
    setConsent(value);
  }

  const id = METRIKA_ID ? METRIKA_ID.replace(/\D/g, "") : "";

  return (
    <>
      {/* Метрика загружается ТОЛЬКО после явного согласия */}
      {consent === "accepted" && id && (
        <>
          <Script
            id="yandex-metrika"
            src={`/api/analytics/yandex?id=${id}`}
            strategy="afterInteractive"
          />
          <noscript>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://mc.yandex.ru/watch/${id}`}
                style={{ position: "absolute", left: "-9999px" }}
                alt=""
              />
            </div>
          </noscript>
        </>
      )}

      {bannerVisible && (
        <div
          className="cookie-banner"
          role="dialog"
          aria-live="polite"
          aria-label="Согласие на использование cookie"
        >
          <div className="cookie-banner__inner">
            <div className="cookie-banner__icon" aria-hidden="true">
              <Cookie size={22} />
            </div>

            <div className="cookie-banner__body">
              <div className="cookie-banner__title">Мы используем cookies</div>
              <p className="cookie-banner__text">
                Cookie нужны для работы корзины и личного кабинета;
                веб-аналитика Яндекс.Метрики включается только после вашего
                согласия. Нажимая «Принять», вы соглашаетесь с{" "}
                <Link href={PRIVACY_POLICY_PATH} className="cookie-banner__link">
                  политикой конфиденциальности
                </Link>{" "}
                и{" "}
                <Link href={COOKIE_POLICY_PATH} className="cookie-banner__link">
                  условиями использования cookie-файлов
                </Link>
                .
              </p>
            </div>

            <div className="cookie-banner__actions">
              <button
                type="button"
                className="cookie-banner__decline"
                onClick={() => decide("declined")}
              >
                Отклонить
              </button>
              <button
                type="button"
                className="cookie-banner__accept"
                onClick={() => decide("accepted")}
              >
                Принять
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
