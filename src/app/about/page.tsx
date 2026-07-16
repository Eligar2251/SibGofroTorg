// src/app/about/page.tsx
import Link from "next/link";
import { Check, ShieldCheck, HeartHandshake, History } from "lucide-react";
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
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
      <div style={{ borderBottom: "1px solid var(--border)", backgroundColor: "#fff" }}>
        <div className="container-wide" style={{ paddingBlock: "14px" }}>
          <div style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>
            <Link href="/" style={{ color: "var(--ink-muted)", textDecoration: "none" }}>
              Главная
            </Link>
            <span>/</span>
            <span style={{ color: "var(--ink)" }}>О компании</span>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "32px" }}>
        <div className="card-base" style={{ padding: "40px" }}>
          <div
            className="md-grid-1"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "40px",
              alignItems: "center",
            }}
          >
            <div>
              <span
                style={{
                  backgroundColor: "var(--kraft-light)",
                  color: "var(--kraft-hover)",
                  fontSize: "11px",
                  fontWeight: "bold",
                  padding: "4px 10px",
                  borderRadius: "100px",
                  textTransform: "uppercase",
                }}
              >
                🤝 Более 8 лет на рынке
              </span>
              <h1
                style={{
                  fontSize: "clamp(24px, 4vw, 36px)",
                  fontWeight: 800,
                  color: "var(--ink)",
                  marginTop: "16px",
                  lineHeight: 1.2,
                }}
              >
                ООО «СибГофроТорг» — упаковка от производителя
              </h1>
              <p style={{ color: "var(--ink-light)", fontSize: "14px", lineHeight: 1.6, marginTop: "16px" }}>
                С 2015 года мы обеспечиваем производственные предприятия,
                интернет-магазины и частных клиентов качественной гофротарой и
                упаковочными материалами в Новосибирске.
              </p>
              <p style={{ color: "var(--ink-light)", fontSize: "14px", lineHeight: 1.6, marginTop: "12px" }}>
                Главная особенность — <strong>оптовые цены доступны каждому</strong>{" "}
                без огромных партий. Коробки и скотч от 1 единицы со склада.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "24px" }}>
                {[
                  "Оптовые цены от первой коробки",
                  "Изготовление тары по размерам заказчика",
                  "Бесплатная доставка при покупке от 15 000 ₽",
                ].map((t) => (
                  <div key={t} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
                    <Check size={16} style={{ color: "var(--green)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 32 }}>
                <Link href="/catalog" className="btn-primary">
                  Перейти к покупкам
                </Link>
              </div>
            </div>

            <div
              style={{
                aspectRatio: "4/3",
                background: "var(--bg-main)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                display: "grid",
                placeItems: "center",
                fontSize: 64,
              }}
            >
              📦
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "40px 0" }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 24 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <ShieldCheck size={28} style={{ color: "var(--kraft)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 4 }}>Стандарты качества</div>
                <p style={{ fontSize: 13, color: "var(--ink-light)", lineHeight: 1.5 }}>
                  Продукция по ГОСТу, подходит для пищевых продуктов.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <HeartHandshake size={28} style={{ color: "var(--kraft)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 4 }}>Надёжный партнёр</div>
                <p style={{ fontSize: 13, color: "var(--ink-light)", lineHeight: 1.5 }}>
                  Договоры с юрлицами, закрывающие документы.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <History size={28} style={{ color: "var(--kraft)", flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: "bold", fontSize: 15, marginBottom: 4 }}>Постоянное наличие</div>
                <p style={{ fontSize: 13, color: "var(--ink-light)", lineHeight: 1.5 }}>
                  Более 10 000 коробок на складе к отгрузке.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 768px) { .md-grid-1 { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}