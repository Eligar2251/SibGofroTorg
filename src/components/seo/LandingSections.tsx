// =========================================================
// FILE: src/components/seo/LandingSections.tsx
// Общие блоки SEO-посадочных страниц (переезд, маркетплейсы,
// гофротара, коробки на заказ): FAQ с разметкой FAQPage,
// сетка товаров, «полезные ссылки», CTA с телефоном.
// Стили — общие (.seo-block* из src/app/seo-blocks.css и
// .product-grid-compact из globals.css), ничего нового не тянем.
// =========================================================

import Link from "next/link";
import { Phone, ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  ProductCardCompact,
} from "@/components/catalog/ProductCardCompact";
import type { FirestoreProduct } from "@/lib/types";
import {
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_ADDRESS,
  SITE_HOURS_LABEL,
} from "@/lib/site-config";

/* ── FAQ + FAQPage JSON-LD (расширенный сниппет в Яндексе/Google) ── */

export type FaqItem = { q: string; a: string };

export function LandingFaq({ title, items }: { title: string; items: FaqItem[] }) {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <JsonLd data={faqLd} />
      <div className="seo-faq">
        <h2>{title}</h2>
        {items.map((item) => (
          <details key={item.q} className="seo-faq__item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </>
  );
}

/* ── Сетка реальных товаров (карточки с ценой и кнопкой заказа) ── */

export function LandingProducts({
  title,
  note,
  products,
}: {
  title: string;
  note?: string;
  products: FirestoreProduct[];
}) {
  if (!products.length) return null;
  return (
    <div className="seo-landing-products">
      <h2 className="seo-block__title">{title}</h2>
      {note ? <p className="seo-block__intro">{note}</p> : null}
      <div className="product-grid product-grid-compact">
        {products.map((p) => (
          <ProductCardCompact key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}

/* ── Блок внутренних ссылок (перелинковка с каталогом) ── */

export function LandingLinks({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="seo-landing-links">
      <h2 className="seo-block__title">{title}</h2>
      <div className="seo-block__links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="seo-block__link">
            {l.label}
          </Link>
        ))}
        <Link href="/catalog" className="seo-block__link">
          Весь каталог <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ── CTA с телефоном (единый вид с SEO-блоком главной) ── */

export function LandingCta({ text }: { text: string }) {
  return (
    <div className="seo-block__cta">
      <div className="seo-block__cta-text">
        {text}
        <span>
          {SITE_HOURS_LABEL} · {SITE_ADDRESS}
        </span>
      </div>
      <a href={SITE_PHONE_HREF} className="seo-block__cta-phone">
        <Phone size={18} /> {SITE_PHONE}
      </a>
    </div>
  );
}
