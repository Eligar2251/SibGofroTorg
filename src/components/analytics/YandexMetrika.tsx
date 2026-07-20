import Script from "next/script";

const METRIKA_ID = process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

export function YandexMetrika() {
  if (!METRIKA_ID) return null;
  const id = METRIKA_ID.replace(/\D/g, "");
  if (!id) return null;

  return (
    <>
      {/* Инициализация вынесена во внешний same-origin script, поэтому строгий
          script-src больше не требует unsafe-inline. */}
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
  );
}
