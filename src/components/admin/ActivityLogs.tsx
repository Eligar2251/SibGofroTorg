// src/components/admin/ActivityLogs.tsx
// Журнал действий администраторов: кто, что и когда сделал.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function prettyJson(value: Record<string, any>): string {
  if (!value || Object.keys(value).length === 0) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ActivityLogs() {
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
        prettyJson(log.details),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [filterAction, filterAdmin, filterEntity, logs, search]);

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
          <input
            className="admin-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: пользователь, действие, объект, ID, детали..."
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select className="admin-select" value={filterAdmin} onChange={(e) => setFilterAdmin(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Все пользователи</option>
          {admins.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="admin-select" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Все действия</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="admin-select" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Все объекты</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="admin-btn admin-btn--ghost" onClick={() => loadLogs(true)} disabled={refreshing}>
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Обновить
        </button>
        <span className="admin-muted" style={{ fontSize: 12 }}>
          Автообновление каждые 5 сек.
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
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>ID</th>
                  <th>Описание и детали</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const meta = actionLabels[log.action] || { label: log.action || "Действие", color: "admin-badge--muted", icon: Edit2 };
                  const Icon = meta.icon;
                  const details = prettyJson(log.details);
                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmtDateTime(log.createdAt)}</td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{log.adminName || "Система"}</div>
                        <div className="admin-muted" style={{ fontSize: 11 }}>
                          {log.adminRole || "—"}
                        </div>
                      </td>
                      <td>
                        <span className={`admin-badge ${meta.color}`}>
                          <Icon size={10} /> {meta.label}
                        </span>
                        <div className="admin-muted" style={{ fontSize: 11, marginTop: 3 }}>
                          {log.action}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 700 }}>
                          {entityLabels[log.entityType] || log.entityType || "—"}
                        </div>
                        <div className="admin-muted" style={{ fontSize: 11 }}>
                          {log.entityType || "—"}
                        </div>
                      </td>
                      <td style={{ fontSize: 11, maxWidth: 160, overflowWrap: "anywhere" }}>
                        {log.entityId || "—"}
                      </td>
                      <td style={{ minWidth: 260 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{log.entityLabel || "—"}</div>
                        {details && (
                          <pre
                            style={{
                              margin: "6px 0 0",
                              padding: 8,
                              borderRadius: 8,
                              background: "rgba(27,43,75,0.04)",
                              border: "1px solid rgba(200,196,188,0.5)",
                              color: "var(--adm-ink)",
                              fontSize: 11,
                              whiteSpace: "pre-wrap",
                              maxHeight: 220,
                              overflow: "auto",
                            }}
                          >
                            {details}
                          </pre>
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
