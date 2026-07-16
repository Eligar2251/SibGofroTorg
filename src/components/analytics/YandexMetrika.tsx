// =========================================================
// FILE: src/components/analytics/YandexMetrika.tsx
// Срабатывает только если NEXT_PUBLIC_YANDEX_METRIKA_ID задан
// =========================================================

import Script from "next/script";

const METRIKA_ID = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

export function YandexMetrika() {
  if (!METRIKA_ID) return null;

  const id = METRIKA_ID.replace(/\D/g, "");
  if (!id) return null;

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">{`
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
m[i].l=1*new Date();
for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
ym(${id}, "init", {
  clickmap: true,
  trackLinks: true,
  accurateTrackBounce: true,
  webvisor: true,
  ecommerce: "dataLayer"
});
window.dataLayer = window.dataLayer || [];
      `}</Script>
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
  );
}

/** Клиентские хелперы целей (вызывать из "use client") */
export const YM_GOALS = {
  orderSuccess: "order_success",
  inquirySubmit: "inquiry_submit",
  wastepaperSubmit: "wastepaper_submit",
  addToCart: "add_to_cart",
  clickPhone: "click_phone",
} as const;

declare global {
  interface Window {
    ym?: (...args: unknown[]) => void;
    dataLayer?: Record<string, unknown>[];
  }
}