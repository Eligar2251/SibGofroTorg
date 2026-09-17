// =========================================================
// FILE: src/components/admin/WastepaperAccountManager.tsx
// Отдельный учёт макулатуры — рабочее место макулатурщика.
// Вкладки: Дни и финансы (остатки по дням, прогноз), Платежи
// (нал/безнал вместе и по отдельности), Приём от клиентов,
// Сдачи на предприятие, Перевозки, Контрагенты.
// Перевозки — ТЕ ЖЕ, что в товарном учёте (раздел «Доставки»):
// приёмы и сдачи с пометкой «в перевозку» едут в общем путевом
// листе как «забор груза» и «сдача груза».
// Деньги модуля (приём, сдачи, платежи) с сайтом и товарным
// учётом не связаны.
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Loader2,
  X,
  Pencil,
  Trash2,
  RotateCcw,
  Banknote,
  CreditCard,
  ArrowDownLeft,
  ArrowUpRight,
  Truck,
  MapPin,
  PackageOpen,
  ChevronDown,
  ChevronUp,
  Scale,
  Check,
  Copy,
  Building2,
  Phone,
  UserRound,
} from "lucide-react";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import { useBodyLock } from "@/hooks/use-body-lock";
import type { WastepaperRates } from "@/lib/wastepaper";
import {
  TransportManager,
  type DriverOption,
  type TransportRow,
} from "@/components/admin/TransportManager";
import { WpProductsTab } from "@/components/admin/WpProductsTab";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import {
  WP_ACCOUNT_LABELS,
  WP_COUNTERPARTY_ROLE_LABELS,
  WP_TYPE_LABELS,
  WP_TYPE_OPTIONS,
  buildWpDayReport,
  findWpBranchByAddress,
  findWpBranchMatch,
  fmtDate,
  fmtKg,
  fmtMoney,
  getWpBalance,
  getWpForecast,
  getWpStock,
  wpCollectMoneyEvents,
  wpDocTotals,
  wpItemsSummary,
  wpTypeLabel,
  wpUid,
  type WpAccount,
  type WpBranch,
  type WpCounterparty,
  type WpDocItem,
  type WpIntake,
  type WpManualPayment,
  type WpMoneyEvent,
  type WpShipment,
  type WpProduct,
  type WpTransportQueueDoc,
} from "@/lib/wastepaper-account-shared";

/* ── Константы и хелперы ───────────────────────────────── */

const TABS = [
  { key: "days", label: "Дни и финансы" },
  { key: "payments", label: "Платежи" },
  { key: "intakes", label: "Приём" },
  { key: "shipments", label: "Сдачи" },
  { key: "transports", label: "Перевозки" },
  { key: "counterparties", label: "Контрагенты" },
  { key: "products", label: "Виды макулатуры" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtPaidAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })} ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Разбор числа из инпута: «1 234,5» / «1234.5» → 1234.5 */
