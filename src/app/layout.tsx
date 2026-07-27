// src/app/layout.tsx

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

import { CartProvider } from "@/context/CartContext";
import { ConditionalChrome } from "@/components/layout/ConditionalChrome";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import { JsonLd } from "@/components/seo/JsonLd";
import { getAllPopupCampaigns } from "@/lib/supabase-queries";
import {
  preparePublicCampaigns,
  type PublicPopupCampaign,
} from "@/lib/popup-campaign";
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  buildLocalBusinessJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo";

const FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Inter:wght@400;500;600;700&family=Montserrat:wght@800;900&display=swap";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Гофротара и упаковка в Новосибирске`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Гофротара и упаковка в Новосибирске`,
    description: DEFAULT_DESCRIPTION,
  },
  keywords: [
    "гофротара Новосибирск",
    "картонные коробки купить",
    "гофрокоробки оптом",
    "упаковка Новосибирск",
    "СибГофроТорг",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b2b4b",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  /* Никаких headers()/cookies() здесь — иначе весь сайт становится
     динамическим и теряет ISR-кэширование страниц.
     Попапы читаются через unstable_cache (ISR-safe) и передаются в
     ConditionalChrome — так клиенту не нужен отдельный fetch /api/popups
     на каждой странице (минус один сетевой запрос из критического пути
     LCP на мобильных сетях). */
  let popupCampaigns: PublicPopupCampaign[] = [];
  try {
    popupCampaigns = preparePublicCampaigns(await getAllPopupCampaigns());
  } catch {
    popupCampaigns = [];
  }

  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <head>
        {/* Ранние подключения источников (экономия на handshake/TLS). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://res.cloudinary.com" />
        {/* Шрифты НЕ блокируют отрисовку: stylesheet вставляется
            динамически (async CSS), текст сразу показывается
            fallback-шрифтами, при загрузке — swap (display=swap).
            На медленных мобильных сетях это убирает ~1–2 c из FCP/LCP. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=document.createElement('link');l.rel='stylesheet';l.href='${FONTS_CSS_URL}';document.head.appendChild(l);}catch(e){}})();`,
          }}
        />
        <noscript>
          <link rel="stylesheet" href={FONTS_CSS_URL} />
        </noscript>
        <JsonLd
          data={[buildLocalBusinessJsonLd(), buildWebSiteJsonLd()]}
        />
      </head>
      <body>
        <CartProvider>
          <ConditionalChrome popupCampaigns={popupCampaigns}>
            {children}
          </ConditionalChrome>
        </CartProvider>
        <YandexMetrika />
      </body>
    </html>
  );
}
