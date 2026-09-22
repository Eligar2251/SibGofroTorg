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
// учётом не связаны. Единственное исключение — зарплаты с пометкой
// «Макулатура» из раздела «Зарплаты»: они выплачиваются наличными из
// кассы макулатуры и показываются здесь расходом «Наличка» (в минус).
// =========================================================

"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useWindowedList } from "@/hooks/use-windowed-list";
import { WpTable, WpHead, WpBody, WpRow, WpCell, WpHeading } from "./mobile/WastepaperLedger";
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
  Wallet,
  Users,
  HandCoins,
  Recycle,
  Warehouse,
  CalendarClock,
} from "lucide-react";
import { useAdminRealtime } from "@/lib/use-admin-realtime";
import { useBodyLock } from "@/hooks/use-body-lock";
import { useEscapeClose } from "@/hooks/use-escape-close";
import type { WastepaperRates } from "@/lib/wastepaper";
import {
  TransportManager,
  type DriverOption,
  type TransportRow,
} from "@/components/admin/TransportManager";
import { WpProductsTab } from "@/components/admin/WpProductsTab";
import { WASTEPAPER_SALARY_SCOPE } from "@/lib/salary-scope";
import type { Employee, Salary } from "@/lib/warehouse-shared";
import dynamic from "next/dynamic";

// Таблица зарплат общая с учётом СибГофроТорг (scope = макулатура);
// грузим её только при открытии вкладки — модуль остаётся лёгким.
const WarehouseSalaries = dynamic(
  () => import("@/components/admin/WarehouseSalaries").then((m) => m.WarehouseSalaries),
  {
    ssr: false,
    loading: () => (
      <div className="admin-empty" style={{ padding: 32 }}>
        <Loader2 size={22} className="animate-spin" />
        <p>Загружаем зарплаты…</p>
      </div>
    ),
  }
);
import type { PickerProduct } from "@/components/admin/ProductPicker";
import {
  WP_ACCOUNT_LABELS,
  WP_COUNTERPARTY_ROLE_LABELS,
  WP_TYPE_OPTIONS,
  buildWpTypeLabels,
  buildWpTypeOptions,
  buildWpDayReport,
  distributeWpTotal,
  findWpBranchByAddress,
  findWpBranchMatch,
  fmtDate,
  fmtKg,
  fmtMoney,
  fmtWpPrice,
  getWpBalance,
  getWpForecast,
  getWpStock,
  wpCollectMoneyEvents,
  wpDocTotals,
  wpIntakeAwaitingWeight,
  wpIntakeCompleted,
  wpIntakePayableTotal,
  wpItemsSummary,
  wpTypeLabel,
  wpUid,
  type WpAccount,
  type WpBalance,
  type WpBranch,
  type WpCounterparty,
  type WpDocItem,
  type WpIntake,
  type WpManualPayment,
  type WpMoneyEvent,
  type WpShipment,
  type WpProduct,
  type WpTransportQueueDoc,
  type WpTypeOption,
} from "@/lib/wastepaper-account-shared";

/* ── Константы и хелперы ───────────────────────────────── */

/**
 * Вкладки модуля. Иконка — для «банковского» пилюльного переключателя,
 * счётчик (badge) показываем только там, где число реально помогает:
 * приёмы, продажи, перевозки и долги.
 */
const TABS = [
  { key: "days", label: "Дни и финансы", icon: Wallet },
  { key: "payments", label: "Платежи", icon: CreditCard },
  { key: "intakes", label: "Приём", icon: ArrowDownLeft },
  { key: "shipments", label: "Продажи", icon: ArrowUpRight },
  { key: "stock", label: "Склад", icon: PackageOpen },
  { key: "transports", label: "Перевозки", icon: Truck },
  { key: "counterparties", label: "Контрагенты", icon: Users },
  { key: "debts", label: "Мы должны", icon: HandCoins },
  { key: "salaries", label: "Зарплаты", icon: Banknote },
  { key: "products", label: "Виды макулатуры", icon: Recycle },
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
  // У зарплат дата выплаты хранится без времени (YYYY-MM-DD) — не
  // превращаем её в «07:00» через часовой пояс, показываем только день.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return fmtDate(iso);
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
  third_party: "admin-badge admin-badge--gray",
};

const KIND_BADGE: Record<WpMoneyEvent["kind"], { cls: string; label: string }> = {
  intake: { cls: "admin-badge admin-badge--amber", label: "Приём" },
  shipment: { cls: "admin-badge admin-badge--teal", label: "Сдача" },
  manual: { cls: "admin-badge admin-badge--blue", label: "Платёж" },
  salary: { cls: "admin-badge admin-badge--indigo", label: "Зарплата" },
};

/** Подсказка для событий-зарплат: их ведут на вкладке «Зарплаты» модуля. */
const SALARY_EVENT_HINT =
  "Зарплата из денег макулатуры. Изменить или отменить её можно на вкладке «Зарплаты» этого модуля.";

/**
 * Конец API по виду денежного события. Зарплата — общая таблица учёта,
 * но у модуля свой маршрут (/api/admin/wp/salaries), который работает
 * только с записями макулатуры.
 */
function apiUrlForEvent(e: WpMoneyEvent): string {
  if (e.kind === "salary") return `/api/admin/wp/salaries/${e.id}`;
  if (e.kind === "intake") return `/api/admin/wp/intakes/${e.id}`;
  if (e.kind === "shipment") return `/api/admin/wp/shipments/${e.id}`;
  return `/api/admin/wp/payments/${e.id}`;
}

/** Цена по виду из тарифов настроек (если есть). */
function rateFor(rates: WastepaperRates | null, type: string): number | null {
  if (!rates) return null;
  const v = (rates as Record<string, number>)[type];
  return v == null ? null : Number(v);
}

/**
 * Виды макулатуры для форм и подписей: справочник «Виды макулатуры»
 * (вкладка модуля) + подписи исходных кодов для старых документов.
 */
interface WpTypeCatalog {
  /** Активные виды для селектов (ключ документа → подпись, цена). */
  options: WpTypeOption[];
  /** Подписи по любому ключу, включая скрытые виды и старые коды. */
  labels: Record<string, string>;
  /** Тарифы калькулятора сайта — запасная цена для исходных видов. */
  rates: WastepaperRates | null;
}

/** Цена по умолчанию: из справочника видов, иначе тариф сайта для исходных видов. */
function defaultPriceFor(catalog: WpTypeCatalog, type: string): number | null {
  const opt = catalog.options.find((o) => o.id === type);
  if (opt && opt.pricePerKg > 0) return opt.pricePerKg;
  return rateFor(catalog.rates, type);
}

