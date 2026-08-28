// src/components/admin/ClientsManager.tsx
"use client";

import { useDeferredValue, useState } from "react";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Phone,
  Mail,
  Building2,
  User,
  Package,
  MessageSquare,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";

interface ClientOrder {
  id: string;
  type: string;
  status: string;
  totalSum: number | null;
  productInfo: string | null;
  items: any[] | null;
  createdAt: string | null;
}

interface Client {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  customerType: string;
  companyName: string | null;
  inn: string | null;
  createdAt: string | null;
  ordersCount: number;
  completedCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
  orders: ClientOrder[];
}

const statusLabels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Выполнена",
  rejected: "Отменена",
};

// Цвета статусов — темызированные пары (фон/текст), чтобы
     // контраст сохранялся в любой теме админки.
const statusColors: Record<string, { bg: string; fg: string }> = {
  new: { bg: "var(--adm-kraft-pale)", fg: "var(--adm-kraft)" },
  in_progress: { bg: "var(--adm-steel-pale)", fg: "var(--adm-steel)" },
  completed: { bg: "var(--adm-pine-pale)", fg: "var(--adm-pine)" },
  rejected: { bg: "var(--adm-rust-pale)", fg: "var(--adm-rust)" },
};

function formatDate(raw: string | null): string {
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function ClientRow({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="admin-card"
      style={{ marginBottom: 12, overflow: "hidden" }}
    >
      {/* Шапка клиента */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 20px",
          cursor: "pointer",
          flexWrap: "wrap",
        }}
        onClick={() => setOpen(!open)}
      >
        {/* Аватар */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background:
              client.customerType === "legal"
                ? "rgba(37,99,235,0.1)"
                : "rgba(27,43,75,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {client.customerType === "legal" ? (
            <Building2 size={18} style={{ color: "var(--adm-steel)" }} />
          ) : (
            <User size={18} style={{ color: "var(--adm-navy)" }} />
          )}
        </div>

        {/* Инфо */}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div
            style={{
              fontWeight: 700,
              color: "var(--adm-navy)",
              fontSize: 15,
            }}
          >
            {client.name || "Без имени"}
            {client.companyName && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--adm-steel)",
                  marginLeft: 8,
                  fontWeight: 500,
                }}
              >
                {client.companyName}
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            {client.phone && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--adm-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Phone size={11} /> {client.phone}
              </span>
            )}
            {client.email && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--adm-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Mail size={11} /> {client.email}
              </span>
            )}
          </div>
        </div>

        {/* Статистика */}
        <div
          style={{
            display: "flex",
            gap: 20,
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "var(--adm-navy)",
              }}
            >
              {client.ordersCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
              заявок
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: "var(--adm-pine)",
              }}
            >
              {client.completedCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
              выполнено
            </div>
          </div>
          {client.totalSpent > 0 && (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: "var(--adm-amber)",
                }}
              >
                {client.totalSpent.toLocaleString("ru-RU")} ₽
              </div>
              <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
                сумма
              </div>
            </div>
          )}
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--adm-muted)",
              }}
            >
              {formatDate(client.createdAt)}
            </div>
            <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
              регистрация
            </div>
          </div>
        </div>

        <div style={{ color: "var(--adm-muted)", flexShrink: 0 }}>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* Раскрытые заявки */}
      {open && (
        <div
          style={{
            borderTop: "1px solid rgba(200,196,188,0.3)",
            padding: "12px 20px",
          }}
        >
          {client.inn && (
            <div
              style={{
                fontSize: 12,
                color: "var(--adm-muted)",
                marginBottom: 12,
              }}
            >
              ИНН: {client.inn}
            </div>
          )}

          {client.orders.length === 0 ? (
            <p
              style={{
                fontSize: 13,
                color: "var(--adm-muted)",
                textAlign: "center",
                padding: "16px 0",
              }}
            >
              Заявок нет
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--adm-navy)",
                  marginBottom: 4,
                }}
              >
                История заявок:
              </div>
              {client.orders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: "var(--adm-bg)",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      color: "var(--adm-muted)",
                    }}
                  >
                    #{order.id.slice(0, 8)}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      background:
                        order.type === "order"
                          ? "var(--adm-indigo-pale)"
                          : "var(--adm-teal-pale)",
                      color:
                        order.type === "order" ? "var(--adm-indigo)" : "var(--adm-teal)",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontWeight: 600,
                    }}
                  >
                    {order.type === "order" ? (
                      <>
                        <Package size={10} /> Заказ
                      </>
                    ) : (
                      <>
                        <MessageSquare size={10} /> Заявка
                      </>
                    )}
                  </span>

                  <span
                    style={{
                      fontSize: 11,
                      background: statusColors[order.status].bg,
                      color: statusColors[order.status].fg,
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontWeight: 600,
                    }}
                  >
                    {statusLabels[order.status] || order.status}
                  </span>

                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--adm-navy)",
                      flex: 1,
                    }}
                  >
                    {order.productInfo ||
                      (order.items && order.items.length > 0
                        ? `${order.items.length} поз.`
                        : "—")}
                  </span>

                  {order.totalSum && (
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--adm-navy)",
                      }}
                    >
                      {order.totalSum.toLocaleString("ru-RU")} ₽
                    </span>
                  )}

                  <span
                    style={{ fontSize: 11, color: "var(--adm-muted)" }}
                  >
                    {formatDate(order.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientsManager({ clients }: { clients: Client[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "legal" | "individual">("all");
  const [sort, setSort] = useState<"date" | "orders" | "spent">("date");
  // Список клиентов длинный — фильтруем по отложенному значению,
  // чтобы ввод в поле не тормозил.
  const deferredSearch = useDeferredValue(search);

  const filtered = clients
    .filter((c) => {
      if (filter === "legal") return c.customerType === "legal";
      if (filter === "individual") return c.customerType === "individual";
      return true;
    })
    .filter((c) => {
      if (!deferredSearch) return true;
      const s = deferredSearch.toLowerCase();
      return (
        (c.name || "").toLowerCase().includes(s) ||
        (c.phone || "").includes(s) ||
        (c.email || "").toLowerCase().includes(s) ||
        (c.companyName || "").toLowerCase().includes(s) ||
        (c.inn || "").includes(s)
      );
    })
    .sort((a, b) => {
      if (sort === "orders") return b.ordersCount - a.ordersCount;
      if (sort === "spent") return b.totalSpent - a.totalSpent;
      return (
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
      );
    });

  const totalSpent = clients.reduce((s, c) => s + c.totalSpent, 0);
  const legalCount = clients.filter(
    (c) => c.customerType === "legal"
  ).length;

  return (
    <div className="admin-stack">
      {/* Статистика */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 16,
          marginBottom: 8,
        }}
      >
        {[
          {
            label: "Всего клиентов",
            value: clients.length,
            color: "var(--adm-navy)",
          },
          {
            label: "Юридических лиц",
            value: legalCount,
            color: "var(--adm-steel)",
          },
          {
            label: "Физических лиц",
            value: clients.length - legalCount,
            color: "var(--adm-pine)",
          },
          {
            label: "Выручка (выполненные)",
            value: `${totalSpent.toLocaleString("ru-RU")} ₽`,
            color: "var(--adm-amber)",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="admin-card"
            style={{ padding: "16px 20px", textAlign: "center" }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: stat.color,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--adm-muted)",
                marginTop: 4,
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Фильтры */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Имя, телефон, ИНН, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-input"
            style={{ paddingLeft: 32 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {(
            [
              { v: "all", label: "Все", token: "" },
              { v: "individual", label: "Физлица", token: "user" },
              { v: "legal", label: "Юрлица", token: "building" },
            ] as const
          ).map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFilter(f.v)}
              className={`admin-filter${filter === f.v ? " admin-filter--active" : ""}`}
            >
              {"token" in f && f.token ? (
                <GlyphIcon value={f.token} size={13} />
              ) : null}
              {f.label}
            </button>
          ))}
        </div>

        <select
          className="admin-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as any)}
          style={{ minWidth: 160 }}
        >
          <option value="date">По дате регистрации</option>
          <option value="orders">По кол-ву заявок</option>
          <option value="spent">По сумме заказов</option>
        </select>
      </div>

      {/* Список */}
      <div>
        {filtered.length > 0 ? (
          filtered.map((client) => (
            <ClientRow key={client.id} client={client} />
          ))
        ) : (
          <div
            className="admin-card"
            style={{ textAlign: "center", padding: 40 }}
          >
            <div style={{ marginBottom: 8, color: "var(--adm-muted)" }}><GlyphIcon value="users" size={32} /></div>
            <p style={{ color: "var(--adm-muted)" }}>
              {search ? `По запросу «${search}» ничего не найдено` : "Клиентов нет"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}