// =========================================================
// FILE: src/app/contacts/page.tsx
// =========================================================

import Link from "next/link";
import { Phone, MapPin, Clock, Mail, ExternalLink } from "lucide-react";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_EMAIL,
  SITE_HOURS_WEEKDAY,
  SITE_HOURS_SATURDAY,
  SITE_MAP_EMBED_URL,
  SITE_MAP_LINK,
} from "@/lib/site-config";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildLocalBusinessJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Контакты — склад и офис в Новосибирске",
  description:
    "Адрес склада СибГофроТорг: Новосибирск, ул. Ватутина. Телефон, режим работы, схема проезда. Гофротара и упаковка.",
  alternates: { canonical: `${SITE_URL}/contacts` },
};

function ContactIcon({ children }: { children: React.ReactNode }) {
  return <div className="contacts-icon">{children}</div>;
}

export default function ContactsPage() {
  return (
    <div className="contacts-page">
      <JsonLd
        data={[
          buildLocalBusinessJsonLd(),
          buildBreadcrumbJsonLd([
            { name: "Главная", url: "/" },
            { name: "Контакты", url: "/contacts" },
          ]),
        ]}
      />

      {/* Breadcrumb */}
      <div className="contacts-page__breadcrumb-bar">
        <div className="container-wide contacts-page__breadcrumb-inner">
          <div className="contacts-page__breadcrumb">
            <Link href="/" className="contacts-page__breadcrumb-link">
              Главная
            </Link>
            <span>/</span>
            <span className="contacts-page__breadcrumb-current">Контакты</span>
          </div>
        </div>
      </div>

      <div className="container-wide contacts-page__content">
        <h1 className="contacts-page__title">Контактная информация</h1>

        <div className="contacts-layout">
          {/* Левая колонка — карточки */}
          <div className="contacts-layout__list">
            {/* Телефон */}
            <div className="card-base contacts-card">
              <ContactIcon>
                <Phone size={20} />
              </ContactIcon>
              <div>
                <div className="contacts-card__label">
                  Телефон отдела продаж
                </div>
                <a href={SITE_PHONE_HREF} className="contacts-card__phone">
                  {SITE_PHONE}
                </a>
                <div className="contacts-card__hint">
                  Принимаем звонки в рабочее время
                </div>
              </div>
            </div>

            {/* Адрес */}
            <div className="card-base contacts-card">
              <ContactIcon>
                <MapPin size={20} />
              </ContactIcon>
              <div>
                <div className="contacts-card__label">Адрес офиса и склада</div>
                <div className="contacts-card__value">{SITE_ADDRESS}</div>
              </div>
            </div>

            {/* Режим работы */}
            <div className="card-base contacts-card">
              <ContactIcon>
                <Clock size={20} />
              </ContactIcon>
              <div>
                <div className="contacts-card__label">Режим работы</div>
                <div className="contacts-card__value contacts-card__value--md">
                  Пн–Пт: {SITE_HOURS_WEEKDAY} · Сб: {SITE_HOURS_SATURDAY}
                </div>
                <div className="contacts-card__closed">
                  Воскресенье: выходной день
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="card-base contacts-card">
              <ContactIcon>
                <Mail size={20} />
              </ContactIcon>
              <div>
                <div className="contacts-card__label">Электронная почта</div>
                <a
                  href={`mailto:${SITE_EMAIL}`}
                  className="contacts-card__email"
                >
                  {SITE_EMAIL}
                </a>
              </div>
            </div>
          </div>

          {/* Правая колонка — карта */}
          <div className="card-base contacts-layout__map">
            <div className="contacts-map__header">
              <div className="contacts-map__title">
                📍 Склад-магазин на карте
              </div>
              <a
                href={SITE_MAP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="contacts-map__link"
              >
                Яндекс.Карты <ExternalLink size={12} />
              </a>
            </div>

            <div className="contacts-map__frame">
              <iframe
                src={SITE_MAP_EMBED_URL}
                title="Карта — СибГофроТорг"
                className="contacts-map__iframe" // или ваш класс
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
