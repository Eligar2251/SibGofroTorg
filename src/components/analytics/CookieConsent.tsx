"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";

const CONSENT_KEY = "sibgofrotorg_cookie_consent";
const METRIKA_ID = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

type ConsentState = "accepted" | "declined" | null;

/**
 * Cookie-баннер (152-ФЗ): трекеры (Яндекс.Метрика) не загружаются до тех
 * пор, пока пользователь не нажал «Принять». Решение сохраняется в
 * localStorage и действует при следующих визитах.
 *
 * Заодно этот компонент заменяет прежний <YandexMetrika /> в layout:
 * скрипт Метрики монтируется только после согласия.
 */
export function CookieConsent() {
  const [consent, setConsent] = useState<ConsentState>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let value: ConsentState = null;
    try {
      const stored = localStorage.getItem(CONSENT_KEY);
      if (stored === "accepted") value = "accepted";
      else if (stored === "declined") value = "declined";
    } catch {
      /* localStorage недоступен — показываем баннер как есть */
    }
    setConsent(value);
    setMounted(true);
  }, []);

  function decide(value: "accepted" | "declined") {
    try {
      localStorage.setItem(CONSENT_KEY, value);
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

      {mounted && consent === null && (
        <div className="cookie-banner" role="dialog" aria-live="polite" aria-label="Согласие на использование cookie">
          <div className="cookie-banner__inner">
            <div className="cookie-banner__text">
              Мы используем файлы cookie и сервис веб-аналитики Яндекс.Метрика,
              чтобы делать сайт удобнее. Продолжая пользоваться сайтом или
              нажимая «Принять», вы соглашаетесь с{" "}
              <Link href="/privacy" target="_blank">
                политикой конфиденциальности
              </Link>
              .
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
