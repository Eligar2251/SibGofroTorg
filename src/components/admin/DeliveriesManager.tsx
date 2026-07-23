// src/components/admin/DeliveriesManager.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Truck,
  MapPin,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Gift,
  Banknote,
  Phone,
  Package,
  CalendarPlus,
  RotateCcw,
  Printer,
  User,
} from "lucide-react";
import {
  DeliveryPrintSheet,
  type PrintDeliveryItem,
} from "@/components/admin/DeliveryPrintSheet";

type FilterTab = "unreleased" | "planned" | "released" | "all";

export type DeliveryDriverOption = {
  id: string;
  name: string;
  phone?: string | null;
  position?: string | null;
};

/** Унифицированная строка доставки: заказ учёта */
export type DeliveryRow = {
  id: string;
  source: "site" | "deal";
  label: string;
  customerName: string;
  customerPhone?: string | null;
  contactName?: string | null;
  deliveryType?: "free" | "paid" | null;
  deliveryCost?: number | null;
  deliveryAddress?: string | null;
  deliveryPlannedDate?: string | null;
  deliveryReleasedAt?: string | null;
  deliveryNote?: string | null;
  deliveryDriverId?: string | null;
  deliveryDriverName?: string | null;
  items?: { name: string; quantity: number }[] | null;
  totalSum?: number | null;
  createdAt?: string | null;
  dealNumber?: number | null;
};

function rowKey(r: DeliveryRow) {
  return `${r.source}:${r.id}`;
}

