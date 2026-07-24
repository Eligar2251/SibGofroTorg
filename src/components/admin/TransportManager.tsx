// src/components/admin/TransportManager.tsx
// Система перевозок: создание, управление, завершение, архив
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck, Calendar, User, MapPin, Phone, Package, CheckCircle2,
  Clock, Loader2, Plus, Trash2, Printer, X, Archive, RotateCcw,
  ChevronDown, ChevronUp, AlertTriangle, Banknote,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { TransportPrintSheet, type TransportPrintData } from "./TransportPrintSheet";

type FilterTab = "active" | "completed" | "archived" | "all";

export interface TransportDeal {
  id: string;
  number: number;
  customerName: string;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  items: { productId: string; name: string; quantity: number }[];
  totalSum?: number | null;
  shippedItems?: { productId: string; shippedQty: number }[];
  deliveryItems?: { productId: string; quantity: number }[];
}

export interface TransportRow {
  id: string;
  number: number;
  date: string;
  plannedDate?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  status: "draft" | "active" | "completed" | "archived";
  note?: string | null;
  items: {
    dealId: string;
    dealNumber: number;
    customerName: string;
    address: string | null;
    phone: string | null;
    items: { productId: string; name: string; orderedQty: number; transportQty: number }[];
    totalSum: number | null;
  }[];
  totalItems: number;
  completedAt?: string | null;
  createdAt?: string | null;
}

