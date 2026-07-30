// src/components/admin/ActivityLogs.tsx
// Журнал действий администраторов: кто, что и когда сделал.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Clock,
  Search,
  Loader2,
  Edit2,
  Trash2,
  LogIn,
  Send,
  Download,
  RefreshCw,
} from "lucide-react";

interface LogEntry {
  id: string;
  adminId?: string | null;
  adminName: string;
  adminRole: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  details: Record<string, any>;
  ipAddress: string;
  createdAt: string | null;
}

const actionLabels: Record<string, { label: string; color: string; icon: any }> = {
  create: { label: "Создание", color: "admin-badge--green", icon: Edit2 },
  update: { label: "Изменение", color: "admin-badge--blue", icon: Edit2 },
  delete: { label: "Удаление", color: "admin-badge--red", icon: Trash2 },
  status_change: { label: "Статус", color: "admin-badge--amber", icon: Send },
  post: { label: "Проведение", color: "admin-badge--green", icon: Send },
  cancel: { label: "Отмена", color: "admin-badge--red", icon: Trash2 },
  login: { label: "Вход", color: "admin-badge--muted", icon: LogIn },
  logout: { label: "Выход", color: "admin-badge--muted", icon: LogIn },
  bulk_update: { label: "Массовое", color: "admin-badge--blue", icon: Edit2 },
  bulk_delete: { label: "Массовое удаление", color: "admin-badge--red", icon: Trash2 },
  export: { label: "Экспорт", color: "admin-badge--muted", icon: Download },
};

const adminRoleLabels: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  lawyer: "Юрист",
  system: "Система",
};

const entityLabels: Record<string, string> = {
  order: "Заявка",
  deal: "Заказ учёта",
  payment: "Платёж",
  receipt: "Поступление",
  product: "Товар",
  transport: "Перевозка",
  delivery: "Доставка",
  settings: "Настройки",
  category: "Категория",
  review: "Отзыв",
  counterparty: "Контрагент",
  salary: "Зарплата",
  "admin-user": "Пользователь админки",
  "cash-collection": "Сдача кассы",
};

function fmtDateTime(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

const statusText: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  completed: "Проведена",
  rejected: "Отменена",
  cancelled: "Отменён",
  draft: "Черновик",
  posted: "Проведено",
};

const tableText: Record<string, string> = {
  orders: "заявки сайта",
  wastepaper_requests: "заявки на макулатуру",
  customer_deals: "заказы учёта",
  bank_payments: "банк / платежи",
  warehouse_receipts: "поступления",
  cash_collections: "журнал сдачи кассы",
};

const detailKeyText: Record<string, string> = {
  table: "Таблица",
  deleted: "Запись удалена",
  reason: "Причина",
  amount: "Сумма",
  newStatus: "Новый статус",
  oldStatus: "Старый статус",
  dealCreated: "Заказ в учёте",
  dealId: "ID заказа учёта",
  dealNumber: "Номер заказа учёта",
  paymentId: "ID платежа",
  paymentIds: "Платежи",
  rollback: "Убрано из работы",
  isPaid: "Проведён",
  excludeFromBalance: "Вне баланса",
  shippedItems: "Отгруженные позиции",
  quantity: "Количество",
  productId: "Товар",
  name: "Название",
  sku: "Артикул",
};

function fmtMoney(value: unknown): string {
  const num = Number(value) || 0;
  return `${num.toLocaleString("ru-RU")} ₽`;
}

function fmtBool(value: unknown): string {
  return value ? "да" : "нет";
}

function fmtStatus(value: unknown): string {
  const key = String(value || "");
  return statusText[key] || key || "не указан";
}

function isMoneyKey(key: string): boolean {
  return /amount|sum|total|cost|price/i.test(key);
}

function fmtDetailValue(key: string, value: any): string {
  if (value == null || value === "") return "не указано";
  if (key === "table") return tableText[String(value)] || String(value);
  if (key.toLowerCase().includes("status")) return fmtStatus(value);
  if (typeof value === "boolean") return fmtBool(value);
  if (isMoneyKey(key) && typeof value !== "object") return fmtMoney(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "нет";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return Object.entries(item)
            .map(([k, v]) => `${detailKeyText[k] || k}: ${fmtDetailValue(k, v)}`)
            .join(", ");
        }
        return String(item);
      })
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([k, v]) => `${detailKeyText[k] || k}: ${fmtDetailValue(k, v)}`)
      .join("; ");
  }
  return String(value);
}

function formatShippedItems(value: any): string {
  if (!Array.isArray(value) || value.length === 0) return "нет";
  return value
    .map((item, idx) => {
      if (!item || typeof item !== "object") return String(item);
      const qty = item.quantity ?? item.shippedQty ?? item.qty ?? 0;
      const name = item.name || item.productName || item.sku || "товар";
      const productId = item.productId ? ` (ID товара: ${item.productId})` : "";
      return `${idx + 1}) ${name}${productId} — ${Number(qty) || 0} шт.`;
    })
    .join(" ");
}

function formatDetails(details: Record<string, any>): string {
  if (!details || Object.keys(details).length === 0) return "";
  const parts: string[] = [];

  if ("oldStatus" in details || "newStatus" in details) {
    parts.push(
      `Статус изменён: ${fmtStatus(details.oldStatus)} → ${fmtStatus(details.newStatus)}.`
    );
  }

  if ("dealCreated" in details) {
    parts.push(
      details.dealCreated
        ? "Заказ в учёте создан."
        : "Заказ в учёте не создавался."
    );
  }

  const skip = new Set(["oldStatus", "newStatus", "dealCreated"]);
  for (const [key, value] of Object.entries(details)) {
    if (skip.has(key)) continue;
    const label = detailKeyText[key] || key;
    if (key === "shippedItems") {
      parts.push(`${label}: ${formatShippedItems(value)}`);
      continue;
    }
    parts.push(`${label}: ${fmtDetailValue(key, value)}.`);
  }

  return parts.join(" ");
}