/** Вид «по умолчанию» для новой позиции — первый активный вид справочника. */
function defaultTypeKey(catalog: WpTypeCatalog): string {
  return catalog.options[0]?.id || WP_TYPE_OPTIONS[0].id;
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
    <div className="wp-modal-stack">
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

      <div className="wp-grid-2">
        <div className="admin-field">
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
        <div className="admin-field">
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
  catalog,
}: {
  items: WpDocItem[];
  onChange: (items: WpDocItem[]) => void;
  catalog: WpTypeCatalog;
}) {
  function setItem(id: string, patch: Partial<WpDocItem>) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        // При смене вида подставляем цену справочника/тариф, если цена
        // ещё не задана вручную или совпадала с ценой прежнего вида.
        if (patch.wastepaperType && !patch.pricePerKg) {
          const prevDefault = defaultPriceFor(catalog, it.wastepaperType);
          const untouched = !it.pricePerKg || (prevDefault != null && Number(it.pricePerKg) === prevDefault);
          if (untouched) {
            const r = defaultPriceFor(catalog, next.wastepaperType);
            if (r != null) next.pricePerKg = r;
          }
        }
        next.total = Math.round((Number(next.weightKg) || 0) * (Number(next.pricePerKg) || 0) * 100) / 100;
        return next;
      })
    );
  }

  function addItem() {
    const first = defaultTypeKey(catalog);
    onChange([
      ...items,
      {
        id: wpUid("it"),
        wastepaperType: first,
        weightKg: 0,
        pricePerKg: defaultPriceFor(catalog, first) ?? 0,
        total: 0,
      },
    ]);
  }

  function removeItem(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  const totals = wpDocTotals(items);

  return (
    <div className="admin-field" style={{ gap: 10 }}>
      <label className="admin-label">
        <Scale size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Позиции (макулатура разных профилей)
      </label>
      {items.length === 0 && (
        <p className="admin-hint" style={{ marginTop: 0 }}>
          Нет позиций — добавьте хотя бы одну.
        </p>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((it) => (
          <div key={it.id} className="wp-item-row">
            <select
              className="admin-select"
              value={it.wastepaperType}
              onChange={(e) => setItem(it.id, { wastepaperType: e.target.value })}
            >
              {catalog.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
              {!catalog.options.some((o) => o.id === it.wastepaperType) && (
                <option value={it.wastepaperType}>{wpTypeLabel(it.wastepaperType, catalog.labels)}</option>
              )}
            </select>
            <input
              className="admin-input"
              type="number"
              min="0"
              step="0.1"
              placeholder="Вес, кг"
              value={it.weightKg || ""}
              onChange={(e) => setItem(it.id, { weightKg: parseNum(e.target.value) })}
            />
            <input
              className="admin-input"
              type="number"
              min="0"
              step="any"
              placeholder="₽/кг"
              value={fmtWpPrice(it.pricePerKg)}
              onChange={(e) => setItem(it.id, { pricePerKg: parseNum(e.target.value) })}
            />
            <div className="wp-item-row__sum">{fmtMoney(it.total)}</div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm wp-item-row__del"
              onClick={() => removeItem(it.id)}
              title="Удалить позицию"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
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
function emptyDocItem(catalog: WpTypeCatalog): WpDocItem {
  const first = defaultTypeKey(catalog);
  return {
    id: wpUid("it"),
    wastepaperType: first,
    weightKg: 0,
    pricePerKg: defaultPriceFor(catalog, first) ?? 0,
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
  /**
   * Зарплаты из денег макулатуры (тег «Макулатура»): наличка, безнал или
   * сторонние средства. Ведутся на вкладке «Зарплаты» модуля и попадают
   * расходом в финансы по своему счёту.
   */
  salaries?: Salary[];
  /** Сотрудники (общий справочник) — для вкладки «Зарплаты». */
  employees?: Employee[];
  /**
   * Может ли пользователь проводить/открывать зарплаты. По умолчанию —
   * да: вкладка «Зарплаты» и /api/admin/wp/salaries доступны и
   * администратору, и роли «макулатура».
   */
  canEditSalaries?: boolean;
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
  // Мгновенное обновление при правках (Realtime + polling fallback).
  // ВАЖНО: вызов должен быть ОДИН — раньше хук стоял дважды (60с и 30с),
  // из-за чего страница держала два SSE-слушателя и два фоновых опроса,
  // а события приводили к парным router.refresh() и лишним перерисовкам.
  useAdminRealtime({
    tables: [
      "wp_intakes",
      "wp_shipments",
      "wp_payments",
      "wp_transports",
      "wp_counterparties",
      // Единые перевозки — вкладка «Перевозки» обновляется вместе с учётом.
      "transports",
      // Зарплаты «с макулатуры» списываются из наличных этого модуля.
      "salaries",
    ],
    pollIntervalMs: 30_000,
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
  const [salaries, setSalaries] = useState<Salary[]>(props.salaries ?? []);
  const canEditSalaries = props.canEditSalaries !== false;
  const [products, setProducts] = useState(props.products);

  // Виды макулатуры для форм и подписей — из справочника модуля.
  const typeCatalog = useMemo<WpTypeCatalog>(
    () => ({
      options: buildWpTypeOptions(products),
      labels: buildWpTypeLabels(products),
      rates: props.rates,
    }),
    [products, props.rates]
  );
  const typeLabels = typeCatalog.labels;

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


  // После router.refresh() сервер отдаёт свежие данные
  useEffect(() => setCounterparties(props.counterparties), [props.counterparties]);
  useEffect(() => setIntakes(props.intakes), [props.intakes]);
  useEffect(() => setShipments(props.shipments), [props.shipments]);
  useEffect(() => setManualPayments(props.manualPayments), [props.manualPayments]);
  useEffect(() => setSalaries(props.salaries ?? []), [props.salaries]);
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
    () => wpCollectMoneyEvents(intakes, shipments, manualPayments, salaries),
    [intakes, shipments, manualPayments, salaries]
  );
  const today = todayStr();
  const balance = useMemo(() => getWpBalance(events, today), [events, today]);
  const forecast = useMemo(() => getWpForecast(events), [events]);
  const stock = useMemo(() => getWpStock(intakes, shipments), [intakes, shipments]);

  /** Суммарный остаток макулатуры на складе — для плашки баланса. */
  const stockTotalKg = useMemo(
    () => stock.reduce((s, r) => s + (Number(r.stockKg) || 0), 0),
    [stock]
  );
  /** Приёмы, по которым ещё не рассчитались с клиентом. */
  const unpaidIntakes = useMemo(
    () => intakes.filter((i) => i.status === "active" && !i.isPaid).length,
    [intakes]
  );
  /** Счётчики на вкладках — только там, где число помогает в работе. */
  const tabCounts = useMemo(
    () => ({
      intakes: intakes.filter((i) => i.status !== "cancelled").length,
      shipments: shipments.filter((s) => s.status !== "cancelled").length,
      transports: props.unifiedTransports.filter(
        (t) => t.status === "draft" || t.status === "active"
      ).length,
      debts: intakes.filter((i) => i.status === "active" && !i.isPaid).length,
      // Зарплаты «к выплате» — запланированные, но ещё не выданные.
      salaries: salaries.filter((s) => !s.isPaid).length,
    }),
    [intakes, shipments, props.unifiedTransports, salaries]
  );

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
    // Зарплата проводится через API зарплат модуля (/api/admin/wp/salaries).
    if (e.kind === "salary" && !canEditSalaries) {
      setActionError("");
      setNotice(SALARY_EVENT_HINT);
      return;
    }
    const ok = await callApi(
      () =>
        fetch(apiUrlForEvent(e), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            e.kind === "salary"
              ? // Как в «Зарплатах»: дата выплаты — день проведения.
                { isPaid: !e.isPaid, paidAt: !e.isPaid ? todayStr() : null }
              : { isPaid: !e.isPaid }
          ),
        }),
      e.kind === "salary" ? SALARY_EVENT_HINT : "Не удалось обновить оплату"
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
    if (e.kind === "salary") {
      // Запись зарплаты редактируется на вкладке «Зарплаты» модуля.
      setActionError("");
      if (!canEditSalaries) {
        setNotice(SALARY_EVENT_HINT);
        return;
      }
      setNotice("");
      setTab("salaries");
      return;
    }
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

  const isMobile = useIsMobile();

  /* ── Рендер ── */

  return (
    <div className={`wp-account${isMobile ? " wp-account--mobile" : ""}`}>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт макулатура</h1>
          <p className="admin-sub">
            {isMobile ? "Приём, сдача и финансы" : "Приём и сдача макулатуры, остатки и движение денег. Перевозки — в общем путевом листе с заказами."}
          </p>
        </div>
        <Link
          href={`/${props.adminPath}/deliveries`}
          className="admin-btn admin-btn--ghost"
          style={{ whiteSpace: "nowrap" }}
        >
          <Truck size={14} /> Открыть общий путевой лист
        </Link>
      </div>

      {/* Баланс: крупная плашка «счёта» — на всех вкладках */}
      <WpHero
        balance={balance}
        forecast={forecast}
        stockKg={stockTotalKg}
        pendingTransport={props.pendingWpDocs.length}
        unpaidIntakes={unpaidIntakes}
        today={today}
        onOpenTransports={() => {
          setTab("transports");
          setActionError("");
          setNotice("");
        }}
        onQuickIntake={() => {
          setFormError("");
          setIntakeModal({ mode: "create" });
        }}
        onQuickShipment={() => {
          setFormError("");
          setShipmentModal({ mode: "create" });
        }}
      />

      {/* Вкладки */}
      {isMobile ? (
        <nav className="wpa-mobile-nav" aria-label="Разделы учёта макулатуры">
          {TABS.map(({ key, label, icon: Icon }) => {
            const count = tabCounts[key as keyof typeof tabCounts];
            return <button key={key} type="button"
              className={`wpa-mobile-nav__item${tab === key ? " wp-tab--active" : ""}`}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => { setTab(key); setActionError(""); setNotice(""); }}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {typeof count === "number" && count > 0 && <span className="wp-tab__count">{count}</span>}
            </button>;
          })}
        </nav>
      ) : (
      <nav className="wp-tabs" role="tablist" aria-label="Разделы учёта макулатуры">
        {TABS.map((t) => {
          const Icon = t.icon;
          const count = tabCounts[t.key as keyof typeof tabCounts];
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`wp-tab${tab === t.key ? " wp-tab--active" : ""}`}
              onClick={() => {
                setTab(t.key);
                setActionError("");
                setNotice("");
              }}
            >
              <span className="wp-tab__icon" aria-hidden="true">
                <Icon size={13} />
              </span>
              {t.label}
              {typeof count === "number" && count > 0 && (
                <span className="wp-tab__count">{count}</span>
              )}
            </button>
          );
        })}
      </nav>
      )}

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
          typeLabels={typeLabels}
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

      {tab === "stock" && <StockTab stock={stock} typeLabels={typeLabels} />}

      {tab === "shipments" && (
        <ShipmentsTab
          shipments={shipments}
          stock={stock}
          typeLabels={typeLabels}
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
          onPostBank={async (item) => {
            await callApi(() => fetch(`/api/admin/wp/shipments/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "postBank" }) }), "Не удалось провести поступление в банк");
          }}
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

      {tab === "debts" && <DebtsTab intakes={intakes} counterparties={counterparties} onEditCounterparty={(item) => setCounterpartyModal({ mode: "edit", item })} />}

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

      {tab === "salaries" && (
        <>
          <p className="admin-hint" style={{ marginTop: -4, marginBottom: 12 }}>
            Зарплаты из денег макулатуры: наличка и безнал списываются со счетов модуля, сторонние
            платежи проходят с пометкой, откуда пришли деньги. Учёт СибГофроТорг эти выплаты не трогают.
          </p>
          <WarehouseSalaries
            employees={props.employees ?? []}
            salaries={salaries}
            scope={WASTEPAPER_SALARY_SCOPE}
          />
        </>
      )}

      {tab === "products" && (
        <WpProductsTab products={products} onChange={setProducts} onSaved={() => router.refresh()} />
      )}

      {/* ── Модалки ── */}
      {intakeModal && (
        <IntakeModal
          mode={intakeModal.mode}
          item={intakeModal.mode === "create" ? null : intakeModal.item}
          suppliers={suppliers}
          catalog={typeCatalog}
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
          catalog={typeCatalog}
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
   ПЛАШКА БАЛАНСА — «счёт» в банковском приложении.
   Одна на весь модуль: видно, сколько денег и что требует
   внимания (склад, долги, очередь перевозок).
   ═══════════════════════════════════════════════════════ */

function WpHero({
  balance,
  forecast,
  stockKg,
  pendingTransport,
  unpaidIntakes,
  today,
  onOpenTransports,
  onQuickIntake,
  onQuickShipment,
}: {
  balance: WpBalance;
  forecast: ReturnType<typeof getWpForecast>;
  stockKg: number;
  pendingTransport: number;
  unpaidIntakes: number;
  today: string;
  onOpenTransports: () => void;
  onQuickIntake: () => void;
  onQuickShipment: () => void;
}) {
  const isMobile = useIsMobile();
  if (isMobile) return (
    <section className="wpa-mobile" aria-label="Баланс макулатуры">
      <div className="wpa-mobile__balance">
        <div className="wpa-mobile__caption"><Wallet size={18} /> Общий баланс <span>{fmtDate(today)}</span></div>
        <strong className="wpa-mobile__total">{fmtMoney(balance.total)}</strong>
        <dl className="wpa-mobile__accounts">
          <div><dt><Banknote size={16} /> Наличные</dt><dd>{fmtMoney(balance.cash)}</dd></div>
          <div><dt><CreditCard size={16} /> Безналичные</dt><dd>{fmtMoney(balance.bank)}</dd></div>
          <div><dt><Wallet size={16} /> Сторонние пополнения</dt><dd>{fmtMoney(balance.third_party)}</dd></div>
        </dl>
      </div>
      <div className="wpa-mobile__actions">
        <button type="button" onClick={onQuickIntake}><ArrowDownLeft size={22} /><span>Принять</span></button>
        <button type="button" onClick={onQuickShipment}><ArrowUpRight size={22} /><span>Сдать</span></button>
        <button type="button" onClick={onOpenTransports}><Truck size={22} /><span>Перевозки</span></button>
      </div>
      <div className="wpa-mobile__summary">
        <div><Warehouse size={18} /><span>На складе</span><strong>{fmtKg(stockKg)}</strong></div>
        <div><HandCoins size={18} /><span>Приёмов к оплате</span><strong>{unpaidIntakes}</strong></div>
        <button type="button" onClick={onOpenTransports}><Truck size={18} /><span>Ждут перевозку</span><strong>{pendingTransport}</strong></button>
      </div>
      <details className="wpa-mobile__forecast">
        <summary>Прогноз движения денег</summary>
        <dl><div><dt>Ожидаемый приход</dt><dd>+{fmtMoney(forecast.inTotal)}</dd></div>
        <div><dt>Ожидаемый расход</dt><dd>−{fmtMoney(forecast.outTotal)}</dd></div></dl>
      </details>
    </section>
  );
  return (
    <section className="wpa-balance" aria-label="Баланс макулатуры">
      <div className="wpa-balance__top">
        <h2 className="wpa-balance__title">Деньги макулатуры</h2>
        <span className="wpa-balance__chip">
          <CalendarClock size={13} /> {fmtDate(today)}
        </span>
      </div>

      <div className="wpa-balance__grid">
        <div className="wpa-balance__cell">
          <div className="wpa-balance__label">
            <Banknote size={13} /> Наличка сейчас
          </div>
          <div className="wpa-balance__value">{fmtMoney(balance.cash)}</div>
        </div>
        <div className="wpa-balance__cell">
          <div className="wpa-balance__label">
            <CreditCard size={13} /> Безнал сейчас
          </div>
          <div className="wpa-balance__value">{fmtMoney(balance.bank)}</div>
          <div className="wpa-balance__item"><div className="wpa-balance__label"><Wallet size={13} /> Сторонние пополнения</div><div className="wpa-balance__value">{fmtMoney(balance.third_party)}</div></div>
        </div>
        <div className="wpa-balance__cell wpa-balance__cell--total wpa-balance__cell--accent">
          <div className="wpa-balance__label">
            <Scale size={13} /> Итого
          </div>
          <div className="wpa-balance__value">{fmtMoney(balance.total)}</div>
        </div>
      </div>

      <div className="wpa-balance__chips">
        <span className="wpa-balance__chip">
          <Warehouse size={13} /> На складе: <strong>{fmtKg(stockKg)}</strong>
        </span>
        <span className="wpa-balance__chip">
          <HandCoins size={13} /> К оплате приёмов: <strong>{unpaidIntakes}</strong>
        </span>
        <span className="wpa-balance__chip wpa-balance__chip--in">
          <ArrowDownLeft size={13} /> Прогноз прихода:{" "}
          <strong>+{fmtMoney(forecast.inTotal)}</strong>
        </span>
        <span className="wpa-balance__chip wpa-balance__chip--out">
          <ArrowUpRight size={13} /> Прогноз расхода:{" "}
          <strong>−{fmtMoney(forecast.outTotal)}</strong>
        </span>
        {pendingTransport > 0 ? (
          <button
            type="button"
            className="wpa-balance__chip wpa-balance__chip--warn"
            onClick={onOpenTransports}
            title="Открыть вкладку перевозок"
          >
            <Truck size={13} /> Ждут перевозку: <strong>{pendingTransport}</strong>
          </button>
        ) : (
          <span className="wpa-balance__chip">
            <Truck size={13} /> Очередь перевозок пуста
          </span>
        )}
      </div>

      {/* Быстрые действия — как кнопки операций в мобильном банке */}
      <div className="wpa-balance__actions">
        <button type="button" className="admin-btn admin-btn--primary" onClick={onQuickIntake}>
          <Plus size={15} /> Принять макулатуру
        </button>
        <button type="button" className="admin-btn admin-btn--outline" onClick={onQuickShipment}>
          <Plus size={15} /> Сдать на предприятие
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={onOpenTransports}>
          <Truck size={15} /> Перевозки
        </button>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ДНИ И ФИНАНСЫ»
   ═══════════════════════════════════════════════════════ */

function DaysTab({
  events,
  today,
  onTogglePaid,
  onEdit,
}: {
  events: WpMoneyEvent[];
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
        : accountView === "third_party"
          ? r.closingThirdParty
          : r.closingCash + r.closingBank + r.closingThirdParty;
  const openingValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.openingCash
      : accountView === "bank"
        ? r.openingBank
        : accountView === "third_party"
          ? r.openingThirdParty
          : r.openingCash + r.openingBank + r.openingThirdParty;
  const inValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.inCash
      : accountView === "bank"
        ? r.inBank
        : accountView === "third_party"
          ? r.inThirdParty
          : r.inCash + r.inBank + r.inThirdParty;
  const outValue = (r: (typeof rows)[number]) =>
    accountView === "cash"
      ? r.outCash
      : accountView === "bank"
        ? r.outBank
        : accountView === "third_party"
          ? r.outThirdParty
          : r.outCash + r.outBank + r.outThirdParty;

  return (
    <div>
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
                  { key: "third_party", label: "Сторонние" },
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
            <WpTable className="admin-table">
              <WpHead>
                <WpRow>
                  <WpHeading>Дата</WpHeading>
                  <WpHeading>Остаток на начало</WpHeading>
                  <WpHeading>Приход</WpHeading>
                  <WpHeading>Расход</WpHeading>
                  <WpHeading>Остаток на конец</WpHeading>
                </WpRow>
              </WpHead>
              <WpBody>
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
              </WpBody>
            </WpTable>
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
      <WpRow
        onActivate={onToggleExpand}
        style={{ cursor: "pointer" }}
        title="Показать операции дня"
      >
        <WpCell style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{" "}
          {fmtDate(row.date)}
          {isToday && (
            <span className="admin-badge admin-badge--blue" style={{ marginLeft: 6 }}>
              сегодня
            </span>
          )}
        </WpCell>
        <WpCell>{fmtMoney(opening)}</WpCell>
        <WpCell style={{ color: "var(--adm-pine)", fontWeight: 600 }}>
          {incoming > 0 ? `+${fmtMoney(incoming)}` : "—"}
        </WpCell>
        <WpCell style={{ color: "var(--adm-kraft)", fontWeight: 600 }}>
          {outgoing > 0 ? `−${fmtMoney(outgoing)}` : "—"}
        </WpCell>
        <WpCell style={{ fontWeight: 700 }}>{fmtMoney(closing)}</WpCell>
      </WpRow>
      {expanded && (
        <WpRow>
          <WpCell colSpan={5} style={{ background: "var(--adm-paper)" }}>
            {row.events.map((e) => (
              <div
                key={`${e.kind}-${e.id}`}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  padding: "6px 0",
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
          </WpCell>
        </WpRow>
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
        <div className="admin-card__pad" style={{ display: "grid", gap: 10 }}>
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
                title={e.kind === "salary" ? SALARY_EVENT_HINT : "Отметить оплаченным"}
              >
                <Check size={13} /> Оплачено
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => onEdit(e)}
                title={e.kind === "salary" ? "Открыть вкладку «Зарплаты»" : "Открыть документ"}
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
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
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
  }, [events, direction, account, paidFilter, deferredQuery]);

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

  // Длинный журнал операций — кусками (см. use-windowed-list).
  const win = useWindowedList(filtered, {
    resetKey: `${deferredQuery}|${direction}|${account}|${paidFilter}`,
  });

  return (
    <div>
      <div className="wp-toolbar">
        <div className="wp-toolbar__search">
          <Search size={14} />
          <input
            className="admin-input"
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
              { key: "all", label: "Все счета" },
              { key: "cash", label: "Наличка" },
              { key: "bank", label: "Безнал" },
              { key: "third_party", label: "Сторонние" },
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

      <p className="wp-summary">
        Показано операций: <strong>{filtered.length}</strong>
        <span className="wp-summary__chip" style={{ color: "var(--adm-pine)" }}>
          +{fmtMoney(totals.inSum)}
        </span>
        <span className="wp-summary__chip" style={{ color: "var(--adm-kraft)" }}>
          −{fmtMoney(totals.outSum)}
        </span>
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">Операций по фильтрам нет.</p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading>Дата</WpHeading>
                <WpHeading>Документ</WpHeading>
                <WpHeading>Контрагент</WpHeading>
                <WpHeading>Сумма</WpHeading>
                <WpHeading>Счёт</WpHeading>
                <WpHeading>Оплата</WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map((e) => (
                <WpRow key={`${e.kind}-${e.id}`}>
                  <WpCell style={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</WpCell>
                  <WpCell>
                    <span className={KIND_BADGE[e.kind].cls}>{KIND_BADGE[e.kind].label}</span>{" "}
                    {e.title}
                    {e.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        {e.comment}
                      </div>
                    )}
                    {e.kind === "salary" && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                        {e.account === "third_party"
                          ? "сторонними деньгами"
                          : e.account === "bank"
                            ? "с безнала макулатуры"
                            : "наличными из кассы макулатуры"}{" "}
                        · ведётся на вкладке «Зарплаты»
                      </div>
                    )}
                  </WpCell>
                  <WpCell>{e.counterpartyName || "—"}</WpCell>
                  <WpCell
                    style={{
                      whiteSpace: "nowrap",
                      fontWeight: 700,
                      color: e.direction === "incoming" ? "var(--adm-pine)" : "var(--adm-kraft)",
                    }}
                  >
                    {e.direction === "incoming" ? "+" : "−"}
                    {fmtMoney(e.amount)}
                  </WpCell>
                  <WpCell>
                    <span className={ACCOUNT_BADGE[e.account]}>
                      {WP_ACCOUNT_LABELS[e.account]}
                    </span>
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    {e.isPaid ? (
                      <span className="admin-badge admin-badge--green" title={fmtPaidAt(e.paidAt)}>
                        Оплачен
                      </span>
                    ) : (
                      <span className="admin-badge admin-badge--amber">Ожидает</span>
                    )}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onTogglePaid(e)}
                      title={
                        e.kind === "salary"
                          ? SALARY_EVENT_HINT
                          : e.isPaid
                            ? "Снять отметку об оплате"
                            : "Отметить оплаченным"
                      }
                    >
                      {e.isPaid ? <RotateCcw size={13} /> : <Check size={13} />}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(e)}
                      title={e.kind === "salary" ? "Открыть вкладку «Зарплаты»" : "Открыть документ"}
                    >
                      <Pencil size={13} />
                    </button>
                  </WpCell>
                </WpRow>
              ))}
            </WpBody>
          </WpTable>
        </div>
      )}
      {win.hasMore && (
        <button
          type="button"
          className="admin-show-more"
          style={{ marginTop: 10 }}
          ref={(node) => {
            win.sentinelRef(node);
          }}
          onClick={win.showAll}
        >
          Показано {win.visible.length} из {win.total} · <strong>Показать все</strong>
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «ПРИЁМ»
   ═══════════════════════════════════════════════════════ */

function IntakesTab({
  intakes,
  typeLabels,
  onNew,
  onEdit,
  onCopy,
  onTogglePaid,
  onToggleTransport,
}: {
  intakes: WpIntake[];
  typeLabels: Record<string, string>;
  onNew: () => void;
  onEdit: (item: WpIntake) => void;
  onCopy: (item: WpIntake) => void;
  onTogglePaid: (item: WpIntake) => void;
  onToggleTransport: (item: WpIntake) => void;
}) {
  const [query, setQuery] = useState("");
  // Буквы в поиске появляются сразу, перефильтровка длинного списка —
  // следом с низким приоритетом (та же схема, что в ProductListClient).
  const deferredQuery = useDeferredValue(query);
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [showCancelled, setShowCancelled] = useState(false);
  // «Текущие» — рабочий список; «Проведённые» — архив: приём оплачен,
  // оба веса (факт и к оплате) указаны. Попадает туда автоматически,
  // см. wpIntakeCompleted().
  const [view, setView] = useState<"current" | "done">("current");
  const doneCount = useMemo(
    () => intakes.filter((i) => wpIntakeCompleted(i)).length,
    [intakes]
  );
  const currentCount = useMemo(
    () => intakes.filter((i) => i.status === "active" && !wpIntakeCompleted(i)).length,
    [intakes]
  );

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return intakes.filter((i) => {
      const done = wpIntakeCompleted(i);
      if (view === "done") {
        if (!done) return false;
      } else {
        if (done) return false;
        if (!showCancelled && i.status === "cancelled") return false;
      }
      if (account !== "all" && i.account !== account) return false;
      if (!q) return true;
      return (
        i.counterpartyName.toLowerCase().includes(q) ||
        (i.address || "").toLowerCase().includes(q) ||
        String(i.number).includes(q) ||
        (i.comment || "").toLowerCase().includes(q)
      );
    });
  }, [intakes, deferredQuery, account, showCancelled, view]);

  const totals = useMemo(() => {
    const active = filtered.filter((i) => i.status === "active");
    return {
      kg: active.reduce((s, i) => s + i.weightKg, 0),
      sum: active.reduce((s, i) => s + i.total, 0),
    };
  }, [filtered]);

  // Длинный список приёмов рендерим кусками: на слабых телефонах сотни
  // строк/карточек роняли FPS при прокрутке (см. use-windowed-list).
  const win = useWindowedList(filtered, {
    resetKey: `${deferredQuery}|${account}|${showCancelled}|${view}`,
  });

  return (
    <div>
      <div className="wp-toolbar">
        <div className="wp-toolbar__search">
          <Search size={14} />
          <input
            className="admin-input"
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
        {view === "current" && (
          <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            отменённые
          </label>
        )}
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNew}>
          <Plus size={15} /> Приём
        </button>
      </div>

      {/* Рабочий список / архив проведённых */}
      <div className="admin-filters admin-filters--sub wp-intake-views" role="tablist" aria-label="Список приёмов">
        <button
          type="button"
          role="tab"
          aria-selected={view === "current"}
          className={`admin-filter${view === "current" ? " admin-filter--active" : ""}`}
          onClick={() => setView("current")}
        >
          <HandCoins size={12} /> Текущие
          <span className="wp-tab__count">{currentCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "done"}
          className={`admin-filter${view === "done" ? " admin-filter--active" : ""}`}
          onClick={() => setView("done")}
          title="Оплаченные приёмы с указанным весом (факт и к оплате) — попадают сюда автоматически"
        >
          <Check size={12} /> Проведённые
          <span className="wp-tab__count">{doneCount}</span>
        </button>
      </div>

      <p className="wp-summary">
        {view === "done" ? "Проведённых приёмов" : "Показано приёмов"}: <strong>{filtered.length}</strong>
        <span className="wp-summary__chip">{fmtKg(totals.kg)}</span>
        <span className="wp-summary__chip">{fmtMoney(totals.sum)}</span>
        {view === "done" && (
          <span className="admin-hint" style={{ marginLeft: 6 }}>
            оплачены, вес факт и к оплате указан · попадают сюда автоматически
          </span>
        )}
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              {view === "done"
                ? "Проведённых приёмов пока нет. Приём попадает сюда сам, когда он оплачен и в карточке указаны фактический вес и вес к оплате."
                : "Приёмов пока нет. Добавьте первый — укажите, от кого приняли макулатуру, вес и итоговую сумму: цена за кг посчитается сама."}
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading>№</WpHeading>
                <WpHeading>Дата</WpHeading>
                <WpHeading>От кого / адрес</WpHeading>
                <WpHeading>Позиции</WpHeading>
                <WpHeading>Вес</WpHeading>
                <WpHeading>Сумма</WpHeading>
                <WpHeading>Счёт</WpHeading>
                <WpHeading>Оплата</WpHeading>
                <WpHeading>Перевозка</WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map((i) => (
                <WpRow
                  key={i.id}
                  style={
                    i.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <WpCell style={{ whiteSpace: "nowrap" }}>ПМ-{i.number}</WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>{fmtDate(i.date)}</WpCell>
                  <WpCell>
                    {i.counterpartyName}
                    {i.address && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                        {i.address}
                      </div>
                    )}
                    {i.phone && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        {i.phone}
                        {i.contactPerson ? ` · ${i.contactPerson}` : ""}
                      </div>
                    )}
                  </WpCell>
                  <WpCell style={{ minWidth: 180 }}>
                    {i.items.length > 0
                      ? wpItemsSummary(i.items, typeLabels)
                      : wpTypeLabel(i.wastepaperType, typeLabels)}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    {i.weightKg > 0 ? (
                      fmtKg(i.weightKg)
                    ) : (
                      <span className="admin-hint" title="Вес узнаем после взвешивания на площадке">
                        вес уточним
                      </span>
                    )}
                    {/* Пометка после завершения перевозки: приёмку выполнили,
                        ждём взвешивания. Склад и платёж не двигаются, пока
                        макулатурщик не впишет вес и не сохранит приём. */}
                    {wpIntakeAwaitingWeight(i) && (
                      <button
                        type="button"
                        className="admin-badge admin-badge--amber"
                        style={{
                          border: 0,
                          cursor: "pointer",
                          marginLeft: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                        onClick={() => onEdit(i)}
                        title="Приёмка выполнена перевозкой · ожидание взвешивания. Откройте приём, впишите фактический вес — после сохранения приём уйдёт на склад и в банк."
                      >
                        <Scale size={11} /> Ждёт взвешивания
                      </button>
                    )}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(i.total)}</WpCell>
                  <WpCell>
                    <span className={ACCOUNT_BADGE[i.account]}>
                      {WP_ACCOUNT_LABELS[i.account]}
                    </span>
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                </WpRow>
              ))}
            </WpBody>
          </WpTable>
        </div>
      )}
      {/* Хвост окна списка: подъезд к кнопке догружает следующий кусок */}
      {win.hasMore && (
        <button
          type="button"
          className="admin-show-more"
          style={{ marginTop: 10 }}
          ref={(node) => {
            win.sentinelRef(node);
          }}
          onClick={win.showAll}
        >
          Показано {win.visible.length} из {win.total} · <strong>Показать все</strong>
        </button>
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
  typeLabels,
  onNew,
  onEdit,
  onCopy,
  onTogglePaid,
  onToggleTransport,
  onPostBank,
}: {
  shipments: WpShipment[];
  stock: ReturnType<typeof getWpStock>;
  typeLabels: Record<string, string>;
  onNew: () => void;
  onEdit: (item: WpShipment) => void;
  onCopy: (item: WpShipment) => void;
  onTogglePaid: (item: WpShipment) => void;
  onToggleTransport: (item: WpShipment) => void;
  onPostBank: (item: WpShipment) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [showCancelled, setShowCancelled] = useState(false);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
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
  }, [shipments, deferredQuery, showCancelled]);

  // Длинный список сдач — кусками (см. use-windowed-list).
  const win = useWindowedList(filtered, {
    resetKey: `${deferredQuery}|${showCancelled}`,
  });

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
              <div key={row.wastepaperType} style={{ minWidth: 170, display: "grid", gap: 3 }}>
                <div style={{ fontWeight: 700 }}>
                  {wpTypeLabel(row.wastepaperType, typeLabels)}
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

      <div className="wp-toolbar">
        <div className="wp-toolbar__search">
          <Search size={14} />
          <input
            className="admin-input"
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
          <Plus size={15} /> Продажа
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Сдач пока нет. Когда везёте накопленную макулатуру на предприятие —
              оформите сдачу: укажите предприятие, принятый вес и итоговую сумму —
              цена за кг посчитается сама; полученные деньги потом отметьте оплатой
              здесь или внесите платежом во вкладке «Платежи».
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading>№</WpHeading>
                <WpHeading>Дата</WpHeading>
                <WpHeading>Предприятие / адрес</WpHeading>
                <WpHeading>Позиции</WpHeading>
                <WpHeading>Вес</WpHeading>
                <WpHeading>Сумма</WpHeading>
                <WpHeading>Счёт</WpHeading>
                <WpHeading>Оплата</WpHeading>
                <WpHeading>Перевозка</WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map((s) => (
                <WpRow
                  key={s.id}
                  style={
                    s.status === "cancelled"
                      ? { opacity: 0.55, textDecoration: "line-through" }
                      : undefined
                  }
                >
                  <WpCell style={{ whiteSpace: "nowrap" }}>СМ-{s.number}</WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>{fmtDate(s.date)}</WpCell>
                  <WpCell>
                    {s.enterpriseName}
                    {s.address && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                        {s.address}
                      </div>
                    )}
                    {s.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        {s.comment}
                      </div>
                    )}
                  </WpCell>
                  <WpCell style={{ minWidth: 180 }}>
                    {s.items.length > 0
                      ? wpItemsSummary(s.items, typeLabels)
                      : wpTypeLabel(s.wastepaperType, typeLabels)}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    {s.weightKg > 0 ? (
                      fmtKg(s.weightKg)
                    ) : (
                      <span className="admin-hint" title="Вес узнаем после взвешивания на предприятии">
                        вес уточним
                      </span>
                    )}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{fmtMoney(s.total)}</WpCell>
                  <WpCell>
                    <span className={ACCOUNT_BADGE[s.account]}>
                      {WP_ACCOUNT_LABELS[s.account]}
                    </span>
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    {s.status === "cancelled" ? (
                      <span className="admin-badge admin-badge--muted">Отменена</span>
                    ) : s.receivedAmount > 0 && !s.bankPostedAt ? (
                      <button type="button" className="admin-badge admin-badge--amber" style={{ border: 0, cursor: "pointer" }} onClick={() => onPostBank(s)}>Провести в банк</button>
                    ) : s.bankPostedAt ? (
                      <span className="admin-badge admin-badge--green">В банке</span>
                    ) : (
                      <span className="admin-badge admin-badge--muted">Нет поступления</span>
                    )}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
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
                  </WpCell>
                </WpRow>
              ))}
            </WpBody>
          </WpTable>
        </div>
      )}
      {win.hasMore && (
        <button
          type="button"
          className="admin-show-more"
          style={{ marginTop: 10 }}
          ref={(node) => {
            win.sentinelRef(node);
          }}
          onClick={win.showAll}
        >
          Показано {win.visible.length} из {win.total} · <strong>Показать все</strong>
        </button>
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
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
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
  }, [counterparties, role, deferredQuery]);

  // Справочник контрагентов — кусками (см. use-windowed-list).
  const win = useWindowedList(filtered, {
    resetKey: `${deferredQuery}|${role}`,
  });

  return (
    <div>
      <div className="wp-toolbar">
        <div className="wp-toolbar__search">
          <Search size={14} />
          <input
            className="admin-input"
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
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading>Название</WpHeading>
                <WpHeading>Роль</WpHeading>
                <WpHeading>Точки / филиалы</WpHeading>
                <WpHeading>ИНН</WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map((c) => (
                <WpRow key={c.id}>
                  <WpCell style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.comment && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", fontWeight: 400, marginTop: 3 }}>
                        {c.comment}
                      </div>
                    )}
                  </WpCell>
                  <WpCell>
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
                  </WpCell>
                  <WpCell style={{ minWidth: 260 }}>
                    {c.branches && c.branches.length > 0 ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        {c.branches.map((b) => (
                          <div key={b.id} style={{ fontSize: "0.85rem" }}>
                            <div style={{ fontWeight: 600 }}>
                              <MapPin size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                              {b.label ? `${b.label}: ` : ""}
                              {b.address || "—"}
                            </div>
                            {(b.contactPerson || b.phone) && (
                              <div style={{ color: "var(--adm-muted)", paddingLeft: 15, marginTop: 2 }}>
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
                  </WpCell>
                  <WpCell>{c.inn || "—"}</WpCell>
                  <WpCell>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => onEdit(c)}
                    >
                      <Pencil size={13} />
                    </button>
                  </WpCell>
                </WpRow>
              ))}
            </WpBody>
          </WpTable>
        </div>
      )}
      {win.hasMore && (
        <button
          type="button"
          className="admin-show-more"
          style={{ marginTop: 10 }}
          ref={(node) => {
            win.sentinelRef(node);
          }}
          onClick={win.showAll}
        >
          Показано {win.visible.length} из {win.total} · <strong>Показать все</strong>
        </button>
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
  acceptedWeightKg: number;
  payableWeightKg: number;
  needsTransport: boolean;
  /** На когда планируем забор (пусто = как можно скорее). */
  transportPlannedDate: string | null;
  /**
   * false — сохранение карточки снимает пометку «приёмка выполнена ·
   * ожидание взвешивания» (вес вписан).
   */
  awaitingWeight: boolean;
}

function IntakeModal({
  mode,
  item,
  suppliers,
  catalog,
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
  catalog: WpTypeCatalog;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: IntakeFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  // Закрытие только крестиком и Escape: клик по подложке модалку не
  // закрывает — иначе выделение текста мышью с отпусканием за окном
  // сбрасывало всю заполненную форму.
  useEscapeClose(onClose, !saving);
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
      : [emptyDocItem(catalog)],
    acceptedWeightKg: item?.acceptedWeightKg || 0,
    payableWeightKg: item?.payableWeightKg || 0,
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

  // ── Расчёт оплаты: сумму вписываем сами, цена считается сама ──
  // Поле суммы — «умный редактор» позиций: при одной позиции её вес
  // становится равен весу к оплате, а цена — сумма / вес; при нескольких
  // сумма делится пропорционально весам (см. distributeWpTotal).
  // В обратную сторону тоже работает: правите позиции — сумма пересчитывается.
  const [sumStr, setSumStr] = useState(() => {
    if (!item) return "";
    const s = wpIntakePayableTotal(item);
    return s > 0 ? String(s) : "";
  });

  /** Пересчитать позиции под расчётный вес (только при ≤1 позиции). */
  function calcItemsForBase(
    items: WpDocItem[],
    base: number
  ): { items: WpDocItem[]; sum: string | null } {
    if (!(base > 0) || items.length > 1) return { items, sum: null };
    const S = parseNum(sumStr);
    if (S > 0) {
      return {
        items: distributeWpTotal(
          items,
          S,
          base,
          items[0]?.wastepaperType || defaultTypeKey(catalog)
        ),
        sum: null,
      };
    }
    if (items.length === 1) {
      // Сумма ещё не вписана — вес тянет за собой сумму по цене позиции.
      const it = items[0];
      const total = Math.round(base * (Number(it.pricePerKg) || 0) * 100) / 100;
      return {
        items: [{ ...it, weightKg: base, total }],
        sum: total > 0 ? String(total) : "",
      };
    }
    return { items, sum: null };
  }

  function onPayableChange(v: number) {
    const { items, sum } = calcItemsForBase(form.items, v);
    if (sum !== null) setSumStr(sum);
    setForm((prev) => ({ ...prev, payableWeightKg: v, items }));
  }

  function onAcceptedChange(v: number) {
    // Вес к оплате по умолчанию равен принятому — подставляем его,
    // пока вес к оплате не правили вручную.
    if (!(Number(form.payableWeightKg) > 0) && v > 0) {
      const { items, sum } = calcItemsForBase(form.items, v);
      if (sum !== null) setSumStr(sum);
      setForm((prev) => ({
        ...prev,
        acceptedWeightKg: v,
        payableWeightKg: v,
        items,
      }));
    } else {
      set("acceptedWeightKg", v);
    }
  }

  function onSumChange(raw: string) {
    setSumStr(raw);
    const S = parseNum(raw);
    const P = Number(form.payableWeightKg) || 0;
    if (S > 0 && P > 0) {
      setForm((prev) => ({
        ...prev,
        items: distributeWpTotal(
          prev.items,
          S,
          P,
          prev.items[0]?.wastepaperType || defaultTypeKey(catalog)
        ),
      }));
    }
  }

  function onSumBlur() {
    // Сумму стёрли — показываем обратно итог позиций, чтобы поле не врало.
    if (!(parseNum(sumStr) > 0)) {
      const t = wpDocTotals(form.items).total;
      setSumStr(t > 0 ? String(t) : "");
    }
  }

  function onItemsChange(next: WpDocItem[]) {
    const t = wpDocTotals(next).total;
    setSumStr(t > 0 ? String(t) : "");
    setForm((prev) => ({
      ...prev,
      items: next,
      // При одной позиции её вес и есть вес к оплате — держим синхронно,
      // чтобы деньги (вес к оплате × цена) всегда равнялись сумме документа.
      ...(next.length === 1 ? { payableWeightKg: next[0].weightKg } : {}),
    }));
  }

  const payableNum = Number(form.payableWeightKg) || 0;
  const sumNum = parseNum(sumStr);
  const autoPrice = sumNum > 0 && payableNum > 0 ? sumNum / payableNum : 0;
  // Сумма вписана, а вес — нет: цена не определена, старую цену позиции
  // не показываем, чтобы не вводить в заблуждение.
  const priceShown =
    autoPrice > 0
      ? fmtWpPrice(autoPrice)
      : sumNum > 0
        ? ""
        : form.items.length === 1
          ? fmtWpPrice(form.items[0].pricePerKg)
          : "";

  const totals = wpDocTotals(form.items);
  const valid =
    form.date !== "" && form.counterpartyName.trim() !== "";
  // В перевозку без адреса нельзя: водитель не будет знать, куда ехать.
  const transportError =
    form.needsTransport && form.address.trim() === ""
      ? "Укажите адрес забора — без него в перевозку нельзя."
      : "";

  return (
    <div className="admin-modal-overlay">
      <div
        className="admin-modal wp-modal"
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
          контактное лицо подставятся), впишите вес к оплате и итоговую сумму —
          цена за кг посчитается сама. Несколько профилей макулатуры добавьте
          позициями ниже. Сумма уйдёт в расход счёта.
        </p>

        {/* Пометка после завершения перевозки: приёмку выполнили, ждём
            взвешивания. Склад макулатуры и платёж не двигаются, пока
            вес не вписан и карточка не сохранена. */}
        {isEdit && item?.awaitingWeight && item.status === "active" && (
          <div className="deal-delivery-block" style={{ marginBottom: 12 }}>
            <div className="deal-delivery-block__head">
              <Scale size={14} />
              <span>Приёмка выполнена · ожидание взвешивания</span>
            </div>
            <p className="deal-delivery-block__empty" style={{ marginTop: 8 }}>
              Груз забрали перевозкой, склад и деньги ещё не двигались. Впишите
              фактический вес по позициям (и в поля «Фактически принято» /
              «Вес к оплате») — после сохранения приём уйдёт на склад макулатуры
              и в банк (расход на сумму), а пометка снимется.
            </p>
          </div>
        )}

        <form
          className="wp-modal-form"
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
              acceptedWeightKg: parseNum(String(form.acceptedWeightKg)),
              payableWeightKg: parseNum(String(form.payableWeightKg)),
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
              // Карточку приёма открыли, чтобы вписать вес — сохранение
              // снимает пометку «приёмка выполнена · ожидание взвешивания».
              awaitingWeight: false,
            });
          }}
        >
          <div className="wp-grid-2">
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

          <div className="admin-field">
            <label className="admin-label">
              <Banknote size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Расчёт оплаты — впишите сумму, цена за кг посчитается сама
            </label>
            <div className="wp-grid-2">
              <div className="admin-field"><label className="admin-label">Фактически принято, кг (на склад)</label><input className="admin-input" type="number" min="0" step="0.1" value={form.acceptedWeightKg || ""} onChange={(e) => onAcceptedChange(parseNum(e.target.value))} placeholder="После взвешивания" /></div>
              <div className="admin-field"><label className="admin-label">Вес к оплате, кг</label><input className="admin-input" type="number" min="0" step="0.1" value={form.payableWeightKg || ""} onChange={(e) => onPayableChange(parseNum(e.target.value))} placeholder="Можно меньше принятого" /></div>
            </div>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Итоговая сумма к оплате, ₽</label>
                <input
                  className="admin-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={sumStr}
                  onChange={(e) => onSumChange(e.target.value)}
                  onBlur={onSumBlur}
                  placeholder="Например, 5000"
                />
                {sumNum > 0 && !(payableNum > 0) && (
                  <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                    Впишите вес к оплате — тогда цена за кг посчитается сама.
                  </span>
                )}
              </div>
              <div className="admin-field">
                <label className="admin-label">Цена за кг, ₽ (авто)</label>
                <input className="admin-input" value={priceShown} readOnly placeholder="—" />
                <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                  {autoPrice > 0
                    ? "Посчитана сама: сумма ÷ вес к оплате."
                    : priceShown
                      ? "Сейчас — цена из позиции ниже."
                      : "Появится, когда впишете вес и сумму."}
                </span>
              </div>
            </div>
            {form.items.length > 1 && (
              <p className="admin-hint" style={{ fontSize: "0.75rem", marginTop: 0 }}>
                Позиций несколько: сумма делится между ними пропорционально весу.
                Цену каждой позиции можно поправить в строках ниже — сумма пересчитается.
              </p>
            )}
          </div>
          <ItemsEditor
            items={form.items}
            catalog={catalog}
            onChange={onItemsChange}
          />

          <div className="wp-grid-3 wp-grid--end">
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

          <div className="wp-modal__actions" style={{ justifyContent: "space-between" }}>
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
  shippedWeightKg: number;
  acceptedWeightKg: number;
  receivedAmount: number;
  needsTransport: boolean;
  /** На когда планируем отвоз (пусто = как можно скорее). */
  transportPlannedDate: string | null;
}

function ShipmentModal({
  mode,
  item,
  enterprises,
  catalog,
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
  catalog: WpTypeCatalog;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: ShipmentFormPayload) => void;
  onCancelDoc: () => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  // Закрытие только крестиком и Escape: клик по подложке модалку не
  // закрывает — иначе выделение текста мышью с отпусканием за окном
  // сбрасывало всю заполненную форму.
  useEscapeClose(onClose, !saving);
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
      : [emptyDocItem(catalog)],
    shippedWeightKg: item?.shippedWeightKg || 0,
    acceptedWeightKg: item?.acceptedWeightKg || 0,
    receivedAmount: item?.receivedAmount || 0,
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

  // ── Расчёт: сумму вписываем сами, цена считается сама ──
  // Та же логика, что в приёме: при одной позиции её вес становится равен
  // принятому весу, а цена — сумма / вес; при нескольких сумма делится
  // пропорционально весам. Правите позиции — сумма пересчитывается.
  const [sumStr, setSumStr] = useState(() => {
    if (!item) return "";
    const t = wpDocTotals(item.items).total;
    return t > 0 ? String(t) : "";
  });

  /** Расчётный вес для цены: принятый, а пока его нет — отгруженный. */
  const baseWeight =
    (Number(form.acceptedWeightKg) || 0) > 0
      ? Number(form.acceptedWeightKg)
      : Number(form.shippedWeightKg) || 0;
  const baseIsAccepted = (Number(form.acceptedWeightKg) || 0) > 0;

  function calcItemsForBase(
    items: WpDocItem[],
    base: number
  ): { items: WpDocItem[]; sum: string | null } {
    if (!(base > 0) || items.length > 1) return { items, sum: null };
    const S = parseNum(sumStr);
    if (S > 0) {
      return {
        items: distributeWpTotal(
          items,
          S,
          base,
          items[0]?.wastepaperType || defaultTypeKey(catalog)
        ),
        sum: null,
      };
    }
    if (items.length === 1) {
      const it = items[0];
      const total = Math.round(base * (Number(it.pricePerKg) || 0) * 100) / 100;
      return {
        items: [{ ...it, weightKg: base, total }],
        sum: total > 0 ? String(total) : "",
      };
    }
    return { items, sum: null };
  }

  function onAcceptedChange(v: number) {
    const base = v > 0 ? v : Number(form.shippedWeightKg) || 0;
    const { items, sum } = calcItemsForBase(form.items, base);
    if (sum !== null) setSumStr(sum);
    setForm((prev) => ({ ...prev, acceptedWeightKg: v, items }));
  }

  function onShippedChange(v: number) {
    // Принятый вес по умолчанию равен отгруженному — подставляем его,
    // пока принятый вес не правили вручную.
    if (!(Number(form.acceptedWeightKg) > 0) && v > 0) {
      const { items, sum } = calcItemsForBase(form.items, v);
      if (sum !== null) setSumStr(sum);
      setForm((prev) => ({
        ...prev,
        shippedWeightKg: v,
        acceptedWeightKg: v,
        items,
      }));
    } else {
      set("shippedWeightKg", v);
    }
  }

  function onSumChange(raw: string) {
    setSumStr(raw);
    const S = parseNum(raw);
    if (S > 0 && baseWeight > 0) {
      setForm((prev) => ({
        ...prev,
        items: distributeWpTotal(
          prev.items,
          S,
          baseWeight,
          prev.items[0]?.wastepaperType || defaultTypeKey(catalog)
        ),
      }));
    }
  }

  function onSumBlur() {
    if (!(parseNum(sumStr) > 0)) {
      const t = wpDocTotals(form.items).total;
      setSumStr(t > 0 ? String(t) : "");
    }
  }

  function onItemsChange(next: WpDocItem[]) {
    const t = wpDocTotals(next).total;
    setSumStr(t > 0 ? String(t) : "");
    setForm((prev) => ({
      ...prev,
      items: next,
      // При одной позиции её вес зеркалит расчётный вес (принятый, а пока
      // его нет — отгруженный), чтобы сумма документа не расходилась с суммой.
      ...(next.length === 1
        ? (Number(prev.acceptedWeightKg) || 0) > 0
          ? { acceptedWeightKg: next[0].weightKg }
          : { shippedWeightKg: next[0].weightKg }
        : {}),
    }));
  }

  const sumNum = parseNum(sumStr);
  const autoPrice = sumNum > 0 && baseWeight > 0 ? sumNum / baseWeight : 0;
  // Сумма вписана, а вес — нет: цена не определена, старую цену позиции
  // не показываем, чтобы не вводить в заблуждение.
  const priceShown =
    autoPrice > 0
      ? fmtWpPrice(autoPrice)
      : sumNum > 0
        ? ""
        : form.items.length === 1
          ? fmtWpPrice(form.items[0].pricePerKg)
          : "";

  const totals = wpDocTotals(form.items);
  const valid =
    form.date !== "" && form.enterpriseName.trim() !== "";
  // В перевозку без адреса нельзя: водитель не будет знать, куда везти.
  const transportError =
    form.needsTransport && form.address.trim() === ""
      ? "Укажите адрес предприятия — без него в перевозку нельзя."
      : "";

  return (
    <div className="admin-modal-overlay">
      <div
        className="admin-modal wp-modal"
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
          точку (адрес, телефон, контакт подставятся), впишите принятый вес и
          итоговую сумму по акту — цена за кг посчитается сама. Сумма придёт в
          выбранный счёт; когда деньги получены — отметьте оплату.
        </p>

        <form
          className="wp-modal-form"
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
              shippedWeightKg: parseNum(String(form.shippedWeightKg)),
              acceptedWeightKg: parseNum(String(form.acceptedWeightKg)),
              receivedAmount: parseNum(String(form.receivedAmount)),
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
            });
          }}
        >
          <div className="wp-grid-2">
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

          <div className="admin-field">
            <label className="admin-label">
              <Banknote size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Расчёт по акту — впишите сумму, цена за кг посчитается сама
            </label>
            <div className="wp-grid-2">
              <div className="admin-field"><label className="admin-label">Отгружено по нашим весам, кг</label><input className="admin-input" type="number" min="0" step="0.1" value={form.shippedWeightKg || ""} onChange={(e) => onShippedChange(parseNum(e.target.value))} /></div>
              <div className="admin-field"><label className="admin-label">Принято предприятием, кг</label><input className="admin-input" type="number" min="0" step="0.1" value={form.acceptedWeightKg || ""} onChange={(e) => onAcceptedChange(parseNum(e.target.value))} /></div>
            </div>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Итоговая сумма, ₽ (по акту)</label>
                <input
                  className="admin-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={sumStr}
                  onChange={(e) => onSumChange(e.target.value)}
                  onBlur={onSumBlur}
                  placeholder="Например, 12000"
                />
                {sumNum > 0 && !(baseWeight > 0) && (
                  <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                    Впишите принятый вес — тогда цена за кг посчитается сама.
                  </span>
                )}
              </div>
              <div className="admin-field">
                <label className="admin-label">Цена за кг, ₽ (авто)</label>
                <input className="admin-input" value={priceShown} readOnly placeholder="—" />
                <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                  {autoPrice > 0
                    ? baseIsAccepted
                      ? "Посчитана сама: сумма ÷ принятый вес."
                      : "Посчитана сама: сумма ÷ отгруженный вес."
                    : priceShown
                      ? "Сейчас — цена из позиции ниже."
                      : "Появится, когда впишете вес и сумму."}
                </span>
              </div>
            </div>
            {form.items.length > 1 && (
              <p className="admin-hint" style={{ fontSize: "0.75rem", marginTop: 0 }}>
                Позиций несколько: сумма делится между ними пропорционально весу.
                Цену каждой позиции можно поправить в строках ниже — сумма пересчитается.
              </p>
            )}
            <div className="admin-field" style={{ marginBottom: 0 }}>
              <label className="admin-label">Поступление денег, ₽ (факт)</label>
              <input className="admin-input" type="number" min="0" step="0.01" value={form.receivedAmount || ""} onChange={(e) => set("receivedAmount", parseNum(e.target.value))} placeholder="Сколько реально пришло" />
              <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                Если реально пришло столько же, сколько по акту, — оставьте пустым.
              </span>
            </div>
          </div>
          <ItemsEditor
            items={form.items}
            catalog={catalog}
            onChange={onItemsChange}
          />

          <div className="wp-grid-3 wp-grid--end">
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

          <div className="wp-modal__actions" style={{ justifyContent: "space-between" }}>
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
  // Закрытие только крестиком и Escape: клик по подложке модалку не
  // закрывает — иначе выделение текста мышью с отпусканием за окном
  // сбрасывало всю заполненную форму.
  useEscapeClose(onClose, !saving);
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
    <div className="admin-modal-overlay">
      <div
        className="admin-modal wp-modal wp-modal--slim"
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
          className="wp-modal-form"
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
          <div className="wp-grid-3">
            <div className="admin-field">
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
              />
            </div>
            <div className="admin-field">
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
            <div className="admin-field">
              <label className="admin-label">Счёт</label>
              <select
                className="admin-select"
                value={form.account}
                onChange={(e) => set("account", e.target.value as WpAccount)}
              >
                <option value="cash">Наличка</option>
                <option value="bank">Безнал</option>
                <option value="third_party">Сторонние пополнения</option>
              </select>
            </div>
          </div>

          <div className="wp-grid-3">
            <div className="admin-field" style={{ gridColumn: "span 2" }}>
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
            <div className="admin-field">
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

          <div className="wp-modal__actions" style={{ justifyContent: "space-between" }}>
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
  paymentDetails: string | null;
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
  // Закрытие только крестиком и Escape: клик по подложке модалку не
  // закрывает — иначе выделение текста мышью с отпусканием за окном
  // сбрасывало всю заполненную форму.
  useEscapeClose(onClose, !saving);
  const [form, setForm] = useState(() => ({
    name: item?.name || "",
    roles: item?.roles || (["supplier"] as string[]),
    branches: initialBranches(item),
    inn: item?.inn || "",
    comment: item?.comment || "",
    paymentDetails: item?.paymentDetails || "",
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
    <div className="admin-modal-overlay">
      <div
        className="admin-modal wp-modal"
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
          className="wp-modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              name: form.name.trim(),
              roles: form.roles,
              branches: cleanBranches,
              inn: form.inn.trim() || null,
              comment: form.comment.trim() || null,
              paymentDetails: form.paymentDetails.trim() || null,
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
          <div className="admin-field" style={{ gap: 10 }}>
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
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
                  <div className="admin-field" style={{ marginBottom: 8 }}>
                    <input
                      className="admin-input"
                      value={b.address}
                      onChange={(e) => setBranch(b.id, { address: e.target.value })}
                      placeholder="Адрес * (где забирать / куда везти)"
                    />
                  </div>
                  <div className="wp-grid-2">
                    <input
                      className="admin-input"
                      value={b.contactPerson}
                      onChange={(e) => setBranch(b.id, { contactPerson: e.target.value })}
                      placeholder="Контактное лицо (ФИО)"
                    />
                    <input
                      className="admin-input"
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
              onClick={addBranch}
            >
              <Plus size={13} /> Добавить точку
            </button>
          </div>

          <div className="admin-field">
            <label className="admin-label">Куда переводить деньги</label>
            <textarea className="admin-input" rows={2} value={form.paymentDetails} onChange={(e) => set("paymentDetails", e.target.value)} placeholder="Карта, СБП, расчётный счёт, банк…" />
          </div>

          <div className="wp-grid-3">
            <div className="admin-field">
              <label className="admin-label">ИНН</label>
              <input
                className="admin-input"
                value={form.inn}
                onChange={(e) => set("inn", e.target.value)}
              />
            </div>
            <div className="admin-field" style={{ gridColumn: "span 2" }}>
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

          <div className="wp-modal__actions" style={{ justifyContent: "space-between" }}>
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

function DebtsTab({ intakes, counterparties, onEditCounterparty }: { intakes: WpIntake[]; counterparties: WpCounterparty[]; onEditCounterparty: (item: WpCounterparty) => void }) {
  const rows = counterparties.map((c) => {
    const docs = intakes.filter((i) => i.status === "active" && !i.isPaid && (i.counterpartyId === c.id || i.counterpartyName.trim().toLowerCase() === c.name.trim().toLowerCase()));
    return { c, docs, total: docs.reduce((sum, d) => sum + d.total, 0) };
  }).filter((r) => r.total > 0 || r.docs.length > 0);
  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return <div>
    <div className="admin-card" style={{ marginBottom: 14 }}><div className="admin-card__head"><span className="admin-card__title">Мы должны за приём макулатуры</span><strong>{fmtMoney(total)}</strong></div><div className="admin-card__pad"><p className="admin-hint">Показываются активные приёмы, которые ещё не отмечены оплаченными.</p></div></div>
    {rows.length === 0 ? <div className="admin-card"><div className="admin-card__pad"><p className="admin-hint">Долгов за приём макулатуры нет.</p></div></div> : <div className="admin-table-wrap"><WpTable className="admin-table"><WpHead><WpRow><WpHeading>Кому</WpHeading><WpHeading>Документы</WpHeading><WpHeading>Куда переводить</WpHeading><WpHeading>Сумма</WpHeading><WpHeading></WpHeading></WpRow></WpHead><WpBody>{rows.map(({c,docs,total}) => <WpRow key={c.id}><WpCell>{c.name}</WpCell><WpCell>{docs.map(d => `ПМ-${d.number}`).join(", ")}</WpCell><WpCell>{c.paymentDetails || <span className="admin-hint">Не указано</span>}</WpCell><WpCell style={{fontWeight:700}}>{fmtMoney(total)}</WpCell><WpCell><button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => onEditCounterparty(c)}><Pencil size={13}/> Реквизиты</button></WpCell></WpRow>)}</WpBody></WpTable></div>}
  </div>;
}

function StockTab({ stock, typeLabels }: { stock: ReturnType<typeof getWpStock>; typeLabels: Record<string, string> }) {
  const total = stock.reduce((sum, row) => sum + Math.max(0, row.stockKg), 0);
  return <div><div className="admin-card" style={{ marginBottom: 14 }}><div className="admin-card__head"><span className="admin-card__title">Фактический склад макулатуры</span><strong>{fmtKg(total)}</strong></div><div className="admin-card__pad"><p className="admin-hint">На склад попадает фактически принятое количество, а не вес к оплате.</p></div></div><div className="admin-table-wrap"><WpTable className="admin-table"><WpHead><WpRow><WpHeading>Вид макулатуры</WpHeading><WpHeading>Принято фактически</WpHeading><WpHeading>Продано / отгружено</WpHeading><WpHeading>Остаток</WpHeading></WpRow></WpHead><WpBody>{stock.map((row) => <WpRow key={row.wastepaperType}><WpCell>{wpTypeLabel(row.wastepaperType, typeLabels)}</WpCell><WpCell>{fmtKg(row.intakeKg)}</WpCell><WpCell>{fmtKg(row.shipmentKg)}</WpCell><WpCell style={{fontWeight:700}}>{fmtKg(Math.max(0,row.stockKg))}</WpCell></WpRow>)}</WpBody></WpTable></div></div>;
}
