// src/app/delivery/page.tsx
import Link from "next/link";
import { Truck, MapPin, CreditCard, BadgePercent, Check } from "lucide-react";
import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Доставка и оплата в Новосибирске",
  description:
    "Доставка гофротары по Новосибирску и области, самовывоз со склада на Ватутина. Оплата: наличные, перевод, счёт для юрлиц.",
  alternates: { canonical: `${SITE_URL}/delivery` },
};

export default function DeliveryPage() {
  return (
    <div style={{ backgroundColor: "var(--bg-main)", paddingBottom: "64px" }}>
      
      {/* Хлебные крошки */}
      <div style={{ borderBottom: "1px solid var(--border)", backgroundColor: "#ffffff" }}>
        <div className="container-wide" style={{ paddingBlock: "14px" }}>
          <div style={{ display: "flex", gap: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>
            <Link href="/" style={{ color: "var(--ink-muted)", textDecoration: "none" }}>Главная</Link>
            <span>/</span>
            <span style={{ color: "var(--ink)" }}>Доставка и оплата</span>
          </div>
        </div>
      </div>

      <div className="container-wide" style={{ marginTop: "32px" }}>
        <h1 style={{ fontSize: "30px", fontWeight: "800", color: "var(--ink)", marginBottom: "32px" }}>
          Условия доставки и оплаты
        </h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginBottom: "32px" }} className="md-grid-1">
          
          {/* Доставка курьером */}
          <div className="card-base" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ width: "48px", height: "48px", backgroundColor: "var(--kraft-light)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--kraft)" }}>
              <Truck size={24} />
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>Доставка по Новосибирску</h2>
            <p style={{ color: "var(--ink-light)", fontSize: "14px", lineHeight: 1.5 }}>
              При заказе на сумму <strong>от 15 000 ₽</strong> доставка по Новосибирску и ближайшему пригороду осуществляется <strong>бесплатно</strong>.
            </p>
            <ul style={{ display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--green)" }} /> Доставка в течение 1–2 рабочих дней
              </li>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--green)" }} /> Возможность срочной доставки в день заказа
              </li>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--green)" }} /> Доставка в отдалённые районы согласовывается отдельно
              </li>
            </ul>
          </div>

          {/* Самовывоз */}
          <div className="card-base" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ width: "48px", height: "48px", backgroundColor: "rgba(17,24,39,0.05)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink)" }}>
              <MapPin size={24} />
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>Самовывоз со склада</h2>
            <p style={{ color: "var(--ink-light)", fontSize: "14px", lineHeight: 1.5 }}>
              Вы можете забрать оплаченный или забронированный товар самостоятельно с нашего склада-магазина.
            </p>
            <ul style={{ display: "flex", flexDirection: "column", gap: "8px", listStyle: "none" }}>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--ink)" }} /> Адрес: г. Новосибирск, ул. Ватутина, 42а корп. 1
              </li>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--ink)" }} /> Пн–Пт 9:00–18:00, Сб 10:00–15:00
              </li>
              <li style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px", color: "var(--ink-light)" }}>
                <Check size={14} style={{ color: "var(--ink)" }} /> Без платы за сборку и подготовку заказа
              </li>
            </ul>
          </div>

        </div>

        {/* Способы оплаты */}
        <h2 style={{ fontSize: "20px", fontWeight: "800", color: "var(--ink)", marginBottom: "20px" }}>
          Способы оплаты
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
          
          <div className="card-base" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "10px", padding: "20px" }}>
            <div style={{ width: "40px", height: "40px", backgroundColor: "var(--bg-main)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", color: "var(--ink)" }}>
              💵
            </div>
            <div style={{ fontWeight: "bold", fontSize: "15px" }}>Наличные</div>
            <p style={{ fontSize: "13px", color: "var(--ink-light)", lineHeight: 1.4 }}>Оплата на кассе склада-магазина при получении</p>
          </div>

          <div className="card-base" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "10px", padding: "20px" }}>
            <div style={{ width: "40px", height: "40px", backgroundColor: "var(--bg-main)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", color: "var(--ink)" }}>
              💳
            </div>
            <div style={{ fontWeight: "bold", fontSize: "15px" }}>Перевод на карту</div>
            <p style={{ fontSize: "13px", color: "var(--ink-light)", lineHeight: 1.4 }}>Перевод на карту Сбербанк / СБП перед отгрузкой</p>
          </div>

          <div className="card-base" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "10px", padding: "20px" }}>
            <div style={{ width: "40px", height: "40px", backgroundColor: "var(--bg-main)", borderRadius: "var(--radius)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", color: "var(--ink)" }}>
              🧾
            </div>
            <div style={{ fontWeight: "bold", fontSize: "15px" }}>Безналичный расчёт</div>
            <p style={{ fontSize: "13px", color: "var(--ink-light)", lineHeight: 1.4 }}>Для юридических лиц (НДС / без НДС) по выставленному счёту</p>
          </div>

        </div>

      </div>

      <style>{`
        @media (max-width: 768px) {
          .md-grid-1 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}