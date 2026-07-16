// =========================================================
// FILE: src/app/[adminPath]/page.tsx
// =========================================================

import {
  getAllCategories,
  getProducts,
  getOrders,
} from "@/lib/firestore-queries";
import { Package, ClipboardList, FolderOpen, TrendingUp } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Выполнена",
  rejected: "Отклонена",
};

const statusColors: Record<string, string> = {
  new: "admin-badge admin-badge--amber",
  in_progress: "admin-badge admin-badge--blue",
  completed: "admin-badge admin-badge--green",
  rejected: "admin-badge admin-badge--red",
};

function formatDate(raw: any): string {
  if (!raw) return "";
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("ru-RU");
  }
  if (typeof raw === "number") return new Date(raw).toLocaleDateString("ru-RU");
  if (raw?.seconds !== undefined)
    return new Date(raw.seconds * 1000).toLocaleDateString("ru-RU");
  return "";
}

export default async function AdminDashboard() {
  const allProducts = await getProducts({});
  const allOrders = await getOrders();
  const allCats = await getAllCategories();
  const newOrders = allOrders.filter((o) => (o as any).status === "new");
  const recentOrders = allOrders.slice(0, 5);

  return (
    <div>
      <h1 className="admin-h1">Панель управления</h1>

      <div className="admin-stat-grid">
        {[
          {
            label: "Товаров",
            value: allProducts.length,
            icon: <Package size={20} />,
            href: `/${ADMIN_PATH}/products`,
            iconBg: "rgba(27,43,75,0.08)",
            iconColor: "#1b2b4b",
          },
          {
            label: "Категорий",
            value: allCats.length,
            icon: <FolderOpen size={20} />,
            href: `/${ADMIN_PATH}/categories`,
            iconBg: "rgba(217,119,6,0.12)",
            iconColor: "#d97706",
          },
          {
            label: "Всего заявок",
            value: allOrders.length,
            icon: <ClipboardList size={20} />,
            href: `/${ADMIN_PATH}/orders`,
            iconBg: "#f0fdf4",
            iconColor: "#16a34a",
          },
          {
            label: "Новых заявок",
            value: newOrders.length,
            icon: <TrendingUp size={20} />,
            href: `/${ADMIN_PATH}/orders?status=new`,
            iconBg: "#fef2f2",
            iconColor: "#ef4444",
          },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="admin-stat">
            <div
              className="admin-stat__icon"
              style={{ background: stat.iconBg, color: stat.iconColor }}
            >
              {stat.icon}
            </div>
            <div className="admin-stat__value">{stat.value}</div>
            <div className="admin-stat__label">{stat.label}</div>
          </Link>
        ))}
      </div>

      <div className="admin-card">
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(200,196,188,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              fontFamily: "Oswald, sans-serif",
              fontWeight: 700,
              color: "#1b2b4b",
              fontSize: 18,
            }}
          >
            Последние заявки
          </h2>
          <Link
            href={`/${ADMIN_PATH}/orders`}
            style={{ fontSize: 14, color: "#d97706", fontWeight: 600 }}
          >
            Все заявки →
          </Link>
        </div>

        {recentOrders.length > 0 ? (
          <div>
            {recentOrders.map((order) => {
              const o = order as any;
              return (
                <div
                  key={o.id}
                  style={{
                    padding: "16px 24px",
                    borderBottom: "1px solid rgba(200,196,188,0.2)",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 600, color: "#1b2b4b", fontSize: 14 }}>
                      {o.customerName}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(55,65,81,0.5)" }}>
                      {o.customerPhone}
                      {o.productInfo && ` · ${o.productInfo}`}
                    </div>
                  </div>
                  <span className={statusColors[o.status || "new"] || statusColors.new}>
                    {statusLabels[o.status || "new"] || o.status}
                  </span>
                  <span style={{ fontSize: 12, color: "rgba(55,65,81,0.4)" }}>
                    {formatDate(o.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              color: "rgba(55,65,81,0.4)",
              fontSize: 14,
            }}
          >
            Заявок пока нет
          </div>
        )}
      </div>
    </div>
  );
}