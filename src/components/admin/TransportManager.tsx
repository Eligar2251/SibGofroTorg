// src/components/admin/TransportManager.tsx
// Система перевозок: создание, порядок точек маршрута, путевой лист,
// отрывные полоски, завершение и архив.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck, Calendar, User, MapPin, CheckCircle2,
  Clock, Loader2, Plus, Trash2, Printer, X, Archive, RotateCcw,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { TransportPrintSheet, type TransportPrintData } from "./TransportPrintSheet";
import { TransportTripSheet, type TripSheetData } from "./TransportTripSheet";
import { TripStopsEditor } from "./TripStopsEditor";
import {
  TRIP_TYPE_LABEL,
  TRIP_TYPE_SHORT,
  dealAvailableFor,
  emptyCustomStop,
  stopFromDeal,
  stopTotalQty,
  stopsFromTransportItems,
  stopsToTransportItems,
  summarizeStops,
  validateStops,
  type TripStop,
  type TripStopDeal,
  type TripType,
} from "@/lib/trip-stops";

// Совместимость: типы и подписи tripType раньше жили здесь.
export type { TripType } from "@/lib/trip-stops";
export { TRIP_TYPE_LABEL, TRIP_TYPE_SHORT };

export type { TripStop };
/** Заказ с доставкой, из которого можно собрать точку маршрута. */
export type TransportDeal = TripStopDeal;

