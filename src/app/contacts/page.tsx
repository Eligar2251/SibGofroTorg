// src/app/contacts/page.tsx
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
import { SITE_URL, SITE_NAME } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildLocalBusinessJsonLd, buildBreadcrumbJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Контакты — склад и офис в Новосибирске",
  description:
    "Адрес склада СибГофроТорг: Новосибирск, ул. Ватутина. Телефон, режим работы, схема проезда. Гофротара и упаковка.",
  alternates: { canonical: `${SITE_URL}/contacts` },
};

export default function ContactsPage() {
  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
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
      <div
        style={{
          borderBottom: "1px solid var(--border)",
          backgroundColor: "#ffffff",
        }}
      >
        <div className="container-wide" style={{ paddingBlock: "14px" }}>
          <div
            style={{
              display: "flex",
              gap: "8px",
              fontSize: "13px",
              color: "var(--ink-muted)",
            }}
          >
            <Link
              href="/"
              style={{ color: "var(--ink-muted)", textDecoration: "none" }}
            >
              Главная
            </Link>
            <span>/</span>
            <span style={{ color: "var(--ink)" }}>Контакты</span>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "32px" }}>
        <h1
          style={{
            fontSize: "30px",
            fontWeight: "800",
            color: "var(--ink)",
            marginBottom: "32px",
          }}
        >
          Контактная информация
        </h1>

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}
          className="lg-grid"
        >
          {/* Левая колонка — карточки */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {/* Телефон */}
            <div
              className="card-base"
              style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "var(--kraft-light)",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--kraft)",
                  flexShrink: 0,
                }}
              >
                <Phone size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "2px",
                  }}
                >
                  Телефон отдела продаж
                </div>
                <a
                  href={SITE_PHONE_HREF}
                  style={{
                    fontSize: "20px",
                    fontWeight: "bold",
                    color: "var(--ink)",
                    textDecoration: "none",
                  }}
                >
                  {SITE_PHONE}
                </a>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--ink-light)",
                    marginTop: "4px",
                  }}
                >
                  Принимаем звонки в рабочее время
                </div>
              </div>
            </div>

            {/* Адрес */}
            <div
              className="card-base"
              style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "var(--kraft-light)",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--kraft)",
                  flexShrink: 0,
                }}
              >
                <MapPin size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "2px",
                  }}
                >
                  Адрес офиса и склада
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: "bold",
                    color: "var(--ink)",
                  }}
                >
                  {SITE_ADDRESS}
                </div>
              </div>
            </div>

            {/* Режим работы */}
            <div
              className="card-base"
              style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "var(--kraft-light)",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--kraft)",
                  flexShrink: 0,
                }}
              >
                <Clock size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "2px",
                  }}
                >
                  Режим работы
                </div>
                <div
                  style={{
                    fontSize: "15px",
                    fontWeight: "bold",
                    color: "var(--ink)",
                  }}
                >
                  Пн–Пт: {SITE_HOURS_WEEKDAY} · Сб: {SITE_HOURS_SATURDAY}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--red)",
                    marginTop: "4px",
                    fontWeight: "600",
                  }}
                >
                  Воскресенье: выходной день
                </div>
              </div>
            </div>

            {/* Email */}
            <div
              className="card-base"
              style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  backgroundColor: "var(--kraft-light)",
                  borderRadius: "var(--radius)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--kraft)",
                  flexShrink: 0,
                }}
              >
                <Mail size={20} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: "bold",
                    fontSize: "14px",
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "2px",
                  }}
                >
                  Электронная почта
                </div>
                <a
                  href={`mailto:${SITE_EMAIL}`}
                  style={{
                    fontSize: "15px",
                    fontWeight: "bold",
                    color: "var(--kraft)",
                    textDecoration: "none",
                  }}
                >
                  {SITE_EMAIL}
                </a>
              </div>
            </div>
          </div>

          {/* Правая колонка — карта */}
          <div
            className="card-base"
            style={{
              padding: 0,
              overflow: "hidden",
              minHeight: "360px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontWeight: "bold", fontSize: "14px" }}>
                📍 Склад-магазин на карте
              </div>
              <a
                href={SITE_MAP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "var(--kraft)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  textDecoration: "none",
                }}
              >
                Яндекс.Карты <ExternalLink size={12} />
              </a>
            </div>

            <div style={{ flex: 1, minHeight: 320, position: "relative" }}>
              <iframe
                src={SITE_MAP_EMBED_URL}
                title="Карта — СибГофроТорг"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
                loading="lazy"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 1024px) {
          .lg-grid { grid-template-columns: 1fr 1.2fr !important; }
        }
      `}</style>
    </div>
  );
}