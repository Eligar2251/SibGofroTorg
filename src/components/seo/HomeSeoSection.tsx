// =========================================================
// FILE: src/components/seo/HomeSeoSection.tsx
// SEO-текстовый блок главной страницы с ключевыми запросами
// («гофротара», «купить гофротару», «купить картонные коробки»,
// «гофротара в Новосибирске») + внутренние ссылки на категории
// каталога и разметка FAQPage для расширенных сниппетов.
//
// Оформление — структурированный «посадочный» блок (.seo-home*):
// заголовок с фактами, ассортимент + каталог в две колонки,
// карточки «покупка» и «доставка», FAQ-аккордеон и CTA.
// =========================================================

import Link from "next/link";
import {
  Phone,
  ArrowRight,
  MapPin,
  Clock,
  Check,
  Package,
  Layers,
  Wallet,
  Truck,
} from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { GlyphIcon } from "@/components/ui/Glyph";
import { SITE_NAME } from "@/lib/seo";
import {
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_ADDRESS,
  SITE_HOURS_LABEL,
} from "@/lib/site-config";

type SeoCategory = { name: string; slug: string; icon?: string | null };

const FAQ = [
  {
    q: "Можно ли купить гофротару от 1 штуки?",
    a: "Да. Минимальный заказ на сайте — 1 шт. Большинство ходовых коробок (Т-22, Т-23, Т-24, 3- и 5-слойные) есть в наличии на складе в Новосибирске.",
  },
  {
    q: "Какие картонные коробки есть в наличии в Новосибирске?",
    a: "В каталоге представлены картонные коробки Т-22, Т-23, Т-24 и других типоразмеров, а также 3-слойный и 5-слойный гофрокартон. Нестандартные размеры изготавливаем под заказ.",
  },
  {
    q: "Есть ли доставка гофротары по Новосибирску и области?",
    a: `Да, осуществляем доставку по Новосибирску (обычно 2-3 дня) и по Новосибирской области. При заказе от определённой суммы доставка по городу — бесплатно. Возможен самовывоз со склада: ${SITE_ADDRESS}.`,
  },
  {
    q: "Как быстро оформить покупку гофротары?",
    a: `Добавьте нужные коробки в корзину и оформите заказ на сайте — сразу получите номер получения. Приезжайте на склад в часы работы (${SITE_HOURS_LABEL}) и заберите товар, оплатив при получении.`,
  },
];

/** Позиции ассортимента — для блока «что можно купить». */
const ASSORTMENT = [
  "Коробки Т-22",
  "Коробки Т-23",
  "Коробки Т-24",
  "3-слойный гофрокартон",
  "5-слойный гофрокартон",
  "Стрейч-плёнка",
  "Скотч",
];

/** Быстрые факты — короткая выжимка условий покупки. */
const FACTS = [
  {
    icon: Package,
    title: "От 1 штуки",
    text: "минимальный заказ без лишних условий",
  },
  {
    icon: Wallet,
    title: "Оплата при получении",
    text: "на складе или при доставке",
  },
  {
    icon: Layers,
    title: "3- и 5-слойный",
    text: "гофрокартон основных типоразмеров",
  },
  {
    icon: Truck,
    title: "Доставка 2–3 дня",
    text: "по Новосибирску и области, есть самовывоз",
  },
];

