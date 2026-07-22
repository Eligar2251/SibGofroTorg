// =========================================================
// FILE: src/lib/seo.ts
// =========================================================

import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_EMAIL,
  SITE_HOURS_WEEKDAY,
} from "@/lib/site-config";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://gofrotara.online";

export const SITE_NAME = "СибГофроТорг";
export const SITE_LEGAL_NAME = 'ООО «СибГофроТорг»';

export const DEFAULT_DESCRIPTION =
  "Гофротара и упаковка в Новосибирске: картонные коробки, стрейч-плёнка, скотч. Оптовые цены от 1 шт. Доставка по городу и области. Склад на ул. Ватутина.";

/** LocalBusiness + Organization для главной / contacts / layout */
export function buildLocalBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    legalName: SITE_LEGAL_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.ico`,
    image: `${SITE_URL}/favicon.ico`,
    description: DEFAULT_DESCRIPTION,
    telephone: SITE_PHONE,
    email: SITE_EMAIL,
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE_ADDRESS.replace(/^г\.\s*Новосибирск,?\s*/i, ""),
      addressLocality: "Новосибирск",
      addressRegion: "Новосибирская область",
      postalCode: "630000",
      addressCountry: "RU",
    },
    geo: {
      "@type": "GeoCoordinates",
      // при необходимости уточните координаты склада
      latitude: 54.9833,
      longitude: 82.8964,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: SITE_HOURS_WEEKDAY.split("–")[0]?.trim() || "8:30",
        closes:
          SITE_HOURS_WEEKDAY.split("–")[1]?.trim() ||
          SITE_HOURS_WEEKDAY.split("-")[1]?.trim() ||
          "17:00",
      },
    ],
    areaServed: [
      { "@type": "City", name: "Новосибирск" },
      { "@type": "AdministrativeArea", name: "Новосибирская область" },
    ],
    priceRange: "₽₽",
    currenciesAccepted: "RUB",
    paymentAccepted: "Cash, Bank Transfer, Invoice",
  };
}

export function buildWebSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "ru-RU",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function buildBreadcrumbJsonLd(
  items: { name: string; url: string }[]
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildProductJsonLd(product: {
  name: string;
  slug: string;
  description?: string | null;
  sku?: string | null;
  price: number | null;
  imageUrl?: string | null;
  inStock?: boolean;
}) {
  const url = `${SITE_URL}/catalog/product/${product.slug}`;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description:
      product.description ||
      `${product.name} — купить в Новосибирске в ${SITE_NAME}`,
    sku: product.sku || undefined,
    image: product.imageUrl || undefined,
    url,
    brand: {
      "@type": "Brand",
      name: SITE_NAME,
    },
  };

  if (product.price != null && product.price > 0) {
    data.offers = {
      "@type": "Offer",
      url,
      priceCurrency: "RUB",
      price: product.price,
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/PreOrder",
      seller: {
        "@type": "Organization",
        name: SITE_NAME,
      },
      areaServed: {
        "@type": "City",
        name: "Новосибирск",
      },
    };
  }

  return data;
}

/** Безопасный JSON для <script type="application/ld+json"> */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}