export interface DriverOption {
  id: string;
  name: string;
  phone?: string | null;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
};
const fmtDateTime = (raw: any) => {
  if (!raw) return "—";
  const d = new Date(raw);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function TransportManager({
  transports: initialTransports,
  pendingDeals,
  drivers,
  companyPhone,
  companyAddress,
}: {
  transports: TransportRow[];
  pendingDeals: TransportDeal[];
  drivers: DriverOption[];
  companyPhone?: string;
  companyAddress?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [printData, setPrintData] = useState<TransportPrintData | null>(null);

  const filtered = useMemo(() => {
    let list = [...initialTransports];
    if (tab === "active") list = list.filter((t) => t.status === "draft" || t.status === "active");
    else if (tab === "completed") list = list.filter((t) => t.status === "completed");
    else if (tab === "archived") list = list.filter((t) => t.status === "archived");
    return list;
  }, [initialTransports, tab]);

  const stats = useMemo(() => ({
    active: initialTransports.filter((t) => t.status === "draft" || t.status === "active").length,
    completed: initialTransports.filter((t) => t.status === "completed").length,
    archived: initialTransports.filter((t) => t.status === "archived").length,
    pending: pendingDeals.length,
  }), [initialTransports, pendingDeals]);

  async function apiCall(url: string, method: string, body?: any) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
    return null;
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить перевозку?")) return;
    await apiCall(`/api/admin/transports/${id}`, "DELETE");
  }

  async function handleComplete(id: string) {
    if (!confirm("Завершить перевозку? Товары будут списаны со склада.")) return;
    await apiCall(`/api/admin/transports/${id}`, "PATCH", { action: "complete" });
  }

  async function handleArchive(id: string) {
    await apiCall(`/api/admin/transports/${id}`, "PATCH", { action: "archive" });
  }

  function handlePrint(t: TransportRow) {
    setPrintData({
      transportNumber: t.number,
      date: t.plannedDate || t.date,
      driverName: t.driverName,
      driverPhone: t.driverPhone,
      items: t.items,
      companyPhone,
      companyAddress,
    });
  }

  return (
    <div>
      {printData && <TransportPrintSheet data={printData} onDone={() => setPrintData(null)} />}

      {/* ── Шапка ── */}
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Перевозки</h1>
          <p className="admin-sub">Формирование, печать бланков, отгрузка и архив</p>
        </div>
        <div className="admin-page-head__actions">
          {pendingDeals.length > 0 && (
            <button className="admin-btn admin-btn--primary" onClick={() => setShowCreate(true)}>
              <Plus size={15} /> Новая перевозка ({stats.pending})
            </button>
          )}
        </div>
      </div>

      {/* ── Статистика ── */}
      <div className="admin-stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: "Ожидают формирования", value: stats.pending, icon: <Clock size={18} />, color: "#d97706", bg: "rgba(217,119,6,0.12)" },
          { label: "Активные", value: stats.active, icon: <Truck size={18} />, color: "#1d4ed8", bg: "#eff6ff" },
          { label: "Завершённые", value: stats.completed, icon: <CheckCircle2 size={18} />, color: "#16a34a", bg: "#f0fdf4" },
          { label: "В архиве", value: stats.archived, icon: <Archive size={18} />, color: "#6b7280", bg: "#f3f4f6" },
        ].map((s) => (
          <div key={s.label} className="admin-stat" style={{ cursor: "default" }}>
            <div className="admin-stat__icon" style={{ background: s.bg, color: s.color }}>{s.icon}</div>
            <div className="admin-stat__value">{s.value}</div>
            <div className="admin-stat__label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Фильтры ── */}
      <div className="admin-filters" style={{ marginBottom: 16 }}>
        {([
          { id: "active" as const, label: `Активные (${stats.active})` },
          { id: "completed" as const, label: `Завершённые (${stats.completed})` },
          { id: "archived" as const, label: `Архив (${stats.archived})` },
          { id: "all" as const, label: `Все (${initialTransports.length})` },
        ]).map((f) => (
          <button key={f.id} className={`admin-filter${tab === f.id ? " admin-filter--active" : ""}`} onClick={() => setTab(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="admin-error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ── Список перевозок ── */}
      <div className="admin-card">
        {filtered.length === 0 ? (
          <div className="admin-empty">
            <Truck size={40} style={{ color: "var(--adm-sand)" }} />
            <p>{tab === "active" ? "Нет активных перевозок" : tab === "completed" ? "Нет завершённых" : "Архив пуст"}</p>
          </div>
        ) : (
          <div className="deliv-list">
            {filtered.map((t) => {
              const expanded = expandedId === t.id;
              const isActive = t.status === "draft" || t.status === "active";
              const totalQty = t.items.reduce((s, it) => s + it.items.reduce((s2, i) => s2 + i.transportQty, 0), 0);
              return (
                <div key={t.id} className={`deliv-item${!isActive ? " deliv-item--released" : ""}`}>
                  <div style={{ paddingTop: 4 }}>
                    <Truck size={16} style={{ color: isActive ? "var(--adm-steel)" : "var(--adm-sand)" }} />
                  </div>

                  <div className="deliv-item__main">
                    <button className="deliv-item__top" style={{ cursor: "pointer", background: "none", border: "none", padding: 0, width: "100%", textAlign: "left" }}
                      onClick={() => setExpandedId(expanded ? null : t.id)}>
                      <span className="admin-order__id">ПЕР-{t.number}</span>
                      <span className={`admin-badge ${t.status === "completed" ? "admin-badge--green" : t.status === "archived" ? "admin-badge--muted" : "admin-badge--blue"}`}>
                        {t.status === "draft" ? "Черновик" : t.status === "active" ? "В пути" : t.status === "completed" ? "Завершена" : "Архив"}
                      </span>
                      {t.plannedDate && (
                        <span className="admin-badge admin-badge--indigo">
                          <Calendar size={10} /> {fmtDate(t.plannedDate)}
                        </span>
                      )}
                      {t.driverName && (
                        <span className="admin-badge admin-badge--blue">
                          <User size={10} /> {t.driverName}
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--adm-sand)" }}>
                        {t.items.length} заказ(ов) · {totalQty} шт.
                      </span>
                      <span style={{ color: "var(--adm-sand)", flexShrink: 0 }}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </button>

                    {expanded && (
                      <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 12 }}>
                        {t.items.map((deal) => (
                          <div key={deal.dealId} style={{ marginBottom: 14, padding: "10px 12px", background: "var(--adm-paper)", borderRadius: 8, border: "1px solid var(--adm-border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span className="admin-order__id">ЗК-{deal.dealNumber}</span>
                              <strong style={{ fontSize: 13 }}>{deal.customerName}</strong>
                              {deal.phone && <a href={`tel:${deal.phone}`} style={{ fontSize: 12, color: "var(--adm-steel)" }}><Phone size={11} /> {deal.phone}</a>}
                              {deal.address && <span style={{ fontSize: 12, color: "var(--adm-sand)", marginLeft: "auto" }}><MapPin size={11} /> {deal.address}</span>}
                            </div>
                            {deal.items.map((item) => (
                              <div key={item.productId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "var(--adm-ink-soft)" }}>
                                <span>{item.name} × {item.transportQty} из {item.orderedQty}</span>
                                <span style={{ color: "var(--adm-sand)" }}>
                                  {item.transportQty < item.orderedQty && (
                                    <span style={{ color: "var(--adm-kraft)", fontWeight: 600 }}>остаток: {item.orderedQty - item.transportQty}</span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                        {t.note && <div style={{ fontSize: 12, color: "var(--adm-sand)", marginBottom: 8 }}>📝 {t.note}</div>}

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {isActive && (
                            <button className="admin-btn admin-btn--primary admin-btn--sm" disabled={saving} onClick={() => handleComplete(t.id)}>
                              <CheckCircle2 size={13} /> Завершить перевозку
                            </button>
                          )}
                          {t.status === "completed" && (
                            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={saving} onClick={() => handleArchive(t.id)}>
                              <Archive size={13} /> В архив
                            </button>
                          )}
                          <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={() => handlePrint(t)}>
                            <Printer size={13} /> Бланк водителю
                          </button>
                          {isActive && (
                            <button className="admin-btn admin-btn--danger admin-btn--sm" disabled={saving} onClick={() => handleDelete(t.id)}>
                              <Trash2 size={13} /> Удалить
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right", flexShrink: 0, fontSize: 11, color: "var(--adm-sand)" }}>
                    {fmtDateTime(t.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Модалка создания перевозки ── */}
      {showCreate && (
        <CreateTransportModal
          deals={pendingDeals}
          drivers={drivers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Модалка создания перевозки ── */
function CreateTransportModal({ deals, drivers, onClose, onCreated }: {
  deals: TransportDeal[];
  drivers: DriverOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [driverId, setDriverId] = useState("");
  const [note, setNote] = useState("");
  // {dealId: {productId: qty}}
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>({});

  function toggleDeal(dealId: string) {
    setSelectedDeals((prev) => {
      const next = new Set(prev);
      if (next.has(dealId)) {
        next.delete(dealId);
      } else {
        next.add(dealId);
        // Инициализируем количества
        const deal = deals.find((d) => d.id === dealId);
        if (deal) {
          const existing = qtys[dealId] || {};
          if (Object.keys(existing).length === 0) {
            const newQtys: Record<string, number> = {};
            for (const item of deal.items) {
              const alreadyShipped = (deal.shippedItems || []).find((s) => s.productId === item.productId)?.shippedQty || 0;
              const alreadyPlanned = (deal.deliveryItems || []).find((d) => d.productId === item.productId)?.quantity || 0;
              newQtys[item.productId] = Math.max(0, item.quantity - alreadyShipped - alreadyPlanned);
            }
            setQtys((prev) => ({ ...prev, [dealId]: newQtys }));
          }
        }
      }
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedDeals.size === 0) { setError("Выберите заказы"); return; }
    const driver = drivers.find((d) => d.id === driverId);

    const items = [...selectedDeals].map((dealId) => {
      const deal = deals.find((d) => d.id === dealId)!;
      const dealQtys = qtys[dealId] || {};
      return {
        dealId: deal.id,
        dealNumber: deal.number,
        customerName: deal.customerName,
        address: deal.deliveryAddress || null,
        phone: deal.customerPhone || null,
        items: deal.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          orderedQty: item.quantity,
          transportQty: dealQtys[item.productId] || 0,
        })),
        totalSum: deal.totalSum || null,
      };
    });

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/transports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          plannedDate: date,
          driverId: driver?.id || null,
          driverName: driver?.name || null,
          driverPhone: driver?.phone || null,
          note: note || null,
          items,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay">
        <div className="admin-modal wh-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Новая перевозка</h3>
            <button type="button" onClick={onClose} className="admin-modal__close"><X size={14} /></button>
          </div>

          <div className="wh-form-grid" style={{ marginBottom: 16 }}>
            <div className="admin-field">
              <label className="admin-label">Дата</label>
              <input type="date" className="admin-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="admin-field">
              <label className="admin-label">Водитель</label>
              <select className="admin-select" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Не назначен</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.phone ? ` · ${d.phone}` : ""}</option>)}
              </select>
            </div>
            <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
              <label className="admin-label">Заметка</label>
              <input className="admin-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Необязательно" />
            </div>
          </div>

          <label className="admin-label" style={{ marginBottom: 8 }}>Заказы для перевозки</label>
          <div style={{ maxHeight: "45vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {deals.length === 0 ? (
              <div className="admin-empty" style={{ padding: 20 }}>Нет заказов с доставкой</div>
            ) : deals.map((deal) => {
              const sel = selectedDeals.has(deal.id);
              return (
                <div key={deal.id} style={{ border: `1px solid ${sel ? "var(--adm-kraft)" : "var(--adm-border)"}`, borderRadius: 8, padding: 12, background: sel ? "var(--adm-kraft-pale)" : "var(--adm-card)", transition: "all 0.12s" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: sel ? 10 : 0 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleDeal(deal.id)} />
                    <strong style={{ fontSize: 13 }}>ЗК-{deal.number}</strong>
                    <span style={{ fontSize: 13 }}>{deal.customerName}</span>
                    {deal.deliveryAddress && <span style={{ fontSize: 11, color: "var(--adm-sand)", marginLeft: "auto" }}><MapPin size={10} /> {deal.deliveryAddress}</span>}
                  </label>
                  {sel && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 26 }}>
                      {deal.items.map((item) => {
                        const alreadyShipped = (deal.shippedItems || []).find((s) => s.productId === item.productId)?.shippedQty || 0;
                        const alreadyPlanned = (deal.deliveryItems || []).find((d) => d.productId === item.productId)?.quantity || 0;
                        const maxQty = item.quantity - alreadyShipped - alreadyPlanned;
                        const curQty = qtys[deal.id]?.[item.productId] ?? maxQty;
                        return (
                          <div key={item.productId} style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 12 }}>
                              {item.name} <span style={{ color: "var(--adm-sand)" }}>(заказано: {item.quantity}{alreadyShipped > 0 ? `, отгружено: ${alreadyShipped}` : ""}{alreadyPlanned > 0 ? `, в перевозках: ${alreadyPlanned}` : ""})</span>
                            </span>
                            <input type="number" className="admin-input" min={0} max={maxQty} value={curQty} style={{ textAlign: "right" }}
                              onChange={(e) => {
                                const v = Math.min(Math.max(0, Number(e.target.value) || 0), maxQty);
                                setQtys((prev) => ({ ...prev, [deal.id]: { ...(prev[deal.id] || {}), [item.productId]: v } }));
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <div className="admin-error" style={{ marginTop: 10 }}>{error}</div>}

          <div className="admin-modal__actions" style={{ marginTop: 14 }}>
            <button type="button" onClick={onClose} className="admin-btn admin-btn--ghost" disabled={saving}>Отмена</button>
            <button type="button" onClick={handleSubmit} className="admin-btn admin-btn--primary" disabled={saving || selectedDeals.size === 0}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              Создать перевозку ({selectedDeals.size})
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
