// =========================================================
// FILE: src/app/layout.tsx
// =========================================================

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import "./mobile.css";
import { CartProvider } from "@/context/CartContext";
import { ConditionalChrome } from "@/components/layout/ConditionalChrome";
import { YandexMetrika } from "@/components/analytics/YandexMetrika";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  buildLocalBusinessJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo";

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
  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;

  return (
    <html lang="ru">
      <head>
        <JsonLd
          nonce={nonce}
          data={[buildLocalBusinessJsonLd(), buildWebSiteJsonLd()]}
        />
      </head>
      <body>
        <CartProvider>
          <ConditionalChrome>{children}</ConditionalChrome>
        </CartProvider>
        <YandexMetrika nonce={nonce} />
      </body>
    </html>
  );
}