export function DeliveriesManager({
  orders,
  adminPath,
  drivers = [],
  companyPhone,
  companyAddress,
}: {
  orders: DeliveryRow[];
  adminPath: string;
  drivers?: DeliveryDriverOption[];
  companyPhone?: string;
  companyAddress?: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<FilterTab>("unreleased");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [planDate, setPlanDate] = useState(todayIso());
  const [dayFilter, setDayFilter] = useState<string>("");
  const [driverFilter, setDriverFilter] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [printItems, setPrintItems] = useState<PrintDeliveryItem[] | null>(null);

  const byKey = useMemo(() => {
    const m = new Map<string, DeliveryRow>();
    for (const o of orders) m.set(rowKey(o), o);
    return m;
  }, [orders]);

  const stats = useMemo(() => {
    const unreleased = orders.filter((o) => !o.deliveryReleasedAt);
    const released = orders.filter((o) => o.deliveryReleasedAt);
    const planned = unreleased.filter((o) => o.deliveryPlannedDate);
    const noDate = unreleased.filter((o) => !o.deliveryPlannedDate);
    const withDriver = orders.filter((o) => o.deliveryDriverId).length;
    return {
      total: orders.length,
      unreleased: unreleased.length,
      released: released.length,
      planned: planned.length,
      noDate: noDate.length,
      withDriver,
    };
  }, [orders]);

  const dayGroups = useMemo(() => {
    const map = new Map<string, DeliveryRow[]>();
    for (const o of orders) {
      if (o.deliveryReleasedAt) continue;
      const key = o.deliveryPlannedDate || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === "__none__") return 1;
      if (b[0] === "__none__") return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [orders]);

  const filtered = useMemo(() => {
    let list = [...orders];
    if (tab === "unreleased") list = list.filter((o) => !o.deliveryReleasedAt);
    else if (tab === "released") list = list.filter((o) => o.deliveryReleasedAt);
    else if (tab === "planned") {
      list = list.filter((o) => !o.deliveryReleasedAt && o.deliveryPlannedDate);
    }
    if (dayFilter === "__none__") list = list.filter((o) => !o.deliveryPlannedDate);
    else if (dayFilter) list = list.filter((o) => o.deliveryPlannedDate === dayFilter);
    if (driverFilter === "__none__") list = list.filter((o) => !o.deliveryDriverId);
    else if (driverFilter) list = list.filter((o) => o.deliveryDriverId === driverFilter);
    list.sort((a, b) => {
      const da = a.deliveryPlannedDate || "9999";
      const db = b.deliveryPlannedDate || "9999";
      if (da !== db) return da.localeCompare(db);
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    });
    return list;
  }, [orders, tab, dayFilter, driverFilter]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisible() {
    const keys = filtered.filter((o) => !o.deliveryReleasedAt).map((o) => rowKey(o));
    setSelected((prev) => {
      const allSelected = keys.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) keys.forEach((id) => next.delete(id));
      else keys.forEach((id) => next.add(id));
      return next;
    });
  }

  function toPrintItem(o: DeliveryRow): PrintDeliveryItem {
    return {
      label: o.label,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      contactName: o.contactName,
      deliveryAddress: o.deliveryAddress,
      deliveryNote: o.deliveryNote,
      deliveryType: o.deliveryType,
      deliveryCost: o.deliveryCost,
      deliveryPlannedDate: o.deliveryPlannedDate,
      deliveryDriverName: o.deliveryDriverName,
      items: o.items,
      totalSum: o.totalSum,
    };
  }

  function printRows(rows: DeliveryRow[]) {
    if (rows.length === 0) {
      setError("Нет доставок для печати");
      return;
    }
    setError(null);
    setPrintItems(rows.map(toPrintItem));
  }

  function printSelected() {
    const rows = [...selected]
      .map((k) => byKey.get(k))
      .filter(Boolean) as DeliveryRow[];
    printRows(rows.length ? rows : filtered);
  }

  async function planSelected() {
    if (selected.size === 0) {
      setError("Выберите заказы для планирования");
      return;
    }
    if (!planDate || !/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
      setError("Укажите дату планирования");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const items = [...selected]
        .map((k) => byKey.get(k))
        .filter(Boolean)
        .map((o) => ({ id: o!.id, source: o!.source }));
      const res = await fetch("/api/admin/deliveries/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: planDate, items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Не удалось запланировать");
      else {
        setMessage(
          `Запланировано ${data.planned} доставок на ${formatRuDate(planDate)}`
        );
        setSelected(new Set());
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  function endpointFor(row: DeliveryRow) {
    return row.source === "deal"
      ? `/api/admin/warehouse/deals/${row.id}/delivery`
      : `/api/admin/orders/${row.id}/delivery`;
  }

  async function setOrderAction(
    row: DeliveryRow,
    action: "release" | "unrelease" | "plan" | "set_driver",
    extra?: Record<string, unknown>
  ) {
    const key = rowKey(row);
    setBusyId(key);
    setError(null);
    try {
      const res = await fetch(endpointFor(row), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Ошибка");
      else router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setBusyId(null);
  }

  return (
    <div>
      {printItems && (
        <DeliveryPrintSheet
          items={printItems}
          title={
            dayFilter && dayFilter !== "__none__"
              ? `Доставки на ${formatRuDate(dayFilter)}`
              : "Бланк доставок для курьера"
          }
          companyPhone={companyPhone}
          companyAddress={companyAddress}
          onDone={() => setPrintItems(null)}
        />
      )}

      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Доставки</h1>
          <p className="admin-sub">
            Заказы учёта (ЗК) · водитель · бланк для курьера · архив
          </p>
        </div>
        <div className="admin-page-head__actions">
          <button
            type="button"
            className="admin-btn admin-btn--outline"
            onClick={() => printRows(filtered)}
            disabled={filtered.length === 0}
            title="Печать видимого списка"
          >
            <Printer size={14} /> Печать списка
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--navy"
            onClick={printSelected}
            disabled={filtered.length === 0}
            title="Печать выбранных (или всего видимого)"
          >
            <Printer size={14} />{" "}
            {selected.size > 0
              ? `Печать выбранных (${selected.size})`
              : "Печать бланка"}
          </button>
        </div>
      </div>

      <div className="admin-stat-grid" style={{ marginBottom: 20 }}>
        {[
          {
            label: "Всего с доставкой",
            value: stats.total,
            icon: <Truck size={18} />,
            color: "#1b2b4b",
            bg: "rgba(27,43,75,0.08)",
          },
          {
            label: "Не отпущены",
            value: stats.unreleased,
            icon: <Clock size={18} />,
            color: "#d97706",
            bg: "rgba(217,119,6,0.12)",
          },
          {
            label: "С водителем",
            value: stats.withDriver,
            icon: <User size={18} />,
            color: "#3b82f6",
            bg: "#eff6ff",
          },
          {
            label: "Архив (отпущено)",
            value: stats.released,
            icon: <CheckCircle2 size={18} />,
            color: "#16a34a",
            bg: "#f0fdf4",
          },
        ].map((s) => (
          <div key={s.label} className="admin-stat" style={{ cursor: "default" }}>
            <div
              className="admin-stat__icon"
              style={{ background: s.bg, color: s.color }}
            >
              {s.icon}
            </div>
            <div className="admin-stat__value">{s.value}</div>
            <div className="admin-stat__label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="admin-card deliv-plan-card">
        <div className="deliv-plan-card__title">
          <CalendarPlus size={16} />
          Планирование и печать
        </div>
        <p className="deliv-plan-card__hint">
          Выберите доставки чекбоксами → назначьте дату / водителя → распечатайте
          бланк полосками для курьера (A4, ~5–6 см).
          {selected.size > 0 ? ` · выбрано: ${selected.size}` : ""}
        </p>
        <div className="deliv-plan-card__row">
          <div className="admin-field" style={{ margin: 0, minWidth: 180 }}>
            <label className="admin-label">Дата доставки</label>
            <input
              type="date"
              className="admin-input"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              disabled={saving}
            />
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--navy"
            onClick={planSelected}
            disabled={saving || selected.size === 0}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Calendar size={14} />
            )}
            Запланировать ({selected.size})
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--outline"
            onClick={printSelected}
            disabled={filtered.length === 0}
          >
            <Printer size={14} /> Печать бланка
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setSelected(new Set())}
              disabled={saving}
            >
              Сбросить выбор
            </button>
          )}
        </div>
        {message && <div className="deliv-msg deliv-msg--ok">{message}</div>}
        {error && <div className="deliv-msg deliv-msg--err">{error}</div>}
      </div>

      {dayGroups.length > 0 && (
        <div className="deliv-days">
          <div className="deliv-days__title">По дням (не отпущены)</div>
          <div className="deliv-days__list">
            <button
              type="button"
              className={`deliv-day${dayFilter === "" ? " deliv-day--active" : ""}`}
              onClick={() => setDayFilter("")}
            >
              Все дни
              <strong>{stats.unreleased}</strong>
            </button>
            {dayGroups.map(([key, list]) => {
              const filterKey = key === "__none__" ? "__none__" : key;
              const active = dayFilter === filterKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={`deliv-day${active ? " deliv-day--active" : ""}`}
                  onClick={() => setDayFilter(active ? "" : filterKey)}
                >
                  {key === "__none__" ? "Без даты" : formatRuDate(key)}
                  <strong>
                    {list.length}{" "}
                    {plural(list.length, "доставка", "доставки", "доставок")}
                  </strong>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="admin-filters" style={{ marginBottom: 10 }}>
        {(
          [
            { id: "unreleased", label: `Не отпущены (${stats.unreleased})` },
            { id: "planned", label: `С датой (${stats.planned})` },
            { id: "released", label: `Архив (${stats.released})` },
            { id: "all", label: `Все (${stats.total})` },
          ] as { id: FilterTab; label: string }[]
        ).map((f) => (
          <button
            key={f.id}
            type="button"
            className={`admin-filter${tab === f.id ? " admin-filter--active" : ""}`}
            onClick={() => setTab(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {drivers.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="admin-field" style={{ margin: 0, minWidth: 220 }}>
            <label className="admin-label">Фильтр по водителю</label>
            <select
              className="admin-select"
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
            >
              <option value="">Все водители</option>
              <option value="__none__">Без водителя</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.phone ? ` · ${d.phone}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="admin-card">
        {filtered.length === 0 ? (
          <div className="admin-empty">
            <div className="admin-empty__icon">
              <Truck size={40} />
            </div>
            <p>
              {orders.length === 0
                ? "Пока нет заказов с доставкой. Включите доставку при оформлении заказа в учёте."
                : "Нет доставок по выбранному фильтру"}
            </p>
            {orders.length === 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "center",
                  marginTop: 12,
                }}
              >
                <a
                  href={`/${adminPath}/warehouse?tab=deals`}
                  className="admin-btn admin-btn--navy"
                >
                  К заказам учёта
                </a>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="deliv-table-toolbar">
              <label className="deliv-check">
                <input
                  type="checkbox"
                  checked={
                    filtered.filter((o) => !o.deliveryReleasedAt).length > 0 &&
                    filtered
                      .filter((o) => !o.deliveryReleasedAt)
                      .every((o) => selected.has(rowKey(o)))
                  }
                  onChange={toggleAllVisible}
                />
                Выбрать видимые неотпущенные
              </label>
              <span className="admin-muted" style={{ fontSize: 12 }}>
                Показано: {filtered.length}
              </span>
            </div>

            <div className="deliv-list">
              {filtered.map((order) => {
                const key = rowKey(order);
                const released = Boolean(order.deliveryReleasedAt);
                const busy = busyId === key;
                return (
                  <div
                    key={key}
                    className={`deliv-item${released ? " deliv-item--released" : ""}${
                      selected.has(key) ? " deliv-item--selected" : ""
                    }`}
                  >
                    <div className="deliv-item__check">
                      {!released && (
                        <input
                          type="checkbox"
                          checked={selected.has(key)}
                          onChange={() => toggle(key)}
                          aria-label="Выбрать"
                        />
                      )}
                    </div>

                    <div className="deliv-item__main">
                      <div className="deliv-item__top">
                        <span className="admin-order__id">{order.label}</span>
                        {order.deliveryType === "paid" ? (
                          <span className="admin-badge admin-badge--amber">
                            <Banknote size={11} />
                            {(order.deliveryCost || 0).toLocaleString("ru-RU")} ₽
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--green">
                            <Gift size={11} />
                            Бесплатная
                          </span>
                        )}
                        {released ? (
                          <span className="admin-badge admin-badge--muted">
                            <CheckCircle2 size={11} /> Архив
                          </span>
                        ) : order.deliveryPlannedDate ? (
                          <span className="admin-badge admin-badge--indigo">
                            <Calendar size={11} />
                            {formatRuDate(order.deliveryPlannedDate)}
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--amber">
                            <Clock size={11} /> Без даты
                          </span>
                        )}
                        {order.deliveryDriverName && (
                          <span className="admin-badge admin-badge--blue">
                            <User size={11} />
                            {order.deliveryDriverName}
                          </span>
                        )}
                        <span className="admin-muted" style={{ fontSize: 12 }}>
                          {formatDateTime(order.createdAt)}
                        </span>
                      </div>

                      <div className="deliv-item__client">
                        <strong>{order.customerName || "Без имени"}</strong>
                        {order.customerPhone && (
                          <a href={`tel:${order.customerPhone}`}>
                            <Phone size={12} />
                            {order.customerPhone}
                          </a>
                        )}
                      </div>

                      <div className="deliv-item__addr">
                        <MapPin size={14} />
                        <span>
                          {order.deliveryAddress || (
                            <em style={{ color: "#ef4444" }}>Адрес не указан</em>
                          )}
                        </span>
                      </div>

                      {order.deliveryNote && (
                        <div className="deliv-item__note">{order.deliveryNote}</div>
                      )}

                      {order.items && order.items.length > 0 && (
                        <div className="deliv-item__items">
                          <Package size={12} />
                          {order.items
                            .slice(0, 4)
                            .map((it) => `${it.name} × ${it.quantity}`)
                            .join(" · ")}
                          {order.items.length > 4
                            ? ` · +${order.items.length - 4}`
                            : ""}
                          {order.totalSum != null && (
                            <strong>
                              {" "}
                              · {order.totalSum.toLocaleString("ru-RU")} ₽
                            </strong>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="deliv-item__side">
                      <div className="admin-field" style={{ margin: 0 }}>
                        <label className="admin-label">Водитель</label>
                        <select
                          className="admin-select"
                          value={order.deliveryDriverId || ""}
                          disabled={busy || drivers.length === 0}
                          onChange={(e) => {
                            const v = e.target.value || null;
                            setOrderAction(order, "set_driver", {
                              deliveryDriverId: v,
                            });
                          }}
                        >
                          <option value="">
                            {drivers.length ? "Не назначен" : "Нет сотрудников"}
                          </option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {!released && (
                        <>
                          <div className="admin-field" style={{ margin: 0 }}>
                            <label className="admin-label">Дата</label>
                            <input
                              type="date"
                              className="admin-input"
                              value={order.deliveryPlannedDate || ""}
                              disabled={busy}
                              onChange={(e) => {
                                const v = e.target.value || null;
                                setOrderAction(order, "plan", {
                                  deliveryPlannedDate: v,
                                });
                              }}
                            />
                          </div>
                          <button
                            type="button"
                            className="admin-btn admin-btn--navy admin-btn--sm"
                            disabled={busy || !order.deliveryAddress}
                            onClick={() => setOrderAction(order, "release")}
                            title="Отметить доставку выполненной (в архив)"
                          >
                            {busy ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={13} />
                            )}
                            В архив
                          </button>
                        </>
                      )}
                      {released && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          disabled={busy}
                          onClick={() => setOrderAction(order, "unrelease")}
                        >
                          {busy ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RotateCcw size={13} />
                          )}
                          Из архива
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => printRows([order])}
                        title="Печать одной полоски"
                      >
                        <Printer size={13} /> Бланк
                      </button>
                      <a
                        href={`/${adminPath}/warehouse?tab=deals&deal=${order.id}`}
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                      >
                        К заказу
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatRuDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}

function formatDateTime(raw: any): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