export function HomeSeoSection({
  categories,
}: {
  categories: SeoCategory[];
}) {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <>
      <JsonLd data={faqLd} />

      <section
        className="seo-home"
        aria-label="Гофротара и картонные коробки в Новосибирске"
      >
        <div className="seo-home__inner">
          {/* ── Заголовок ── */}
          <header className="seo-home__head">
            <span className="seo-home__eyebrow">
              Производство и продажа гофротары
            </span>
            <h2 className="seo-home__title">
              Гофротара и картонные коробки{" "}
              <span>в Новосибирске</span> — купить от 1 штуки
            </h2>
            <p className="seo-home__intro">
              {SITE_NAME} — производство и продажа гофротары в Новосибирске.
              У нас можно купить картонные коробки, гофрокоробки и
              упаковочные материалы со склада на ул. Ватутина. Работаем с
              физическими и юридическими лицами, доставляем по городу и
              области.
            </p>
          </header>

          {/* ── Быстрые факты ── */}
          <div className="seo-home__facts">
            {FACTS.map((f) => (
              <div key={f.title} className="seo-home__fact">
                <span className="seo-home__fact-icon">
                  <f.icon size={18} />
                </span>
                <div>
                  <strong>{f.title}</strong>
                  <span>{f.text}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── Ассортимент + Каталог ── */}
          <div className="seo-home__grid">
            <div className="seo-home__panel">
              <h3 className="seo-home__h3">
                Гофротара в Новосибирске — что можно купить
              </h3>
              <p className="seo-home__p">
                Ассортимент — это гофротара основных типоразмеров: коробки
                Т-22, Т-23, Т-24, 3-слойный и 5-слойный гофрокартон, а также
                упаковочные материалы — стрейч-плёнка и скотч. Все позиции
                доступны к заказу от одной штуки, поэтому купить гофротару
                можно и для одной отправки, и под регулярные поставки.
              </p>
              <ul className="seo-home__assort">
                {ASSORTMENT.map((item) => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="seo-home__panel">
              <h3 className="seo-home__h3">Каталог гофротары</h3>
              <div className="seo-home__cats">
                {categories.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/catalog/${c.slug}`}
                    className="seo-home__cat"
                  >
                    <span className="seo-home__cat-icon">
                      <GlyphIcon value={c.icon ?? "box"} size={18} />
                    </span>
                    <span className="seo-home__cat-name">{c.name}</span>
                    <ArrowRight size={13} className="seo-home__cat-arrow" />
                  </Link>
                ))}
              </div>
              <div className="seo-home__more">
                <Link href="/gofrotara">Гофротара</Link>
                <Link href="/korobki-dlya-pereezda">Коробки для переезда</Link>
                <Link href="/korobki-dlya-marketplejsov">
                  Коробки для WB и Ozon
                </Link>
                <Link href="/korobki-na-zakaz">Коробки на заказ</Link>
                <Link href="/catalog" className="seo-home__more-all">
                  Весь каталог <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          </div>

          {/* ── Покупка + Доставка ── */}
          <div className="seo-home__cards">
            <article className="seo-home__card">
              <h3 className="seo-home__h3">
                Купить картонные коробки
              </h3>
              <p className="seo-home__p">
                Если вам нужны{" "}
                <Link href="/korobki-dlya-pereezda">
                  картонные коробки для переезда
                </Link>
                , хранения или упаковки товара — выберите подходящий размер в{" "}
                <Link href="/catalog">каталоге гофротары</Link>. Для типовых
                коробок минимальный заказ — 1 шт. Нестандартные размеры и 3-
                или 5-слойные коробки{" "}
                <Link href="/korobki-na-zakaz">изготовим под заказ</Link>. Для
                поставщиков маркетплейсов есть отдельный подбор{" "}
                <Link href="/korobki-dlya-marketplejsov">
                  коробок для WB и Ozon
                </Link>
                .
              </p>
            </article>

            <article className="seo-home__card">
              <h3 className="seo-home__h3">
                Доставка гофротары по Новосибирску и области
              </h3>
              <p className="seo-home__p">
                Берем на себя логистику: доставляем гофротару по{" "}
                <Link href="/delivery">Новосибирску и Новосибирской области</Link>
                , а также предлагаем самовывоз со склада. Для заказов с
                предоплатой бронируем товар без ожидания — оплата при получении.
                Подробные условия — на странице{" "}
                <Link href="/delivery">доставки и оплаты</Link>.
              </p>
            </article>
          </div>

          {/* ── FAQ ── */}
          <div className="seo-home__faq">
            <h3 className="seo-home__h3">
              Частые вопросы о покупке гофротары
            </h3>
            {FAQ.map((item) => (
              <details key={item.q} className="seo-home__faq-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>

          {/* ── CTA ── */}
          <div className="seo-home__cta">
            <div className="seo-home__cta-body">
              <div className="seo-home__cta-title">
                Подберём коробки под ваш товар и рассчитаем стоимость
              </div>
              <div className="seo-home__cta-meta">
                <span>
                  <Clock size={14} /> {SITE_HOURS_LABEL}
                </span>
                <span>
                  <MapPin size={14} /> {SITE_ADDRESS}
                </span>
              </div>
            </div>
            <a href={SITE_PHONE_HREF} className="seo-home__cta-phone">
              <Phone size={18} /> {SITE_PHONE}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
