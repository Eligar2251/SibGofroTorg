// =========================================================
// FILE: src/app/about/page.tsx
// =========================================================

import Link from "next/link";
import { Check, ShieldCheck, HeartHandshake, History } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import type { Metadata } from "next";
import { SITE_URL, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "О компании",
  description:
    "ООО «СибГофроТорг» — производство и продажа гофротары в Новосибирске с 2015 года. Оптовые цены от 1 шт., склад на ул. Ватутина.",
  alternates: { canonical: `${SITE_URL}/about` },
  openGraph: {
    title: `О компании — ${SITE_NAME}`,
    url: `${SITE_URL}/about`,
  },
};

export default function AboutPage() {
  return (
    <div className="about-page">
      {/* Breadcrumb */}
      <div className="about-page__breadcrumb-bar">
        <div className="container-wide about-page__breadcrumb-inner">
          <div className="about-page__breadcrumb">
            <Link href="/" className="about-page__breadcrumb-link">
              Главная
            </Link>
            <span>/</span>
            <span className="about-page__breadcrumb-current">О компании</span>
          </div>
        </div>
      </div>

      <div className="container-wide about-page__content">
        <div className="card-base about-card">
          <div className="about-grid">
            <div className="about-grid__text">
              <span className="about-badge"><GlyphIcon value="handshake" size={13} /> Более 8 лет на рынке</span>

              <h1 className="about-title">
                ООО «СибГофроТорг» — упаковка от производителя
              </h1>

              <p className="about-lead">
                С 2015 года мы обеспечиваем производственные предприятия,
                интернет-магазины и частных клиентов качественной гофротарой и
                упаковочными материалами в Новосибирске.
              </p>

              <p className="about-lead about-lead--tight">
                Главная особенность —{" "}
                <strong>оптовые цены доступны каждому</strong> без огромных
                партий. Коробки и скотч от 1 единицы со склада.
              </p>

              <div className="about-checklist">
                {[
                  "Оптовые цены от первой коробки",
                  "Изготовление тары по размерам заказчика",
                  "Бесплатная доставка при покупке от 15 000 ₽",
                ].map((t) => (
                  <div key={t} className="about-checklist__item">
                    <Check size={16} className="about-checklist__icon" />
                    {t}
                  </div>
                ))}
              </div>

              <div className="about-cta">
                <Link href="/catalog" className="btn-primary">
                  Перейти к покупкам
                </Link>
              </div>
            </div>

            <div className="about-grid__visual" aria-hidden>
              <GlyphIcon value="box" size={120} />
            </div>
          </div>

          <hr className="about-divider" />

          <div className="about-features">
            <div className="about-feature">
              <ShieldCheck size={28} className="about-feature__icon" />
              <div>
                <div className="about-feature__title">Стандарты качества</div>
                <p className="about-feature__text">
                  Продукция по ГОСТу, подходит для пищевых продуктов.
                </p>
              </div>
            </div>

            <div className="about-feature">
              <HeartHandshake size={28} className="about-feature__icon" />
              <div>
                <div className="about-feature__title">Надёжный партнёр</div>
                <p className="about-feature__text">
                  Договоры с юрлицами, закрывающие документы.
                </p>
              </div>
            </div>

            <div className="about-feature">
              <History size={28} className="about-feature__icon" />
              <div>
                <div className="about-feature__title">Постоянное наличие</div>
                <p className="about-feature__text">
                  Более 10 000 коробок на складе к отгрузке.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}