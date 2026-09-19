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
  stopFromReceipt,
  stopFromWpDoc,
  stopTotalQty,
  stopsFromTransportItems,
  stopsToTransportItems,
  summarizeStops,
  validateStops,
  type TripStop,
  type TripStopDeal,
  type TripStopLine,
  type TripStopReceipt,
  type TripType,
} from "@/lib/trip-stops";
import {
  wpQueueDocLabel,
  type WpTransportQueueDoc,
} from "@/lib/wastepaper-account-shared";
import {
  receiptQueueDocLabel,
  type ReceiptTransportQueueDoc,
} from "@/lib/warehouse-shared";

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
    /** Привязка к приёму/сдаче макулатуры (точки ПМ-/СМ-). */
    wpDocId?: string | null;
    wpDocKind?: "intake" | "shipment" | null;
    wpDocNumber?: number | null;
    /** Привязка к поставке — приходному ордеру (точки ПО-). */
    receiptId?: string | null;
    receiptNumber?: number | null;
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
      unit?: string | null;
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
  pendingWpDocs = [],
  pendingReceipts = [],
  drivers,
  companyPhone,
  companyAddress,
  focusTransportId,
  products = [],
}: {
  transports: TransportRow[];
  pendingDeals: TransportDeal[];
  /**
   * Приёмы/сдачи макулатуры с пометкой «в перевозку» — очередь того же
   * конструктора рейса: заборы (ПМ-) и сдачи (СМ-) едут в общем путевом
   * листе вместе с заказами учёта.
   */
  pendingWpDocs?: WpTransportQueueDoc[];
  /**
   * Поставки с пометкой «Заберём сами» — едем забирать товар у поставщика
   * (точки ПО-, «забор груза»). При завершении рейса поставка принимается
   * на склад (остаток остаётся в поставке).
   */
  pendingReceipts?: ReceiptTransportQueueDoc[];
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
  // Завершение с приёмкой поставок: спрашиваем фактические количества
  const [completeTarget, setCompleteTarget] = useState<{
    transport: TransportRow;
    stops: TripStop[];
  } | null>(null);

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
    pending: pendingDeals.length + pendingWpDocs.length + pendingReceipts.length,
  }), [initialTransports, pendingDeals, pendingWpDocs, pendingReceipts]);

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

  /**
   * Завершение рейса. Если в перевозке есть поставки (ПО-), сначала
   * спрашиваем фактические количества — «приняли меньше» возможно:
   * остаток останется в поставке («остаток по приёмке»).
   */
  function handleComplete(t: TransportRow, stops: TripStop[]) {
    const receiptStops = stops.filter((s) => s.receiptId && !s.wpDocId);
    if (receiptStops.length > 0) {
      setCompleteTarget({ transport: t, stops });
      setError("");
      return;
    }
    const hasWp = stops.some((s) => s.wpDocId);
    const msg = hasWp
      ? "Завершить перевозку? Товары спишутся со склада, а макулатура получит пометку «приёмка выполнена · ожидание взвешивания» (вес впишете в приёме)."
      : "Завершить перевозку? Товары будут списаны со склада.";
    if (!confirm(msg)) return;
    void apiCall(`/api/admin/transports/${t.id}`, "PATCH", { action: "complete" });
  }

  /** Финальное подтверждение с фактическими количествами по поставкам. */
  async function completeWithReceipts(
    target: { transport: TransportRow; stops: TripStop[] },
    receipts: { receiptId: string; items: { productId: string; quantity: number }[] }[]
  ) {
    await apiCall(`/api/admin/transports/${target.transport.id}`, "PATCH", {
      action: "complete",
      receipts,
    });
    setCompleteTarget(null);
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
          wpDocKind: stop.wpDocKind,
          wpDocNumber: stop.wpDocNumber,
          receiptNumber: stop.receiptNumber ?? null,
          customerName: stop.customerName,
          contactName: stop.contactName,
          address: stop.address,
          phone: stop.phone,
          deliveryNote: stop.deliveryNote,
          tripType: stop.tripType,
          items: stop.lines.map((line) => ({
            name: line.name,
            transportQty: line.qty,
            unit: line.unit ?? null,
          })),
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
    <div className="deliv-page">
      {printData && <TransportPrintSheet data={printData} onDone={() => setPrintData(null)} />}
      {tripData && <TransportTripSheet data={tripData} onDone={() => setTripData(null)} />}
      {completeTarget && (
        <CompleteTransportModal
          transport={completeTarget.transport}
          stops={completeTarget.stops}
          saving={saving}
          onClose={() => setCompleteTarget(null)}
          onConfirm={(receipts) => completeWithReceipts(completeTarget, receipts)}
        />
      )}

      {/* ── Шапка ── */}
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Перевозки · путевые листы</h1>
          <p className="admin-sub">
            Путевой лист водителю: точки по порядку, пометки «забор / доставка», печать А4.
            Заказы учёта и макулатура едут в одном маршруте.
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
          <div key={s.label} className="admin-stat deliv-stat--row" style={{ cursor: "default" }}>
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
                        {totals.kg > 0 && <> · {totals.kg} кг</>}
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
                            <button className="admin-btn admin-btn--primary admin-btn--sm" disabled={saving} onClick={() => handleComplete(t, stops)}>
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
          wpDocs={pendingWpDocs}
          receipts={pendingReceipts}
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
  wpDocs = [],
  receipts = [],
  drivers,
  products,
  companyPhone,
  companyAddress,
  onClose,
  onCreated,
}: {
  deals: TransportDeal[];
  /** Очередь макулатуры: приёмы (забор) и сдачи (на предприятие). */
  wpDocs?: WpTransportQueueDoc[];
  /** Очередь поставок «Заберём сами» — забор товара у поставщика (ПО-). */
  receipts?: ReceiptTransportQueueDoc[];
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

  /** Приём/сдача макулатуры → точка маршрута (забор/сдача груза). */
  function toggleWpDoc(doc: WpTransportQueueDoc) {
    const existing = stops.find(
      (s) => s.wpDocKind === doc.kind && s.wpDocId && String(s.wpDocId) === String(doc.id)
    );
    if (existing) {
      setStops((prev) => prev.filter((s) => s.key !== existing.key));
      return;
    }
    setStops((prev) => [...prev, stopFromWpDoc(doc)]);
  }

  const wpIntakes = useMemo(() => wpDocs.filter((d) => d.kind === "intake"), [wpDocs]);
  const wpShipments = useMemo(() => wpDocs.filter((d) => d.kind === "shipment"), [wpDocs]);

  /** Поставка («Заберём сами») → точка маршрута: забор товара у поставщика. */
  function toggleReceipt(doc: ReceiptTransportQueueDoc) {
    const existing = stops.find(
      (s) => s.receiptId && String(s.receiptId) === String(doc.id)
    );
    if (existing) {
      setStops((prev) => prev.filter((s) => s.key !== existing.key));
      return;
    }
    setStops((prev) => [...prev, stopFromReceipt(doc)]);
  }

  /** Сколько единиц товара забираем с поставки (подпись в очереди). */
  function receiptStopSummary(doc: ReceiptTransportQueueDoc) {
    const stop = stops.find((s) => s.receiptId && String(s.receiptId) === String(doc.id));
    if (!stop) {
      return { qty: doc.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0), picked: false };
    }
    return { qty: stopTotalQty(stop), picked: true };
  }

  /** Найти точку выбранного документа — чтобы править её строки прямо в списке. */
  function stopForDeal(deal: TransportDeal) {
    return stops.find((s) => s.kind === "deal" && String(s.dealId) === String(deal.id)) || null;
  }
  function stopForWp(doc: WpTransportQueueDoc) {
    return (
      stops.find(
        (s) => s.wpDocKind === doc.kind && s.wpDocId && String(s.wpDocId) === String(doc.id)
      ) || null
    );
  }
  function stopForReceipt(doc: ReceiptTransportQueueDoc) {
    return stops.find((s) => s.receiptId && String(s.receiptId) === String(doc.id)) || null;
  }

  /**
   * Правка количества по конкретному товару прямо в списке «Что везём»
   * (шаг выбора контрагента): диспетчер вписывает фактическое количество
   * руками, не переходя в карточку точки.
   */
  function patchStopLine(stopKeyArg: string, lineIndex: number, patch: Partial<TripStopLine>) {
    setStops((prev) =>
      prev.map((s) =>
        s.key === stopKeyArg
          ? { ...s, lines: s.lines.map((l, i) => (i === lineIndex ? { ...l, ...patch } : l)) }
          : s
      )
    );
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

  /** Сколько килограммов везём с приёма/сдачи (подпись в очереди). */
  function wpStopSummary(doc: WpTransportQueueDoc) {
    const stop = stops.find(
      (s) => s.wpDocKind === doc.kind && s.wpDocId && String(s.wpDocId) === String(doc.id)
    );
    if (!stop) return { qty: doc.weightKg, picked: false };
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
        <div className="admin-modal wp-modal deliv-modal transport-modal transport-modal--builder" onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Новая перевозка · путевой лист</h3>
            <button type="button" onClick={onClose} className="admin-modal__close"><X size={14} /></button>
          </div>

          <div className="transport-builder__fields">
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
            <div className="admin-field transport-builder__note">
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
              1. Что везём (заказы: {deals.length}
              {wpDocs.length > 0 ? ` · макулатура: ${wpDocs.length}` : ""}
              {receipts.length > 0 ? ` · поставки: ${receipts.length}` : ""})
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
              <div className="transport-modal__orders">
                {deals.length === 0 && wpDocs.length === 0 && receipts.length === 0 ? (
                  <div className="admin-empty" style={{ padding: 20 }}>Очередь пуста: нет ни заказов, ни макулатуры, ни поставок в перевозку — добавьте свою точку</div>
                ) : (
                  <>
                  {deals.length > 0 && (
                    <div className="wp-pick__group">
                      <Truck size={12} /> Заказы учёта — доставка ({deals.length})
                    </div>
                  )}
                  {deals.map((deal) => {
                    const summary = dealStopSummary(deal);
                    const stop = stopForDeal(deal);
                    return (
                      <div
                        key={deal.id}
                        id={`transport-deal-${deal.id}`}
                        className={`wp-pick${summary.picked ? " wp-pick--on" : ""}`}
                      >
                        <label className="transport-modal__order-label wp-pick__label">
                          <input type="checkbox" checked={summary.picked} onChange={() => toggleDeal(deal)} />
                          <strong className="wp-pick__num">ЗК-{deal.number}</strong>
                          <span className="wp-pick__client">{deal.customerName}</span>
                          <span className="admin-badge admin-badge--muted">
                            {summary.picked ? `в маршруте ${summary.qty} ед.` : `можно ${summary.qty} ед.`}
                          </span>
                          {deal.deliveryAddress && (
                            <span className="transport-modal__address wp-pick__addr">
                              <MapPin size={10} /> <span>{deal.deliveryAddress}</span>
                            </span>
                          )}
                        </label>
                        {stop && stop.lines.length > 0 && (
                          <PickLinesEditor
                            stop={stop}
                            unit="ед."
                            onPatchLine={(index, patch) => patchStopLine(stop.key, index, patch)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {/* Очередь макулатуры: приёмы едут как «забор груза»… */}
                  {wpIntakes.length > 0 && (
                    <div className="wp-pick__group wp-pick__group--pickup">
                      ⭡ Забор макулатуры — приёмы ({wpIntakes.length})
                    </div>
                  )}
                  {wpIntakes.map((doc) => {
                    const summary = wpStopSummary(doc);
                    return (
                      <div
                        key={`wp-${doc.kind}-${doc.id}`}
                        className={`wp-pick${summary.picked ? " wp-pick--on" : ""}`}
                      >
                        <label className="transport-modal__order-label wp-pick__label">
                          <input type="checkbox" checked={summary.picked} onChange={() => toggleWpDoc(doc)} />
                          <strong className="wp-pick__num">{wpQueueDocLabel(doc)}</strong>
                          <span className="wp-pick__client">{doc.customerName}</span>
                          <span className="admin-badge admin-badge--muted">
                            {summary.qty > 0
                              ? summary.picked
                                ? `в маршруте ${summary.qty} кг`
                                : `можно ${summary.qty} кг`
                              : "вес уточним"}
                          </span>
                          {doc.plannedDate && (
                            <span className="admin-badge admin-badge--indigo" title="Желаемая дата вывоза">
                              к {fmtDate(doc.plannedDate)}
                            </span>
                          )}
                          {doc.address && (
                            <span className="transport-modal__address wp-pick__addr">
                              <MapPin size={10} /> <span>{doc.address}</span>
                            </span>
                          )}
                        </label>
                        {(() => {
                          const stop = stopForWp(doc);
                          if (!stop || stop.lines.length === 0) return null;
                          return (
                            <PickLinesEditor
                              stop={stop}
                              unit="кг"
                              onPatchLine={(index, patch) => patchStopLine(stop.key, index, patch)}
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
                  {/* …а сдачи — как «сдача груза» на предприятие. */}
                  {wpShipments.length > 0 && (
                    <div className="wp-pick__group wp-pick__group--handover">
                      ⭣ Сдача макулатуры — на предприятие ({wpShipments.length})
                    </div>
                  )}
                  {wpShipments.map((doc) => {
                    const summary = wpStopSummary(doc);
                    return (
                      <div
                        key={`wp-${doc.kind}-${doc.id}`}
                        className={`wp-pick${summary.picked ? " wp-pick--on" : ""}`}
                      >
                        <label className="transport-modal__order-label wp-pick__label">
                          <input type="checkbox" checked={summary.picked} onChange={() => toggleWpDoc(doc)} />
                          <strong className="wp-pick__num">{wpQueueDocLabel(doc)}</strong>
                          <span className="wp-pick__client">{doc.customerName}</span>
                          <span className="admin-badge admin-badge--muted">
                            {summary.qty > 0
                              ? summary.picked
                                ? `в маршруте ${summary.qty} кг`
                                : `можно ${summary.qty} кг`
                              : "вес уточним"}
                          </span>
                          {doc.plannedDate && (
                            <span className="admin-badge admin-badge--indigo" title="Желаемая дата вывоза">
                              к {fmtDate(doc.plannedDate)}
                            </span>
                          )}
                          {doc.address && (
                            <span className="transport-modal__address wp-pick__addr">
                              <MapPin size={10} /> <span>{doc.address}</span>
                            </span>
                          )}
                        </label>
                        {(() => {
                          const stop = stopForWp(doc);
                          if (!stop || stop.lines.length === 0) return null;
                          return (
                            <PickLinesEditor
                              stop={stop}
                              unit="кг"
                              onPatchLine={(index, patch) => patchStopLine(stop.key, index, patch)}
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
                  {/* Поставки «Заберём сами» — едем за товаром к поставщику. */}
                  {receipts.length > 0 && (
                    <div className="wp-pick__group wp-pick__group--pickup">
                      ⭡ Забор поставок — ПО ({receipts.length})
                    </div>
                  )}
                  {receipts.map((doc) => {
                    const summary = receiptStopSummary(doc);
                    return (
                      <div
                        key={`receipt-${doc.id}`}
                        className={`wp-pick${summary.picked ? " wp-pick--on" : ""}`}
                      >
                        <label className="transport-modal__order-label wp-pick__label">
                          <input
                            type="checkbox"
                            checked={summary.picked}
                            onChange={() => toggleReceipt(doc)}
                          />
                          <strong className="wp-pick__num">{receiptQueueDocLabel(doc)}</strong>
                          <span className="wp-pick__client">{doc.supplierName}</span>
                          <span className="admin-badge admin-badge--muted">
                            {summary.picked
                              ? `в маршруте ${summary.qty} ед.`
                              : `к приёмке ${summary.qty} ед.`}
                          </span>
                          {doc.plannedDate && (
                            <span className="admin-badge admin-badge--indigo" title="Желаемая дата забора">
                              к {fmtDate(doc.plannedDate)}
                            </span>
                          )}
                          {doc.address && (
                            <span className="transport-modal__address wp-pick__addr">
                              <MapPin size={10} /> <span>{doc.address}</span>
                            </span>
                          )}
                        </label>
                        {(() => {
                          const stop = stopForReceipt(doc);
                          if (!stop || stop.lines.length === 0) return null;
                          return (
                            <PickLinesEditor
                              stop={stop}
                              unit="ед."
                              onPatchLine={(index, patch) => patchStopLine(stop.key, index, patch)}
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
                  </>
                )}
              </div>

              <div className="transport-builder__hint">
                Количество груза правится прямо здесь (можно меньше, чем в документе).
                Пометки «забор / доставка» и порядок точек — на шаге 2.
                Поставка при завершении рейса принимается на склад: остаток останется в поставке.
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
                emptyText="Пока пусто: отметьте заказы или макулатуру на шаге 1 — или добавьте свою точку"
                actions={
                  <button type="button" className="admin-btn admin-btn--outline admin-btn--sm" onClick={addCustomStop}>
                    <Plus size={13} /> Своя точка
                  </button>
                }
              />
            </div>
          )}

          {error && <div className="admin-error" style={{ marginTop: 10 }}>{error}</div>}

          <div className="admin-modal__actions transport-builder__footer">
            <button type="button" onClick={onClose} className="admin-btn admin-btn--ghost" disabled={saving}>Отмена</button>
            <button type="button" onClick={openTripPreview} className="admin-btn admin-btn--outline" disabled={stops.length === 0}>
              <Printer size={14} /> Предпросмотр
            </button>
            <span className="transport-builder__totals">
              {totals.total} точ. · {totals.positions} поз. · {totals.qty} ед.
              {totals.kg > 0 && <> · {totals.kg} кг</>}
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

/* ─────────────────────────────────────────────────────────
   Правка количеств прямо в списке «Что везём» (шаг 1)
   ───────────────────────────────────────────────────────── */

/**
 * Компактный редактор строк груза для выбора контрагента: диспетчер
 * вписывает фактическое количество руками ещё до создания перевозки —
 * «забираем меньше, чем в документе». Для поставок это же значение потом
 * принимается на склад при завершении рейса (остаток останется в поставке).
 */
function PickLinesEditor({
  stop,
  unit,
  onPatchLine,
}: {
  stop: TripStop;
  unit: string;
  onPatchLine: (index: number, patch: Partial<TripStopLine>) => void;
}) {
  const total = stopTotalQty(stop);
  return (
    <div className="pick-lines">
      <div className="pick-lines__head">
        <span className="pick-lines__title">Груз: {total} {unit}</span>
        <span className="pick-lines__hint">количество можно править руками</span>
      </div>
      <div className="trip-stop__lines">
        {stop.lines.map((line, index) => {
          const max = line.maxQty ?? line.orderedQty ?? null;
          return (
            <div className="trip-stop__line" key={`${stop.key}-pick-${index}`}>
              <span className="trip-stop__line-name">
                {line.name || "без названия"}
                {line.orderedQty != null && (
                  <span className="trip-stop__line-ordered"> (в документе {line.orderedQty})</span>
                )}
              </span>
              <div className="trip-stop__line-qty">
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={max ?? undefined}
                  value={line.qty || ""}
                  placeholder="0"
                  title="Фактическое количество в этом рейсе (можно меньше, чем в документе)"
                  onChange={(e) => {
                    const raw = Math.max(0, Number(e.target.value) || 0);
                    onPatchLine(index, { qty: max != null ? Math.min(raw, max) : raw });
                  }}
                />
                <span className="trip-stop__line-unit" aria-hidden>{unit}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Завершение перевозки: фактические количества по поставкам
   ───────────────────────────────────────────────────────── */

/**
 * Рейс закрыли — спрашиваем, сколько реально приняли по каждой поставке
 * (ПО-). Приняли меньше — остаток останется в поставке «остатком по
 * приёмке», его можно добрать кнопкой «Принять остаток» в самой поставке.
 */
function CompleteTransportModal({
  transport,
  stops,
  saving,
  onClose,
  onConfirm,
}: {
  transport: TransportRow;
  stops: TripStop[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (
    receipts: { receiptId: string; items: { productId: string; quantity: number }[] }[]
  ) => void;
}) {
  const receiptStops = useMemo(
    () => stops.filter((s) => !!s.receiptId && !s.wpDocId),
    [stops]
  );
  const otherStops = useMemo(
    () => stops.filter((s) => !s.receiptId || !!s.wpDocId),
    [stops]
  );
  const [qty, setQty] = useState<Record<string, number[]>>(() => {
    const init: Record<string, number[]> = {};
    for (const stop of receiptStops) {
      if (!stop.receiptId) continue;
      init[stop.receiptId] = stop.lines.map((line) => Number(line.qty) || 0);
    }
    return init;
  });

  function patchQty(receiptId: string, index: number, value: number, max: number | null) {
    const next = Math.max(0, value);
    setQty((prev) => ({
      ...prev,
      [receiptId]: (prev[receiptId] || []).map((v, i) =>
        i === index ? (max != null ? Math.min(next, max) : next) : v
      ),
    }));
  }

  function handleConfirm() {
    const receipts = receiptStops
      .filter((s) => !!s.receiptId)
      .map((s) => ({
        receiptId: String(s.receiptId),
        items: s.lines
          .map((line, index) => ({
            productId: line.productId ? String(line.productId) : "",
            quantity: Number((qty[String(s.receiptId)] || [])[index] ?? line.qty) || 0,
          }))
          .filter((item) => item.productId && item.quantity >= 0),
      }));
    onConfirm(receipts);
  }

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">
              Завершить перевозку ТМ-{transport.number}
            </h3>
            <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Закрыть">
              <X size={14} />
            </button>
          </div>

          <div style={{ maxHeight: "58vh", overflowY: "auto" }}>
            <p className="admin-modal__desc">
              Впишите, сколько фактически приняли по каждой поставке. Если приняли
              меньше — остаток останется в поставке («остаток по приёмке»), его
              можно добрать позже кнопкой «Принять остаток».
            </p>

            {receiptStops.map((stop) => {
              const id = String(stop.receiptId);
              return (
                <div className="wp-pick wp-pick--on" key={`complete-${id}`} style={{ marginBottom: 10 }}>
                  <div className="wp-pick__label" style={{ cursor: "default" }}>
                    <strong className="wp-pick__num">{stop.receiptNumber != null ? `ПО-${stop.receiptNumber}` : "Поставка"}</strong>
                    <span className="wp-pick__client">{stop.customerName}</span>
                  </div>
                  <div className="trip-stop__lines">
                    {stop.lines.map((line, index) => {
                      const max = line.maxQty ?? line.orderedQty ?? null;
                      const value = (qty[id] || [])[index] ?? (Number(line.qty) || 0);
                      return (
                        <div className="trip-stop__line" key={`${id}-${index}`}>
                          <span className="trip-stop__line-name">
                            {line.name || "без названия"}
                            {line.orderedQty != null && (
                              <span className="trip-stop__line-ordered"> (в поставке {line.orderedQty})</span>
                            )}
                          </span>
                          <div className="trip-stop__line-qty">
                            <input
                              className="admin-input"
                              type="number"
                              min={0}
                              max={max ?? undefined}
                              value={value || ""}
                              placeholder="0"
                              onChange={(e) => patchQty(id, index, Number(e.target.value) || 0, max)}
                            />
                            <span className="trip-stop__line-unit" aria-hidden>ед.</span>
                            <button
                              type="button"
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              title="Принять столько, сколько везли"
                              onClick={() => patchQty(id, index, Number(line.qty) || 0, null)}
                            >
                              Столько
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {otherStops.length > 0 && (
              <div className="transport-builder__hint">
                Ещё точек: {otherStops.length}. Товары по заказам спишутся со склада, а
                макулатура получит пометку «приёмка выполнена · ожидание взвешивания» —
                вес впишете в приёме руками.
              </div>
            )}
          </div>

          <div className="admin-modal__actions">
            <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose} disabled={saving}>
              Отмена
            </button>
            <button type="button" className="admin-btn admin-btn--primary" onClick={handleConfirm} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Завершить и принять на склад
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
