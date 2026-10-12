// =========================================================
// FILE: src/components/seo/LandingSections.tsx
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

/** `headingClassName` — чтобы блок вписывался в типографику страницы:
 *  на посадочных это `.seo-block h2`, на страницах со `.seo-home*`
 *  передаём `.seo-home__h3`. По умолчанию — как было. */
export function LandingFaq({
  title,
  items,
  headingClassName,
}: {
  title: string;
  items: FaqItem[];
  headingClassName?: string;
}) {
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
        {headingClassName ? (
          <h2 className={headingClassName}>{title}</h2>
        ) : (
          <h2>{title}</h2>
        )}
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
    <section className="seo-landing-products" aria-label={title}>
      <header className="seo-landing-products__head">
        <h2 className="seo-landing-products__title">{title}</h2>
        {note ? <p className="seo-landing-products__note">{note}</p> : null}
      </header>
      <div className="seo-landing-products__grid">
        {products.map((p) => (
          <ProductCardCompact key={p.id} product={p} />
        ))}
      </div>
      <Link href="/catalog" className="seo-landing-products__all">
        Смотреть весь каталог <ArrowRight size={14} />
      </Link>
    </section>
  );
}

/* ── Блок внутренних ссылок (перелинковка с каталогом) ── */

export function LandingLinks({
  title,
  links,
  headingClassName = "seo-block__title",
}: {
  title: string;
  links: { href: string; label: string }[];
  headingClassName?: string;
}) {
  return (
    <div className="seo-landing-links">
      <h2 className={headingClassName}>{title}</h2>
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
