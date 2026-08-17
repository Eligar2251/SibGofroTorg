// =========================================================
// FILE: src/app/privacy/page.tsx — Политика конфиденциальности
// Обработка персональных данных (152-ФЗ)
// Текст редактируется в админке («Настройки → Политика конфиденциальности»).
// =========================================================

import type { Metadata } from "next";
import {
  COMPANY_FULL_NAME,
  COMPANY_LEGAL_NAME,
  COMPANY_INN,
  COMPANY_KPP,
  COMPANY_OGRN,
  COMPANY_LEGAL_ADDRESS,
  COMPANY_DIRECTOR,
  SITE_EMAIL,
  SITE_PHONE,
  SITE_ADDRESS,
} from "@/lib/site-config";
import { SITE_URL } from "@/lib/seo";
import { MarkdownText } from "@/components/catalog/MarkdownText";
import {
  PRIVACY_POLICY_SETTING_KEY,
  DEFAULT_PRIVACY_POLICY_TEXT,
} from "@/lib/privacy";
import { getSettings } from "@/lib/supabase-queries";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description:
    "Политика обработки персональных данных компании СибГофроТорг (ООО «СибГофроТорг»): какие данные собираются, как используются и защищаются.",
  alternates: { canonical: `${SITE_URL}/privacy` },
  robots: { index: true, follow: true },
};

const SITE_URL_LABEL = SITE_URL.replace(/^https?:\/\//, "");

export default async function PrivacyPage() {
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const policyText =
    (settings[PRIVACY_POLICY_SETTING_KEY] || "").trim() ||
    DEFAULT_PRIVACY_POLICY_TEXT;

  return (
    <div className="privacy-page">
      <div className="container-wide privacy-page__inner">
        {/* Шапка */}
        <header className="privacy-hero">
          <h1 className="privacy-hero__title">Политика конфиденциальности</h1>
          <p className="privacy-hero__sub">
            Политика обработки персональных данных · {COMPANY_LEGAL_NAME}
          </p>
        </header>

        {/* Реквизиты оператора */}
        <div className="privacy-card" style={{ marginBottom: 20 }}>
          <h2 className="privacy__h2">Реквизиты оператора</h2>
          <div className="privacy-table">
            <div className="privacy-table__row">
              <span className="privacy-table__key">Наименование</span>
              <span className="privacy-table__val">{COMPANY_FULL_NAME}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">ИНН</span>
              <span className="privacy-table__val">{COMPANY_INN}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">КПП</span>
              <span className="privacy-table__val">{COMPANY_KPP}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">ОГРН</span>
              <span className="privacy-table__val">{COMPANY_OGRN}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">Юридический адрес</span>
              <span className="privacy-table__val">{COMPANY_LEGAL_ADDRESS}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">Руководитель</span>
              <span className="privacy-table__val">{COMPANY_DIRECTOR}</span>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">Телефон</span>
              <a className="privacy-table__val privacy-table__link" href={`tel:${SITE_PHONE.replace(/[^\d+]/g, "")}`}>
                {SITE_PHONE}
              </a>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">Электронная почта</span>
              <a className="privacy-table__val privacy-table__link" href={`mailto:${SITE_EMAIL}`}>
                {SITE_EMAIL}
              </a>
            </div>
            <div className="privacy-table__row">
              <span className="privacy-table__key">Сайт</span>
              <a
                className="privacy-table__val privacy-table__link"
                href={SITE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {SITE_URL_LABEL}
              </a>
            </div>
          </div>
        </div>

        {/* Текст политики (редактируется в админке) */}
        <div className="privacy-card">
          <MarkdownText text={policyText} />
        </div>

        <footer className="privacy__footer">
          <p>
            {COMPANY_LEGAL_NAME} · {SITE_ADDRESS} ·{" "}
            <a href={`mailto:${SITE_EMAIL}`}>{SITE_EMAIL}</a> ·{" "}
            <a href={SITE_URL} target="_blank" rel="noopener noreferrer">
              {SITE_URL_LABEL}
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
