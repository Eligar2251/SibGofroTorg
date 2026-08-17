// =========================================================
// FILE: src/components/layout/Footer.tsx
// =========================================================

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_HOURS_LABEL,
  SITE_EMAIL,
  COMPANY_FULL_NAME,
  COMPANY_INN,
  COMPANY_OGRN,
  COMPANY_LEGAL_ADDRESS,
} from "@/lib/site-config";
import { useSiteSettings } from "@/hooks/use-site-settings";

const INFO_LINKS = [
  { href: "/about", label: "О компании" },
  { href: "/delivery", label: "Доставка и оплата" },
  { href: "/wastepaper", label: "Приём макулатуры" },
  { href: "/contacts", label: "Контакты" },
  { href: "/privacy", label: "Политика конфиденциальности" },
];

const CLIENT_LINKS = [
  { href: "/order", label: "Оформить заказ" },
  { href: "/cabinet", label: "Мои заказы" },
  { href: "/login", label: "Вход" },
  { href: "/register", label: "Регистрация" },
  { href: "/search", label: "Поиск товаров" },
];

interface CatLink {
  href: string;
  label: string;
}

export function Footer() {
  const [catalogLinks, setCatalogLinks] = useState<CatLink[]>([
    { href: "/catalog", label: "Весь каталог" },
  ]);
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState(30000);
  // Подхватываем телефон/email/адрес/часы из БД (админ-панель «Настройки»).
  // Пока запрос идёт, показываем дефолты из site-config.ts.
  const siteSettings = useSiteSettings();
  const footerPhone = siteSettings.phone || SITE_PHONE;
  const footerPhoneHref = siteSettings.phoneHref || SITE_PHONE_HREF;
  const footerEmail = siteSettings.email || SITE_EMAIL;
  const footerAddress = siteSettings.address || SITE_ADDRESS;
  const footerHours = siteSettings.hoursLabel || SITE_HOURS_LABEL;

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setCatalogLinks([
          ...data.slice(0, 6).map((c: { slug: string; name: string }) => ({
            href: `/catalog/${c.slug}`,
            label: c.name,
          })),
          { href: "/catalog", label: "Все категории →" },
        ]);
      })
      .catch(() => {});

    fetch("/api/settings/public")
      .then((r) => r.json())
      .then((data) => {
        const threshold = Number(data.freeDeliveryThreshold);
        if (Number.isFinite(threshold) && threshold > 0) {
          setFreeDeliveryThreshold(threshold);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <footer className="site-footer">
      <div className="container-wide">
        <div className="footer-top">
          <div>
            <div className="footer-brand-name">СибГофроТорг</div>
            <p className="footer-brand-desc">
              Производство и продажа гофротары, упаковочных материалов. Оптовые
              цены в розницу. Приём макулатуры.
              <br />
              {footerAddress}
            </p>
            <a href={footerPhoneHref} className="footer-phone">
              {footerPhone}
            </a>
            <p className="footer-hours">{footerHours}</p>
            {footerEmail && (
              <a href={`mailto:${footerEmail}`} className="footer-email">
                {footerEmail}
              </a>
            )}
          </div>

          <div>
            <div className="footer-col-title">Каталог</div>
            {catalogLinks.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="footer-link">
                {l.label}
              </Link>
            ))}
          </div>

          <div>
            <div className="footer-col-title">Информация</div>
            {INFO_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="footer-link">
                {l.label}
              </Link>
            ))}
          </div>

          <div>
            <div className="footer-col-title">Покупателям</div>
            {CLIENT_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="footer-link">
                {l.label}
              </Link>
            ))}
            <div className="footer-delivery-box">
              <div className="footer-delivery-label">Бесплатная доставка</div>
              <div className="footer-delivery-value">от {freeDeliveryThreshold.toLocaleString("ru-RU")} ₽</div>
              <div className="footer-delivery-sub">по Новосибирску</div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} ООО «СибГофроТорг» · Все права защищены
          </span>
          <span>
            <Link href="/privacy" className="footer-link footer-link--inline">
              Политика конфиденциальности
            </Link>
          </span>
          <span>{footerEmail}</span>
        </div>

        <div className="footer-requisites">
          <div className="footer-requisites__title">Реквизиты</div>
          <div className="footer-requisites__row">{COMPANY_FULL_NAME}</div>
          <div className="footer-requisites__row">
            ИНН {COMPANY_INN} · ОГРН {COMPANY_OGRN}
          </div>
          <div className="footer-requisites__row">
            Юридический адрес: {COMPANY_LEGAL_ADDRESS}
          </div>
        </div>
      </div>
    </footer>
  );
}