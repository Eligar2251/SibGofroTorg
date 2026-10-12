// src/app/layout.tsx

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
// mobile.css идёт после globals.css: точечно перекрывает базовые стили.
import "./mobile.css";

import { CartProvider } from "@/context/CartContext";
import { ConditionalChrome } from "@/components/layout/ConditionalChrome";
import { getCategories } from "@/lib/supabase-queries";
import type { HeaderCategory } from "@/components/layout/Header";
import { CookieConsent } from "@/components/analytics/CookieConsent";
import { PhoneClickTracking } from "@/components/analytics/PhoneClickTracking";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegister";
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
import { cookieConsentInitScript } from "@/lib/cookie-consent";
import { localizeMediaDeep } from "@/lib/media";

// Шрифты Oswald/Inter/Montserrat — self-hosted (public/fonts/*.woff2,

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
    // Next 15+ понимает только mobile-web-app-capable, apple-версия — для iOS.
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
    popupCampaigns = preparePublicCampaigns(
      localizeMediaDeep(await getAllPopupCampaigns())
    );
  } catch {
    popupCampaigns = [];
  }

  // Категории меню шапки отдаём с сервера — без запроса после гидрации.
  let headerCategories: HeaderCategory[] = [];
  try {
    headerCategories = (await getCategories()).map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      icon: category.icon ?? "box",
    }));
  } catch {
    headerCategories = [];
  }

  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Ранние подключения источников (экономия на handshake/TLS).
            Внешних CDN здесь больше нет: изображения отдаются с нашего
            домена через /media/... (см. src/lib/media.ts), поэтому браузер
            посетителя не соединяется с зарубежными серверами. */}
        {/* Preload основных шрифтов (кириллица) — они критичны для LCP:
            файлы локальные (public/fonts), подключены через @font-face
            в src/app/fonts.css с font-display: swap. */}
        <link
          rel="preload"
          href="/fonts/inter-cyrillic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/oswald-cyrillic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/montserrat-cyrillic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <JsonLd
          data={[buildLocalBusinessJsonLd(), buildWebSiteJsonLd()]}
        />
        {/* Кастомизация админки: применяем сохранённые тему/раскладку/стиль
            до первой отрисовки (анти-FOUC). Список настроек и скрипт
            генерируются из единого источника — src/lib/admin-theme.ts. */}
        <script dangerouslySetInnerHTML={{ __html: adminThemeInitScript() }} />
        {/* Согласие на cookie: если посетитель уже нажал «Принять»/«Отклонить»,
            помечаем <html> атрибутом до первой отрисовки — CSS прячет баннер,
            и он не мигает при каждой загрузке страницы. */}
        <script dangerouslySetInnerHTML={{ __html: cookieConsentInitScript() }} />
      </head>
      <body>
        <CartProvider>
          <ConditionalChrome
            popupCampaigns={popupCampaigns}
            categories={headerCategories}
          >
            {children}
          </ConditionalChrome>
        </CartProvider>
        <CookieConsent />
        <PhoneClickTracking />
        {/* PWA: регистрируем /sw.js, чтобы браузер предложил установить
            сайт на домашний экран и открывал его без адресной строки.
            На страницах админки компонент ничего не делает — там свой
            worker (см. AdminShell и public/admin-sw.js). */}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
