// src/app/[adminPath]/page.tsx
import {
  getAllCategories,
  getProducts,
  getOrders,
  getPromotions,
} from "@/lib/firestore-queries";
import {
  Package,
  ClipboardList,
  FolderOpen,
  TrendingUp,
  Users,
  CheckCircle,
  CheckCircle2,
  Clock,
  XCircle,
  BarChart3,
  Megaphone,
  Star,
  Plus,
  Pencil,
  Settings,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { getAdminDb } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Проведена",
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
  if (typeof raw === "number")
    return new Date(raw).toLocaleDateString("ru-RU");
  if (raw?.seconds !== undefined)
    return new Date(raw.seconds * 1000).toLocaleDateString("ru-RU");
  return "";
}

export default async function AdminDashboard() {
  const db = getAdminDb();
  const weekStart = Timestamp.fromMillis(Date.now() - 7 * 86_400_000);

  // Для дашборда читаем только 50 последних заявок. Общие показатели
  // получаем агрегатами Firestore: это значительно дешевле, чем загружать
  // целиком коллекции users и orders при каждом открытии панели.
  const [
    allProducts,
    recentOrderPool,
    allCats,
    promotions,
    totalOrdersAgg,
    newOrdersAgg,
    inProgressAgg,
    completedAgg,
    rejectedAgg,
    usersAgg,
    weekAgg,
  ] = await Promise.all([
    getProducts({}),
    getOrders({ limit: 50 }),
    getAllCategories(),
    getPromotions(),
    db.collection("orders").count().get(),
    db.collection("orders").where("status", "==", "new").count().get(),
    db
      .collection("orders")
      .where("status", "==", "in_progress")
      .count()
      .get(),
    db.collection("orders").where("status", "==", "completed").count().get(),
    db.collection("orders").where("status", "==", "rejected").count().get(),
    db.collection("users").count().get(),
    db.collection("orders").where("createdAt", ">=", weekStart).count().get(),
  ]);

  const totalOrdersCount = totalOrdersAgg.data().count;
  const newOrdersCount = newOrdersAgg.data().count;
  const inProgressOrdersCount = inProgressAgg.data().count;
  const completedOrdersCount = completedAgg.data().count;
  const rejectedOrdersCount = rejectedAgg.data().count;
  const usersCount = usersAgg.data().count;
  const weekOrders = weekAgg.data().count;
  const totalRevenue = recentOrderPool
    .filter((order) => order.status === "completed")
    .reduce((sum, order) => sum + (Number(order.totalSum) || 0), 0);
  const recentOrders = recentOrderPool.slice(0, 8);

  const lowStockProducts = allProducts.filter(
    (product) =>
      product.stockQty !== null &&
      product.stockQty !== undefined &&
      product.stockQty <= 10
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 className="admin-h1" style={{ margin: 0 }}>
          Панель управления
        </h1>
        <div
          style={{ fontSize: 13, color: "var(--adm-muted)" }}
        >
          {new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>

      {/* Основная статистика */}
      <div className="admin-stat-grid" style={{ marginBottom: 24 }}>
        {[
          {
            label: "Товаров",
            value: allProducts.length,
            icon: <Package size={20} />,
            href: `/${ADMIN_PATH}/products`,
            iconBg: "rgba(27,43,75,0.08)",
            iconColor: "#1b2b4b",
            sub: `${allProducts.filter((p) => p.inStock).length} в наличии`,
          },
          {
            label: "Категорий",
            value: allCats.length,
            icon: <FolderOpen size={20} />,
            href: `/${ADMIN_PATH}/categories`,
            iconBg: "rgba(217,119,6,0.12)",
            iconColor: "#d97706",
            sub: `${allCats.filter((c) => c.isVisible !== false).length} видимых`,
          },
          {
            label: "Всего заявок",
            value: totalOrdersCount,
            icon: <ClipboardList size={20} />,
            href: `/${ADMIN_PATH}/orders`,
            iconBg: "#f0fdf4",
            iconColor: "#16a34a",
            sub: `+${weekOrders} за 7 дней`,
          },
          {
            label: "Новых заявок",
            value: newOrdersCount,
            icon: <TrendingUp size={20} />,
            href: `/${ADMIN_PATH}/orders?status=new`,
            iconBg: "#fef2f2",
            iconColor: "#ef4444",
            sub: "требуют обработки",
          },
          {
            label: "Клиентов",
            value: usersCount,
            icon: <Users size={20} />,
            href: `/${ADMIN_PATH}/clients`,
            iconBg: "rgba(37,99,235,0.08)",
            iconColor: "#2563eb",
            sub: "зарегистрировано",
          },
          {
            label: "Выручка",
            value:
              totalRevenue > 0
                ? `${(totalRevenue / 1000).toFixed(0)}К ₽`
                : "—",
            icon: <BarChart3 size={20} />,
            href: `/${ADMIN_PATH}/orders?status=completed`,
            iconBg: "rgba(16,185,129,0.1)",
            iconColor: "#10b981",
            sub: "по 50 последним заявкам",
          },
          {
            label: "Акции",
            value: promotions.length,
            icon: <Megaphone size={20} />,
            href: `/${ADMIN_PATH}/promotions`,
            iconBg: "rgba(234,179,8,0.12)",
            iconColor: "#eaaf08",
            sub: `${promotions.filter((p) => p.isVisible !== false).length} активных`,
          },
          {
            label: "Отзывы",
            value: 0,
            icon: <Star size={20} />,
            href: `/${ADMIN_PATH}/reviews`,
            iconBg: "rgba(245,166,35,0.12)",
            iconColor: "#f5a623",
            sub: "управление отзывами",
          },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="admin-stat" prefetch={false}>
            <div
              className="admin-stat__icon"
              style={{
                background: stat.iconBg,
                color: stat.iconColor,
              }}
            >
              {stat.icon}
            </div>
            <div className="admin-stat__value">{stat.value}</div>
            <div className="admin-stat__label">{stat.label}</div>
            {stat.sub && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--adm-muted)",
                  marginTop: 2,
                }}
              >
                {stat.sub}
              </div>
            )}
          </Link>
        ))}
      </div>

      {/* Воронка статусов */}
      <div
        className="admin-card"
        style={{ marginBottom: 24, padding: "20px 24px" }}
      >
        <div
          style={{
            fontFamily: "Oswald, sans-serif",
            fontWeight: 700,
            color: "#1b2b4b",
            fontSize: 16,
            marginBottom: 16,
          }}
        >
          Статусы заявок
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
          }}
        >
          {[
            {
              label: "Новые",
              count: newOrdersCount,
              icon: <Clock size={16} />,
              color: "#f59e0b",
              bg: "#fffbeb",
              status: "new",
            },
            {
              label: "В работе",
              count: inProgressOrdersCount,
              icon: <TrendingUp size={16} />,
              color: "#3b82f6",
              bg: "#eff6ff",
              status: "in_progress",
            },
            {
              label: "Выполнены",
              count: completedOrdersCount,
              icon: <CheckCircle size={16} />,
              color: "#16a34a",
              bg: "#f0fdf4",
              status: "completed",
            },
            {
              label: "Отклонены",
              count: rejectedOrdersCount,
              icon: <XCircle size={16} />,
              color: "#ef4444",
              bg: "#fef2f2",
              status: "rejected",
            },
          ].map((s) => (
            <Link
              key={s.status}
              href={`/${ADMIN_PATH}/orders?status=${s.status}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "16px 12px",
                borderRadius: 12,
                background: s.bg,
                border: `1px solid ${s.color}30`,
                textDecoration: "none",
                gap: 6,
              }}
             prefetch={false}>
              <div style={{ color: s.color }}>{s.icon}</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: s.color,
                  lineHeight: 1,
                }}
              >
                {s.count}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: s.color,
                  fontWeight: 600,
                }}
              >
                {s.label}
              </div>
              {totalOrdersCount > 0 && (
                <div
                  style={{
                    fontSize: 11,
                    color: `${s.color}99`,
                  }}
                >
                  {Math.round((s.count / totalOrdersCount) * 100)}%
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 24,
        }}
        className="admin-dash-grid"
      >
        {/* Последние заявки */}
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
                fontSize: 16,
              }}
            >
              Последние заявки
            </h2>
            <Link
              href={`/${ADMIN_PATH}/orders`}
              style={{
                fontSize: 13,
                color: "#d97706",
                fontWeight: 600,
              }}
             prefetch={false}>
              Все →
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
                      padding: "12px 24px",
                      borderBottom: "1px solid rgba(200,196,188,0.15)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "#1b2b4b",
                          fontSize: 13,
                        }}
                      >
                        {o.customerName}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "rgba(55,65,81,0.5)",
                        }}
                      >
                        {o.customerPhone}
                      </div>
                    </div>
                    <span
                      className={
                        statusColors[o.status || "new"] ||
                        statusColors.new
                      }
                    >
                      {statusLabels[o.status || "new"] || o.status}
                    </span>
                    {o.totalSum > 0 && (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "#1b2b4b",
                        }}
                      >
                        {o.totalSum.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgba(55,65,81,0.4)",
                      }}
                    >
                      {formatDate(o.createdAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                padding: "32px 24px",
                textAlign: "center",
                color: "rgba(55,65,81,0.4)",
                fontSize: 14,
              }}
            >
              Заявок пока нет
            </div>
          )}
        </div>

        {/* Правая колонка */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Мало на складе */}
          <div className="admin-card" style={{ flex: 1 }}>
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
                  fontSize: 16,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                <AlertTriangle size={15} />
                Мало на складе
              </h2>
              <Link
                href={`/${ADMIN_PATH}/products/bulk`}
                style={{
                  fontSize: 13,
                  color: "#d97706",
                  fontWeight: 600,
                }}
               prefetch={false}>
                Редактировать →
              </Link>
            </div>

            {lowStockProducts.length > 0 ? (
              <div>
                {lowStockProducts.slice(0, 6).map((p) => (
                  <div
                    key={p.id}
                    style={{
                      padding: "10px 24px",
                      borderBottom: "1px solid rgba(200,196,188,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        color: "#1b2b4b",
                        fontWeight: 500,
                        flex: 1,
                      }}
                    >
                      {p.name}
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color:
                          (p.stockQty || 0) === 0
                            ? "#ef4444"
                            : "#f59e0b",
                        background:
                          (p.stockQty || 0) === 0
                            ? "#fef2f2"
                            : "#fffbeb",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {p.stockQty === 0 ? "закончился" : `${p.stockQty} шт.`}
                    </span>
                  </div>
                ))}
                {lowStockProducts.length > 6 && (
                  <div
                    style={{
                      padding: "10px 24px",
                      fontSize: 12,
                      color: "var(--adm-muted)",
                    }}
                  >
                    + ещё {lowStockProducts.length - 6} товаров
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: "24px",
                  textAlign: "center",
                  color: "rgba(55,65,81,0.4)",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    whiteSpace: "nowrap",
                  }}
                >
                  <CheckCircle2 size={15} />
                  Склад в норме
                </span>
              </div>
            )}
          </div>

          {/* Быстрые действия */}
          <div
            className="admin-card"
            style={{ padding: "16px 24px" }}
          >
            <div
              style={{
                fontFamily: "Oswald, sans-serif",
                fontWeight: 700,
                color: "#1b2b4b",
                fontSize: 16,
                marginBottom: 14,
              }}
            >
              Быстрые действия
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {[
                {
                  href: `/${ADMIN_PATH}/products/new`,
                  label: "Добавить товар",
                  icon: <Plus size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/products/bulk`,
                  label: "Массовое редактирование",
                  icon: <Pencil size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/orders?status=new`,
                  label: `Новые заявки (${newOrdersCount})`,
                  icon: <ClipboardList size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/clients`,
                  label: `Клиенты (${usersCount})`,
                  icon: <Users size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/categories`,
                  label: "Управление категориями",
                  icon: <FolderOpen size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/promotions`,
                  label: `Акции и спецпредложения (${promotions.length})`,
                  icon: <Megaphone size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/reviews`,
                  label: "Отзывы покупателей",
                  icon: <Star size={14} />,
                },
                {
                  href: `/${ADMIN_PATH}/settings`,
                  label: "Настройки сайта",
                  icon: <Settings size={14} />,
                },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--adm-bg, #f8f7f4)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#1b2b4b",
                    textDecoration: "none",
                    border: "1px solid transparent",
                    transition: "border-color 0.15s",
                  }}
                 prefetch={false}>
                  {action.icon}
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`\n        @media (max-width: 768px) {\n          .admin-dash-grid {\n            grid-template-columns: 1fr !important;\n          }\n        }\n      `}</style>
    </div>
  );
}