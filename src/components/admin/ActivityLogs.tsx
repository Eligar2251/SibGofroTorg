// src/components/admin/ActivityLogs.tsx
// Просмотр логов действий администраторов
"use client";

import { useState, useEffect } from "react";
import { Clock, User, Search, Loader2, Eye, Edit2, Trash2, LogIn, Send, Download } from "lucide-react";

interface LogEntry {
  id: string;
  adminName: string;
  adminRole: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  details: Record<string, any>;
  ipAddress: string;
  createdAt: string;
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
  deal: "Заказ",
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
};

function fmtDateTime(raw: string): string {
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

export function ActivityLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterAdmin, setFilterAdmin] = useState("");

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/activity-logs?limit=200");
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  const admins = [...new Set(logs.map((l) => l.adminName))].filter(Boolean);

  const filtered = logs.filter((log) => {
    if (filterAction && log.action !== filterAction) return false;
    if (filterEntity && log.entityType !== filterEntity) return false;
    if (filterAdmin && log.adminName !== filterAdmin) return false;
    if (search) {
      const hay = `${log.adminName} ${log.entityLabel} ${log.entityType} ${log.action} ${JSON.stringify(log.details || {})}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="admin-stack">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-sand)" }} />
          <input
            className="admin-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по действиям..."
            style={{ paddingLeft: 32 }}
          />
        </div>
        <select className="admin-select" value={filterAdmin} onChange={(e) => setFilterAdmin(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">Все сотрудники</option>
          {admins.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="admin-select" value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">Все действия</option>
          {Object.entries(actionLabels).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="admin-select" value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">Все объекты</option>
          {Object.entries(entityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="admin-btn admin-btn--ghost" onClick={loadLogs}>Обновить</button>
      </div>

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
                  <th>Время</th>
                  <th>Сотрудник</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const meta = actionLabels[log.action] || { label: log.action, color: "admin-badge--muted", icon: Edit2 };
                  const Icon = meta.icon;
                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12 }}>{fmtDateTime(log.createdAt)}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{log.adminName}</span>
                        {log.adminRole === "manager" && (
                          <span className="admin-badge admin-badge--muted" style={{ marginLeft: 4 }}>менеджер</span>
                        )}
                      </td>
                      <td>
                        <span className={`admin-badge ${meta.color}`}>
                          <Icon size={10} /> {meta.label}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--adm-ink-muted)" }}>
                          {entityLabels[log.entityType] || log.entityType}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 13 }}>{log.entityLabel || "—"}</span>
                        {log.details && Object.keys(log.details).length > 0 && (
                          <div style={{ fontSize: 11, color: "var(--adm-sand)", marginTop: 2, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {JSON.stringify(log.details)}
                          </div>
                        )}
                      </td>
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