type FilterTab = "active" | "completed" | "archived" | "all";

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
    dealId: string | null;
    dealNumber: number | null;
    customerName: string;
    contactName?: string | null;
    address: string | null;
    phone: string | null;
    deliveryNote?: string | null;
    plannedTime?: string | null;
    items: {
      productId: string | null;
      name: string;
      orderedQty: number;
      transportQty: number;
    }[];
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
  /** Товары склада — для выбора груза в своих точках маршрута */
  products?: PickerProduct[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(focusTransportId || null);
  const [showCreate, setShowCreate] = useState(false);
  const [printData, setPrintData] = useState<TransportPrintData | null>(null);
  const [tripData, setTripData] = useState<TripSheetData | null>(null);
  // Черновик порядка/пометок для уже созданной перевозки: {id: stops}
  const [stopDraft, setStopDraft] = useState<Record<string, TripStop[]>>({});

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

  /**
   * Сохранить порядок/пометки/количества в уже созданной перевозке.
   * items[] пишется в том же порядке, что в редакторе, — он и есть
   * порядок точек в путевом листе (колонки сортировки не заводим:
   * transports.items — JSONB-массив, он сохраняет порядок записи).
   */
  async function saveStops(t: TransportRow, stops: TripStop[]) {
    const err = validateStops(stops);
    if (err) {
      setError(err);
      return;
    }
    const res = await apiCall(`/api/admin/transports/${t.id}`, "PATCH", {
      items: stopsToTransportItems(stops),
    });
    if (res) {
      setStopDraft((prev) => {
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
      setError("");
    }
  }

  function handlePrint(t: TransportRow, stops: TripStop[]) {
    setPrintData({
      transportNumber: t.number,
      date: t.plannedDate || t.date,
      driverName: t.driverName,
      driverPhone: t.driverPhone,
      // В бланк попадает только реально выбранный/загруженный груз.
      items: stops
        .filter((stop) => stop.lines.length > 0)
        .map((stop) => ({
          dealNumber: stop.dealNumber ?? 0,
          customerName: stop.customerName,
          contactName: stop.contactName,
          address: stop.address,
          phone: stop.phone,
          deliveryNote: stop.deliveryNote,
          tripType: stop.tripType,
          items: stop.lines.map((line) => ({ name: line.name, transportQty: line.qty })),
        })),
      companyPhone,
      companyAddress,
    });
  }

  function handleTripSheet(t: TransportRow, stops: TripStop[]) {
    setTripData({
      transportNumber: t.number,
      date: t.plannedDate || t.date,
      note: t.note,
      driverName: t.driverName,
      driverPhone: t.driverPhone,
      stops,
      companyPhone,
      companyAddress,
    });
  }

  return (
    <div>
      {printData && <TransportPrintSheet data={printData} onDone={() => setPrintData(null)} />}
      {tripData && <TransportTripSheet data={tripData} onDone={() => setTripData(null)} />}

      {/* ── Шапка ── */}
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Перевозки · путевые листы</h1>
          <p className="admin-sub">
            Путевой лист водителю: точки по порядку, пометки «забор / доставка», печать А4
          </p>
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
              const stops = stopDraft[t.id] ?? stopsFromTransportItems(t.items);
              const dirty = Boolean(stopDraft[t.id]);
              const totals = summarizeStops(stops);
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
                        {totals.total} точ. · {totals.qty} шт.
                        {dirty && <strong style={{ color: "var(--adm-kraft)" }}> · не сохранено</strong>}
                      </span>
                      <span style={{ color: "var(--adm-sand)", flexShrink: 0 }}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </button>

                    {expanded && (
                      <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 12 }}>
                        {/* Порядок точек: drag&drop, пометки, время, груз */}
                        <div className="transport-card__stops">
                          <TripStopsEditor
                            stops={stops}
                            defaultOpen="none"
                            onChange={(next) => setStopDraft((prev) => ({ ...prev, [t.id]: next }))}
                            sortable={isActive}
                            editable={isActive}
                            removable={isActive}
                            allowSort={isActive}
                            products={products}
                            title={isActive ? "Порядок точек (правки сохраняются кнопкой ниже)" : "Порядок точек маршрута"}
                            hint={isActive ? "Можно поправить количества — попадёт в бланк и в списание" : undefined}
                            showTotals
                          />
                        </div>

                        {t.note && <div style={{ fontSize: 12, color: "var(--adm-sand)", marginBottom: 8 }}>📝 {t.note}</div>}

                        <div className="transport-modal__trip-types" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => handleTripSheet(t, stops)}>
                            <Printer size={13} /> Путевой лист (А4)
                          </button>
                          <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={() => handlePrint(t, stops)}>
                            <Printer size={13} /> Полоски под УПД
                          </button>
                          {isActive && dirty && (
                            <button className="admin-btn admin-btn--ghost admin-btn--sm" disabled={saving} onClick={() => saveStops(t, stops)}>
                              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Сохранить порядок
                            </button>
                          )}
                          {isActive && dirty && (
                            <button
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              disabled={saving}
                              onClick={() => {
                                setStopDraft((prev) => {
                                  const next = { ...prev };
                                  delete next[t.id];
                                  return next;
                                });
                                setError("");
                              }}
                            >
                              <RotateCcw size={13} /> Отменить правки
                            </button>
                          )}
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
          companyPhone={companyPhone}
          companyAddress={companyAddress}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            // Сразу открываем путевой лист: собрал маршрут → распечатал.
            if (created) setTripData(created);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Модалка создания: заказы → точки маршрута по порядку
   ───────────────────────────────────────────────────────── */

function CreateTransportModal({
  deals,
  drivers,
  products,
  companyPhone,
  companyAddress,
  onClose,
  onCreated,
}: {
  deals: TransportDeal[];
  drivers: DriverOption[];
  products?: PickerProduct[];
  companyPhone?: string;
  companyAddress?: string;
  onClose: () => void;
  /** null — создание не удалось; иначе — данные для немедленной печати */
  onCreated: (created: TripSheetData | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [driverId, setDriverId] = useState("");
  const [note, setNote] = useState("");
  const [panel, setPanel] = useState<"deals" | "stops">("deals");
  // Единый источник правды: порядок = порядок массива.
  const [stops, setStops] = useState<TripStop[]>([]);
  // Предпросмотр путевого листа прямо в модалке
  const [tripPreview, setTripPreview] = useState<TripSheetData | null>(null);

  const selectedDealIds = useMemo(
    () => new Set(stops.filter((s) => s.kind === "deal" && s.dealId).map((s) => String(s.dealId))),
    [stops]
  );
  const totals = summarizeStops(stops);

  function toggleDeal(deal: TransportDeal) {
    const existing = stops.find((s) => s.kind === "deal" && String(s.dealId) === String(deal.id));
    if (existing) {
      setStops((prev) => prev.filter((s) => s.key !== existing.key));
      return;
    }
    setStops((prev) => [...prev, stopFromDeal(deal)]);
  }

  function addCustomStop() {
    setStops((prev) => [...prev, emptyCustomStop()]);
    setPanel("stops");
  }

  /** Сколько едем везём с заказа (для подписи в списке заказов). */
  function dealStopSummary(deal: TransportDeal) {
    const stop = stops.find((s) => s.kind === "deal" && String(s.dealId) === String(deal.id));
    if (!stop) {
      const avail = deal.items.reduce(
        (sum, item) => sum + dealAvailableFor(deal, item.productId),
        0
      );
      return { qty: avail, picked: false };
    }
    return { qty: stopTotalQty(stop), picked: true };
  }

  async function handleSubmit() {
    const err = validateStops(stops);
    if (err) {
      setError(err);
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
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
          items: stopsToTransportItems(stops),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка");
      // Бланк открываем сразу: номер уже присвоен, точки те же, что собрали.
      onCreated({
        transportNumber: Number(data.number) || 0,
        date,
        note: note || null,
        driverName: driver?.name ?? null,
        driverPhone: driver?.phone ?? null,
        stops,
        companyPhone,
        companyAddress,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  function openTripPreview() {
    const err = validateStops(stops);
    if (err) {
      setError(err);
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    setError("");
    setTripPreview({
      transportNumber: 0,
      date,
      note: note || null,
      driverName: driver?.name ?? null,
      driverPhone: driver?.phone ?? null,
      stops,
      companyPhone,
      companyAddress,
    });
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true">
        <div className="admin-modal wh-modal transport-modal transport-modal--builder" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Новая перевозка · путевой лист</h3>
            <button type="button" onClick={onClose} className="admin-modal__close"><X size={14} /></button>
          </div>

          <div className="wh-form-grid" style={{ marginBottom: 12 }}>
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
              <label className="admin-label">Заметка к перевозке (в шапке бланка)</label>
              <input className="admin-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: после 17:00 не звонить, ключи у охранника" />
            </div>
          </div>

          <div className="transport-builder__tabs" role="tablist" aria-label="Шаги">
            <button
              type="button"
              role="tab"
              aria-selected={panel === "deals"}
              className={`admin-filter${panel === "deals" ? " admin-filter--active" : ""}`}
              onClick={() => setPanel("deals")}
            >
              1. Что везём ({deals.length} заказов доступно)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={panel === "stops"}
              className={`admin-filter${panel === "stops" ? " admin-filter--active" : ""}`}
              onClick={() => setPanel("stops")}
            >
              2. Порядок и пометки ({stops.length})
            </button>
          </div>

          {panel === "deals" ? (
            <>
              <div className="transport-modal__orders" style={{ maxHeight: "42vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
                {deals.length === 0 ? (
                  <div className="admin-empty" style={{ padding: 20 }}>Нет заказов с доставкой — добавьте свою точку</div>
                ) : (
                  deals.map((deal) => {
                    const summary = dealStopSummary(deal);
                    return (
                      <div
                        key={deal.id}
                        id={`transport-deal-${deal.id}`}
                        className="transport-modal__order"
                        style={{
                          border: `1px solid ${summary.picked ? "var(--adm-kraft)" : "var(--adm-border)"}`,
                          borderRadius: 8,
                          padding: 10,
                          background: summary.picked ? "var(--adm-kraft-pale)" : "var(--adm-card)",
                          transition: "all 0.12s",
                        }}
                      >
                        <label className="transport-modal__order-label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flexWrap: "wrap" }}>
                          <input type="checkbox" checked={summary.picked} onChange={() => toggleDeal(deal)} />
                          <strong style={{ fontSize: 13 }}>ЗК-{deal.number}</strong>
                          <span style={{ fontSize: 13 }}>{deal.customerName}</span>
                          <span className="admin-badge admin-badge--muted" style={{ fontSize: 11 }}>
                            {summary.picked ? `в маршруте ${summary.qty} ед.` : `можно ${summary.qty} ед.`}
                          </span>
                          {deal.deliveryAddress && (
                            <span className="transport-modal__address" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--adm-sand)", marginLeft: "auto", minWidth: 0, overflow: "hidden" }}>
                              <MapPin size={10} style={{ flexShrink: 0 }} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{deal.deliveryAddress}</span>
                            </span>
                          )}
                        </label>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="transport-builder__hint">
                Количество груза и пометки (забор / доставка) настраиваются на шаге 2 — в карточке точки.
              </div>
            </>
          ) : (
            <div className="transport-builder__stops">
              <TripStopsEditor
                stops={stops}
                onChange={setStops}
                products={products}
                defaultOpen="all"
                removable
                onOpenDeal={() => setPanel("deals")}
                title="Точки маршрута по порядку"
                hint="тяните за ⠿ — в бланке будет этот порядок"
                emptyText="Пока пусто: отметьте заказы на шаге 1 или добавьте свою точку"
                actions={
                  <button type="button" className="admin-btn admin-btn--outline admin-btn--sm" onClick={addCustomStop}>
                    <Plus size={13} /> Своя точка
                  </button>
                }
              />
            </div>
          )}

          {error && <div className="admin-error" style={{ marginTop: 10 }}>{error}</div>}

          <div className="admin-modal__actions transport-builder__footer" style={{ gap: 10, marginTop: 14 }}>
            <button type="button" onClick={onClose} className="admin-btn admin-btn--ghost" disabled={saving}>Отмена</button>
            <button type="button" onClick={openTripPreview} className="admin-btn admin-btn--outline" disabled={stops.length === 0}>
              <Printer size={14} /> Предпросмотр
            </button>
            <span className="transport-builder__totals">
              {totals.total} точ. · {totals.positions} поз. · {totals.qty} ед.
            </span>
            <button type="button" onClick={handleSubmit} className="admin-btn admin-btn--primary" disabled={saving || stops.length === 0}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
              Создать перевозку ({stops.length})
            </button>
          </div>
        </div>
      </div>

      {tripPreview && (
        <TransportTripSheet
          data={tripPreview}
          onDone={() => setTripPreview(null)}
        />
      )}
    </ModalPortal>
  );
}
