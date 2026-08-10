// src/app/layout.tsx

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
// Адаптивный слой подключается после базовых стилей. Раньше mobile.css
// импортировался в начале globals.css, поэтому последующие desktop-правила
// перекрывали мобильную сетку и растягивали карточки на всю ширину.
import "./mobile.css";

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
  // PWA: манифест + иконки домашнего экрана.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    // ★ Полноэкранный режим на iOS: сайт, добавленный на домашний экран,
    //   открывается без адресной строки и панели навигации.
    capable: true,
    title: SITE_NAME,
    // Статусбар прозрачный — контент уходит под «чёлку», а отступы за нас
    // добирает viewport-fit=cover + env(safe-area-inset-*) в CSS.
    statusBarStyle: "black-translucent",
  },
  other: {
    // Next.js 15+ вместо apple-mobile-web-app-capable выводит только
    // современный mobile-web-app-capable (vercel/next.js#70272). Актуальные
    // iOS читают display:"standalone" из манифеста, но версии до 16.4 —
    // только этот тег, поэтому дублируем его вручную. Без него сайт
    // открывается с домашнего экрана обычной вкладкой Safari.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1b2b4b",
  // viewport-fit=cover обязателен для black-translucent: без него iOS
  // оставляет белые полосы сверху/снизу вместо полноэкранной отрисовки.
  viewportFit: "cover",
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
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Ранние подключения источников (экономия на handshake/TLS). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://res.cloudinary.com" />
        <link rel="stylesheet" href={FONTS_CSS_URL} />
        <JsonLd
          data={[buildLocalBusinessJsonLd(), buildWebSiteJsonLd()]}
        />
        <script dangerouslySetInnerHTML={{ __html: `try{var k="adm-theme",v=localStorage.getItem(k)||"standard";var ok=["standard","light","dark","superdark","forest","ocean"].indexOf(v)>=0?v:"standard";var kl="adm-layout",vl=localStorage.getItem(kl)||"sidebar-left";var okl=["sidebar-left","sidebar-right","sidebar-top"].indexOf(vl)>=0?vl:"sidebar-left";var ks="adm-style",vs=localStorage.getItem(ks)||"classic";var oks=["classic","neo","retro","cyberpunk"].indexOf(vs)>=0?vs:"classic";document.documentElement.setAttribute("data-admin-theme",ok);document.documentElement.setAttribute("data-admin-layout",okl);document.documentElement.setAttribute("data-admin-style",oks);}catch(e){}` }} />
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
