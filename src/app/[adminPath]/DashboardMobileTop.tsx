// =========================================================
// FILE: src/app/[adminPath]/DashboardMobileTop.tsx
// Мобильная шапка дашборда — нативные плитки показателей.
//
// На десктопе компонент не рендерит НИЧЕГО (useIsMobile), десктопная
// вёрстка page.tsx не меняется. На телефоне добавляет сверху:
//   • строку с датой и приветствием;
//   • плитки-показатели 2 колонки (товары, заявки, деньги, доставка)
//     — каждая плитка ведёт в свой раздел;
//   • ряд быстрых действий (сканер, подбор коробки, новый товар).
//
// Данные приходят с сервера пропсами (те же числа, что считает
// page.tsx) — никакого второго запроса к БД.
// =========================================================

"use client";

import Link from "next/link";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  PackagePlus,
  QrCode,
  Ruler,
  Truck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import styles from "./DashboardMobileTop.module.css";

export type DashboardMobileStats = {
  isLawyer: boolean;
  productsTotal: number;
  productsInStock: number;
  newOrders: number;
  inProgressOrders: number;
  revenueK: number | null;
  expectedInK: number;
  deliveries: number;
};

export function DashboardMobileTop({
  stats,
}: {
  stats: DashboardMobileStats;
}) {
  const isMobile = useIsMobile();
  if (!isMobile) return null;

  const dateLabel = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const tiles = stats.isLawyer
    ? [
        {
          href: "#",
          icon: <BarChart3 size={19} />,
          tone: "pine",
          label: "Выручка (мес.)",
          value: stats.revenueK != null ? `${stats.revenueK}К ₽` : "—",
          sub: "оплаты минус расходы",
        },
        {
          href: "#",
          icon: <Truck size={19} />,
          tone: "steel",
          label: "Доставки",
          value: String(stats.deliveries),
          sub: "план перевозок",
        },
      ]
    : [
        {
          href: "products",
          icon: <Boxes size={19} />,
          tone: "sand",
          label: "Товары",
          value: String(stats.productsTotal),
          sub: `${stats.productsInStock} в наличии`,
        },
        {
          href: "orders?status=new",
          icon: <ClipboardList size={19} />,
          tone: stats.newOrders > 0 ? "rust" : "sand",
          label: "Новые заявки",
          value: String(stats.newOrders),
          sub: stats.newOrders > 0 ? "требуют обработки" : "всё обработано",
        },
        {
          href: "orders?status=in_progress",
          icon: <TrendingUp size={19} />,
          tone: "steel",
          label: "В работе",
          value: String(stats.inProgressOrders),
          sub: "заявок в процессе",
        },
        {
          href: "warehouse?tab=bank",
          icon: <Wallet size={19} />,
          tone: "pine",
          label: "Выручка (мес.)",
          value: stats.revenueK != null ? `${stats.revenueK}К ₽` : "—",
          sub: `к оплате нам ${stats.expectedInK}К ₽`,
        },
      ];

  const quickActions = stats.isLawyer
    ? []
    : [
        { href: "scan", icon: <QrCode size={16} />, label: "Сканер" },
        { href: "box-finder", icon: <Ruler size={16} />, label: "Подбор коробки" },
        { href: "products/new", icon: <PackagePlus size={16} />, label: "Товар" },
      ];

  return (
    <section className={styles.hero} aria-label="Главные показатели">
      <div className={styles.dateRow}>
        <LayoutDashboard size={15} className={styles.dateIcon} aria-hidden="true" />
        <span className={styles.date}>{dateLabel}</span>
      </div>

      <div className={styles.grid}>
        {tiles.map((tile) => {
          const body = (
            <>
              <span className={`${styles.tileIcon} ${styles[`tone_${tile.tone}`]}`}>
                {tile.icon}
              </span>
              <span className={styles.tileValue}>{tile.value}</span>
              <span className={styles.tileLabel}>{tile.label}</span>
              {tile.sub && <span className={styles.tileSub}>{tile.sub}</span>}
            </>
          );
          return tile.href === "#" ? (
            <div key={tile.label} className={styles.tile}>
              {body}
            </div>
          ) : (
            <Link key={tile.label} href={tile.href} prefetch={false} className={styles.tile}>
              {body}
            </Link>
          );
        })}
      </div>

      {quickActions.length > 0 && (
        <div className={styles.quickRow}>
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              prefetch={false}
              className={styles.quick}
            >
              {action.icon}
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
