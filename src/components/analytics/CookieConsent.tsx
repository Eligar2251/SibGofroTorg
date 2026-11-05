"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { Cookie } from "lucide-react";
import {
  COOKIE_CONSENT_ATTR,
  COOKIE_CONSENT_EVENT,
  COOKIE_SETTINGS_EVENT,
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_POLICY_PATH,
  PRIVACY_POLICY_PATH,
} from "@/lib/cookie-consent";
import { CLIENT_ADMIN_PATH } from "@/lib/admin-path-client";

const METRIKA_ID = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

type ConsentState = "accepted" | "declined" | null;

function readStoredConsent(): ConsentState {
  try {
    const attrVal = document.documentElement.getAttribute(COOKIE_CONSENT_ATTR);
    if (attrVal === "accepted" || attrVal === "declined") return attrVal;
  } catch {
    /* ignore */
  }
  try {
    const stored = localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (stored === "accepted" || stored === "declined") return stored;
  } catch {
    /* ignore */
  }
  try {
    const m = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${COOKIE_CONSENT_STORAGE_KEY}=(accepted|declined)(?:;|$)`)
    );
    if (m?.[1] === "accepted" || m?.[1] === "declined") return m[1];
  } catch {
    /* ignore */
  }
  return null;
}

export function CookieConsent({ adminPath }: { adminPath?: string }) {
  const pathname = usePathname() || "";
  const effectiveAdminPath = adminPath || CLIENT_ADMIN_PATH;
  const isAdminRoute =
    pathname === `/${effectiveAdminPath}` ||
    pathname.startsWith(`/${effectiveAdminPath}/`);

  const [consent, setConsent] = useState<ConsentState>(null);
  const [hydrated, setHydrated] = useState(false);
  const [review, setReview] = useState(false);

  useEffect(() => {
    setConsent(readStoredConsent());
    setHydrated(true);

    const onInlineDecision = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (detail === "accepted" || detail === "declined") {
        setConsent(detail);
        setReview(false);
      } else {
        setConsent(readStoredConsent());
      }
    };
    const openSettings = () => setReview(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, openSettings);
    window.addEventListener(COOKIE_CONSENT_EVENT, onInlineDecision);
    return () => {
      window.removeEventListener(COOKIE_SETTINGS_EVENT, openSettings);
      window.removeEventListener(COOKIE_CONSENT_EVENT, onInlineDecision);
    };
  }, []);

  // На страницах админки (включая форму входа) клиентский cookie-баннер не показываем.
  const bannerVisible = !isAdminRoute && (!hydrated || consent === null || review);

  useEffect(() => {
    if (!bannerVisible) return;
    if (!review && document.documentElement.hasAttribute(COOKIE_CONSENT_ATTR)) return;
    document.body.classList.add("cookie-banner-visible");
    return () => {
      document.body.classList.remove("cookie-banner-visible");
    };
  }, [bannerVisible, review]);

  function decide(value: "accepted" | "declined") {
    try {
      localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    try {
      document.cookie = `${COOKIE_CONSENT_STORAGE_KEY}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      /* ignore */
    }
    try {
      document.documentElement.setAttribute(COOKIE_CONSENT_ATTR, value);
      document.body.classList.remove("cookie-banner-visible");
    } catch {
      /* ignore */
    }
    setConsent(value);
    setReview(false);
    // An already loaded analytics script cannot be reliably unloaded in-place.
    // Reload after revocation so it is not loaded again without consent.
    if (consent === "accepted" && value === "declined") window.location.reload();
  }

  const id = METRIKA_ID ? METRIKA_ID.replace(/\D/g, "") : "";

  return (
    <>
      {/* Метрика загружается ТОЛЬКО после явного согласия и только вне админки */}
      {!isAdminRoute && consent === "accepted" && id && (
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
          data-review={review ? "true" : undefined}
          role="dialog"
          aria-live="polite"
          aria-label="Согласие на использование cookie"
          style={{ pointerEvents: "auto" }}
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

            <div className="cookie-banner__actions" style={{ pointerEvents: "auto" }}>
              <button
                type="button"
                data-cookie-action="declined"
                className="cookie-banner__decline"
                onClick={() => decide("declined")}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
              >
                Отклонить
              </button>
              <button
                type="button"
                data-cookie-action="accepted"
                className="cookie-banner__accept"
                onClick={() => decide("accepted")}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
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