function parseNum(raw: string): number {
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const ACCOUNT_BADGE: Record<WpAccount, string> = {
  cash: "admin-badge admin-badge--teal",
  bank: "admin-badge admin-badge--indigo",
};

const KIND_BADGE: Record<WpMoneyEvent["kind"], { cls: string; label: string }> = {
  intake: { cls: "admin-badge admin-badge--amber", label: "Приём" },
  shipment: { cls: "admin-badge admin-badge--teal", label: "Сдача" },
  manual: { cls: "admin-badge admin-badge--blue", label: "Платёж" },
};

/** Конец API по виду денежного события. */
function apiBaseForEvent(e: WpMoneyEvent): string {
  if (e.kind === "intake") return "intakes";
  if (e.kind === "shipment") return "shipments";
  return "payments";
}

/** Цена по виду из тарифов настроек (если есть). */
function rateFor(rates: WastepaperRates | null, type: string): number | null {
  if (!rates) return null;
  const v = (rates as Record<string, number>)[type];
  return v == null ? null : Number(v);
}

/* ── Поле «адрес точки» (филиалы контрагента) ────────────
   Один контрагент (например «Детский мир») может иметь несколько
   адресов-филиалов; у каждого свой телефон и контактное лицо. Адрес
   выбираем из списка ИЛИ вписываем новый — новый автоматически
   сохранится в точки контрагента при сохранении документа.        */

function AddressField({
  branches,
  address,
  phone,
  contactPerson,
  onChange,
  addressLabel = "Адрес",
  autoFocus,
}: {
  branches: WpBranch[];
  address: string;
  phone: string;
  contactPerson: string;
  onChange: (patch: { address: string; phone: string; contactPerson: string }) => void;
  addressLabel?: string;
  autoFocus?: boolean;
}) {
  const matched = findWpBranchMatch(branches, address, phone, contactPerson);
  const hasBranches = branches.length > 0;

  function onSelectId(id: string) {
    if (id === "__new") {
      onChange({ address: "", phone: "", contactPerson: "" });
      return;
    }
    const b = branches.find((x) => x.id === id);
    if (b) onChange({ address: b.address, phone: b.phone, contactPerson: b.contactPerson });
  }

  return (
    <div>
      {hasBranches && (
        <div className="admin-field">
          <label className="admin-label">
            <Building2 size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Филиал / точка
          </label>
          <select
            className="admin-select"
            value={matched?.id || "__new"}
            onChange={(e) => onSelectId(e.target.value)}
          >
            <option value="__new">➕ Другой адрес (вписать новый)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label ? `${b.label} — ${b.address}` : b.address}
                {b.contactPerson ? ` (${b.contactPerson})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {(!hasBranches || !matched) && (
        <div className="admin-field">
          <label className="admin-label">{addressLabel}</label>
          <input
            className="admin-input"
            value={address}
            autoFocus={autoFocus}
            onChange={(e) => onChange({ address: e.target.value, phone, contactPerson })}
            placeholder="Улица, дом, ориентир"
          />
          {!hasBranches && (
            <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
              Новый адрес сохранится в карточку контрагента автоматически.
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div className="admin-field" style={{ flex: "1 1 150px" }}>
          <label className="admin-label">
            <Phone size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Телефон точки
          </label>
          <input
            className="admin-input"
            value={phone}
            onChange={(e) => onChange({ address, phone: e.target.value, contactPerson })}
            placeholder="+7…"
          />
        </div>
        <div className="admin-field" style={{ flex: "1 1 170px" }}>
          <label className="admin-label">
            <UserRound size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Контактное лицо
          </label>
          <input
            className="admin-input"
            value={contactPerson}
            onChange={(e) => onChange({ address, phone, contactPerson: e.target.value })}
            placeholder="ФИО"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Табличная часть документа (позиции макулатуры) ───────
   Как в 1С: несколько профилей макулатуры, у каждого свой вес и
   цена за кг. Сумма документа = сумма позиций.                    */

function ItemsEditor({
  items,
  onChange,
  rates,
}: {
  items: WpDocItem[];
  onChange: (items: WpDocItem[]) => void;
  rates: WastepaperRates | null;
}) {
  function setItem(id: string, patch: Partial<WpDocItem>) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        // При смене вида подставляем тариф, если цена ещё не задана вручную.
        if (patch.wastepaperType && !patch.pricePerKg && !it.pricePerKg) {
          const r = rateFor(rates, next.wastepaperType);
          if (r != null) next.pricePerKg = r;
        }
        next.total = Math.round((Number(next.weightKg) || 0) * (Number(next.pricePerKg) || 0) * 100) / 100;
        return next;
      })
    );
  }

  function addItem() {
    const first = WP_TYPE_OPTIONS[0].id;
    onChange([
      ...items,
      {
        id: wpUid("it"),
        wastepaperType: first,
        weightKg: 0,
        pricePerKg: rateFor(rates, first) ?? 0,
        total: 0,
      },
    ]);
  }

  function removeItem(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  const totals = wpDocTotals(items);

  return (
    <div className="admin-field">
      <label className="admin-label">
        <Scale size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Позиции (макулатура разных профилей)
      </label>
      {items.length === 0 && (
        <p className="admin-hint" style={{ marginTop: 0 }}>
          Нет позиций — добавьте хотя бы одну.
        </p>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((it) => (
          <div
            key={it.id}
            className="admin-card"
            style={{ padding: "8px 10px", borderStyle: "dashed", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
          >
            <select
              className="admin-select"
              style={{ flex: "2 1 160px" }}
              value={it.wastepaperType}
              onChange={(e) => setItem(it.id, { wastepaperType: e.target.value })}
            >
              {WP_TYPE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              {!WP_TYPE_OPTIONS.some((o) => o.id === it.wastepaperType) && (
                <option value={it.wastepaperType}>{wpTypeLabel(it.wastepaperType, WP_TYPE_LABELS)}</option>
              )}
            </select>
            <input
              className="admin-input"
              style={{ flex: "1 1 90px" }}
              type="number"
              min="0"
              step="0.1"
              placeholder="Вес, кг"
              value={it.weightKg || ""}
              onChange={(e) => setItem(it.id, { weightKg: parseNum(e.target.value) })}
            />
            <input
              className="admin-input"
              style={{ flex: "1 1 90px" }}
              type="number"
              min="0"
              step="0.01"
              placeholder="₽/кг"
              value={it.pricePerKg || ""}
              onChange={(e) => setItem(it.id, { pricePerKg: parseNum(e.target.value) })}
            />
            <div
              className="admin-hint"
              style={{ flex: "1 1 100px", fontWeight: 700, color: "var(--adm-pine)", whiteSpace: "nowrap" }}
            >
              {fmtMoney(it.total)}
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => removeItem(it.id)}
              title="Удалить позицию"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={addItem}>
          <Plus size={13} /> Позиция
        </button>
        <span className="admin-hint" style={{ fontWeight: 700 }}>
          Итого: {fmtKg(totals.weightKg)} · {fmtMoney(totals.total)}
        </span>
      </div>
    </div>
  );
}

/** Пустая позиция документа (для новых приёмов/сдач). */
function emptyDocItem(rates: WastepaperRates | null): WpDocItem {
  const first = WP_TYPE_OPTIONS[0].id;
  return {
    id: wpUid("it"),
    wastepaperType: first,
    weightKg: 0,
    pricePerKg: rateFor(rates, first) ?? 0,
    total: 0,
  };
}

/** Копия позиций с новыми id (для «Копировать документ»). */
function cloneDocItems(items: WpDocItem[]): WpDocItem[] {
  return items.map((it) => ({ ...it, id: wpUid("it") }));
}
/* ── Основной компонент ────────────────────────────────── */

interface Props {
  adminPath: string;
  initialTab: string;
  counterparties: WpCounterparty[];
  intakes: WpIntake[];
  shipments: WpShipment[];
  manualPayments: WpManualPayment[];
  products: WpProduct[];
  rates: WastepaperRates | null;
  /**
   * ЕДИНЫЕ перевозки учёта (ПЕР-...) для вкладки «Перевозки»: те же рейсы,
   * что видит раздел «Доставки». Макулатурщик собирает их из своих
   * заборов/сдач (очередь pendingWpDocs), заказы учёта ему не показываем.
   */
  unifiedTransports: TransportRow[];
  pendingWpDocs: WpTransportQueueDoc[];
  drivers: DriverOption[];
  companyPhone?: string;
  companyAddress?: string;
  /** Товары склада — выбор груза для своих точек маршрута. */
  stockProducts?: PickerProduct[];
}

export function WastepaperAccountManager(props: Props) {
  const router = useRouter();
  // Приёмщик на весовой и бухгалтер в кабинете работают с одними и теми же
  // документами — модуль обновляется без перезагрузки страницы.
  useAdminRealtime({
    tables: [
      "wp_intakes",
      "wp_shipments",
      "wp_payments",
      "wp_transports",
      "wp_counterparties",
      // Единые перевозки — вкладка «Перевозки» обновляется вместе с учётом.
      "transports",
    ],
    pollIntervalMs: 60_000,
  });
  const [tab, setTab] = useState<TabKey>(
    (TABS.some((t) => t.key === props.initialTab)
      ? props.initialTab
      : "days") as TabKey
  );

  const [counterparties, setCounterparties] = useState(props.counterparties);
  const [intakes, setIntakes] = useState(props.intakes);
  const [shipments, setShipments] = useState(props.shipments);
  const [manualPayments, setManualPayments] = useState(props.manualPayments);
  const [products, setProducts] = useState(props.products);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  // Модалки
  const [intakeModal, setIntakeModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpIntake } | { mode: "copy"; item: WpIntake } | null
  >(null);
  const [shipmentModal, setShipmentModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; item: WpShipment }
    | { mode: "copy"; item: WpShipment }
    | null
  >(null);
  const [paymentModal, setPaymentModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpManualPayment } | null
  >(null);
  const [counterpartyModal, setCounterpartyModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpCounterparty } | null
  >(null);


  // Мгновенное обновление при правках (Realtime + polling fallback)
  useAdminRealtime({
    tables: [
      "wp_intakes",
      "wp_shipments",
      "wp_payments",
      "wp_transports",
      "wp_counterparties",
      "transports",
    ],
    pollIntervalMs: 30_000,
  });

  // После router.refresh() сервер отдаёт свежие данные
  useEffect(() => setCounterparties(props.counterparties), [props.counterparties]);
  useEffect(() => setIntakes(props.intakes), [props.intakes]);
  useEffect(() => setShipments(props.shipments), [props.shipments]);
  useEffect(() => setManualPayments(props.manualPayments), [props.manualPayments]);
  useEffect(() => setProducts(props.products), [props.products]);

  // Сохраняем вкладку в URL (?tab=...), чтобы ссылки с дашборда и
  // обновление страницы не сбрасывали рабочее место.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== tab) {
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      /* приватный режим и т.п. */
    }
  }, [tab]);

  /* ── Производные данные ── */

  const events = useMemo(
    () => wpCollectMoneyEvents(intakes, shipments, manualPayments),
    [intakes, shipments, manualPayments]
  );
  const today = todayStr();
  const balance = useMemo(() => getWpBalance(events, today), [events, today]);
  const forecast = useMemo(() => getWpForecast(events), [events]);
  const stock = useMemo(() => getWpStock(intakes, shipments), [intakes, shipments]);

  const suppliers = useMemo(
    () => counterparties.filter((c) => c.roles.includes("supplier")),
    [counterparties]
  );
  const enterprises = useMemo(
    () => counterparties.filter((c) => c.roles.includes("enterprise")),
    [counterparties]
  );

  /* ── Общие действия ── */

  async function callApi(
    fn: () => Promise<Response>,
    fallbackError: string
  ): Promise<boolean> {
    setSaving(true);
    setFormError("");
    setActionError("");
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || fallbackError);
      router.refresh();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : fallbackError;
      setFormError(msg);
      setActionError(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleEventPaid(e: WpMoneyEvent) {
    const ok = await callApi(
      () =>
        fetch(`/api/admin/wp/${apiBaseForEvent(e)}/${e.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPaid: !e.isPaid }),
        }),
      "Не удалось обновить оплату"
    );
    if (ok) setNotice(e.isPaid ? "Помечено как неоплаченное" : "Проведено: оплачено");
  }

  /**
   * Пометить приём/сдачу «в перевозку» (или снять пометку) прямо из списка.
   * Помеченный документ попадает в очередь перевозок учёта и едет в общем
   * путевом листе: приём — как «забор груза», сдача — как «сдача груза».
   */
  async function toggleDocTransport(
    docType: "intakes" | "shipments",
    item: WpIntake | WpShipment
  ) {
    const to = !item.needsTransport;
    if (to && !item.address?.trim()) {
      // Без адреса в рейс нельзя — открываем документ, чтобы вписать адрес.
      setNotice(
        docType === "intakes"
          ? "Укажите адрес забора — без него непонятно, куда ехать, — и отметьте «в перевозку»."
          : "Укажите адрес предприятия — без него непонятно, куда везти, — и отметьте «в перевозку»."
      );
      setFormError("");
      if (docType === "intakes") setIntakeModal({ mode: "edit", item: item as WpIntake });
      else setShipmentModal({ mode: "edit", item: item as WpShipment });
      return;
    }
    const ok = await callApi(
      () =>
        fetch(`/api/admin/wp/${docType}/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ needsTransport: to }),
        }),
      "Не удалось обновить перевозку"
    );
    if (ok) {
      setNotice(
        to
          ? docType === "intakes"
            ? `Приём ПМ-${item.number} — в очереди перевозок (забор груза).`
            : `Сдача СМ-${item.number} — в очереди перевозок (сдача груза).`
          : "Снято с перевозки."
      );
    }
  }

  function openEventEdit(e: WpMoneyEvent) {
    if (e.kind === "intake") {
      const item = intakes.find((i) => i.id === e.id);
      if (item) setIntakeModal({ mode: "edit", item });
    } else if (e.kind === "shipment") {
      const item = shipments.find((s) => s.id === e.id);
      if (item) setShipmentModal({ mode: "edit", item });
    } else {
      const item = manualPayments.find((p) => p.id === e.id);
      if (item) setPaymentModal({ mode: "edit", item });
    }
  }

  /* ── Рендер ── */

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт макулатуры</h1>
          <p className="admin-sub">
            Отдельный модуль: приём макулатуры, сдача на предприятие, наличка и
            безнал по дням. Перевозки — общие с товарным учётом: заборы и сдачи
            едут в одном путевом листе с заказами.
          </p>
        </div>
      </div>

      {/* Вкладки */}
      <div className="admin-filters" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-filter${tab === t.key ? " admin-filter--active" : ""}`}
            onClick={() => {
              setTab(t.key);
              setActionError("");
              setNotice("");
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <p
          className="admin-hint"
          style={{ color: "var(--adm-green, #1c7c45)", marginTop: -6, marginBottom: 12 }}
        >
          {notice}
        </p>
      )}
      {actionError && (
        <p className="admin-error" style={{ marginTop: -6, marginBottom: 12 }}>
          {actionError}
        </p>
      )}

      {tab === "days" && (
        <DaysTab
          events={events}
          balance={balance}
          forecastCash={forecast}
          today={today}
          onTogglePaid={toggleEventPaid}
          onEdit={openEventEdit}
        />
      )}

      {tab === "payments" && (
        <PaymentsTab
          events={events}
          onTogglePaid={toggleEventPaid}
          onEdit={openEventEdit}
          onNew={() => {
            setFormError("");
            setPaymentModal({ mode: "create" });
          }}
        />
      )}

      {tab === "intakes" && (
        <IntakesTab
          intakes={intakes}
          onNew={() => {
            setFormError("");
            setIntakeModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setIntakeModal({ mode: "edit", item });
          }}
          onCopy={(item) => {
            setFormError("");
            setIntakeModal({ mode: "copy", item });
          }}
          onTogglePaid={(item) =>
            toggleEventPaid({
              ...events.find((e) => e.kind === "intake" && e.id === item.id)!,
            })
          }
          onToggleTransport={(item) => toggleDocTransport("intakes", item)}
        />
      )}

      {tab === "shipments" && (
        <ShipmentsTab
          shipments={shipments}
          stock={stock}
          onNew={() => {
            setFormError("");
            setShipmentModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setShipmentModal({ mode: "edit", item });
          }}
          onCopy={(item) => {
            setFormError("");
            setShipmentModal({ mode: "copy", item });
          }}
          onTogglePaid={(item) =>
            toggleEventPaid({
              ...events.find((e) => e.kind === "shipment" && e.id === item.id)!,
            })
          }
          onToggleTransport={(item) => toggleDocTransport("shipments", item)}
        />
      )}

      {tab === "transports" && (
        <TransportManager
          transports={props.unifiedTransports}
          pendingDeals={[]}
          pendingWpDocs={props.pendingWpDocs}
          drivers={props.drivers}
          companyPhone={props.companyPhone}
          companyAddress={props.companyAddress}
          products={props.stockProducts || []}
        />
      )}

      {tab === "counterparties" && (
        <CounterpartiesTab
          counterparties={counterparties}
          onNew={() => {
            setFormError("");
            setCounterpartyModal({ mode: "create" });
          }}
          onEdit={(item) => {
            setFormError("");
            setCounterpartyModal({ mode: "edit", item });
          }}
        />
      )}

      {tab === "products" && (
        <WpProductsTab products={products} onSaved={() => router.refresh()} />
      )}

      {/* ── Модалки ── */}
      {intakeModal && (
        <IntakeModal
          mode={intakeModal.mode}
          item={intakeModal.mode === "create" ? null : intakeModal.item}
          suppliers={suppliers}
          rates={props.rates}
          saving={saving}
          error={formError}
          onClose={() => setIntakeModal(null)}
          onSubmit={async (form) => {
            const isEdit = intakeModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/intakes/${(intakeModal as any).item.id}`
                    : "/api/admin/wp/intakes",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить приём" : "Не удалось создать приём"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice(isEdit ? "Приём сохранён" : "Приём добавлен");
            }
          }}
          onCancelDoc={async () => {
            if (intakeModal.mode !== "edit") return;
            const cancelled = intakeModal.item.status !== "cancelled";
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/intakes/${intakeModal.item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: cancelled ? "cancel" : "restore" }),
                }),
              "Не удалось изменить статус приёма"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice(cancelled ? "Приём отменён" : "Приём восстановлен");
            }
          }}
          onDelete={async () => {
            if (intakeModal.mode !== "edit") return;
            if (!confirm(`Удалить приём №${intakeModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/intakes/${intakeModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить приём"
            );
            if (ok) {
              setIntakeModal(null);
              setNotice("Приём удалён");
            }
          }}
        />
      )}

      {shipmentModal && (
        <ShipmentModal
          mode={shipmentModal.mode}
          item={shipmentModal.mode === "create" ? null : shipmentModal.item}
          enterprises={enterprises}
          rates={props.rates}
          saving={saving}
          error={formError}
          onClose={() => setShipmentModal(null)}
          onSubmit={async (form) => {
            const isEdit = shipmentModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/shipments/${(shipmentModal as any).item.id}`
                    : "/api/admin/wp/shipments",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить сдачу" : "Не удалось создать сдачу"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice(isEdit ? "Сдача сохранена" : "Сдача добавлена");
            }
          }}
          onCancelDoc={async () => {
            if (shipmentModal.mode !== "edit") return;
            const cancelled = shipmentModal.item.status !== "cancelled";
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/shipments/${shipmentModal.item.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: cancelled ? "cancel" : "restore" }),
                }),
              "Не удалось изменить статус сдачи"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice(cancelled ? "Сдача отменена" : "Сдача восстановлена");
            }
          }}
          onDelete={async () => {
            if (shipmentModal.mode !== "edit") return;
            if (!confirm(`Удалить сдачу №${shipmentModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/shipments/${shipmentModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить сдачу"
            );
            if (ok) {
              setShipmentModal(null);
              setNotice("Сдача удалена");
            }
          }}
        />
      )}

      {paymentModal && (
        <PaymentModal
          mode={paymentModal.mode}
          item={paymentModal.mode === "edit" ? paymentModal.item : null}
          counterparties={counterparties}
          saving={saving}
          error={formError}
          onClose={() => setPaymentModal(null)}
          onSubmit={async (form) => {
            const isEdit = paymentModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/payments/${(paymentModal as any).item.id}`
                    : "/api/admin/wp/payments",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить платёж" : "Не удалось создать платёж"
            );
            if (ok) {
              setPaymentModal(null);
              setNotice(isEdit ? "Платёж сохранён" : "Платёж добавлен");
            }
          }}
          onDelete={async () => {
            if (paymentModal.mode !== "edit") return;
            if (!confirm(`Удалить платёж №${paymentModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/payments/${paymentModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить платёж"
            );
            if (ok) {
              setPaymentModal(null);
              setNotice("Платёж удалён");
            }
          }}
        />
      )}

      {counterpartyModal && (
        <CounterpartyModal
          mode={counterpartyModal.mode}
          item={counterpartyModal.mode === "edit" ? counterpartyModal.item : null}
          saving={saving}
          error={formError}
          onClose={() => setCounterpartyModal(null)}
          onSubmit={async (form) => {
            const isEdit = counterpartyModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/counterparties/${(counterpartyModal as any).item.id}`
                    : "/api/admin/wp/counterparties",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить контрагента" : "Не удалось создать контрагента"
            );
            if (ok) {
              setCounterpartyModal(null);
              setNotice(isEdit ? "Контрагент сохранён" : "Контрагент добавлен");
            }
          }}
          onDelete={async () => {
            if (counterpartyModal.mode !== "edit") return;
            if (
              !confirm(
                `Удалить контрагента «${counterpartyModal.item.name}»? Приёмы и сдачи с ним останутся, но привязка пропадёт.`
              )
            )
              return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/counterparties/${counterpartyModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить контрагента"
            );
            if (ok) {
              setCounterpartyModal(null);
              setNotice("Контрагент удалён");
            }
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ДНИ И ФИНАНСЫ»
   ═══════════════════════════════════════════════════════ */

function DaysTab({
  events,
  balance,
  forecastCash,
  today,
  onTogglePaid,
  onEdit,
}: {
  events: WpMoneyEvent[];
  balance: { cash: number; bank: number; total: number };
  forecastCash: ReturnType<typeof getWpForecast>;
  today: string;
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [accountView, setAccountView] = useState<"all" | WpAccount>("all");
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      buildWpDayReport(events, {
        from: from || undefined,
        to: to || undefined,
        sortDesc,
      }),
    [events, from, to, sortDesc]
  );

  const unpaid = useMemo(
    () =>
      events
        .filter((e) => !e.cancelled && !e.isPaid)
        .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number),
    [events]
  );
  const unpaidIn = unpaid.filter((e) => e.direction === "incoming");
  const unpaidOut = unpaid.filter((e) => e.direction === "outgoing");

  const closingValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.closingCash
      : accountView === "bank"
        ? r.closingBank
        : r.closingCash + r.closingBank;
  const openingValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.openingCash
      : accountView === "bank"
        ? r.openingBank
        : r.openingCash + r.openingBank;
  const inValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.inCash
      : accountView === "bank"
        ? r.inBank
        : r.inCash + r.inBank;
  const outValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.outCash
      : accountView === "bank"
        ? r.outBank
        : r.outCash + r.outBank;

  return (
    <div>
      {/* Баланс сейчас. Карточки в строку: иконка слева, сумма и подпись
          справа (wp-stat--row) — только в этом модуле. */}
      <div className="admin-stat-grid" style={{ marginBottom: 18 }}>
        <div className="admin-stat wp-stat--row">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-teal-pale)", color: "var(--adm-teal)" }}
            aria-hidden="true"
          >
            <Banknote size={18} />
          </div>
          <div className="wp-stat__body">
            <div className="admin-stat__value">{fmtMoney(balance.cash)}</div>
            <div className="admin-stat__label">Наличка сейчас</div>
          </div>
        </div>
        <div className="admin-stat wp-stat--row">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-indigo-pale)", color: "var(--adm-indigo)" }}
            aria-hidden="true"
          >
            <CreditCard size={18} />
          </div>
          <div className="wp-stat__body">
            <div className="admin-stat__value">{fmtMoney(balance.bank)}</div>
            <div className="admin-stat__label">Безнал сейчас</div>
          </div>
        </div>
        <div className="admin-stat wp-stat--row">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-steel-pale)", color: "var(--adm-steel)" }}
            aria-hidden="true"
          >
            <Scale size={18} />
          </div>
          <div className="wp-stat__body">
            <div className="admin-stat__value">{fmtMoney(balance.total)}</div>
            <div className="admin-stat__label">Итого (нал + безнал)</div>
          </div>
        </div>
        <div className="admin-stat wp-stat--row">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-pine-pale)", color: "var(--adm-pine)" }}
            aria-hidden="true"
          >
            <ArrowDownLeft size={18} />
          </div>
          <div className="wp-stat__body">
            <div className="admin-stat__value" style={{ fontSize: "1.25rem" }}>
              +{fmtMoney(forecastCash.inTotal)}
            </div>
            <div className="admin-stat__label">
              Прогноз прихода · нал {fmtMoney(forecastCash.inCash)} · безнал{" "}
              {fmtMoney(forecastCash.inBank)}
            </div>
          </div>
        </div>
        <div className="admin-stat wp-stat--row">
          <div
            className="admin-stat__icon"
            style={{ background: "var(--adm-kraft-pale)", color: "var(--adm-kraft)" }}
            aria-hidden="true"
          >
            <ArrowUpRight size={18} />
          </div>
          <div className="wp-stat__body">
            <div className="admin-stat__value" style={{ fontSize: "1.25rem" }}>
              −{fmtMoney(forecastCash.outTotal)}
            </div>
            <div className="admin-stat__label">
              Прогноз расхода · нал {fmtMoney(forecastCash.outCash)} · безнал{" "}
              {fmtMoney(forecastCash.outBank)}
            </div>
          </div>
        </div>
      </div>

      {/* Отчёт по дням */}
      <div className="admin-card" style={{ marginBottom: 18 }}>
        <div className="admin-card__head">
          <span className="admin-card__title">Движение денег по дням</span>
          {/* На мобильном (≤480px) перестраивается в сетку:
              фильтры-счёт на всю ширину, даты по 50% (.wp-days-filters) */}
          <div className="wp-days-filters">
            <div className="admin-filters" style={{ marginBottom: 0 }}>
              {(
                [
                  { key: "all", label: "Всё" },
                  { key: "cash", label: "Наличка" },
                  { key: "bank", label: "Безнал" },
                ] as const
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className={`admin-filter${accountView === o.key ? " admin-filter--active" : ""}`}
                  onClick={() => setAccountView(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="admin-input wp-days-filters__date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="С даты"
            />
            <span className="wp-days-filters__dash">—</span>
            <input
              type="date"
              className="admin-input wp-days-filters__date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="По дату"
            />
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => setSortDesc((v) => !v)}
              title="Сортировка по дате"
            >
              {sortDesc ? (
                <>
                  <ChevronDown size={14} /> Сначала новые
                </>
              ) : (
                <>
                  <ChevronUp size={14} /> Сначала старые
                </>
              )}
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="admin-card__pad">
            <p className="admin-hint">
              Оплаченных операций за выбранный период нет. Как только появятся
              оплаченные приёмы, сдачи или платежи — здесь будет отчёт по дням с
              остатком предыдущего дня.
            </p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Остаток на начало</th>
                  <th>Приход</th>
                  <th>Расход</th>
                  <th>Остаток на конец</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <DayRowFragment
                    key={row.date}
                    row={row}
                    expanded={expandedDay === row.date}
                    onToggleExpand={() =>
                      setExpandedDay((cur) => (cur === row.date ? null : cur))
                    }
                    opening={openingValue(row)}
                    incoming={inValue(row)}
                    outgoing={outValue(row)}
                    closing={closingValue(row)}
                    isToday={row.date === today}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Прогноз: запланированные, но ещё не оплаченные операции */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        <ForecastCard
          title={`Ожидаем приход (${unpaidIn.length})`}
          tone="in"
          events={unpaidIn}
          onTogglePaid={onTogglePaid}
          onEdit={onEdit}
        />
        <ForecastCard
          title={`Нужно выплатить (${unpaidOut.length})`}
          tone="out"
          events={unpaidOut}
          onTogglePaid={onTogglePaid}
          onEdit={onEdit}
        />
      </div>
    </div>
  );
}

function DayRowFragment({
  row,
  expanded,
  onToggleExpand,
  opening,
  incoming,
  outgoing,
  closing,
  isToday,
}: {
  row: ReturnType<typeof buildWpDayReport>[number];
  expanded: boolean;
  onToggleExpand: () => void;
  opening: number;
  incoming: number;
  outgoing: number;
  closing: number;
  isToday: boolean;
}) {
  return (
    <>
      <tr
        onClick={onToggleExpand}
        style={{ cursor: "pointer" }}
        title="Показать операции дня"
      >
        <td style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{" "}
          {fmtDate(row.date)}
          {isToday && (
            <span className="admin-badge admin-badge--blue" style={{ marginLeft: 6 }}>
              сегодня
            </span>
          )}
        </td>
        <td>{fmtMoney(opening)}</td>
        <td style={{ color: "var(--adm-pine)", fontWeight: 600 }}>
          {incoming > 0 ? `+${fmtMoney(incoming)}` : "—"}
        </td>
        <td style={{ color: "var(--adm-kraft)", fontWeight: 600 }}>
          {outgoing > 0 ? `−${fmtMoney(outgoing)}` : "—"}
        </td>
        <td style={{ fontWeight: 700 }}>{fmtMoney(closing)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: "var(--adm-paper)" }}>
            {row.events.map((e) => (
              <div
                key={`${e.kind}-${e.id}`}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "4px 0",
                  fontSize: "0.85rem",
                }}
              >
                <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>
                <span style={{ color: "var(--adm-muted)" }}>{e.title}</span>
                <span>{e.counterpartyName || "—"}</span>
                <span className={ACCOUNT_BADGE[e.account]}>
                  {WP_ACCOUNT_LABELS[e.account]}
                </span>
                <strong
                  style={{
                    color: e.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-kraft)",
                  }}
                >
                  {e.direction === "incoming" ? "+" : "−"}
                  {fmtMoney(e.amount)}
                </strong>
                {e.paidAt && (
                  <span style={{ color: "var(--adm-muted)" }}>
                    оплачено {fmtPaidAt(e.paidAt)}
                  </span>
                )}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function ForecastCard({
  title,
  tone,
  events,
  onTogglePaid,
  onEdit,
}: {
  title: string;
  tone: "in" | "out";
  events: WpMoneyEvent[];
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
}) {
  const total = events.reduce((s, e) => s + e.amount, 0);
  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <span className="admin-card__title">{title}</span>
        <strong style={{ color: tone === "in" ? "var(--adm-pine)" : "var(--adm-kraft)" }}>
          {tone === "in" ? "+" : "−"}
          {fmtMoney(total)}
        </strong>
      </div>
      {events.length === 0 ? (
        <div className="admin-card__pad">
          <p className="admin-hint">Незапланированных ожиданий нет.</p>
        </div>
      ) : (
        <div className="admin-card__pad" style={{ display: "grid", gap: 8 }}>
          {events.slice(0, 20).map((e) => (
            <div
              key={`${e.kind}-${e.id}`}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--adm-muted)", whiteSpace: "nowrap" }}>
                {fmtDate(e.date)}
              </span>
              <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>
              <span style={{ flex: 1, minWidth: 120 }}>
                {e.title}
                {e.counterpartyName ? ` · ${e.counterpartyName}` : ""}
              </span>
              <span className={ACCOUNT_BADGE[e.account]}>
                {WP_ACCOUNT_LABELS[e.account]}
              </span>
              <strong>{fmtMoney(e.amount)}</strong>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => onTogglePaid(e)}
                title="Отметить оплаченным"
              >
                <Check size={13} /> Оплачено
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => onEdit(e)}
              >
                <Pencil size={13} />
              </button>
            </div>
          ))}
          {events.length > 20 && (
            <p className="admin-hint">…и ещё {events.length - 20} (см. вкладку «Платежи»)</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПЛАТЕЖИ»
   ═══════════════════════════════════════════════════════ */

function PaymentsTab({
  events,
  onTogglePaid,
  onEdit,
  onNew,
}: {
  events: WpMoneyEvent[];
  onTogglePaid: (e: WpMoneyEvent) => void;
  onEdit: (e: WpMoneyEvent) => void;
  onNew: () => void;
}) {
  const [direction, setDirection] = useState<"all" | "incoming" | "outgoing">("all");
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [paidFilter, setPaidFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        if (e.cancelled) return false;
        if (direction !== "all" && e.direction !== direction) return false;
        if (account !== "all" && e.account !== account) return false;
        if (paidFilter === "paid" && !e.isPaid) return false;
        if (paidFilter === "unpaid" && e.isPaid) return false;
        if (!q) return true;
        return (
          e.title.toLowerCase().includes(q) ||
          e.counterpartyName.toLowerCase().includes(q) ||
          (e.comment || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number);
  }, [events, direction, account, paidFilter, query]);

  const totals = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    for (const e of filtered) {
      if (!e.isPaid) continue;
      if (e.direction === "incoming") inSum += e.amount;
      else outSum += e.amount;
    }
    return { inSum, outSum };
  }, [filtered]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--adm-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по документу, контрагенту, комментарию…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все" },
              { key: "incoming", label: "Приход" },
              { key: "outgoing", label: "Расход" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${direction === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setDirection(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Нал+безнал" },
              { key: "cash", label: "Наличка" },
              { key: "bank", label: "Безнал" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${account === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setAccount(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все статусы" },
              { key: "paid", label: "Оплаченные" },
              { key: "unpaid", label: "Ожидают" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${paidFilter === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setPaidFilter(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Платёж
        </button>
      </div>

      <p className="admin-hint" style={{ marginTop: -4 }}>
        Показано операций: {filtered.length}. По оплаченным: приход{" "}
        <b style={{ color: "var(--adm-pine)" }}>+{fmtMoney(totals.inSum)}</b>, расход{" "}
        <b style={{ color: "var(--adm-kraft)" }}>−{fmtMoney(totals.outSum)}</b>.
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">Операций по фильтрам нет.</p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Документ</th>
                <th>Контрагент</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={`${e.kind}-${e.id}`}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</td>
                  <td>
                    <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>{" "}
                    {e.title}
                    {e.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {e.comment}
                      </div>
                    )}
                  </td>
                  <td>{e.counterpartyName || "—"}</td>
                  <td
                    style={{
                      whiteSpace: "nowrap",
                      fontWeight: 700,
                      color: e.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-kraft)",
                    }}
                  >
                    {e.direction === "incoming" ? "+" : "−"}
                    {fmtMoney(e.amount)}
                  </td>
                  <td>
                    <span className={ACCOUNT_BADGE[e.account]}>
                      {WP_ACCOUNT_LABELS[e.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {e.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(e.paidAt)}>
                        Оплачен
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge--amber">Ожидает</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onTogglePaid(e)}
                      title={e.isPaid ? "Снять отметку об оплате" : "Отметить оплаченным"}
                    >
                      {e.isPaid ? <RotateCcw size={13} /> : <Check size={13} />}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(e)}
                      title="Открыть документ"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПРИЁМ»
   ═══════════════════════════════════════════════════════ */

function IntakesTab({
  intakes,
  onNew,
  onEdit,
  onCopy,
  onTogglePaid,
  onToggleTransport,
}: {
  intakes: WpIntake[];
  onNew: () => void;
  onEdit: (item: WpIntake) => void;
  onCopy: (item: WpIntake) => void;
  onTogglePaid: (item: WpIntake) => void;
  onToggleTransport: (item: WpIntake) => void;
}) {
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [showCancelled, setShowCancelled] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return intakes.filter((i) => {
      if (!showCancelled && i.status === "cancelled") return false;
      if (account !== "all" && i.account !== account) return false;
      if (!q) return true;
      return (
        i.counterpartyName.toLowerCase().includes(q) ||
        (i.address || "").toLowerCase().includes(q) ||
        String(i.number).includes(q) ||
        (i.comment || "").toLowerCase().includes(q)
      );
    });
  }, [intakes, query, account, showCancelled]);

  const totals = useMemo(() => {
    const active = filtered.filter((i) => i.status === "active");
    return {
      kg: active.reduce((s, i) => s + i.weightKg, 0),
      sum: active.reduce((s, i) => s + i.total, 0),
    };
  }, [filtered]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по контрагенту, адресу, №…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Нал+безнал" },
              { key: "cash", label: "Наличка" },
              { key: "bank", label: "Безнал" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${account === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setAccount(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          отменённые
        </label>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Приём
        </button>
      </div>

      <p className="admin-hint" style={{ marginTop: -4 }}>
        Показано приёмов: {filtered.length} · {fmtKg(totals.kg)} на {fmtMoney(totals.sum)}.
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Приёмов пока нет. Добавьте первый — укажите, от кого приняли
              макулатуру, вес и цену за кг.
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>От кого / адрес</th>
                <th>Позиции</th>
                <th>Вес</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th>Перевозка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr
                  key={i.id}
                  style={
                    i.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <td style={{ whiteSpace: "nowrap" }}>ПМ-{i.number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(i.date)}</td>
                  <td>
                    {i.counterpartyName}
                    {i.address && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                        {i.address}
                      </div>
                    )}
                    {i.phone && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {i.phone}
                        {i.contactPerson ? ` · ${i.contactPerson}` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    {i.items.length > 0
                      ? wpItemsSummary(i.items, WP_TYPE_LABELS)
                      : WP_TYPE_LABELS[i.wastepaperType] || i.wastepaperType}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtKg(i.weightKg)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(i.total)}</td>
                  <td>
                    <span className={ACCOUNT_BADGE[i.account]}>
                      {WP_ACCOUNT_LABELS[i.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {i.status === "cancelled" ? (
                      <span className="admin-badge admin-badge--muted">Отменён</span>
                    ) : i.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(i.paidAt)}>
                        Оплачен
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="admin-badge admin-badge--amber"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onTogglePaid(i)}
                        title="Нажмите, чтобы отметить оплаченным"
                      >
                        Ожидает
                      </button>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {i.status === "cancelled" ? (
                      <span className="admin-hint">—</span>
                    ) : i.needsTransport ? (
                      <button
                        type="button"
                        className="admin-badge admin-badge--blue"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onToggleTransport(i)}
                        title="В очереди перевозок (забор груза). Нажмите, чтобы снять."
                      >
                        <Truck size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{" "}
                        Забор{i.transportPlannedDate ? ` · ${fmtDate(i.transportPlannedDate)}` : ""}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => onToggleTransport(i)}
                        title="Отметить: забрать нашим транспортом"
                      >
                        <Truck size={13} /> В перевозку
                      </button>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onCopy(i)}
                      title="Копировать (как в 1С)"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(i)}
                      title="Редактировать"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «СДАЧИ»
   ═══════════════════════════════════════════════════════ */

function ShipmentsTab({
  shipments,
  stock,
  onNew,
  onEdit,
  onCopy,
  onTogglePaid,
  onToggleTransport,
}: {
  shipments: WpShipment[];
  stock: ReturnType<typeof getWpStock>;
  onNew: () => void;
  onEdit: (item: WpShipment) => void;
  onCopy: (item: WpShipment) => void;
  onTogglePaid: (item: WpShipment) => void;
  onToggleTransport: (item: WpShipment) => void;
}) {
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) => {
      if (!showCancelled && s.status === "cancelled") return false;
      if (!q) return true;
      return (
        s.enterpriseName.toLowerCase().includes(q) ||
        (s.address || "").toLowerCase().includes(q) ||
        String(s.number).includes(q) ||
        (s.comment || "").toLowerCase().includes(q)
      );
    });
  }, [shipments, query, showCancelled]);

  return (
    <div>
      {/* Остаток макулатуры на площадке — что можно сдавать */}
      {stock.length > 0 && (
        <div className="admin-card" style={{ marginBottom: 14 }}>
          <div className="admin-card__head">
            <span className="admin-card__title">Остаток на площадке</span>
            <span className="admin-hint">принято − сдано, по действующим документам</span>
          </div>
          <div
            className="admin-card__pad"
            style={{ display: "flex", gap: 14, flexWrap: "wrap" }}
          >
            {stock.map((row) => (
              <div key={row.wastepaperType} style={{ minWidth: 170 }}>
                <div style={{ fontWeight: 700 }}>
                  {wpTypeLabel(row.wastepaperType, WP_TYPE_LABELS)}
                </div>
                <div className="admin-hint">
                  принято {fmtKg(row.intakeKg)} · сдано {fmtKg(row.shipmentKg)}
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    color: row.stockKg > 0 ? "var(--adm-pine)" : "var(--adm-muted)",
                  }}
                >
                  <PackageOpen size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                  {fmtKg(Math.max(0, row.stockKg))} на площадке
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по предприятию, №…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          отменённые
        </label>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Сдача
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Сдач пока нет. Когда везёте накопленную макулатуру на предприятие —
              оформите сдачу: укажите предприятие, вес и цену; полученные деньги
              потом отметьте оплатой здесь или внесите платежом во вкладке
              «Платежи».
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Предприятие / адрес</th>
                <th>Позиции</th>
                <th>Вес</th>
                <th>Сумма</th>
                <th>Счёт</th>
                <th>Оплата</th>
                <th>Перевозка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  style={
                    s.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <td style={{ whiteSpace: "nowrap" }}>СМ-{s.number}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.date)}</td>
                  <td>
                    {s.enterpriseName}
                    {s.address && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                        {s.address}
                      </div>
                    )}
                    {s.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem" }}>
                        {s.comment}
                      </div>
                    )}
                  </td>
                  <td style={{ minWidth: 180 }}>
                    {s.items.length > 0
                      ? wpItemsSummary(s.items, WP_TYPE_LABELS)
                      : WP_TYPE_LABELS[s.wastepaperType] || s.wastepaperType}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtKg(s.weightKg)}</td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(s.total)}</td>
                  <td>
                    <span className={ACCOUNT_BADGE[s.account]}>
                      {WP_ACCOUNT_LABELS[s.account]}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s.status === "cancelled" ? (
                      <span className="admin-badge admin-badge--muted">Отменена</span>
                    ) : s.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(s.paidAt)}>
                        Получено
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="admin-badge admin-badge--amber"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onTogglePaid(s)}
                        title="Нажмите, когда деньги получены"
                      >
                        Ожидаем
                      </button>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {s.status === "cancelled" ? (
                      <span className="admin-hint">—</span>
                    ) : s.needsTransport ? (
                      <button
                        type="button"
                        className="admin-badge admin-badge--blue"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onToggleTransport(s)}
                        title="В очереди перевозок (сдача груза). Нажмите, чтобы снять."
                      >
                        <Truck size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{" "}
                        Сдача{s.transportPlannedDate ? ` · ${fmtDate(s.transportPlannedDate)}` : ""}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => onToggleTransport(s)}
                        title="Отметить: отвезти нашим транспортом"
                      >
                        <Truck size={13} /> В перевозку
                      </button>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onCopy(s)}
                      title="Копировать (как в 1С)"
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(s)}
                      title="Редактировать"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «КОНТРАГЕНТЫ»
   ═══════════════════════════════════════════════════════ */

function CounterpartiesTab({
  counterparties,
  onNew,
  onEdit,
}: {
  counterparties: WpCounterparty[];
  onNew: () => void;
  onEdit: (item: WpCounterparty) => void;
}) {
  const [role, setRole] = useState<"all" | "supplier" | "enterprise">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return counterparties.filter((c) => {
      if (role !== "all" && !c.roles.includes(role)) return false;
      if (!q) return true;
      if (c.name.toLowerCase().includes(q) || (c.inn || "").includes(q)) return true;
      // Ищем по всем точкам: адрес, телефон, контактное лицо, метка.
      return (c.branches || []).some(
        (b) =>
          b.address.toLowerCase().includes(q) ||
          b.phone.toLowerCase().includes(q) ||
          b.contactPerson.toLowerCase().includes(q) ||
          b.label.toLowerCase().includes(q)
      );
    });
  }, [counterparties, role, query]);

  return (
    <div>
      <div
        className="admin-card"
        style={{ padding: "12px 16px", marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}
      >
        <div style={{ flex: "1 1 220px", position: "relative" }}>
          <Search
            size={14}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-muted)", pointerEvents: "none" }}
          />
          <input
            className="admin-input"
            style={{ paddingLeft: 30, width: "100%" }}
            placeholder="Поиск по названию, адресу, телефону, ИНН…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="admin-filters" style={{ marginBottom: 0 }}>
          {(
            [
              { key: "all", label: "Все" },
              { key: "supplier", label: "Сдают нам" },
              { key: "enterprise", label: "Принимают у нас" },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              className={`admin-filter${role === o.key ? " admin-filter--active" : ""}`}
              onClick={() => setRole(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Контрагент
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Контрагентов пока нет. Добавьте, от кого забираете макулатуру и
              каким предприятиям сдаёте — адрес и телефон подставятся в приёмы и
              перевозки.
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Роль</th>
                <th>Точки / филиалы</th>
                <th>ИНН</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", fontWeight: 400 }}>
                        {c.comment}
                      </div>
                    )}
                  </td>
                  <td>
                    {c.roles.map((r) => (
                      <span
                        key={r}
                        className={
                          r === "supplier"
                            ? "admin-badge admin-badge--amber"
                            : "admin-badge admin-badge--teal"
                        }
                        style={{ marginRight: 4 }}
                      >
                        {WP_COUNTERPARTY_ROLE_LABELS[r as keyof typeof WP_COUNTERPARTY_ROLE_LABELS] ||
                          r}
                      </span>
                    ))}
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {c.branches && c.branches.length > 0 ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        {c.branches.map((b) => (
                          <div key={b.id} style={{ fontSize: "0.85rem" }}>
                            <div style={{ fontWeight: 600 }}>
                              <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                              {b.label ? `${b.label}: ` : ""}
                              {b.address || "—"}
                            </div>
                            {(b.contactPerson || b.phone) && (
                              <div style={{ color: "var(--adm-muted)", paddingLeft: 15 }}>
                                {b.contactPerson}
                                {b.contactPerson && b.phone ? " · " : ""}
                                {b.phone ? <a href={`tel:${b.phone}`}>{b.phone}</a> : ""}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--adm-muted)" }}>—</span>
                    )}
                  </td>
                  <td>{c.inn || "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(c)}
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: ПРИЁМ
   ═══════════════════════════════════════════════════════ */

interface IntakeFormPayload {
  date: string;
  counterpartyId: string | null;
  counterpartyName: string;
  address: string | null;
  phone: string | null;
  contactPerson: string | null;
  items: WpDocItem[];
  account: WpAccount;
  isPaid: boolean;
  comment: string | null;
  saveCounterparty: boolean;
  /** Забрать нашим транспортом: приём попадёт в очередь перевозок учёта. */
  needsTransport: boolean;
  /** На когда планируем забор (пусто = как можно скорее). */
  transportPlannedDate: string | null;
}

function IntakeModal({
  mode,
  item,
  suppliers,
  rates,
  saving,
  error,
  onClose,
  onSubmit,
  onCancelDoc,
  onDelete,
}: {
  mode: "create" | "edit" | "copy";
  item: WpIntake | null;
  suppliers: WpCounterparty[];
  rates: WastepaperRates | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: IntakeFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const isEdit = mode === "edit";
  const isCopy = mode === "copy";
  // Копия как в 1С: всё переносится, но дата — сегодня, оплата сброшена,
  // позиции можно полностью править/удалять.
  const [form, setForm] = useState(() => ({
    date: isCopy ? todayStr() : item?.date || todayStr(),
    counterpartyName: item?.counterpartyName || "",
    counterpartyId: item?.counterpartyId || (null as string | null),
    address: item?.address || "",
    phone: item?.phone || "",
    contactPerson: item?.contactPerson || "",
    items: item
      ? isCopy
        ? cloneDocItems(item.items)
        : item.items
      : [emptyDocItem(rates)],
    account: (item?.account || "cash") as WpAccount,
    isPaid: isCopy ? false : item?.isPaid || false,
    comment: item?.comment || "",
    saveCounterparty: true,
    needsTransport: isCopy ? false : item?.needsTransport || false,
    transportPlannedDate: isCopy ? "" : item?.transportPlannedDate || "",
  }));

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Точки выбранного контрагента — для выбора адреса/филиала.
  const selected =
    suppliers.find((c) => c.id === form.counterpartyId) ||
    suppliers.find((c) => c.name.trim().toLowerCase() === form.counterpartyName.trim().toLowerCase()) ||
    null;
  const branches = selected?.branches || [];

  function onNameChange(value: string) {
    const found = suppliers.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => {
      // При выборе известного контрагента подставляем адрес/телефон/контакт
      // его первой точки (если у документа они ещё пустые).
      const first = found?.branches?.[0];
      return {
        ...prev,
        counterpartyName: value,
        counterpartyId: found ? found.id : null,
        address: prev.address || first?.address || found?.address || "",
        phone: prev.phone || first?.phone || found?.phone || "",
        contactPerson:
          prev.contactPerson || first?.contactPerson || found?.contactPerson || "",
      };
    });
  }

  const totals = wpDocTotals(form.items);
  const valid =
    form.date !== "" && form.counterpartyName.trim() !== "" && totals.weightKg > 0;
  // В перевозку без адреса нельзя: водитель не будет знать, куда ехать.
  const transportError =
    form.needsTransport && form.address.trim() === ""
      ? "Укажите адрес забора — без него в перевозку нельзя."
      : "";

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "40rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {isEdit
              ? `Приём №${item?.number}`
              : isCopy
                ? `Копия приёма №${item?.number}`
                : "Новый приём макулатуры"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Забор макулатуры у контрагента: выберите филиал (адрес, телефон,
          контактное лицо подставятся) и добавьте позиции — разные профили
          макулатуры со своим весом и ценой за кг. Сумма уйдёт в расход счёта.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || transportError) return;
            onSubmit({
              date: form.date,
              counterpartyId: form.counterpartyId,
              counterpartyName: form.counterpartyName.trim(),
              address: form.address.trim() || null,
              phone: form.phone.trim() || null,
              contactPerson: form.contactPerson.trim() || null,
              items: form.items,
              account: form.account,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">От кого приняли *</label>
              <input
                className="admin-input"
                list="wp-intake-suppliers"
                value={form.counterpartyName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Имя или компания (например «Детский мир»)"
                autoFocus={mode === "create"}
                required
              />
              <datalist id="wp-intake-suppliers">
                {suppliers.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
          </div>

          {!isEdit && !form.counterpartyId && form.counterpartyName.trim() && (
            <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -6 }}>
              <input
                type="checkbox"
                checked={form.saveCounterparty}
                onChange={(e) => set("saveCounterparty", e.target.checked)}
              />
              Сохранить «{form.counterpartyName.trim()}» в контрагенты (адрес и
              телефон добавятся в его точки)
            </label>
          )}

          <AddressField
            branches={branches}
            address={form.address}
            phone={form.phone}
            contactPerson={form.contactPerson}
            addressLabel="Адрес забора"
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />

          <div className="deal-delivery-block">
            <div className="deal-delivery-block__head">
              <Truck size={14} />
              <span>Перевозка</span>
              <label className="deal-delivery-block__toggle">
                <input
                  type="checkbox"
                  checked={form.needsTransport}
                  onChange={(e) => set("needsTransport", e.target.checked)}
                />
                Забрать нашим транспортом
              </label>
            </div>

            {form.needsTransport ? (
              <div className="deal-delivery-block__body">
                <div className="admin-field" style={{ maxWidth: 220 }}>
                  <label className="admin-label">Забрать не позже</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={form.transportPlannedDate}
                    onChange={(e) => set("transportPlannedDate", e.target.value)}
                  />
                </div>
                <p className="deal-delivery-block__empty" style={{ marginTop: 0 }}>
                  Приём встанет в очередь перевозок учёта: водитель заберёт груз
                  по адресу выше, в общем путевом листе это будет «забор груза».
                </p>
                {transportError && (
                  <p className="admin-error" style={{ margin: 0 }}>{transportError}</p>
                )}
              </div>
            ) : (
              <p className="deal-delivery-block__empty">
                Самопривоз: контрагент привезёт макулатуру сам. Включите, если
                нужно отправить за грузом нашу машину.
              </p>
            )}
          </div>

          <ItemsEditor
            items={form.items}
            rates={rates}
            onChange={(items) => set("items", items)}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ flex: "1 1 200px" }}>
              <label className="admin-label">Счёт</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="cash">Наличка</option>
                <option value="bank">Безнал</option>
              </select>
            </div>
            <label
              className="admin-hint"
              style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => set("isPaid", e.target.checked)}
              />
              Уже оплачено
            </label>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Итого</label>
              <input className="admin-input" value={fmtMoney(totals.total)} readOnly />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Например: частями, довоз завтра…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {isEdit && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={onCancelDoc}
                    disabled={saving}
                  >
                    <RotateCcw size={13} />{" "}
                    {item?.status === "cancelled" ? "Восстановить" : "Отменить приём"}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                    onClick={onDelete}
                    disabled={saving}
                  >
                    <Trash2 size={13} /> Удалить
                  </button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid || !!transportError}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {isEdit ? "Сохранить" : isCopy ? "Создать копию" : "Добавить приём"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: СДАЧА НА ПРЕДПРИЯТИЕ
   ═══════════════════════════════════════════════════════ */

interface ShipmentFormPayload {
  date: string;
  enterpriseId: string | null;
  enterpriseName: string;
  address: string | null;
  phone: string | null;
  contactPerson: string | null;
  items: WpDocItem[];
  account: WpAccount;
  isPaid: boolean;
  comment: string | null;
  saveCounterparty: boolean;
  /** Отвезти нашим транспортом: сдача попадёт в очередь перевозок учёта. */
  needsTransport: boolean;
  /** На когда планируем отвоз (пусто = как можно скорее). */
  transportPlannedDate: string | null;
}

function ShipmentModal({
  mode,
  item,
  enterprises,
  rates,
  saving,
  error,
  onClose,
  onSubmit,
  onCancelDoc,
  onDelete,
}: {
  mode: "create" | "edit" | "copy";
  item: WpShipment | null;
  enterprises: WpCounterparty[];
  rates: WastepaperRates | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: ShipmentFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const isEdit = mode === "edit";
  const isCopy = mode === "copy";
  const [form, setForm] = useState(() => ({
    date: isCopy ? todayStr() : item?.date || todayStr(),
    enterpriseName: item?.enterpriseName || "",
    enterpriseId: item?.enterpriseId || (null as string | null),
    address: item?.address || "",
    phone: item?.phone || "",
    contactPerson: item?.contactPerson || "",
    items: item
      ? isCopy
        ? cloneDocItems(item.items)
        : item.items
      : [emptyDocItem(rates)],
    account: (item?.account || "bank") as WpAccount,
    isPaid: isCopy ? false : item?.isPaid || false,
    comment: item?.comment || "",
    saveCounterparty: true,
    needsTransport: isCopy ? false : item?.needsTransport || false,
    transportPlannedDate: isCopy ? "" : item?.transportPlannedDate || "",
  }));

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const selected =
    enterprises.find((c) => c.id === form.enterpriseId) ||
    enterprises.find(
      (c) => c.name.trim().toLowerCase() === form.enterpriseName.trim().toLowerCase()
    ) ||
    null;
  const branches = selected?.branches || [];

  function onNameChange(value: string) {
    const found = enterprises.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => {
      const first = found?.branches?.[0];
      return {
        ...prev,
        enterpriseName: value,
        enterpriseId: found ? found.id : null,
        address: prev.address || first?.address || found?.address || "",
        phone: prev.phone || first?.phone || found?.phone || "",
        contactPerson:
          prev.contactPerson || first?.contactPerson || found?.contactPerson || "",
      };
    });
  }

  const totals = wpDocTotals(form.items);
  const valid =
    form.date !== "" && form.enterpriseName.trim() !== "" && totals.weightKg > 0;
  // В перевозку без адреса нельзя: водитель не будет знать, куда везти.
  const transportError =
    form.needsTransport && form.address.trim() === ""
      ? "Укажите адрес предприятия — без него в перевозку нельзя."
      : "";

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "40rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {isEdit
              ? `Сдача №${item?.number}`
              : isCopy
                ? `Копия сдачи №${item?.number}`
                : "Сдача на предприятие"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Везём накопленную макулатуру на переработку: выберите предприятие и его
          точку (адрес, телефон, контакт подставятся), добавьте позиции. Сумма
          придёт в выбранный счёт; когда деньги получены — отметьте оплату.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || transportError) return;
            onSubmit({
              date: form.date,
              enterpriseId: form.enterpriseId,
              enterpriseName: form.enterpriseName.trim(),
              address: form.address.trim() || null,
              phone: form.phone.trim() || null,
              contactPerson: form.contactPerson.trim() || null,
              items: form.items,
              account: form.account,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 150px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">Предприятие-приёмщик *</label>
              <input
                className="admin-input"
                list="wp-shipment-enterprises"
                value={form.enterpriseName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Кому сдаём"
                autoFocus={mode === "create"}
                required
              />
              <datalist id="wp-shipment-enterprises">
                {enterprises.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
          </div>

          {!isEdit && !form.enterpriseId && form.enterpriseName.trim() && (
            <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: -6 }}>
              <input
                type="checkbox"
                checked={form.saveCounterparty}
                onChange={(e) => set("saveCounterparty", e.target.checked)}
              />
              Сохранить «{form.enterpriseName.trim()}» в контрагенты (адрес
              добавится в его точки)
            </label>
          )}

          <AddressField
            branches={branches}
            address={form.address}
            phone={form.phone}
            contactPerson={form.contactPerson}
            addressLabel="Адрес предприятия (куда везём)"
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />

          <div className="deal-delivery-block">
            <div className="deal-delivery-block__head">
              <Truck size={14} />
              <span>Перевозка</span>
              <label className="deal-delivery-block__toggle">
                <input
                  type="checkbox"
                  checked={form.needsTransport}
                  onChange={(e) => set("needsTransport", e.target.checked)}
                />
                Отвезти нашим транспортом
              </label>
            </div>

            {form.needsTransport ? (
              <div className="deal-delivery-block__body">
                <div className="admin-field" style={{ maxWidth: 220 }}>
                  <label className="admin-label">Отвезти не позже</label>
                  <input
                    type="date"
                    className="admin-input"
                    value={form.transportPlannedDate}
                    onChange={(e) => set("transportPlannedDate", e.target.value)}
                  />
                </div>
                <p className="deal-delivery-block__empty" style={{ marginTop: 0 }}>
                  Сдача встанет в очередь перевозок учёта: водитель отвезёт груз
                  по адресу выше, в общем путевом листе это будет «сдача груза».
                </p>
                {transportError && (
                  <p className="admin-error" style={{ margin: 0 }}>{transportError}</p>
                )}
              </div>
            ) : (
              <p className="deal-delivery-block__empty">
                Самовывоз: предприятие заберёт макулатуру само. Включите, если
                повезём груз нашей машиной.
              </p>
            )}
          </div>

          <ItemsEditor
            items={form.items}
            rates={rates}
            onChange={(items) => set("items", items)}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="admin-field" style={{ flex: "1 1 200px" }}>
              <label className="admin-label">Куда придут деньги</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="bank">Безнал</option>
                <option value="cash">Наличка</option>
              </select>
            </div>
            <label
              className="admin-hint"
              style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}
            >
              <input
                type="checkbox"
                checked={form.isPaid}
                onChange={(e) => set("isPaid", e.target.checked)}
              />
              Деньги уже получены
            </label>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Итого</label>
              <input className="admin-input" value={fmtMoney(totals.total)} readOnly />
            </div>
          </div>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Например: акт №…, оплата по счёту до пятницы…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {isEdit && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={onCancelDoc}
                    disabled={saving}
                  >
                    <RotateCcw size={13} />{" "}
                    {item?.status === "cancelled" ? "Восстановить" : "Отменить сдачу"}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                    onClick={onDelete}
                    disabled={saving}
                  >
                    <Trash2 size={13} /> Удалить
                  </button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid || !!transportError}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {isEdit ? "Сохранить" : isCopy ? "Создать копию" : "Добавить сдачу"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: РУЧНОЙ ПЛАТЁЖ
   ═══════════════════════════════════════════════════════ */

interface PaymentFormPayload {
  date: string;
  direction: "incoming" | "outgoing";
  account: WpAccount;
  counterpartyId: string | null;
  counterpartyName: string;
  amount: number;
  isPaid: boolean;
  comment: string | null;
}

function PaymentModal({
  mode,
  item,
  counterparties,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpManualPayment | null;
  counterparties: WpCounterparty[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: PaymentFormPayload) => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    direction: (item?.direction || "incoming") as "incoming" | "outgoing",
    account: (item?.account || "cash") as WpAccount,
    counterpartyName: item?.counterpartyName || "",
    counterpartyId: item?.counterpartyId || (null as string | null),
    amount: item ? String(item.amount) : "",
    isPaid: item ? item.isPaid : true,
    comment: item?.comment || "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onNameChange(value: string) {
    const found = counterparties.find(
      (c) => c.name.trim().toLowerCase() === value.trim().toLowerCase()
    );
    setForm((prev) => ({
      ...prev,
      counterpartyName: value,
      counterpartyId: found ? found.id : null,
    }));
  }

  const amount = parseNum(form.amount);
  const valid = form.date !== "" && amount > 0;

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "30rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Платёж №${item?.number}` : "Новый платёж"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Внесение денег вручную: например, получили оплату за сдачу не сразу, или
          выдали наличку на расходы. Приход/расход по наличке и безналу учитывается
          и отдельно, и вместе.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              direction: form.direction,
              account: form.account,
              counterpartyId: form.counterpartyId,
              counterpartyName: form.counterpartyName.trim(),
              amount,
              isPaid: form.isPaid,
              comment: form.comment.trim() || null,
            });
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Направление</label>
              <select
                className="admin-select"
                value={form.direction}
                onChange={(e) => set("direction", e.target.value as "incoming" | "outgoing")}
              >
                <option value="incoming">Приход</option>
                <option value="outgoing">Расход</option>
              </select>
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Счёт</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="cash">Наличка</option>
                <option value="bank">Безнал</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "2 1 200px" }}>
              <label className="admin-label">Контрагент</label>
              <input
                className="admin-input"
                list="wp-payment-counterparties"
                value={form.counterpartyName}
                onChange={(e) => onNameChange(e.target.value)}
                placeholder="Кто платит / кому платим"
              />
              <datalist id="wp-payment-counterparties">
                {counterparties.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </div>
            <div className="admin-field" style={{ flex: "1 1 140px" }}>
              <label className="admin-label">Сумма, ₽ *</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0"
                required
              />
            </div>
          </div>

          <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.isPaid}
              onChange={(e) => set("isPaid", e.target.checked)}
            />
            Проведён (деньги реально двигаются). Снять галочку — будет в прогнозе.
          </label>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="За что платёж…"
            />
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              {mode === "edit" && (
                <button
                  type="button"
                  className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                  onClick={onDelete}
                  disabled={saving}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить платёж"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   МОДАЛКА: КОНТРАГЕНТ
   ═══════════════════════════════════════════════════════ */

interface CounterpartyFormPayload {
  name: string;
  roles: string[];
  branches: WpBranch[];
  inn: string | null;
  comment: string | null;
}

/** Точки из карточки: JSONB или одна точка из старых одиночных полей. */
function initialBranches(item: WpCounterparty | null): WpBranch[] {
  if (!item) return [];
  if (item.branches && item.branches.length > 0) return item.branches;
  if (item.address || item.phone || item.contactPerson) {
    return [
      {
        id: "br-legacy",
        label: "",
        address: item.address || "",
        contactPerson: item.contactPerson || "",
        phone: item.phone || "",
      },
    ];
  }
  return [];
}

function CounterpartyModal({
  mode,
  item,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpCounterparty | null;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: CounterpartyFormPayload) => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  const [form, setForm] = useState(() => ({
    name: item?.name || "",
    roles: item?.roles || (["supplier"] as string[]),
    branches: initialBranches(item),
    inn: item?.inn || "",
    comment: item?.comment || "",
  }));

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleRole(role: string) {
    setForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role],
    }));
  }

  function setBranch(id: string, patch: Partial<WpBranch>) {
    setForm((prev) => ({
      ...prev,
      branches: prev.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  }

  function addBranch() {
    setForm((prev) => ({
      ...prev,
      branches: [
        ...prev.branches,
        { id: wpUid("br"), label: "", address: "", contactPerson: "", phone: "" },
      ],
    }));
  }

  function removeBranch(id: string) {
    setForm((prev) => ({ ...prev, branches: prev.branches.filter((b) => b.id !== id) }));
  }

  const valid = form.name.trim() !== "" && form.roles.length > 0;
  // В сохранение идут только заполненные точки (адрес/телефон/контакт непустые).
  const cleanBranches = form.branches
    .map((b) => ({
      ...b,
      label: b.label.trim(),
      address: b.address.trim(),
      contactPerson: b.contactPerson.trim(),
      phone: b.phone.trim(),
    }))
    .filter((b) => b.address || b.phone || b.contactPerson);

  return (
    <div className="admin-modal-overlay" onClick={() => !saving && onClose()}>
      <div
        className="admin-modal"
        style={{ maxWidth: "40rem" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {mode === "edit" ? `Контрагент: ${item?.name}` : "Новый контрагент"}
          </h3>
          <button
            type="button"
            className="admin-modal__close"
            onClick={onClose}
            disabled={saving}
            aria-label="Закрыть"
          >
            <X size={16} />
          </button>
        </div>
        <p className="admin-modal__desc">
          Одна фирма — несколько точек (филиалов). У каждой точки свой адрес,
          контактное лицо и телефон: они подставляются в приёмы, сдачи и печать
          путевого листа. Например «Детский мир» и три его адреса.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              name: form.name.trim(),
              roles: form.roles,
              branches: cleanBranches,
              inn: form.inn.trim() || null,
              comment: form.comment.trim() || null,
            });
          }}
        >
          <div className="admin-field">
            <label className="admin-label">Название *</label>
            <input
              className="admin-input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Имя или компания (например «Детский мир»)"
              autoFocus={mode === "create"}
              required
            />
          </div>

          <div className="admin-field">
            <label className="admin-label">Роль *</label>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {Object.entries(WP_COUNTERPARTY_ROLE_LABELS).map(([key, label]) => (
                <label key={key} className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={form.roles.includes(key)}
                    onChange={() => toggleRole(key)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Точки / филиалы */}
          <div className="admin-field">
            <label className="admin-label">
              <Building2 size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Точки / филиалы (адрес + контактное лицо + телефон)
            </label>
            {form.branches.length === 0 && (
              <p className="admin-hint" style={{ marginTop: 0 }}>
                Точек пока нет — добавьте адрес, чтобы он подставлялся в документы.
              </p>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {form.branches.map((b, idx) => (
                <div
                  key={b.id}
                  className="admin-card"
                  style={{ padding: "10px 12px", borderStyle: "dashed" }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span className="admin-badge admin-badge--muted">Точка {idx + 1}</span>
                    <input
                      className="admin-input"
                      style={{ flex: 1 }}
                      value={b.label}
                      onChange={(e) => setBranch(b.id, { label: e.target.value })}
                      placeholder="Метка (необязательно): Филиал №1, Центральный…"
                      maxLength={120}
                    />
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => removeBranch(b.id)}
                      title="Удалить точку"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="admin-field" style={{ marginBottom: 6 }}>
                    <input
                      className="admin-input"
                      value={b.address}
                      onChange={(e) => setBranch(b.id, { address: e.target.value })}
                      placeholder="Адрес * (где забирать / куда везти)"
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="admin-input"
                      style={{ flex: "1 1 160px" }}
                      value={b.contactPerson}
                      onChange={(e) => setBranch(b.id, { contactPerson: e.target.value })}
                      placeholder="Контактное лицо (ФИО)"
                    />
                    <input
                      className="admin-input"
                      style={{ flex: "1 1 150px" }}
                      value={b.phone}
                      onChange={(e) => setBranch(b.id, { phone: e.target.value })}
                      placeholder="Телефон +7…"
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ marginTop: 8 }}
              onClick={addBranch}
            >
              <Plus size={13} /> Добавить точку
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-field" style={{ flex: "1 1 160px" }}>
              <label className="admin-label">ИНН</label>
              <input
                className="admin-input"
                value={form.inn}
                onChange={(e) => set("inn", e.target.value)}
              />
            </div>
            <div className="admin-field" style={{ flex: "2 1 220px" }}>
              <label className="admin-label">Комментарий</label>
              <input
                className="admin-input"
                value={form.comment}
                onChange={(e) => set("comment", e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
            <div>
              {mode === "edit" && (
                <button
                  type="button"
                  className="admin-btn admin-btn--danger-ghost admin-btn--sm"
                  onClick={onDelete}
                  disabled={saving}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={onClose}
                disabled={saving}
              >
                Закрыть
              </button>
              <button
                type="submit"
                className="admin-btn admin-btn--primary"
                disabled={saving || !valid}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}{" "}
                {mode === "edit" ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