function getEntityHref(log: LogEntry, adminPath: string): string | null {
  const id = String(log.entityId || "").trim();
  if (!id) return null;
  if (log.entityType === "order") return `/${adminPath}/orders?status=all&q=${encodeURIComponent(id)}`;
  if (log.entityType === "deal") return `/${adminPath}/warehouse?tab=deals&deal=${encodeURIComponent(id)}`;
  if (log.entityType === "payment") return `/${adminPath}/warehouse?tab=bank&payment=${encodeURIComponent(id)}`;
  if (log.entityType === "receipt") return `/${adminPath}/warehouse?tab=receipts&receipt=${encodeURIComponent(id)}`;
  if (log.entityType === "product") return `/${adminPath}/products/${encodeURIComponent(id)}`;
  if (log.entityType === "delivery" || log.entityType === "transport") return `/${adminPath}/deliveries`;
  if (log.entityType === "counterparty") return `/${adminPath}/warehouse?tab=counterparties`;
  if (log.entityType === "salary") return `/${adminPath}/warehouse?tab=salaries`;
  if (log.entityType === "cash-collection") return `/${adminPath}/warehouse?tab=bank`;
  return null;
}

export function ActivityLogs({ adminPath = "admin" }: { adminPath?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterAdmin, setFilterAdmin] = useState("");

  const loadLogs = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/activity-logs?limit=500", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Не удалось загрузить логи");
      }
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить логи");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
    const id = window.setInterval(() => loadLogs(true), 5000);
    return () => window.clearInterval(id);
  }, [loadLogs]);

  const admins = useMemo(
    () => [...new Set(logs.map((l) => l.adminName))].filter(Boolean),
    [logs]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return logs.filter((log) => {
      if (filterAction && log.action !== filterAction) return false;
      if (filterEntity && log.entityType !== filterEntity) return false;
      if (filterAdmin && log.adminName !== filterAdmin) return false;
      if (!q) return true;
      const hay = [
        log.adminName,
        log.adminRole,
        log.action,
        log.entityType,
        log.entityId,
        log.entityLabel,
        log.ipAddress,
        formatDetails(log.details),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [filterAction, filterAdmin, filterEntity, logs, search]);

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ position: "relative", flex: "1 1 360px", minWidth: 260 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
          <input
            className="admin-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: пользователь, действие, ID операции..."
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select className="admin-select" value={filterAdmin} onChange={(e) => setFilterAdmin(e.target.value)} style={{ width: 150, flex: "0 0 150px" }}>
          <option value="">Пользователь: все</option>
          {admins.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="admin-select" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={{ width: 145, flex: "0 0 145px" }}>
          <option value="">Действие: все</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="admin-select" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} style={{ width: 145, flex: "0 0 145px" }}>
          <option value="">Объект: все</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="admin-btn admin-btn--ghost" onClick={() => loadLogs(true)} disabled={refreshing} style={{ flex: "0 0 auto" }}>
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Обновить
        </button>
        <span className="admin-muted" style={{ fontSize: 12, flex: "0 0 auto" }}>
          авто 5 сек.
        </span>
      </div>

      {error && <div className="wh-form-error">{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--adm-kraft)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="admin-empty">
          <Clock size={40} style={{ color: "var(--adm-sand)" }} />
          <p>Логов пока нет</p>
        </div>
      ) : (
        <div className="admin-card">
          <div className="admin-table-wrap" style={{ overflowX: "auto" }}>
            <table className="admin-table" style={{ minWidth: 1120, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 142 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 118 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 170 }} />
                <col />
                <col style={{ width: 112 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>ID / перейти</th>
                  <th>Описание и детали</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const meta = actionLabels[log.action] || { label: log.action || "Действие", color: "admin-badge--muted", icon: Edit2 };
                  const Icon = meta.icon;
                  const details = formatDetails(log.details);
                  const entityHref = getEntityHref(log, adminPath);
                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmtDateTime(log.createdAt)}</td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{log.adminName || "Система"}</div>
                        <div className="admin-muted" style={{ fontSize: 11 }}>
                          {adminRoleLabels[log.adminRole] || log.adminRole || "—"}
                        </div>
                      </td>
                      <td style={{ overflow: "hidden" }}>
                        <span className={`admin-badge ${meta.color}`} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <Icon size={10} /> {meta.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                          {entityLabels[log.entityType] || log.entityType || "—"}
                        </div>
                      </td>
                      <td style={{ fontSize: 11, overflow: "hidden" }}>
                        {entityHref ? (
                          <Link
                            href={entityHref}
                            prefetch={false}
                            className="bank-pay__doc"
                            title={log.entityId || "Открыть"}
                            style={{ display: "block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {log.entityId || "Открыть"}
                          </Link>
                        ) : (
                          <span title={log.entityId || ""} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {log.entityId || "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{log.entityLabel || "—"}</div>
                        {details && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: 8,
                              borderRadius: 8,
                              background: "rgba(27,43,75,0.04)",
                              border: "1px solid rgba(200,196,188,0.5)",
                              color: "var(--adm-ink)",
                              fontSize: 12,
                              lineHeight: 1.45,
                              overflowWrap: "anywhere",
                            }}
                          >
                            {details}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 11, whiteSpace: "nowrap" }}>{log.ipAddress || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
