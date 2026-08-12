// src/components/admin/TransportManager.tsx
// Система перевозок: создание, управление, завершение, архив
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck, Calendar, User, MapPin, Phone, Package, CheckCircle2,
  Clock, Loader2, Plus, Trash2, Printer, X, Archive, RotateCcw,
  ChevronDown, ChevronUp, AlertTriangle, Banknote, PackageSearch,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { ProductPicker, type PickerProduct } from "@/components/admin/ProductPicker";
import { TransportPrintSheet, type TransportPrintData } from "./TransportPrintSheet";

export type TripType = "delivery" | "pickup" | "handover";

export const TRIP_TYPE_LABEL: Record<TripType, string> = {
  delivery: "Доставка клиенту",
  pickup: "Забор груза",
  handover: "Сдача груза",
};

export const TRIP_TYPE_SHORT: Record<TripType, string> = {
  delivery: "Доставка",
  pickup: "Забор груза",
  handover: "Сдача груза",
};

type FilterTab = "active" | "completed" | "archived" | "all";

export interface TransportDeal {
  id: string;
  number: number;
  customerName: string;
  contactName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryNote?: string | null;
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
    contactName?: string | null;
    address: string | null;
    phone: string | null;
    deliveryNote?: string | null;
    items: { productId: string | null; name: string; orderedQty: number; transportQty: number }[];
    totalSum: number | null;
    tripType?: TripType | null;
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
  focusTransportId,
  products = [],
}: {
  transports: TransportRow[];
  pendingDeals: TransportDeal[];
  drivers: DriverOption[];
  companyPhone?: string;
  companyAddress?: string;
  focusTransportId?: string | null;
  /** Товары каталога сайта — для выбора груза в самостоятельных поездках */
  products?: PickerProduct[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(focusTransportId || null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!focusTransportId) return;
    const focused = initialTransports.find((transport) => transport.id === focusTransportId);
    setTab(
      focused?.status === "archived"
        ? "archived"
        : focused?.status === "completed"
          ? "completed"
          : "active"
    );
    setExpandedId(focusTransportId);
    window.setTimeout(() => {
      document
        .getElementById(`transport-${focusTransportId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [focusTransportId, initialTransports]);
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
          <button className="admin-btn admin-btn--primary" onClick={() => setShowCreate(true)}>
            <Plus size={15} /> Новая перевозка
          </button>
        </div>
      </div>

      {/* ── Статистика ── */}
      <div className="admin-stat-grid" style={{ marginBottom: 20 }}>
        {[
          { label: "Ожидают формирования", value: stats.pending, icon: <Clock size={18} />, color: "var(--adm-kraft)", bg: "var(--adm-kraft-pale)" },
          { label: "Активные", value: stats.active, icon: <Truck size={18} />, color: "var(--adm-steel)", bg: "var(--adm-steel-pale)" },
          { label: "Завершённые", value: stats.completed, icon: <CheckCircle2 size={18} />, color: "var(--adm-pine)", bg: "var(--adm-pine-pale)" },
          { label: "В архиве", value: stats.archived, icon: <Archive size={18} />, color: "var(--adm-sand)", bg: "var(--adm-sand-pale)" },
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
                <div
                  key={t.id}
                  id={`transport-${t.id}`}
                  className={`deliv-item${!isActive ? " deliv-item--released" : ""}${focusTransportId === t.id ? " admin-order--highlighted" : ""}`}
                >
                  <div style={{ paddingTop: 4 }}>
                    <Truck size={16} style={{ color: isActive ? "var(--adm-steel)" : "var(--adm-sand)" }} />
                  </div>

                  <div className="deliv-item__main">
                    <button className="deliv-item__top" style={{ cursor: "pointer", background: "none", border: "none", padding: 0, width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                      onClick={() => setExpandedId(expanded ? null : t.id)}>
                      <span className="admin-order__id">ПЕР-{t.number}</span>
                      <span className={`admin-badge ${t.status === "completed" ? "admin-badge--green" : t.status === "archived" ? "admin-badge--muted" : "admin-badge--blue"}`}>
                        {t.status === "draft" ? "Черновик" : t.status === "active" ? "В пути" : t.status === "completed" ? "Завершена" : "Архив"}
                      </span>
                      {t.plannedDate && (
                        <span className="admin-badge admin-badge--indigo" style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                          <Calendar size={10} style={{ flexShrink: 0 }} /> {fmtDate(t.plannedDate)}
                        </span>
                      )}
                      {t.driverName && (
                        <span className="admin-badge admin-badge--blue" style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                          <User size={10} style={{ flexShrink: 0 }} /> {t.driverName}
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
                        {t.items.map((deal, idx) => (
                          <div key={deal.dealId || `custom-${deal.customerName}-${idx}`} style={{ marginBottom: 14, padding: "10px 12px", background: "var(--adm-paper)", borderRadius: 8, border: "1px solid var(--adm-border)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span className="admin-order__id">{deal.dealNumber ? `ЗК-${deal.dealNumber}` : "Самостоятельная перевозка"}</span>
                              {!deal.dealNumber && deal.tripType && deal.tripType !== "delivery" && (
                                <span className={`admin-badge ${deal.tripType === "pickup" ? "admin-badge--blue" : "admin-badge--indigo"}`}>
                                  {TRIP_TYPE_SHORT[deal.tripType]}
                                </span>
                              )}
                              <strong style={{ fontSize: 13 }}>{deal.customerName}</strong>
                      {deal.phone && (
                        <a href={`tel:${deal.phone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--adm-steel)", whiteSpace: "nowrap" }}>
                          <Phone size={11} style={{ flexShrink: 0 }} /> {deal.phone}
                        </a>
                      )}
                      {deal.address && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--adm-sand)", marginLeft: "auto", minWidth: 0, overflow: "hidden" }}>
                          <MapPin size={11} style={{ flexShrink: 0 }} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.address}</span>
                        </span>
                      )}
                            </div>
                            {deal.items.map((item, itemIdx) => (
                              <div key={item.productId || `it-${item.name}-${itemIdx}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "var(--adm-ink-soft)" }}>
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

                        <div className="transport-modal__trip-types" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          products={products}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Модалка создания перевозки ── */
interface CustomCargoRow {
  productId: string | null;
  name: string;
  transportQty: number;
}

interface CustomIndependentTrip {
  id: string;
  tripType: TripType;
  customerName: string;
  contactName: string;
  phone: string;
  address: string;
  deliveryNote: string;
  items: CustomCargoRow[];
}

function CreateTransportModal({ deals, drivers, products, onClose, onCreated }: {
  deals: TransportDeal[];
  drivers: DriverOption[];
  products?: PickerProduct[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [rowPicker, setRowPicker] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [driverId, setDriverId] = useState("");
  const [note, setNote] = useState("");
  // {dealId: {productId: qty}}
  const [selectedDeals, setSelectedDeals] = useState<Set<string>>(new Set());
  const [qtys, setQtys] = useState<Record<string, Record<string, number>>>({});
  const [customTrips, setCustomTrips] = useState<CustomIndependentTrip[]>([]);

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
    if (selectedDeals.size === 0 && customTrips.length === 0) {
      setError("Выберите хотя бы один заказ или добавьте самостоятельную поездку");
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);

    const items = [];

    // 1. Process selected deals
    for (const dealId of selectedDeals) {
      const deal = deals.find((d) => d.id === dealId)!;
      const dealQtys = qtys[dealId] || {};
      items.push({
        dealId: deal.id,
        dealNumber: deal.number,
        customerName: deal.customerName,
        contactName: deal.contactName || null,
        address: deal.deliveryAddress || null,
        phone: deal.customerPhone || null,
        deliveryNote: deal.deliveryNote || null,
        items: deal.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          orderedQty: item.quantity,
          transportQty: dealQtys[item.productId] || 0,
        })),
        totalSum: deal.totalSum || null,
      });
    }

    // 2. Process custom independent trips
    for (const trip of customTrips) {
      if (!trip.customerName.trim()) {
        setError("Укажите контрагента для самостоятельной поездки");
        return;
      }
      if (!trip.address.trim()) {
        setError("Укажите адрес (куда ехать) для самостоятельной поездки");
        return;
      }
      const tripItems = trip.items.filter(it => it.name.trim() && it.transportQty > 0);
      if (tripItems.length === 0) {
        setError("Добавьте хотя бы один товар/груз в самостоятельной поездке");
        return;
      }
      const tripType = trip.tripType || "delivery";
      items.push({
        dealId: null,
        dealNumber: null,
        customerName: trip.customerName.trim(),
        contactName: trip.contactName.trim() || null,
        address: trip.address.trim() || null,
        phone: trip.phone.trim() || null,
        deliveryNote: trip.deliveryNote.trim() || null,
        items: tripItems.map(it => ({
          productId: it.productId || null,
          name: it.name.trim(),
          orderedQty: it.transportQty,
          transportQty: it.transportQty,
        })),
        totalSum: null,
        // Тип поездки: доставка клиенту / забор груза / сдача груза.
        // Для поездок по заказам всегда "delivery" (не задаём — по умолчанию).
        tripType,
      });
    }

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
      <div className="admin-modal-overlay" data-admin="true">
        <div className="admin-modal wh-modal transport-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
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
          <div className="transport-modal__orders" style={{ maxHeight: "45vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
            {deals.length === 0 ? (
              <div className="admin-empty" style={{ padding: 20 }}>Нет заказов с доставкой</div>
            ) : deals.map((deal) => {
              const sel = selectedDeals.has(deal.id);
              return (
                <div key={deal.id} className="transport-modal__order" style={{ border: `1px solid ${sel ? "var(--adm-kraft)" : "var(--adm-border)"}`, borderRadius: 8, padding: 12, background: sel ? "var(--adm-kraft-pale)" : "var(--adm-card)", transition: "all 0.12s" }}>
                  <label className="transport-modal__order-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: sel ? 10 : 0 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleDeal(deal.id)} />
                    <strong style={{ fontSize: 13 }}>ЗК-{deal.number}</strong>
                    <span style={{ fontSize: 13 }}>{deal.customerName}</span>
                    {deal.deliveryAddress && (
                      <span className="transport-modal__address" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--adm-sand)", marginLeft: "auto", minWidth: 0, overflow: "hidden" }}>
                        <MapPin size={10} style={{ flexShrink: 0 }} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.deliveryAddress}</span>
                      </span>
                    )}
                  </label>
                  {sel && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 26 }}>
                      {deal.items.map((item) => {
                        const alreadyShipped = (deal.shippedItems || []).find((s) => s.productId === item.productId)?.shippedQty || 0;
                        const alreadyPlanned = (deal.deliveryItems || []).find((d) => d.productId === item.productId)?.quantity || 0;
                        const maxQty = item.quantity - alreadyShipped - alreadyPlanned;
                        const curQty = qtys[deal.id]?.[item.productId] ?? maxQty;
                        return (
                          <div key={item.productId} className="transport-modal__deal-item" style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 8, alignItems: "center" }}>
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

          {/* Раздел самостоятельных перевозок (без заказа) */}
          <div style={{ marginTop: 16, borderTop: "1px solid var(--adm-border)", paddingTop: 16 }}>
            <div className="transport-modal__custom-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <label className="admin-label" style={{ margin: 0 }}>Самостоятельные перевозки (без привязки к заказам)</label>
              <button
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm transport-modal__add-trip"
                onClick={() => {
                  setCustomTrips(prev => [
                    ...prev,
                    {
                      id: Math.random().toString(36).substring(7),
                      tripType: "delivery",
                      customerName: "",
                      contactName: "",
                      phone: "",
                      address: "",
                      deliveryNote: "",
                      items: [{ productId: null, name: "Макулатура", transportQty: 100 }],
                    }
                  ]);
                }}
              >
                <Plus size={13} style={{ marginRight: 4 }} /> Добавить самостоятельную перевозку
              </button>
            </div>

            {customTrips.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: "35vh", overflowY: "auto", paddingRight: 4 }}>
                {customTrips.map((trip, tripIdx) => (
                  <div
                    key={trip.id}
                    style={{
                      border: "1px solid var(--adm-kraft)",
                      borderRadius: 8,
                      padding: 12,
                      background: "rgba(224, 155, 18, 0.03)",
                      position: "relative",
                    }}
                  >
                    {/* Кнопка удаления поездки */}
                    <button
                      type="button"
                      onClick={() => {
                        setCustomTrips(prev => prev.filter(t => t.id !== trip.id));
                      }}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        background: "none",
                        border: "none",
                        color: "var(--adm-rust)",
                        cursor: "pointer",
                      }}
                      title="Удалить поездку"
                    >
                      <Trash2 size={15} />
                    </button>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: "var(--adm-kraft)" }}>
                        🚗 Самостоятельная перевозка #{tripIdx + 1}
                      </span>
                      <span className={`admin-badge ${trip.tripType === "pickup" ? "admin-badge--blue" : trip.tripType === "handover" ? "admin-badge--indigo" : "admin-badge--green"}`}>
                        {TRIP_TYPE_SHORT[trip.tripType || "delivery"]}
                      </span>
                    </div>

                    {/* Тип поездки: доставка / забор груза / сдача груза */}
                    <div className="admin-field" style={{ marginBottom: 12 }}>
                      <label className="admin-label">Тип поездки</label>
                      <div className="transport-modal__trip-types" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {([
                          { id: "delivery" as TripType, label: "🚚 Доставка клиенту", hint: "везём товар клиенту" },
                          { id: "pickup" as TripType, label: "📥 Забор груза", hint: "забираем груз у контрагента" },
                          { id: "handover" as TripType, label: "📤 Сдача груза", hint: "сдаём груз (напр. на переработку)" },
                        ]).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            className={`admin-btn ${(trip.tripType || "delivery") === opt.id ? "admin-btn--primary" : "admin-btn--ghost"}`}
                            style={{ flex: 1, minWidth: 150 }}
                            title={opt.hint}
                            onClick={() => {
                              setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, tripType: opt.id } : t));
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <span className="wh-form-hint" style={{ margin: "4px 0 0" }}>
                        Забор — забираем груз у контрагента, сдача — привозим груз (например, на переработку).
                      </span>
                    </div>

                    <div className="wh-form-grid" style={{ marginBottom: 12 }}>
                      <div className="admin-field">
                        <label className="admin-label">
                          {trip.tripType === "pickup" ? "Откуда забираем (Контрагент) *" : trip.tripType === "handover" ? "Куда сдаём (Контрагент) *" : "Контрагент / Клиент *"}
                        </label>
                        <input
                          type="text"
                          className="admin-input"
                          value={trip.customerName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, customerName: val } : t));
                          }}
                          placeholder="ООО 'Приемка', Магазин..."
                          required
                        />
                      </div>

                      <div className="admin-field">
                        <label className="admin-label">Адрес *</label>
                        <input
                          type="text"
                          className="admin-input"
                          value={trip.address}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, address: val } : t));
                          }}
                          placeholder="ул. Сибирская, 10..."
                          required
                        />
                      </div>

                      <div className="admin-field">
                        <label className="admin-label">Контактное лицо</label>
                        <input
                          type="text"
                          className="admin-input"
                          value={trip.contactName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, contactName: val } : t));
                          }}
                          placeholder="Имя получателя"
                        />
                      </div>

                      <div className="admin-field">
                        <label className="admin-label">Телефон</label>
                        <input
                          type="text"
                          className="admin-input"
                          value={trip.phone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, phone: val } : t));
                          }}
                          placeholder="+7..."
                        />
                      </div>

                      <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                        <label className="admin-label">Заметка водителю</label>
                        <input
                          type="text"
                          className="admin-input"
                          value={trip.deliveryNote}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomTrips(prev => prev.map(t => t.id === trip.id ? { ...t, deliveryNote: val } : t));
                          }}
                          placeholder="Сдать макулатуру, забрать коробки..."
                        />
                      </div>
                    </div>

                    {/* Товары для этой самостоятельной поездки */}
                    <div style={{ borderTop: "1px dashed var(--adm-border)", paddingTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, fontWeight: 700 }}>📦 Груз / Товары:</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className="admin-btn admin-btn--outline admin-btn--sm"
                            disabled={!products || products.length === 0}
                            title={!products || products.length === 0 ? "Каталог не загружен" : "Выбрать товар из каталога сайта"}
                            onClick={() => setRowPicker(`${trip.id}:new`)}
                          >
                            <PackageSearch size={13} /> Из каталога
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            onClick={() => {
                              setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                ...t,
                                items: [...t.items, { productId: null, name: "", transportQty: 10 }]
                              } : t));
                            }}
                          >
                            + Добавить строку груза
                          </button>
                        </div>
                      </div>

                      {/* Выбор товара из каталога сайта */}
                      {rowPicker === `${trip.id}:new` && (
                        <div style={{ marginBottom: 8 }}>
                          <ProductPicker
                            products={products || []}
                            onPick={(p) => {
                              setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                ...t,
                                items: [...t.items, { productId: p.id, name: p.name, transportQty: 10 }],
                              } : t));
                              setRowPicker(null);
                            }}
                            placeholder="Поиск товара по каталогу сайта..."
                          />
                        </div>
                      )}

                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {trip.items.map((item, itemIdx) => {
                          const pickerKey = `${trip.id}:${itemIdx}`;
                          return (
                            <div key={`${trip.id}-${itemIdx}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <div className="transport-modal__cargo-row" style={{ display: "grid", gridTemplateColumns: "1fr 100px 30px", gap: 8, alignItems: "center" }}>
                                <input
                                  type="text"
                                  className="admin-input"
                                  value={item.name}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                      ...t,
                                      // Пользователь правит название вручную — привязка к товару каталога сбрасывается
                                      items: t.items.map((it, iIdx) => iIdx === itemIdx ? { ...it, name: val, productId: null } : it)
                                    } : t));
                                  }}
                                  placeholder="Название (например, Макулатура, Поддоны)"
                                  required
                                />
                                <input
                                  type="number"
                                  className="admin-input"
                                  min={1}
                                  value={item.transportQty || ""}
                                  onChange={(e) => {
                                    const val = Math.max(1, Number(e.target.value) || 0);
                                    setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                      ...t,
                                      items: t.items.map((it, iIdx) => iIdx === itemIdx ? { ...it, transportQty: val } : it)
                                    } : t));
                                  }}
                                  style={{ textAlign: "right" }}
                                  required
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                      ...t,
                                      items: t.items.filter((_, iIdx) => iIdx !== itemIdx)
                                    } : t));
                                  }}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--adm-rust)",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                  }}
                                  disabled={trip.items.length <= 1}
                                  title="Удалить товар"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                              <div className="transport-modal__cargo-actions" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                {item.productId ? (
                                  <span className="admin-badge admin-badge--green" style={{ fontSize: 11 }}>
                                    ✓ из каталога: {item.name}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, color: "var(--adm-sand)" }}>
                                    свободное описание груза
                                  </span>
                                )}
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--ghost admin-btn--sm"
                                  style={{ padding: "2px 8px", fontSize: 11 }}
                                  onClick={() => setRowPicker(rowPicker === pickerKey ? null : pickerKey)}
                                >
                                  {item.productId ? "Заменить из каталога" : "Выбрать из каталога"}
                                </button>
                              </div>
                              {rowPicker === pickerKey && (
                                <div style={{ marginBottom: 4 }}>
                                  <ProductPicker
                                    products={products || []}
                                    onPick={(p) => {
                                      setCustomTrips(prev => prev.map(t => t.id === trip.id ? {
                                        ...t,
                                        items: t.items.map((it, iIdx) => iIdx === itemIdx ? { ...it, productId: p.id, name: p.name } : it)
                                      } : t));
                                      setRowPicker(null);
                                    }}
                                    placeholder="Поиск товара по каталогу сайта..."
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className="admin-error" style={{ marginTop: 10 }}>{error}</div>}

          <div className="admin-modal__actions" style={{gap: 10,  marginTop: 14 }}>
            <button type="button" onClick={onClose} className="admin-btn admin-btn--ghost" disabled={saving}>Отмена</button>
            <button type="button" onClick={handleSubmit} className="admin-btn admin-btn--primary" disabled={saving || (selectedDeals.size === 0 && customTrips.length === 0)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              Создать перевозку ({selectedDeals.size + customTrips.length})
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
