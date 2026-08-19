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
import { CookieConsent } from "@/components/analytics/CookieConsent";
import { PhoneClickTracking } from "@/components/analytics/PhoneClickTracking";
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
import { adminThemeInitScript } from "@/lib/admin-theme";

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
  // Подтверждение прав на сайт в Яндекс.Вебмастере (мета-тег).
  // Файловый способ (public/yandex_a4c02cbb98296a7e.html) оставлен как запасной.
  verification: {
    yandex: "a4c02cbb98296a7e",
  },
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
     LCP на мобильных сетях).

     ВАЖНО: этот layout оборачивает ВЕСЬ сайт. Если Supabase недоступен,
     await здесь блокирует отрисовку любой страницы (пустой экран +
     бесконечная загрузка). Поэтому попапы ждём не дольше 3 секунд —
     дальше отдаём пустой список, а страница продолжает рендериться. */
  const popupPromise = getAllPopupCampaigns()
    .then(preparePublicCampaigns)
    .catch(() => [] as PublicPopupCampaign[]);
  const popupCampaigns = await Promise.race([
    popupPromise,
    new Promise<PublicPopupCampaign[]>((resolve) =>
      setTimeout(() => resolve([]), 3_000)
    ),
  ]);

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
        {/* Кастомизация админки: применяем сохранённые тему/раскладку/стиль
            до первой отрисовки (анти-FOUC). Список настроек и скрипт
            генерируются из единого источника — src/lib/admin-theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: adminThemeInitScript() }} />
      </head>
      <body>
        <CartProvider>
          <ConditionalChrome popupCampaigns={popupCampaigns}>
            {children}
          </ConditionalChrome>
        </CartProvider>
        <CookieConsent />
        <PhoneClickTracking />
      </body>
    </html>
  );
}
