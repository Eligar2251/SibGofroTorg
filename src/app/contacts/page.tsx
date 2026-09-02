// =========================================================
// FILE: src/app/contacts/page.tsx
// =========================================================

import Link from "next/link";
import { Phone, MapPin, Clock, Mail, ExternalLink } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_EMAIL,
  SITE_HOURS_WEEKDAY,
  SITE_MAP_EMBED_URL,
  SITE_MAP_LINK,
} from "@/lib/site-config";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { YandexMapEmbed } from "@/components/layout/YandexMapEmbed";
import { buildLocalBusinessJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo";
import { getSettings } from "@/lib/supabase-queries";
import { buildWeekdayLabel } from "@/lib/hours-label";
import { getWastepaperPageConfig } from "@/lib/wastepaper";
import { Recycle } from "lucide-react";

export const metadata: Metadata = {
  title: "Контакты — склад и офис в Новосибирске",
  description:
    "Адрес склада СибГофроТорг: Новосибирск, ул. Ватутина. Телефон, режим работы, схема проезда. Гофротара и упаковка.",
  alternates: { canonical: `${SITE_URL}/contacts` },
};

function ContactIcon({ children }: { children: React.ReactNode }) {
  return <div className="contacts-icon">{children}</div>;
}

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  // Подхватываем настройки из БД (админка «Настройки → Контактная информация»)
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const contactsPhone = (settings.phone || SITE_PHONE || "").trim();
  const contactsPhoneHref =
    `tel:${contactsPhone.replace(/[^\d+]/g, "")}` || SITE_PHONE_HREF;
  const contactsEmail = (settings.email || SITE_EMAIL || "").trim();
  const contactsAddress = (settings.address || SITE_ADDRESS || "").trim();
  const contactsWeekday = buildWeekdayLabel(
    settings.working_hours,
    SITE_HOURS_WEEKDAY
  );
  // Отдельный номер отдела приёма макулатуры — с явной подписью,
  // чтобы посетители не путали его с телефоном отдела продаж.
  const wpCfg = getWastepaperPageConfig(settings);

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
                <a href={contactsPhoneHref} className="contacts-card__phone">
                  {contactsPhone}
                </a>
                <div className="contacts-card__hint">
                  Заказ гофротары и упаковки · принимаем звонки в рабочее время
                </div>
              </div>
            </div>

            {/* Телефон приёма макулатуры */}
            <div className="card-base contacts-card">
              <ContactIcon>
                <Recycle size={20} />
              </ContactIcon>
              <div>
                <div className="contacts-card__label">
                  Приём макулатуры
                </div>
                <a href={wpCfg.phoneHref} className="contacts-card__phone">
                  {wpCfg.phone}
                </a>
                <div className="contacts-card__hint">
                  Сдать картон и бумагу · вывоз от {wpCfg.pickupMinKg} кг ·{" "}
                  <Link
                    href="/wastepaper"
                    style={{ color: "var(--green)", textDecoration: "underline" }}
                  >
                    цены и калькулятор
                  </Link>
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
                <div className="contacts-card__value">{contactsAddress}</div>
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
                  {contactsWeekday}
                </div>
                <div className="contacts-card__closed">
                  Сб, Вс: выходные дни
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
                  href={`mailto:${contactsEmail}`}
                  className="contacts-card__email"
                >
                  {contactsEmail}
                </a>
              </div>
            </div>
          </div>

          {/* Правая колонка — карта */}
          <div className="card-base contacts-layout__map">
            <div className="contacts-map__header">
              <div className="contacts-map__title">
                <GlyphIcon value="pin" size={16} /> Склад-магазин на карте
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
              <YandexMapEmbed
                src={SITE_MAP_EMBED_URL}
                title="Карта — СибГофроТорг"
                address={contactsAddress}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
