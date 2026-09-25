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

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  Save,
  Landmark,
  ArrowLeftRight,
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
  findWpBranchByAddress,
  findWpBranchMatch,
  fmtDate,
  fmtKg,
  fmtMoney,
  fmtWpPrice,
  getWpBalance,
  getWpForecast,
  getWpStock,
  migrateWpDocItems,
  wpCollectMoneyEvents,
  wpDocDetailedTotals,
  wpEventEffectiveDate,
  wpIntakeAwaitingWeight,
  wpIntakeCompleted,
  WP_COMMON_ACCOUNT_LABEL,
  wpIntakeTransportDone,
  wpItemsSummary,
  wpTypeLabel,
  wpUid,
  type WpAccount,
  type WpAccountTransfer,
  type WpBalance,
  type WpBranch,
  type WpCounterparty,
  type WpDocItem,
  type WpDocKind,
  type WpDocPaymentSpec,
  type WpIntake,
  type WpManualPayment,
  type WpMoneyEvent,
  type WpShipment,
  type WpStockAdjustment,
  type WpStockRow,
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
  { key: "bank", label: "Банк", icon: Landmark },
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
  })}\u00A0${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
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
  transfer: { cls: "admin-badge admin-badge--gray", label: "Перевод" },
};

/**
 * Бейдж вида движения. У платежа-оплаты документа заголовок самодостаточен
 * («Оплата приёма №112») — бейдж «Платёж» рядом только шумит.
 */
function wpEventKindBadge(e: WpMoneyEvent): { cls: string; label: string } | null {
  if (e.docType && e.docId) return null;
  return KIND_BADGE[e.kind];
}

/** Тот же бейдж сразу JSX-элементом (или пусто — заголовок самодостаточен). */
function wpEventKindBadgeEl(e: WpMoneyEvent) {
  const b = wpEventKindBadge(e);
  return b ? <span className={b.cls}>{b.label}</span> : null;
}

/**
 * Перевод между своими счетами проводится сразу: отметки «оплачено»
 * у него нет, правится и удаляется он во вкладке «Банк».
 */
const TRANSFER_EVENT_HINT =
  "Перевод между счетами макулатуры. Изменить или удалить его можно на вкладке «Банк» этого модуля.";

/** Подсказка для событий-зарплат: их ведут на вкладке «Зарплаты» модуля. */
const SALARY_EVENT_HINT =
  "Зарплата из денег макулатуры. Изменить или отменить её можно на вкладке «Зарплаты» этого модуля.";

/**
 * Конец API по виду денежного события. Зарплата — общая таблица учёта,
 * но у модуля свой маршрут (/api/admin/wp/salaries), который работает
 * только с записями макулатуры.
 */
function apiUrlForEvent(e: WpMoneyEvent): string {
  if (e.kind === "transfer") return `/api/admin/wp/account-transfers/${e.transferId}`;
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
   Как в 1С: несколько видов макулатуры, у каждого свой фактический
   вес, расчётный вес (к оплате / принятый) и сумма. Все три поля
   необязательные: документ заполняют частями и правят позже.
   Цена за кг нигде не вводится — она считается сама (сумма / вес),
   а пока суммы нет, подсказывается из справочника видов. Итоги
   документа (принято / к оплате / сумма) = суммы этих строк.   */

function ItemsEditor({
  items,
  onChange,
  catalog,
  mode,
}: {
  items: WpDocItem[];
  onChange: (items: WpDocItem[]) => void;
  catalog: WpTypeCatalog;
  /**
   * Приём: «Факт / К оплате». Сдача: «Отгружено / Принято».
   * Поля данных общие (weightKg / payableWeightKg), различаются подписи.
   */
  mode: "intake" | "shipment";
}) {
  const factLabel = mode === "intake" ? "Факт, кг" : "Отгружено, кг";
  const calcLabel = mode === "intake" ? "К оплате, кг" : "Принято, кг";

  /** Расчётный вес строки: к оплате/принятый, а пока его нет — факт. */
  function calcBase(it: WpDocItem): number {
    const calc = Number(it.payableWeightKg) || 0;
    return calc > 0 ? calc : Number(it.weightKg) || 0;
  }

  /** Цена строки для показа: сумма / вес, иначе подсказка справочника. */
  function rowPrice(it: WpDocItem): number {
    const t = Number(it.total) || 0;
    const base = calcBase(it);
    if (t > 0 && base > 0) return t / base;
    return Number(it.pricePerKg) || 0;
  }

  /**
   * Автосумма: пока сумму не вписали вручную, считаем её сами
   * (расчётный вес × цена-подсказка) — как раньше тянул вес.
   */
  function withAutoSum(row: WpDocItem): WpDocItem {
    const calc = Number(row.payableWeightKg) || 0;
    const price = Number(row.pricePerKg) || 0;
    if (!((Number(row.total) || 0) > 0) && calc > 0 && price > 0) {
      return { ...row, total: Math.round(calc * price * 100) / 100 };
    }
    return row;
  }

  /**
   * Сумму вписали вручную — цена строки пересчитывается под неё,
   * чтобы сумма / вес всегда сходились.
   */
  function withManualPrice(row: WpDocItem): WpDocItem {
    const t = Number(row.total) || 0;
    const base = calcBase(row);
    if (t > 0 && base > 0) return { ...row, pricePerKg: t / base };
    return row;
  }

  function setType(id: string, wastepaperType: string) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, wastepaperType };
        // Сумму ещё не вписали — цена берётся из справочника нового вида.
        if (!((Number(next.total) || 0) > 0)) {
          const p = defaultPriceFor(catalog, wastepaperType);
          if (p != null && p > 0) next.pricePerKg = p;
          return withAutoSum(next);
        }
        return next;
      })
    );
  }

  function setFact(id: string, v: number) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, weightKg: v };
        // Расчётный вес по умолчанию равен фактическому — подставляем,
        // пока его не правили вручную.
        if (!((Number(next.payableWeightKg) || 0) > 0) && v > 0) {
          next.payableWeightKg = v;
        }
        return (Number(next.total) || 0) > 0
          ? withManualPrice(next)
          : withAutoSum(next);
      })
    );
  }

  function setCalc(id: string, v: number) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, payableWeightKg: v };
        return (Number(next.total) || 0) > 0
          ? withManualPrice(next)
          : withAutoSum(next);
      })
    );
  }

  function setSum(id: string, v: number) {
    onChange(
      items.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, total: Math.round(v * 100) / 100 };
        // Сумму стёрли — цена-подсказка остаётся, автосумма включится
        // при следующей правке веса.
        return v > 0 ? withManualPrice(next) : next;
      })
    );
  }

  function addItem() {
    onChange([...items, emptyDocItem(catalog)]);
  }

  function removeItem(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  const totals = wpDocDetailedTotals(items);

  return (
    <div className="admin-field" style={{ gap: 10 }}>
      <label className="admin-label">
        <Scale size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Позиции — по каждому виду: факт, вес к оплате и сумма
      </label>
      {/* Шапка колонок — только десктоп; на телефоне у полей плейсхолдеры. */}
      {items.length > 0 && (
        <div className="wp-items__head" aria-hidden="true">
          <span>Вид макулатуры</span>
          <span>{factLabel}</span>
          <span>{calcLabel}</span>
          <span>Сумма, ₽</span>
          <span>₽/кг</span>
          <span />
        </div>
      )}
      {items.length === 0 && (
        <p className="admin-hint" style={{ marginTop: 0 }}>
          Нет позиций — добавьте хотя бы одну или сохраните документ пустым
          и заполните позже.
        </p>
      )}
      <div style={{ display: "grid", gap: 10 }}>
        {items.map((it) => (
          <div key={it.id} className="wp-item-row">
            <select
              className="admin-select"
              aria-label="Вид макулатуры"
              value={it.wastepaperType}
              onChange={(e) => setType(it.id, e.target.value)}
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
              aria-label={factLabel}
              placeholder={factLabel}
              title={factLabel}
              value={it.weightKg || ""}
              onChange={(e) => setFact(it.id, parseNum(e.target.value))}
            />
            <input
              className="admin-input"
              type="number"
              min="0"
              step="0.1"
              aria-label={calcLabel}
              placeholder={calcLabel}
              title={calcLabel}
              value={it.payableWeightKg || ""}
              onChange={(e) => setCalc(it.id, parseNum(e.target.value))}
            />
            <input
              className="admin-input"
              type="number"
              min="0"
              step="0.01"
              aria-label="Сумма позиции, ₽"
              placeholder="Сумма, ₽"
              title="Сумма позиции, ₽"
              value={it.total || ""}
              onChange={(e) => setSum(it.id, parseNum(e.target.value))}
            />
            <input
              className="admin-input wp-item-row__price"
              aria-label="Цена за кг (считается сама)"
              title="Цена за кг: сумма ÷ вес. Пока суммы нет — цена из справочника видов."
              value={fmtWpPrice(rowPrice(it))}
              placeholder="—"
              readOnly
              tabIndex={-1}
            />
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm wp-item-row__del"
              onClick={() => removeItem(it.id)}
              title="Удалить позицию"
              aria-label="Удалить позицию"
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
          Итого: {mode === "intake" ? "факт" : "отгружено"} {fmtKg(totals.acceptedKg)} ·{" "}
          {mode === "intake" ? "к оплате" : "принято"} {fmtKg(totals.payableKg)} ·{" "}
          {fmtMoney(totals.total)}
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
    payableWeightKg: 0,
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
  /**
   * Ручные правки остатка макулатуры (вкладка «Склад»): разница с расчётом
   * «принято − продано». Приёмы и продажи продолжают двигать остаток
   * поверх правки.
   */
  stockAdjustments?: WpStockAdjustment[];
  /**
   * Переводы денег между счетами модуля (безнал ↔ наличка): внутреннее
   * движение, в журнале «Банк» и в отчёте по дням видно обе стороны.
   */
  accountTransfers?: WpAccountTransfer[];
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
      // Ручные правки остатка — вкладка «Склад» у всех открыта актуальной.
      "wp_stock_adjustments",
      // Переводы между счетами — журнал «Банк» обновляется сразу.
      "wp_account_transfers",
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
  const [stockAdjustments, setStockAdjustments] = useState<WpStockAdjustment[]>(
    props.stockAdjustments ?? []
  );
  const [accountTransfers, setAccountTransfers] = useState<WpAccountTransfer[]>(
    props.accountTransfers ?? []
  );

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
  const [transferModal, setTransferModal] = useState<
    { mode: "create" } | { mode: "edit"; item: WpAccountTransfer } | null
  >(null);


  // После router.refresh() сервер отдаёт свежие данные
  useEffect(() => setCounterparties(props.counterparties), [props.counterparties]);
  useEffect(() => setIntakes(props.intakes), [props.intakes]);
  useEffect(() => setShipments(props.shipments), [props.shipments]);
  useEffect(() => setManualPayments(props.manualPayments), [props.manualPayments]);
  useEffect(() => setSalaries(props.salaries ?? []), [props.salaries]);
  useEffect(() => setProducts(props.products), [props.products]);
  useEffect(
    () => setStockAdjustments(props.stockAdjustments ?? []),
    [props.stockAdjustments]
  );
  useEffect(
    () => setAccountTransfers(props.accountTransfers ?? []),
    [props.accountTransfers]
  );

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
    () =>
      wpCollectMoneyEvents(
        intakes,
        shipments,
        manualPayments,
        salaries,
        accountTransfers
      ),
    [intakes, shipments, manualPayments, salaries, accountTransfers]
  );
  const today = todayStr();
  const balance = useMemo(() => getWpBalance(events, today), [events, today]);
  const forecast = useMemo(() => getWpForecast(events), [events]);
  const stock = useMemo(
    () => getWpStock(intakes, shipments, stockAdjustments),
    [intakes, shipments, stockAdjustments]
  );

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
    // Перевод между счетами проводится в момент записи: отметки об оплате
    // у него нет, менять нужно сам перевод (вкладка «Банк»).
    if (e.kind === "transfer") {
      setActionError("");
      setNotice(TRANSFER_EVENT_HINT);
      return;
    }
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

  /**
   * Пометка «перевозка выполнена» — груз вывезли.
   *
   * Обычно ставится сама: завершили рейс с точкой приёма — пометка на
   * месте. Вручную нужна, когда груз уехал вне рейса (своя машина,
   * самовывоз) или когда пометку надо снять. Приём с пометкой уходит из
   * доставок и очереди перевозок, дальше по нему только вес и оплата.
   */
  async function toggleIntakeTransportDone(item: WpIntake) {
    const to = !wpIntakeTransportDone(item);
    const ok = await callApi(
      () =>
        fetch(`/api/admin/wp/intakes/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transportDone: to }),
        }),
      "Не удалось обновить пометку о перевозке"
    );
    if (ok) {
      setNotice(
        to
          ? `Приём ПМ-${item.number}: перевозка выполнена — приём убран из доставок.`
          : `Приём ПМ-${item.number}: пометка снята, приём снова в очереди перевозок.`
      );
    }
  }

  function openEventEdit(e: WpMoneyEvent) {
    if (e.kind === "transfer") {
      // Обе стороны перевода ведут к одной записи — открываем её.
      const item = accountTransfers.find((t) => t.id === e.transferId);
      if (item) {
        setFormError("");
        setTransferModal({ mode: "edit", item });
      } else {
        setNotice(TRANSFER_EVENT_HINT);
      }
      return;
    }
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

      {tab === "bank" && (
        <BankTab
          events={events}
          balance={balance}
          transfers={accountTransfers}
          onNewTransfer={() => {
            setFormError("");
            setTransferModal({ mode: "create" });
          }}
          onEditTransfer={(item) => {
            setFormError("");
            setTransferModal({ mode: "edit", item });
          }}
          onEditEvent={openEventEdit}
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
          onToggleTransportDone={toggleIntakeTransportDone}
        />
      )}

      {tab === "stock" && (
        <StockTab
          stock={stock}
          typeLabels={typeLabels}
          catalog={typeCatalog}
          adjustments={stockAdjustments}
          onSaved={(items) => {
            setStockAdjustments(items);
            setNotice("Остаток на складе сохранён");
          }}
          onFailed={(message) => setActionError(message)}
        />
      )}

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
          payments={manualPayments}
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
          payments={manualPayments}
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

      {transferModal && (
        <TransferModal
          mode={transferModal.mode}
          item={transferModal.mode === "edit" ? transferModal.item : null}
          balance={balance}
          saving={saving}
          error={formError}
          onClose={() => setTransferModal(null)}
          onSubmit={async (form) => {
            const isEdit = transferModal.mode === "edit";
            const ok = await callApi(
              () =>
                fetch(
                  isEdit
                    ? `/api/admin/wp/account-transfers/${transferModal.item.id}`
                    : "/api/admin/wp/account-transfers",
                  {
                    method: isEdit ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(form),
                  }
                ),
              isEdit ? "Не удалось сохранить перевод" : "Не удалось создать перевод"
            );
            if (ok) {
              setTransferModal(null);
              setNotice(isEdit ? "Перевод сохранён" : "Перевод проведён");
            }
          }}
          onDelete={async () => {
            if (transferModal.mode !== "edit") return;
            if (!confirm(`Удалить перевод №${transferModal.item.number} безвозвратно?`)) return;
            const ok = await callApi(
              () =>
                fetch(`/api/admin/wp/account-transfers/${transferModal.item.id}`, {
                  method: "DELETE",
                }),
              "Не удалось удалить перевод"
            );
            if (ok) {
              setTransferModal(null);
              setNotice("Перевод удалён");
            }
          }}
        />
      )}

      {paymentModal && (
        <PaymentModal
          mode={paymentModal.mode}
          item={paymentModal.mode === "edit" ? paymentModal.item : null}
          counterparties={counterparties}
          intakes={intakes}
          shipments={shipments}
          onOpenDoc={(docType, docId) => {
            // Из карточки платежа — сразу в привязанный документ.
            setPaymentModal(null);
            if (docType === "intake") {
              const doc = intakes.find((i) => i.id === docId);
              if (doc) setIntakeModal({ mode: "edit", item: doc });
            } else {
              const doc = shipments.find((s) => s.id === docId);
              if (doc) setShipmentModal({ mode: "edit", item: doc });
            }
          }}
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
  // Счета модуля — одинаковые строки и на телефоне, и на десктопе:
  // иконка · название · сумма справа (как счета в приложении банка).
  const accountRows = (
    <dl className="wpa-hero__accounts">
      <div className="wpa-hero__account">
        <dt>
          <span className="wpa-hero__account-ic" aria-hidden="true">
            <Banknote size={17} />
          </span>
          <span className="wpa-hero__account-name">Наличка</span>
        </dt>
        <dd className="wpa-hero__account-val">{fmtMoney(balance.cash)}</dd>
      </div>
      <div className="wpa-hero__account">
        <dt>
          <span className="wpa-hero__account-ic" aria-hidden="true">
            <CreditCard size={17} />
          </span>
          <span className="wpa-hero__account-name">Безнал</span>
        </dt>
        <dd className="wpa-hero__account-val">{fmtMoney(balance.bank)}</dd>
      </div>
      <div className="wpa-hero__account">
        <dt>
          <span className="wpa-hero__account-ic" aria-hidden="true">
            <HandCoins size={17} />
          </span>
          <span className="wpa-hero__account-name">Сторонние пополнения</span>
        </dt>
        <dd className="wpa-hero__account-val">{fmtMoney(balance.third_party)}</dd>
      </div>
    </dl>
  );

  const isMobile = useIsMobile();
  if (isMobile) return (
    <section className="wpa-mobile" aria-label="Баланс макулатуры">
      <div className="wpa-hero wpa-hero--phone">
        <div className="wpa-hero__top">
          <h2 className="wpa-hero__title">
            <Wallet size={14} /> Деньги макулатуры
          </h2>
          <span className="wpa-hero__date">
            <CalendarClock size={13} /> {fmtDate(today)}
          </span>
        </div>
        <div className="wpa-hero__main">
          <div className="wpa-hero__label">
            <Scale size={13} /> Итого · все счета
          </div>
          <strong className="wpa-hero__value">{fmtMoney(balance.total)}</strong>
          <p className="wpa-hero__note">
            {WP_COMMON_ACCOUNT_LABEL}: <strong>{fmtMoney(balance.common)}</strong>
          </p>
        </div>
        {accountRows}
        <div className="wpa-hero__actions">
          <button type="button" className="wpa-hero__btn wpa-hero__btn--primary" onClick={onQuickIntake}>
            <ArrowDownLeft size={20} /><span>Принять</span>
          </button>
          <button type="button" className="wpa-hero__btn" onClick={onQuickShipment}>
            <ArrowUpRight size={20} /><span>Сдать</span>
          </button>
          <button type="button" className="wpa-hero__btn" onClick={onOpenTransports}>
            <Truck size={20} /><span>Перевозки</span>
          </button>
        </div>
      </div>
      <div className="wpa-mobile__summary">
        <div><Warehouse size={18} /><span>На складе</span><strong>{fmtKg(stockKg)}</strong></div>
        <div><HandCoins size={18} /><span>Приёмов к оплате</span><strong>{unpaidIntakes}</strong></div>
        <button type="button" onClick={onOpenTransports}><Truck size={18} /><span>Ждут перевозку</span><strong>{pendingTransport}</strong></button>
      </div>
      <details className="wpa-mobile__forecast">
        <summary>Прогноз движения денег</summary>
        <dl>
          <div className="wpa-mobile__forecast-row">
            <dt>Ожидаемый приход</dt>
            <dd className="wp-amt wp-amt--in">+{fmtMoney(forecast.inTotal)}</dd>
          </div>
          <div className="wpa-mobile__forecast-row">
            <dt>Ожидаемый расход</dt>
            <dd className="wp-amt wp-amt--out">−{fmtMoney(forecast.outTotal)}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
  return (
    <section className="wpa-hero" aria-label="Баланс макулатуры">
      <div className="wpa-hero__top">
        <h2 className="wpa-hero__title">
          <Wallet size={14} /> Деньги макулатуры
        </h2>
        <span className="wpa-hero__date">
          <CalendarClock size={13} /> {fmtDate(today)}
        </span>
      </div>

      <div className="wpa-hero__body">
        <div className="wpa-hero__main">
          <div className="wpa-hero__label">
            <Scale size={13} /> Итого · наличка, безнал и сторонние
          </div>
          <div className="wpa-hero__value">{fmtMoney(balance.total)}</div>
          <p className="wpa-hero__note">
            {WP_COMMON_ACCOUNT_LABEL} (наличка + безнал):{" "}
            <strong>{fmtMoney(balance.common)}</strong>
          </p>
          {/* Быстрые действия — как кнопки операций в мобильном банке */}
          <div className="wpa-hero__actions">
            <button type="button" className="wpa-hero__btn wpa-hero__btn--primary" onClick={onQuickIntake}>
              <ArrowDownLeft size={16} /> Принять макулатуру
            </button>
            <button type="button" className="wpa-hero__btn" onClick={onQuickShipment}>
              <ArrowUpRight size={16} /> Сдать на предприятие
            </button>
            <button type="button" className="wpa-hero__btn" onClick={onOpenTransports}>
              <Truck size={16} /> Перевозки
            </button>
          </div>
        </div>
        {accountRows}
      </div>

      <div className="wpa-hero__stats">
        <span className="wpa-hero__stat">
          <Warehouse size={13} /> На складе: <strong>{fmtKg(stockKg)}</strong>
        </span>
        <span className="wpa-hero__stat">
          <HandCoins size={13} /> К оплате приёмов: <strong>{unpaidIntakes}</strong>
        </span>
        <span className="wpa-hero__stat wpa-hero__stat--in">
          <ArrowDownLeft size={13} /> Прогноз прихода:{' '}
          <strong>+{fmtMoney(forecast.inTotal)}</strong>
        </span>
        <span className="wpa-hero__stat wpa-hero__stat--out">
          <ArrowUpRight size={13} /> Прогноз расхода:{' '}
          <strong>−{fmtMoney(forecast.outTotal)}</strong>
        </span>
        {pendingTransport > 0 ? (
          <button
            type="button"
            className="wpa-hero__stat wpa-hero__stat--warn"
            onClick={onOpenTransports}
            title="Открыть вкладку перевозок"
          >
            <Truck size={13} /> Ждут перевозку: <strong>{pendingTransport}</strong>
          </button>
        ) : (
          <span className="wpa-hero__stat">
            <Truck size={13} /> Очередь перевозок пуста
          </span>
        )}
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
                  <WpHeading className="wp-cell--date">Дата</WpHeading>
                  <WpHeading className="wp-cell--num">Остаток на начало</WpHeading>
                  <WpHeading className="wp-cell--num">Приход</WpHeading>
                  <WpHeading className="wp-cell--num">Расход</WpHeading>
                  <WpHeading className="wp-cell--num">Остаток на конец</WpHeading>
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

      {/* Прогноз: запланированные, но ещё не оплаченные операции.
          Колонка не уже 440px: внутри карточки платежей формата «Банк»
          (иконка · контрагент · сумма + кнопки), в узкой колонке они
          не помещаются. На телефоне .wpa-forecast-grid делает одну колонку. */}
      <div className="wpa-forecast-grid">
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
        <WpCell className="wp-cell--date" style={{ fontWeight: 600 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{" "}
          {fmtDate(row.date)}
          {isToday && (
            <span className="admin-badge admin-badge--blue" style={{ marginLeft: 6 }}>
              сегодня
            </span>
          )}
        </WpCell>
        <WpCell className="wp-cell--num">{fmtMoney(opening)}</WpCell>
        <WpCell className={`wp-cell--num wp-amt${incoming > 0 ? " wp-amt--in" : " wp-amt--muted"}`} style={{ fontWeight: 700 }}>
          {incoming > 0 ? `+${fmtMoney(incoming)}` : "—"}
        </WpCell>
        <WpCell className={`wp-cell--num wp-amt${outgoing > 0 ? " wp-amt--out" : " wp-amt--muted"}`} style={{ fontWeight: 700 }}>
          {outgoing > 0 ? `−${fmtMoney(outgoing)}` : "—"}
        </WpCell>
        <WpCell className="wp-cell--num" style={{ fontWeight: 700 }}>{fmtMoney(closing)}</WpCell>
      </WpRow>
      {expanded && (
        <WpRow>
          <WpCell colSpan={5} style={{ background: "var(--adm-paper)" }}>
            {/* Операции дня — карточки «платежа» как в выписке банка:
                иконка направления · документ и контрагент · сумма. */}
            <div className="wpa-ops">
              {row.events.map((e) => (
                <div key={`${e.kind}-${e.id}`} className="wpa-op">
                  <span
                    className={`wpa-op__icon ${e.direction === "incoming" ? "wpa-op__icon--in" : "wpa-op__icon--out"}`}
                    aria-hidden="true"
                  >
                    {e.direction === "incoming" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
                  </span>
                  <div className="wpa-op__main">
                    <div className="wpa-op__row">
                      <span className="wpa-op__title">{e.title}</span>
                      {wpEventKindBadgeEl(e)}
                      <span className={ACCOUNT_BADGE[e.account]}>
                        {WP_ACCOUNT_LABELS[e.account]}
                      </span>
                    </div>
                    <div className="wpa-op__row">
                      <span className="wpa-op__meta">{e.counterpartyName || "—"}</span>
                      {e.paidAt && (
                        <span className="wpa-op__meta">
                          оплачено {fmtPaidAt(e.paidAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <strong
                    className={`wpa-op__amount ${e.direction === "incoming" ? "wp-amt--in" : "wp-amt--out"}`}
                  >
                    {e.direction === "incoming" ? "+" : "−"}
                    {fmtMoney(e.amount)}
                  </strong>
                </div>
              ))}
            </div>
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
  const sign = tone === "in" ? "+" : "−";
  return (
    <div className={`admin-card wpa-forecast wpa-forecast--${tone}`}>
      <div className="admin-card__head">
        <span className="admin-card__title">{title}</span>
        <span className={`admin-badge ${tone === "in" ? "admin-badge--green" : "admin-badge--red"}`}>
          {sign}
          {fmtMoney(total)}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="admin-card__pad">
          <p className="admin-hint">Незапланированных ожиданий нет.</p>
        </div>
      ) : (
        <div className="admin-card__pad">
          {/* Карточки платежей — та же разметка, что в журнале «Банк» учёта
              СибГофроТорг (.bank-pay): иконка · контрагент + бейджи · дата
              и комментарий · сумма с кнопками. На телефоне admin-mobile.css
              раскладывает её в колонку, имя контрагента идёт целой строкой. */}
          <div className="bank-month__list wpa-forecast__list">
            {events.slice(0, 20).map((e) => (
              <div key={`${e.kind}-${e.id}`} className="bank-pay bank-pay--pending">
                <div
                  className={`bank-pay__icon ${
                    tone === "in" ? "bank-pay__icon--in" : "bank-pay__icon--out"
                  }`}
                >
                  {tone === "in" ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                </div>
                <div className="bank-pay__main">
                  <div className="bank-pay__row1">
                    <span className="bank-pay__counterparty">
                      {e.counterpartyName || e.title}
                    </span>
                    {e.counterpartyName ? (
                      <span className="bank-pay__num">{e.title}</span>
                    ) : null}
                    {wpEventKindBadgeEl(e)}
                    <span className={ACCOUNT_BADGE[e.account]}>
                      {WP_ACCOUNT_LABELS[e.account]}
                    </span>
                    <span className="bank-pay__wait">ожидается</span>
                  </div>
                  <div className="bank-pay__row2">
                    <span className="bank-pay__date">{fmtDate(e.date)}</span>
                    {e.comment ? (
                      <span className="bank-pay__comment" title={e.comment}>
                        {e.comment}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="bank-pay__side">
                  <span
                    className={`bank-pay__amount${tone === "out" ? " bank-pay__amount--out" : ""}`}
                  >
                    {sign}
                    {fmtMoney(e.amount)}
                  </span>
                  <div className="wh-pay-controls">
                    <button
                      type="button"
                      className="admin-status__btn admin-status__btn--primary"
                      onClick={() => onTogglePaid(e)}
                      title={e.kind === "salary" ? SALARY_EVENT_HINT : "Отметить оплаченным"}
                    >
                      <Check size={14} />
                      Оплачено
                    </button>
                    <button
                      type="button"
                      className="admin-status__btn admin-status__btn--edit"
                      onClick={() => onEdit(e)}
                      title={e.kind === "salary" ? "Открыть вкладку «Зарплаты»" : "Открыть документ"}
                    >
                      <Pencil size={14} />
                      {e.kind === "salary" ? "Зарплаты" : "Открыть"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {events.length > 20 && (
              <p className="admin-hint">…и ещё {events.length - 20} (см. вкладку «Платежи»)</p>
            )}
          </div>
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
      // Перевод между своими счетами — не внешний приход и не расход.
      if (e.internal) continue;
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
        <span className="wp-summary__chip wp-amt wp-amt--in">
          +{fmtMoney(totals.inSum)}
        </span>
        <span className="wp-summary__chip wp-amt wp-amt--out">
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
                <WpHeading className="wp-cell--date">Дата</WpHeading>
                <WpHeading>Документ</WpHeading>
                <WpHeading>Контрагент</WpHeading>
                <WpHeading className="wp-cell--num">Сумма</WpHeading>
                <WpHeading>Счёт</WpHeading>
                <WpHeading>Оплата</WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map((e) => (
                <WpRow key={`${e.kind}-${e.id}`}>
                  <WpCell className="wp-cell--date">{fmtDate(e.date)}</WpCell>
                  <WpCell>
                    {wpEventKindBadgeEl(e)}{" "}
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
                    className={`wp-cell--num wp-amt ${e.direction === "incoming" ? "wp-amt--in" : "wp-amt--out"}`}
                    style={{ fontWeight: 700 }}
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
                    {e.kind === "transfer" ? (
                      <span
                        className="admin-badge admin-badge--gray"
                        title={TRANSFER_EVENT_HINT}
                      >
                        проведён
                      </span>
                    ) : (
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
                    )}
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
            win.observeTail(node);
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
  onToggleTransportDone,
}: {
  intakes: WpIntake[];
  typeLabels: Record<string, string>;
  onNew: () => void;
  onEdit: (item: WpIntake) => void;
  onCopy: (item: WpIntake) => void;
  onTogglePaid: (item: WpIntake) => void;
  onToggleTransport: (item: WpIntake) => void;
  onToggleTransportDone: (item: WpIntake) => void;
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
                : "Приёмов пока нет. Добавьте первый — укажите, от кого приняли макулатуру, а вес и сумму впишите по позициям: цена за кг посчитается сама."}
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading className="wp-cell--id">№</WpHeading>
                <WpHeading className="wp-cell--date">Дата</WpHeading>
                <WpHeading>От кого / адрес</WpHeading>
                <WpHeading>Позиции</WpHeading>
                <WpHeading className="wp-cell--num">Вес</WpHeading>
                <WpHeading className="wp-cell--num">Сумма</WpHeading>
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
                  <WpCell className="wp-cell--id">ПМ-{i.number}</WpCell>
                  <WpCell className="wp-cell--date">{fmtDate(i.date)}</WpCell>
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
                  <WpCell className="wp-cell--num">
                    {i.acceptedWeightKg > 0 || i.weightKg > 0 ? (
                      fmtKg(i.acceptedWeightKg > 0 ? i.acceptedWeightKg : i.weightKg)
                    ) : (
                      <span className="admin-hint" title="Вес узнаем после взвешивания на площадке">
                        вес уточним
                      </span>
                    )}
                    {i.payableWeightKg > 0 && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        к оплате {fmtKg(i.payableWeightKg)}
                      </div>
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
                  <WpCell className="wp-cell--num" style={{ fontWeight: 700 }}>{fmtMoney(i.total)}</WpCell>
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
                    ) : wpIntakeTransportDone(i) ? (
                      // Груз вывезли: приём больше не показывается в
                      // доставках и очереди перевозок, дальше — вес и оплата.
                      <button
                        type="button"
                        className="admin-badge admin-badge--green"
                        style={{ border: 0, cursor: "pointer" }}
                        onClick={() => onToggleTransportDone(i)}
                        title="Перевозка выполнена — груз вывезли, приём не показывается в доставках. Нажмите, чтобы снять пометку."
                      >
                        <Check size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                        Перевозка выполнена
                      </button>
                    ) : (
                      <>
                        {i.needsTransport ? (
                          <button
                            type="button"
                            className="admin-badge admin-badge--blue"
                            style={{ border: 0, cursor: "pointer" }}
                            onClick={() => onToggleTransport(i)}
                            title="В очереди перевозок (забор груза). Нажмите, чтобы снять."
                          >
                            <Truck size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />{" "}
                            Забор
                            {i.transportPlannedDate ? ` · ${fmtDate(i.transportPlannedDate)}` : ""}
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
                        {/* Ручная пометка «груз вывезли» — когда приём уехал
                            вне рейса или рейс завершили без пометки. */}
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          style={{ marginLeft: 4 }}
                          onClick={() => onToggleTransportDone(i)}
                          aria-label={`ПМ-${i.number}: отметить «перевозка выполнена»`}
                          title="Груз вывезли — отметить «перевозка выполнена». Приём уйдёт из доставок, останется работа по весу и оплате."
                        >
                          <Check size={13} />
                        </button>
                      </>
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
            win.observeTail(node);
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
            <span className="admin-hint">
              принято − сдано, по действующим документам; продажи «без списания»
              не вычитаем, ручные правки — на вкладке «Склад»
            </span>
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
                <WpHeading className="wp-cell--id">№</WpHeading>
                <WpHeading className="wp-cell--date">Дата</WpHeading>
                <WpHeading>Предприятие / адрес</WpHeading>
                <WpHeading>Позиции</WpHeading>
                <WpHeading className="wp-cell--num">Вес</WpHeading>
                <WpHeading className="wp-cell--num">Сумма</WpHeading>
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
                  <WpCell className="wp-cell--id">СМ-{s.number}</WpCell>
                  <WpCell className="wp-cell--date">{fmtDate(s.date)}</WpCell>
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
                  <WpCell className="wp-cell--num">
                    {s.shippedWeightKg > 0 || s.weightKg > 0 ? (
                      fmtKg(s.shippedWeightKg > 0 ? s.shippedWeightKg : s.weightKg)
                    ) : (
                      <span className="admin-hint" title="Вес узнаем после взвешивания на предприятии">
                        вес уточним
                      </span>
                    )}
                    {s.acceptedWeightKg > 0 && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                        принято {fmtKg(s.acceptedWeightKg)}
                      </div>
                    )}
                    {s.skipStock && s.status !== "cancelled" && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="admin-badge admin-badge--muted"
                          title="Деньги проводим, остаток макулатуры на площадке не уменьшаем"
                        >
                          Без списания
                        </span>
                      </div>
                    )}
                  </WpCell>
                  <WpCell className="wp-cell--num" style={{ fontWeight: 700 }}>{fmtMoney(s.total)}</WpCell>
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
            win.observeTail(node);
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
                <WpHeading className="wp-cell--id">ИНН</WpHeading>
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
                  <WpCell className="wp-cell--id">{c.inn || "—"}</WpCell>
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
            win.observeTail(node);
          }}
          onClick={win.showAll}
        >
          Показано {win.visible.length} из {win.total} · <strong>Показать все</strong>
        </button>
      )}
    </div>
  );
}

/* ── Выпадающий список контрагента ─────────────────────────
   Выбор из справочника ИЛИ новый (свободное имя). Существующий
   подставляет своё имя/id — дальше адреса подтягиваются как раньше. */

function CounterpartySelect({
  label,
  options,
  id,
  name,
  onChange,
  placeholder,
  autoFocus,
  nameLabel = "Имя контрагента (вручную)",
}: {
  label: string;
  options: WpCounterparty[];
  id: string | null;
  name: string;
  onChange: (next: { counterpartyId: string | null; counterpartyName: string }) => void;
  placeholder?: string;
  autoFocus?: boolean;
  nameLabel?: string;
}) {
  const knownId =
    id && options.some((c) => c.id === id)
      ? id
      : (name.trim()
          ? options.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id
          : null) ?? null;
  const selectValue = knownId ?? (name.trim() ? "__new" : "");
  return (
    <>
      <div className="admin-field">
        <label className="admin-label">{label}</label>
        <select
          className="admin-select"
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") {
              onChange({ counterpartyId: null, counterpartyName: "" });
              return;
            }
            const c = options.find((x) => x.id === v);
            onChange(c ? { counterpartyId: c.id, counterpartyName: c.name } : { counterpartyId: null, counterpartyName: "" });
          }}
        >
          <option value="">— выберите из списка —</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">➕ Новый контрагент…</option>
        </select>
      </div>
      {!knownId && (
        <div className="admin-field">
          <label className="admin-label">{nameLabel}</label>
          <input
            className="admin-input"
            value={name}
            onChange={(e) => onChange({ counterpartyId: null, counterpartyName: e.target.value })}
            placeholder={placeholder}
            autoFocus={autoFocus}
          />
        </div>
      )}
    </>
  );
}

/* ── Блок «Оплата» в документах (приём/продажа) ─────────────
   Оплата документа — отдельный платёж (вкладка «Платежи»), привязанный
   к нему: один и тот же объект правится и отсюда, и оттуда. Этот платёж —
   ЕДИНСТВЕННОЕ движение денег документа (двойного счёта нет). Три режима:
   «не оплачено», «оплатить сейчас» (новый платёж / обновить привязанный)
   и «привязать существующий» свободный платёж. */

function PaymentBlock({
  docType,
  docId,
  payments,
  value,
  onChange,
  defaultAmount,
  defaultAccount,
  accountLabel,
  docWord,
}: {
  docType: WpDocKind;
  docId: string | null;
  payments: WpManualPayment[];
  value: WpDocPaymentSpec;
  onChange: (next: WpDocPaymentSpec) => void;
  defaultAmount: number;
  defaultAccount: WpAccount;
  accountLabel: string;
  /** «приёма» / «продажи» — для подписей. */
  docWord: string;
}) {
  const linked = payments.find((p) => p.docType === docType && p.docId === docId) || null;
  const free = payments.filter((p) => !p.docId && p.id !== linked?.id);
  const modeKey: "none" | "pay" | "attach" =
    value.mode === "none" ? "none" : value.mode === "attach" ? "attach" : "pay";

  function toPayMode(): WpDocPaymentSpec {
    return {
      mode: linked ? "keep" : "create",
      paymentId: linked?.id ?? null,
      date: linked?.date ?? value.date ?? todayStr(),
      account: (linked?.account ?? value.account ?? defaultAccount) as WpAccount,
      amount: linked?.amount ?? (value.amount || defaultAmount),
      isPaid: linked ? linked.isPaid : value.isPaid ?? true,
      comment: linked?.comment ?? value.comment ?? "",
    };
  }

  return (
    <div className="deal-delivery-block">
      <div className="deal-delivery-block__head">
        <Banknote size={14} />
        <span>Оплата {docWord}</span>
        {linked && (
          <span className="admin-badge admin-badge--blue" style={{ marginLeft: "auto" }}>
            Платёж №{linked.number}
          </span>
        )}
      </div>
      <div className="deal-delivery-block__body">
        <div className="admin-field" style={{ maxWidth: 340 }}>
          <label className="admin-label">Оплата документа</label>
          <select
            className="admin-select"
            value={modeKey}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "none") onChange({ mode: "none" });
              else if (v === "attach") onChange({ mode: "attach", paymentId: free[0]?.id ?? null });
              else onChange(toPayMode());
            }}
          >
            <option value="none">Не оплачено — заплатим позже</option>
            <option value="pay">
              {linked ? `Оплата платежом №${linked.number}` : "Оплатить сейчас — новый платёж"}
            </option>
            {free.length > 0 && (
              <option value="attach">Привязать существующий платёж…</option>
            )}
          </select>
        </div>

        {modeKey === "none" && (
          <p className="deal-delivery-block__empty" style={{ marginTop: 0 }}>
            Долг останется в разделе «Долги» и в прогнозе. Отметить оплату можно
            позже — отсюда, из «Платежей» или кнопкой в списке.
          </p>
        )}

        {modeKey === "pay" && (
          <>
            <div className="wp-grid-3">
              <div className="admin-field">
                <label className="admin-label">Дата оплаты</label>
                <input
                  className="admin-input"
                  type="date"
                  value={value.date || todayStr()}
                  onChange={(e) => onChange({ ...value, date: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Сумма оплаты, ₽</label>
                <input
                  className="admin-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={value.amount || ""}
                  onChange={(e) => onChange({ ...value, amount: parseNum(e.target.value) })}
                  placeholder={defaultAmount > 0 ? `по документу — ${fmtMoney(defaultAmount)}` : "0"}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">{accountLabel}</label>
                <select
                  className="admin-select"
                  value={value.account || defaultAccount}
                  onChange={(e) => onChange({ ...value, account: e.target.value as WpAccount })}
                >
                  <option value="cash">Наличка</option>
                  <option value="bank">Безнал</option>
                  <option value="third_party">Сторонние пополнения</option>
                </select>
              </div>
            </div>
            <label className="admin-hint" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={value.isPaid ?? true}
                onChange={(e) => onChange({ ...value, isPaid: e.target.checked })}
              />
              Проведена (деньги реально двигаются). Снять — попадёт в прогноз.
            </label>
          </>
        )}

        {modeKey === "attach" && (
          <>
            <div className="admin-field" style={{ maxWidth: 420 }}>
              <label className="admin-label">Свободный платёж</label>
              <select
                className="admin-select"
                value={value.paymentId || ""}
                onChange={(e) => onChange({ ...value, paymentId: e.target.value || null })}
              >
                {free.map((p) => (
                  <option key={p.id} value={p.id}>
                    №{p.number} · {fmtDate(p.date)} · {fmtMoney(p.amount)} ·{" "}
                    {WP_ACCOUNT_LABELS[p.account]}
                    {p.counterpartyName ? ` · ${p.counterpartyName}` : ""}
                  </option>
                ))}
              </select>
              <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                Платёж перестанет быть свободным и станет оплатой этого {docWord} —
                деньги учитываются один раз.
              </span>
            </div>
          </>
        )}

        {linked && modeKey !== "none" && (
          <p className="deal-delivery-block__empty" style={{ marginTop: 0 }}>
            Платёж №{linked.number} — общий объект: правьте его здесь или на
            вкладке «Платежи», данные сходятся в один и тот же платёж.{" "}
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => onChange({ mode: "none" })}
            >
              Отвязать платёж
            </button>
          </p>
        )}
      </div>
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
  /**
   * Блок «Оплата»: привязанный платёж документа — его ЕДИНСТВЕННОЕ денежное
   * движение (двойного счёта нет). none — не оплачено / отвязать.
   */
  payment: WpDocPaymentSpec;
  comment: string | null;
  saveCounterparty: boolean;
  /** Итоги позиций: факт (на склад) и вес к оплате клиенту. */
  acceptedWeightKg: number;
  payableWeightKg: number;
  /** Забрать нашим транспортом: приём попадёт в очередь перевозок учёта. */
  needsTransport: boolean;
  /** На когда планируем забор (пусто = как можно скорее). */
  transportPlannedDate: string | null;
  /**
   * false — сохранение карточки снимает пометку «приёмка выполнена ·
   * ожидание взвешивания» (вес вписан).
   */
  awaitingWeight: boolean;
  /**
   * Перевозка выполнена: груз вывезли, приём не показывается в доставках
   * и очереди перевозок. Сохранение карточки её не снимает.
   */
  transportDone: boolean;
}

function IntakeModal({
  mode,
  item,
  suppliers,
  catalog,
  payments,
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
  /** Платежи модуля: блок «Оплата» показывает привязанные и свободные. */
  payments: WpManualPayment[];
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
  // позиции можно полностью править/удалять. Старые позиции (один вес
  // в строке, факт только в шапке) переводятся в новый формат
  // «факт + к оплате + сумма» — см. migrateWpDocItems().
  // Блок «Оплата»: привязанный платёж правится как «keep», старая оплата
  // без платежа предлагается оформить платежом («create»), копия — «none».
  const linkedPayment =
    (item &&
      !isCopy &&
      payments.find((p) => p.docType === "intake" && p.docId === item.id)) ||
    null;
  const [form, setForm] = useState(() => ({
    date: isCopy ? todayStr() : item?.date || todayStr(),
    counterpartyName: item?.counterpartyName || "",
    counterpartyId: item?.counterpartyId || (null as string | null),
    address: item?.address || "",
    phone: item?.phone || "",
    contactPerson: item?.contactPerson || "",
    items: item
      ? migrateWpDocItems(
          isCopy ? cloneDocItems(item.items) : item.items,
          item.acceptedWeightKg,
          item.payableWeightKg
        )
      : [emptyDocItem(catalog)],
    account: (item?.account || "cash") as WpAccount,
    payment: ((): WpDocPaymentSpec => {
      if (isCopy || !item) return { mode: "none" };
      if (linkedPayment) {
        return {
          mode: "keep",
          paymentId: linkedPayment.id,
          date: linkedPayment.date,
          account: linkedPayment.account,
          amount: linkedPayment.amount,
          isPaid: linkedPayment.isPaid,
          comment: linkedPayment.comment ?? "",
        };
      }
      // Старый оплаченный приём без платежа: при сохранении оплата
      // оформится платежом — дальше всё связано.
      if (item.isPaid) {
        return {
          mode: "create",
          date: item.date,
          account: item.account,
          amount: (item.cashAmount || 0) + (item.bankAmount || 0) || item.total,
          isPaid: true,
          comment: "",
        };
      }
      return { mode: "none" };
    })(),
    comment: item?.comment || "",
    saveCounterparty: true,
    needsTransport: isCopy ? false : item?.needsTransport || false,
    transportPlannedDate: isCopy ? "" : item?.transportPlannedDate || "",
    // Копия приёма — новый документ, по нему ещё ничего не возили.
    transportDone: isCopy ? false : item?.transportDone === true,
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

  function onNameChange(value: string, id: string | null = null) {
    // Выпадающий список присылает готовую пару «имя + id» (или новое имя).
    const found =
      (id ? suppliers.find((c) => c.id === id) : null) ||
      suppliers.find(
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

  // ── Итоги документа: только из позиций, руками не вписываются ──
  // В строках ниже по каждому виду вписывают факт, вес к оплате и сумму;
  // шапка (принято / к оплате / сумма) всегда повторяет суммы строк.
  const totals = wpDocDetailedTotals(form.items);
  const avgPrice =
    totals.total > 0 && totals.payableKg > 0
      ? totals.total / totals.payableKg
      : 0;

  function onItemsChange(next: WpDocItem[]) {
    set("items", next);
  }

  // Обязательны только дата и контрагент: веса и суммы вписывают частями
  // и правят позже — документ можно сохранить пустым.
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
          контактное лицо подставятся), а ниже добавьте позиции — по каждому
          виду впишите фактический вес, вес к оплате и сумму. Цена за кг и
          итоги посчитаются сами. Поля необязательные: можно заполнить
          частями и отредактировать позже. Оплата — платёж в блоке ниже:
          новая оплата или привязка существующего платежа.
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
              фактический вес по позициям ниже — после сохранения приём уйдёт
              на склад макулатуры и в банк (расход на сумму), а пометка снимется.
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
              account: (form.payment.account as WpAccount) || form.account,
              isPaid:
                form.payment.mode !== "none" && (form.payment.isPaid ?? true),
              payment: form.payment,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
              acceptedWeightKg: totals.acceptedKg,
              payableWeightKg: totals.payableKg,
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
              // Карточку приёма открыли, чтобы вписать вес — сохранение
              // снимает пометку «приёмка выполнена · ожидание взвешивания».
              awaitingWeight: false,
              // «Перевозка выполнена» — наоборот, переживает сохранение.
              transportDone: form.transportDone,
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
            <div style={{ flex: "2 1 220px", display: "grid", gap: 10 }}>
              <CounterpartySelect
                label="От кого приняли *"
                options={suppliers}
                id={form.counterpartyId}
                name={form.counterpartyName}
                onChange={({ counterpartyId, counterpartyName }) =>
                  onNameChange(counterpartyName, counterpartyId)
                }
                placeholder="Имя или компания (например «Детский мир»)"
                autoFocus={mode === "create"}
              />
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
              <label
                className="deal-delivery-block__toggle"
                title="Груз вывезли — приём не показывается в доставках и очереди перевозок"
              >
                <input
                  type="checkbox"
                  checked={form.transportDone}
                  onChange={(e) => set("transportDone", e.target.checked)}
                />
                Перевозка выполнена
              </label>
            </div>

            {form.transportDone && (
              <p className="deal-delivery-block__empty" style={{ marginTop: 8 }}>
                Перевозка выполнена: приём не показывается в доставках и очереди
                перевозок, дальше по нему только вес и оплата. Обычно пометка
                ставится сама — когда завершают рейс с этим приёмом.
              </p>
            )}

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
            catalog={catalog}
            mode="intake"
            onChange={onItemsChange}
          />

          <div className="admin-field">
            <label className="admin-label">
              <Banknote size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Итого по позициям — считается сам
            </label>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Фактически принято, кг (на склад)</label>
                <input className="admin-input" value={totals.acceptedKg > 0 ? fmtKg(totals.acceptedKg) : ""} placeholder="—" readOnly tabIndex={-1} />
              </div>
              <div className="admin-field">
                <label className="admin-label">Вес к оплате, кг</label>
                <input className="admin-input" value={totals.payableKg > 0 ? fmtKg(totals.payableKg) : ""} placeholder="—" readOnly tabIndex={-1} />
              </div>
            </div>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Итоговая сумма к оплате, ₽</label>
                <input className="admin-input" value={totals.total > 0 ? fmtMoney(totals.total) : ""} placeholder="—" readOnly tabIndex={-1} />
                {totals.total > 0 && !(totals.payableKg > 0) && (
                  <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                    Впишите вес к оплате в строках — тогда цена за кг посчитается сама.
                  </span>
                )}
              </div>
              <div className="admin-field">
                <label className="admin-label">Средняя цена за кг, ₽ (авто)</label>
                <input className="admin-input" value={avgPrice > 0 ? fmtWpPrice(avgPrice) : ""} readOnly tabIndex={-1} placeholder="—" />
                <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                  {avgPrice > 0
                    ? "Посчитана сама: сумма ÷ вес к оплате."
                    : "Появится, когда впишете вес и сумму."}
                </span>
              </div>
            </div>
          </div>

          <PaymentBlock
            docType="intake"
            docId={!isCopy && item ? item.id : null}
            payments={payments}
            value={form.payment}
            onChange={(payment) =>
              setForm((prev) => ({
                ...prev,
                payment,
                account: (payment.account as WpAccount) || prev.account,
              }))
            }
            defaultAmount={totals.total}
            defaultAccount={form.account}
            accountLabel="Счёт оплаты"
            docWord="приёма"
          />

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
  /**
   * Блок «Оплата»: привязанный платёж продажи — её ЕДИНСТВЕННОЕ денежное
   * движение (двойного счёта нет). none — не оплачено / отвязать.
   */
  payment: WpDocPaymentSpec;
  comment: string | null;
  saveCounterparty: boolean;
  /** Итоги позиций: отгружено с площадки и принято предприятием. */
  shippedWeightKg: number;
  acceptedWeightKg: number;
  receivedAmount: number;
  /** Отвезти нашим транспортом: сдача попадёт в очередь перевозок учёта. */
  needsTransport: boolean;
  /** На когда планируем отвоз (пусто = как можно скорее). */
  transportPlannedDate: string | null;
  /** TRUE — деньги проводим, а остаток макулатуры на складе не уменьшаем. */
  skipStock: boolean;
}

function ShipmentModal({
  mode,
  item,
  enterprises,
  catalog,
  payments,
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
  /** Платежи модуля: блок «Оплата» показывает привязанные и свободные. */
  payments: WpManualPayment[];
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
  // Старые позиции (один вес в строке) переводятся в новый формат
  // «отгружено + принято + сумма» — см. migrateWpDocItems().
  // Блок «Оплата»: привязанный платёж правится как «keep», старая оплата
  // без платежа предлагается оформить платежом («create»), копия — «none».
  const linkedPayment =
    (item &&
      !isCopy &&
      payments.find((p) => p.docType === "shipment" && p.docId === item.id)) ||
    null;
  const [form, setForm] = useState(() => ({
    date: isCopy ? todayStr() : item?.date || todayStr(),
    enterpriseName: item?.enterpriseName || "",
    enterpriseId: item?.enterpriseId || (null as string | null),
    address: item?.address || "",
    phone: item?.phone || "",
    contactPerson: item?.contactPerson || "",
    items: item
      ? migrateWpDocItems(
          isCopy ? cloneDocItems(item.items) : item.items,
          item.shippedWeightKg,
          item.acceptedWeightKg
        )
      : [emptyDocItem(catalog)],
    account: (item?.account || "bank") as WpAccount,
    payment: ((): WpDocPaymentSpec => {
      if (isCopy || !item) return { mode: "none" };
      if (linkedPayment) {
        return {
          mode: "keep",
          paymentId: linkedPayment.id,
          date: linkedPayment.date,
          account: linkedPayment.account,
          amount: linkedPayment.amount,
          isPaid: linkedPayment.isPaid,
          comment: linkedPayment.comment ?? "",
        };
      }
      // Старая оплаченная сдача без платежа: при сохранении оплата
      // оформится платежом — дальше всё связано.
      if (item.isPaid) {
        return {
          mode: "create",
          date: item.date,
          account: item.account,
          amount: item.receivedAmount > 0 ? item.receivedAmount : item.total,
          isPaid: true,
          comment: "",
        };
      }
      return { mode: "none" };
    })(),
    comment: item?.comment || "",
    saveCounterparty: true,
    needsTransport: isCopy ? false : item?.needsTransport || false,
    transportPlannedDate: isCopy ? "" : item?.transportPlannedDate || "",
    // Пометку наследуем при правке; в копии сбрасываем: новая сдача
    // обычно уже с нашей площадки.
    skipStock: isCopy ? false : item?.skipStock || false,
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

  function onNameChange(value: string, id: string | null = null) {
    // Выпадающий список присылает готовую пару «имя + id» (или новое имя).
    const found =
      (id ? enterprises.find((c) => c.id === id) : null) ||
      enterprises.find(
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

  // ── Итоги документа: только из позиций, руками не вписываются ──
  // В строках ниже по каждому виду вписывают отгруженный вес, принятый
  // вес и сумму по акту; шапка повторяет суммы строк.
  const totals = wpDocDetailedTotals(form.items);
  /** Расчётный вес для цены: принятый, а пока его нет — отгруженный. */
  const baseWeight =
    totals.payableKg > 0 ? totals.payableKg : totals.acceptedKg;
  const baseIsAccepted = totals.payableKg > 0;
  const avgPrice =
    totals.total > 0 && baseWeight > 0 ? totals.total / baseWeight : 0;

  function onItemsChange(next: WpDocItem[]) {
    set("items", next);
  }

  // Обязательны только дата и предприятие: веса и суммы вписывают частями
  // и правят позже — документ можно сохранить пустым.
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
          точку (адрес, телефон, контакт подставятся), а ниже добавьте позиции —
          по каждому виду впишите отгруженный вес, принятый вес и сумму по акту.
          Цена за кг и итоги посчитаются сами. Поля необязательные: можно
          заполнить частями и отредактировать позже. Деньги приходят платежом
          (блок ниже): новая оплата или привязка существующего платежа.
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
              account: (form.payment.account as WpAccount) || form.account,
              isPaid:
                form.payment.mode !== "none" && (form.payment.isPaid ?? true),
              payment: form.payment,
              comment: form.comment.trim() || null,
              saveCounterparty: form.saveCounterparty,
              shippedWeightKg: totals.acceptedKg,
              acceptedWeightKg: totals.payableKg,
              // Фактическое поступление = сумма оплаты (блок «Оплата» ниже);
              // без оплаты денег пока не было.
              receivedAmount:
                form.payment.mode !== "none"
                  ? Math.max(0, Number(form.payment.amount) || 0)
                  : 0,
              needsTransport: form.needsTransport,
              transportPlannedDate: form.needsTransport
                ? form.transportPlannedDate || null
                : null,
              skipStock: form.skipStock,
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
            <div style={{ flex: "2 1 220px", display: "grid", gap: 10 }}>
              <CounterpartySelect
                label="Предприятие-приёмщик *"
                options={enterprises}
                id={form.enterpriseId}
                name={form.enterpriseName}
                onChange={({ counterpartyId, counterpartyName }) =>
                  onNameChange(counterpartyName, counterpartyId)
                }
                placeholder="Кому сдаём"
                autoFocus={mode === "create"}
              />
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
            catalog={catalog}
            mode="shipment"
            onChange={onItemsChange}
          />

          <div className="deal-delivery-block">
            <div className="deal-delivery-block__head">
              <PackageOpen size={14} />
              <span>Склад макулатуры</span>
              <label className="deal-delivery-block__toggle">
                <input
                  type="checkbox"
                  checked={form.skipStock}
                  onChange={(e) => set("skipStock", e.target.checked)}
                />
                Не списывать со склада
              </label>
            </div>
            {form.skipStock ? (
              <p className="deal-delivery-block__empty" style={{ marginTop: 0 }}>
                Деньги по сдаче проводим как обычно, а остаток макулатуры на
                площадке НЕ уменьшаем — груз ушёл не с нашей площадки (перегруз,
                чужой склад). Вес останется в графе «Продано» с пометкой
                «без списания» на вкладке «Склад».
              </p>
            ) : (
              <p className="deal-delivery-block__empty">
                Обычно: отгруженный вес уходит с остатка на площадке. Включите,
                если этот объём на нашем складе не числился.
              </p>
            )}
          </div>

          <div className="admin-field">
            <label className="admin-label">
              <Banknote size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Итого по позициям — считается сам
            </label>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Отгружено по нашим весам, кг</label>
                <input className="admin-input" value={totals.acceptedKg > 0 ? fmtKg(totals.acceptedKg) : ""} placeholder="—" readOnly tabIndex={-1} />
              </div>
              <div className="admin-field">
                <label className="admin-label">Принято предприятием, кг</label>
                <input className="admin-input" value={totals.payableKg > 0 ? fmtKg(totals.payableKg) : ""} placeholder="—" readOnly tabIndex={-1} />
              </div>
            </div>
            <div className="wp-grid-2">
              <div className="admin-field">
                <label className="admin-label">Итоговая сумма, ₽ (по акту)</label>
                <input className="admin-input" value={totals.total > 0 ? fmtMoney(totals.total) : ""} placeholder="—" readOnly tabIndex={-1} />
                {totals.total > 0 && !(baseWeight > 0) && (
                  <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                    Впишите вес в строках — тогда цена за кг посчитается сама.
                  </span>
                )}
              </div>
              <div className="admin-field">
                <label className="admin-label">Средняя цена за кг, ₽ (авто)</label>
                <input className="admin-input" value={avgPrice > 0 ? fmtWpPrice(avgPrice) : ""} readOnly tabIndex={-1} placeholder="—" />
                <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
                  {avgPrice > 0
                    ? baseIsAccepted
                      ? "Посчитана сама: сумма ÷ принятый вес."
                      : "Посчитана сама: сумма ÷ отгруженный вес."
                    : "Появится, когда впишете вес и сумму."}
                </span>
              </div>
            </div>
          </div>

          <PaymentBlock
            docType="shipment"
            docId={!isCopy && item ? item.id : null}
            payments={payments}
            value={form.payment}
            onChange={(payment) =>
              setForm((prev) => ({
                ...prev,
                payment,
                account: (payment.account as WpAccount) || prev.account,
              }))
            }
            defaultAmount={totals.total}
            defaultAccount={form.account}
            accountLabel="Куда придут деньги"
            docWord="продажи"
          />

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
  /**
   * Привязка к документу: платёж = оплата приёма/продажи (его ЕДИНСТВЕННОЕ
   * денежное движение). null — свободный платёж. Присылается ПАРОЙ
   * docType/docId (null — отвязать).
   */
  docType: WpDocKind | null;
  docId: string | null;
}

function PaymentModal({
  mode,
  item,
  counterparties,
  intakes,
  shipments,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
  onOpenDoc,
}: {
  mode: "create" | "edit";
  item: WpManualPayment | null;
  counterparties: WpCounterparty[];
  /** Документы для привязки платежа (оплата приёма/продажи). */
  intakes: WpIntake[];
  shipments: WpShipment[];
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: PaymentFormPayload) => void;
  onDelete: () => void;
  /** Открыть привязанный документ (приём/продажу) из карточки платежа. */
  onOpenDoc?: (docType: WpDocKind, docId: string) => void;
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
    docType: (item?.docType ?? null) as WpDocKind | null,
    docId: item?.docId ?? (null as string | null),
    comment: item?.comment || "",
  });
  // Закрытие только крестиком и Escape: клик по подложке не закрывает —
  // иначе выделение текста с отпусканием мыши за окном закрывало окно.
  useEscapeClose(onClose, !saving);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  /** Привязка к документу: оплата приёма — расход, продажи — приход. */
  function onDocSelect(value: string) {
    if (!value) {
      setForm((prev) => ({ ...prev, docType: null, docId: null }));
      return;
    }
    const sep = value.indexOf(":");
    const kind = value.slice(0, sep);
    const id = value.slice(sep + 1);
    const docType: WpDocKind | null = kind === "intake" || kind === "shipment" ? kind : null;
    if (!docType || !id) return;
    const isIntake = docType === "intake";
    const intake = isIntake ? intakes.find((i) => i.id === id) : null;
    const shipment = !isIntake ? shipments.find((s) => s.id === id) : null;
    const docTotal = intake
      ? intake.total
      : shipment
        ? shipment.receivedAmount > 0
          ? shipment.receivedAmount
          : shipment.total
        : 0;
    setForm((prev) => ({
      ...prev,
      docType,
      docId: id,
      direction: isIntake ? "outgoing" : "incoming",
      counterpartyName: intake?.counterpartyName || shipment?.enterpriseName || prev.counterpartyName,
      counterpartyId: intake?.counterpartyId || shipment?.enterpriseId || prev.counterpartyId,
      // Сумму подставляем из документа, пока её не вписали руками.
      amount: prev.amount || (docTotal > 0 ? String(docTotal) : ""),
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
          Деньги вручную: например, получили оплату за сдачу не сразу, или выдали
          наличку на расходы. Можно привязать платёж к приёму/продаже — тогда он
          станет их оплатой (одно движение денег, правится и отсюда, и из
          документа).
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
              docType: form.docType,
              docId: form.docType ? form.docId : null,
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

          <div className="admin-field">
            <label className="admin-label">Документ — оплата приёма/продажи</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                className="admin-select"
                value={form.docType && form.docId ? `${form.docType}:${form.docId}` : ""}
                onChange={(e) => onDocSelect(e.target.value)}
              >
                <option value="">Без документа (свободный платёж)</option>
                {intakes.filter((i) => i.status !== "cancelled").length > 0 && (
                  <optgroup label="Приёмы">
                    {intakes
                      .filter((i) => i.status !== "cancelled")
                      .map((i) => (
                        <option key={i.id} value={`intake:${i.id}`}>
                          Приём №{i.number} · {i.counterpartyName} · {fmtMoney(i.total)} ₽
                        </option>
                      ))}
                  </optgroup>
                )}
                {shipments.filter((s) => s.status !== "cancelled").length > 0 && (
                  <optgroup label="Продажи (сдачи)">
                    {shipments
                      .filter((s) => s.status !== "cancelled")
                      .map((s) => (
                        <option key={s.id} value={`shipment:${s.id}`}>
                          Продажа №{s.number} · {s.enterpriseName} · {fmtMoney(s.total)} ₽
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
              {form.docType && form.docId && onOpenDoc && (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  style={{ whiteSpace: "nowrap" }}
                  onClick={() => onOpenDoc(form.docType!, form.docId!)}
                >
                  <Pencil size={13} /> Открыть
                </button>
              )}
            </div>
            <span className="admin-hint" style={{ fontSize: "0.75rem" }}>
              Привязанный платёж — единственное движение денег документа
              (двойного счёта нет): правьте его здесь или в карточке документа.
            </span>
          </div>

          <div className="wp-grid-3">
            <div className="admin-field" style={{ gridColumn: "span 2" }}>
              <CounterpartySelect
                label="Контрагент"
                options={counterparties}
                id={form.counterpartyId}
                name={form.counterpartyName}
                onChange={({ counterpartyId, counterpartyName }) =>
                  setForm((prev) => ({ ...prev, counterpartyId, counterpartyName }))
                }
                placeholder="Кто платит / кому платим"
                nameLabel="Имя контрагента (вручную)"
              />
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

/** Пресеты меток точек контрагента — выпадающий список + «своя метка». */
const BRANCH_LABEL_PRESETS = [
  "Филиал №1",
  "Филиал №2",
  "Филиал №3",
  "Склад",
  "Приёмная площадка",
  "Центральный",
  "Производство",
  "Офис",
];

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

  /** Роль — выпадающий список: одна роль или «и то, и другое». */
  function setRole(value: string) {
    setForm((prev) => ({
      ...prev,
      roles: value === "both" ? ["supplier", "enterprise"] : [value],
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
            <select
              className="admin-select"
              value={form.roles.length > 1 ? "both" : form.roles[0] || "supplier"}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="supplier">Сдаёт нам (поставщик)</option>
              <option value="enterprise">Принимает у нас (предприятие)</option>
              <option value="both">И то, и другое</option>
            </select>
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="admin-badge admin-badge--muted">Точка {idx + 1}</span>
                    <div
                      style={{
                        flex: "1 1 260px",
                        display: "grid",
                        gap: 6,
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      }}
                    >
                      <select
                        className="admin-select"
                        value={BRANCH_LABEL_PRESETS.includes(b.label) ? b.label : ""}
                        onChange={(e) => {
                          if (e.target.value) setBranch(b.id, { label: e.target.value });
                        }}
                        aria-label="Метка точки из списка"
                      >
                        <option value="">Метка из списка…</option>
                        {BRANCH_LABEL_PRESETS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        className="admin-input"
                        value={b.label}
                        onChange={(e) => setBranch(b.id, { label: e.target.value })}
                        placeholder="Или своя метка…"
                        maxLength={120}
                      />
                    </div>
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
    {rows.length === 0 ? <div className="admin-card"><div className="admin-card__pad"><p className="admin-hint">Долгов за приём макулатуры нет.</p></div></div> : <div className="admin-table-wrap"><WpTable className="admin-table"><WpHead><WpRow><WpHeading>Кому</WpHeading><WpHeading>Документы</WpHeading><WpHeading>Куда переводить</WpHeading><WpHeading className="wp-cell--num">Сумма</WpHeading><WpHeading></WpHeading></WpRow></WpHead><WpBody>{rows.map(({c,docs,total}) => <WpRow key={c.id}><WpCell>{c.name}</WpCell><WpCell>{docs.map(d => `ПМ-${d.number}`).join(", ")}</WpCell><WpCell>{c.paymentDetails || <span className="admin-hint">Не указано</span>}</WpCell><WpCell className="wp-cell--num" style={{fontWeight:700}}>{fmtMoney(total)}</WpCell><WpCell><button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => onEditCounterparty(c)}><Pencil size={13}/> Реквизиты</button></WpCell></WpRow>)}</WpBody></WpTable></div>}
  </div>;
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «СКЛАД»: остаток макулатуры и его ручная правка
   ═══════════════════════════════════════════════════════ */

/**
 * Инлайн-правка остатка по виду — так же, как остаток товара в товарном
 * учёте: вписал фактическое количество, нажал «Сохранить».
 *
 * Сохраняем не абсолют, а разницу с расчётом по документам (сервер
 * считает её сам от свежих приёмов/продаж) — поэтому правка не
 * «замораживает» склад: следующие приёмы и продажи двигают остаток
 * поверх неё.
 */
function WpStockQtyEditor({
  row,
  onSaved,
  onFailed,
}: {
  row: WpStockRow;
  onSaved: (items: WpStockAdjustment[]) => void;
  onFailed: (message: string) => void;
}) {
  const [value, setValue] = useState(String(row.stockKg));
  const [savedValue, setSavedValue] = useState(row.stockKg);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Пока курсор в поле — внешние обновления (Realtime) его не затирают.
  const typingRef = useRef(false);

  const parsed = value.trim() === "" ? NaN : Number(value.replace(",", "."));
  const dirty = Number.isFinite(parsed) && Math.abs(parsed - savedValue) > 0.049;

  useEffect(() => {
    if (typingRef.current) return;
    setValue(String(row.stockKg));
    setSavedValue(row.stockKg);
  }, [row.stockKg]);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/wp/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wastepaperType: row.wastepaperType,
          stockKg: Math.round(parsed * 1000) / 1000,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFailed(body.error || "Не удалось сохранить остаток");
        return;
      }
      setValue(String(Math.round(parsed * 1000) / 1000));
      setSavedValue(parsed);
      setSaved(true);
      onSaved(Array.isArray(body.items) ? body.items : []);
      window.setTimeout(() => setSaved(false), 1400);
    } catch {
      onFailed("Не удалось сохранить остаток");
    } finally {
      setSaving(false);
    }
  }

  /** Снять правку — остаток снова считается только по документам. */
  async function reset() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/wp/stock", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wastepaperType: row.wastepaperType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFailed(body.error || "Не удалось снять правку остатка");
        return;
      }
      onSaved(Array.isArray(body.items) ? body.items : []);
    } catch {
      onFailed("Не удалось снять правку остатка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <div className="stock-inline-editor">
        <input
          type="number"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => {
            typingRef.current = true;
          }}
          onBlur={() => {
            typingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          aria-label={`Фактический остаток: ${row.wastepaperType}`}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          title="Сохранить остаток"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saved ? (
            <Check size={13} />
          ) : (
            <Save size={13} />
          )}
        </button>
      </div>
      {row.adjustmentKg !== 0 && (
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={reset}
          disabled={saving}
          title="Убрать ручную правку — остаток снова считается по документам"
        >
          <RotateCcw size={12} /> Снять правку
        </button>
      )}
    </div>
  );
}

function StockTab({
  stock,
  typeLabels,
  catalog,
  adjustments,
  onSaved,
  onFailed,
}: {
  stock: WpStockRow[];
  typeLabels: Record<string, string>;
  catalog: WpTypeCatalog;
  adjustments: WpStockAdjustment[];
  onSaved: (items: WpStockAdjustment[]) => void;
  onFailed: (message: string) => void;
}) {
  const total = stock.reduce((sum, row) => sum + Math.max(0, row.stockKg), 0);
  const adjByType = useMemo(
    () => new Map(adjustments.map((a) => [a.wastepaperType, a])),
    [adjustments]
  );
  // Виды справочника, по которым документов ещё не было: правку по ним
  // можно внести отдельно (строка появится в таблице после сохранения).
  const missingOptions = catalog.options.filter(
    (o) => !stock.some((row) => row.wastepaperType === o.id)
  );
  const [addType, setAddType] = useState(missingOptions[0]?.id || "");
  const [addValue, setAddValue] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // Вид после сохранения попал в таблицу — выбираем следующий свободный.
  useEffect(() => {
    if (missingOptions.length === 0) return;
    if (!missingOptions.some((o) => o.id === addType)) setAddType(missingOptions[0].id);
  }, [missingOptions, addType]);

  const addParsed =
    addValue.trim() === "" ? NaN : Number(addValue.replace(",", "."));
  const addValid = addType !== "" && Number.isFinite(addParsed) && addParsed >= 0;

  async function addAdjustment() {
    if (!addValid || addSaving) return;
    setAddSaving(true);
    try {
      const res = await fetch("/api/admin/wp/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wastepaperType: addType,
          stockKg: Math.round(addParsed * 1000) / 1000,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onFailed(body.error || "Не удалось сохранить остаток");
        return;
      }
      setAddValue("");
      onSaved(Array.isArray(body.items) ? body.items : []);
    } catch {
      onFailed("Не удалось сохранить остаток");
    } finally {
      setAddSaving(false);
    }
  }

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 14 }}>
        <div className="admin-card__head">
          <span className="admin-card__title">Фактический склад макулатуры</span>
          <strong>{fmtKg(total)}</strong>
        </div>
        <div className="admin-card__pad" style={{ display: "grid", gap: 6 }}>
          <p className="admin-hint" style={{ margin: 0 }}>
            На склад попадает фактически принятое количество, а не вес к оплате.
            Продажи с пометкой «Не списывать со склада» остаток не уменьшают —
            такой вес виден в графе «Продано» отдельной строкой.
          </p>
          <p className="admin-hint" style={{ margin: 0 }}>
            Остаток можно поправить руками: впишите фактическое количество в
            последнем столбце и нажмите <strong>Сохранить</strong>. Запомнится
            разница с расчётом — новые приёмы и продажи будут считаться поверх
            правки, а не вместо неё.
          </p>
        </div>
      </div>

      <div className="admin-table-wrap">
        <WpTable className="admin-table">
          <WpHead>
            <WpRow>
              <WpHeading>Вид макулатуры</WpHeading>
              <WpHeading className="wp-cell--num">Принято фактически</WpHeading>
              <WpHeading className="wp-cell--num">Продано / отгружено</WpHeading>
              <WpHeading className="wp-cell--num">Ручная правка</WpHeading>
              <WpHeading className="wp-cell--num">Остаток</WpHeading>
              <WpHeading className="wp-cell--num">Фактический остаток, кг</WpHeading>
            </WpRow>
          </WpHead>
          <WpBody>
            {stock.map((row) => {
              const adj = adjByType.get(row.wastepaperType);
              return (
                <WpRow key={row.wastepaperType}>
                  <WpCell>{wpTypeLabel(row.wastepaperType, typeLabels)}</WpCell>
                  <WpCell className="wp-cell--num">{fmtKg(row.intakeKg)}</WpCell>
                  <WpCell className="wp-cell--num">
                    {fmtKg(row.shipmentKg)}
                    {row.skippedShipmentKg > 0 && (
                      <div
                        style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}
                        title="Продажи с пометкой «Не списывать со склада»: деньги прошли, остаток не двигали"
                      >
                        без списания {fmtKg(row.skippedShipmentKg)}
                      </div>
                    )}
                  </WpCell>
                  <WpCell className="wp-cell--num">
                    {row.adjustmentKg === 0 ? (
                      <span className="admin-hint">—</span>
                    ) : (
                      <span
                        style={{ fontWeight: 700 }}
                        title={
                          adj
                            ? `${adj.updatedBy ? `${adj.updatedBy} · ` : ""}${
                                adj.updatedAt ? fmtDate(adj.updatedAt.slice(0, 10)) : ""
                              }${adj.note ? ` · ${adj.note}` : ""}`
                            : undefined
                        }
                      >
                        {row.adjustmentKg > 0 ? "+" : "−"}
                        {fmtKg(Math.abs(row.adjustmentKg))}
                      </span>
                    )}
                  </WpCell>
                  <WpCell className="wp-cell--num" style={{ fontWeight: 700 }}>
                    {fmtKg(Math.max(0, row.stockKg))}
                    {row.stockKg < 0 && (
                      <div style={{ color: "var(--adm-rust)", fontSize: "0.8rem", marginTop: 3 }}>
                        минус: продано больше, чем принято
                      </div>
                    )}
                  </WpCell>
                  <WpCell className="wp-cell--num">
                    <WpStockQtyEditor row={row} onSaved={onSaved} onFailed={onFailed} />
                  </WpCell>
                </WpRow>
              );
            })}
          </WpBody>
        </WpTable>
      </div>

      {missingOptions.length > 0 && (
        <div className="admin-card" style={{ marginTop: 14 }}>
          <div className="admin-card__head">
            <span className="admin-card__title">Вписать остаток по другому виду</span>
          </div>
          <div className="admin-card__pad">
            <p className="admin-hint" style={{ marginTop: 0 }}>
              По этому виду документов ещё не было — укажите, сколько его лежит
              на площадке, и он появится в таблице выше.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="admin-field" style={{ minWidth: 220, marginBottom: 0 }}>
                <label className="admin-label">Вид макулатуры</label>
                <select
                  className="admin-select"
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                >
                  {missingOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-field" style={{ width: 150, marginBottom: 0 }}>
                <label className="admin-label">Количество, кг</label>
                <input
                  className="admin-input"
                  type="number"
                  step="0.1"
                  min="0"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addAdjustment();
                    }
                  }}
                  placeholder="0"
                />
              </div>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={addAdjustment}
                disabled={!addValid || addSaving}
              >
                {addSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{" "}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ВКЛАДКА «БАНК»: журнал всех движений по счетам
   ═══════════════════════════════════════════════════════ */

/** Строка журнала: движение + остаток после него. */
interface BankJournalRow {
  event: WpMoneyEvent;
  effDate: string;
  /** Остаток счёта операции после её проведения. */
  accountAfter: number | null;
  /** Общий остаток денег модуля после её проведения. */
  totalAfter: number | null;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function BankTab({
  events,
  balance,
  transfers,
  onNewTransfer,
  onEditTransfer,
  onEditEvent,
}: {
  events: WpMoneyEvent[];
  balance: WpBalance;
  transfers: WpAccountTransfer[];
  onNewTransfer: () => void;
  onEditTransfer: (item: WpAccountTransfer) => void;
  onEditEvent: (e: WpMoneyEvent) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [account, setAccount] = useState<"all" | WpAccount>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [onlyTransfers, setOnlyTransfers] = useState(false);

  /**
   * Хронология движений с нарастающим остатком. Остаток считаем по ВСЕМ
   * проведённым операциям, а не по отфильтрованным: фильтр по счёту или
   * периоду меняет список строк, но не остаток в них.
   */
  const journal = useMemo<BankJournalRow[]>(() => {
    const sorted = events
      .filter((e) => !e.cancelled)
      .map((e) => ({ e, effDate: wpEventEffectiveDate(e) }))
      .filter((r) => r.effDate)
      .sort(
        (a, b) =>
          a.effDate.localeCompare(b.effDate) ||
          a.e.number - b.e.number ||
          a.e.id.localeCompare(b.e.id)
      );
    const acc: Record<WpAccount, number> = { cash: 0, bank: 0, third_party: 0 };
    const rows = sorted.map(({ e, effDate }) => {
      let accountAfter: number | null = null;
      let totalAfter: number | null = null;
      if (e.isPaid) {
        acc[e.account] += e.direction === "incoming" ? e.amount : -e.amount;
        accountAfter = roundMoney(acc[e.account]);
        totalAfter = roundMoney(acc.cash + acc.bank + acc.third_party);
      }
      return { event: e, effDate, accountAfter, totalAfter };
    });
    // Свежие сверху — как в банковской выписке.
    rows.reverse();
    return rows;
  }, [events]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return journal.filter(({ event: e, effDate }) => {
      if (account !== "all" && e.account !== account) return false;
      if (from && effDate < from) return false;
      if (to && effDate > to) return false;
      if (onlyTransfers && e.kind !== "transfer") return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.counterpartyName.toLowerCase().includes(q) ||
        (e.comment || "").toLowerCase().includes(q)
      );
    });
  }, [journal, account, from, to, onlyTransfers, deferredQuery]);

  /** Приход/расход за выбранный период по каждому счёту (без фильтров вида). */
  const periodByAccount = useMemo(() => {
    const acc: Record<WpAccount, { incoming: number; outgoing: number }> = {
      cash: { incoming: 0, outgoing: 0 },
      bank: { incoming: 0, outgoing: 0 },
      third_party: { incoming: 0, outgoing: 0 },
    };
    for (const { event: e, effDate } of journal) {
      if (!e.isPaid) continue;
      if (from && effDate < from) continue;
      if (to && effDate > to) continue;
      if (e.direction === "incoming") acc[e.account].incoming += e.amount;
      else acc[e.account].outgoing += e.amount;
    }
    return acc;
  }, [journal, from, to]);

  /** Итоги по показанным строкам: перевод считаем один раз (по расходу). */
  const totals = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    let transferSum = 0;
    let transferCount = 0;
    for (const { event: e } of filtered) {
      if (!e.isPaid) continue;
      if (e.kind === "transfer") {
        if (e.direction === "outgoing") {
          transferSum += e.amount;
          transferCount += 1;
        }
        continue;
      }
      if (e.direction === "incoming") incoming += e.amount;
      else outgoing += e.amount;
    }
    return {
      incoming: roundMoney(incoming),
      outgoing: roundMoney(outgoing),
      transferSum: roundMoney(transferSum),
      transferCount,
    };
  }, [filtered]);

  // Длинная выписка — кусками (см. use-windowed-list).
  const win = useWindowedList(filtered, {
    resetKey: `${deferredQuery}|${account}|${from}|${to}|${onlyTransfers}`,
  });


  return (
    <div>
      {/* Остатки счетов и обороты за выбранный период — карточки
          «счетов» как в приложении банка: иконка, крупная сумма,
          расшифровка и обороты за период. */}
      <div className="admin-card" style={{ marginBottom: 14 }}>
        <div className="admin-card__head">
          <span className="admin-card__title">
            <Landmark size={14} aria-hidden="true" /> Счета макулатуры
          </span>
          <span className="admin-hint">
            {from || to
              ? `обороты за ${from ? fmtDate(from) : "начало"} — ${to ? fmtDate(to) : "сегодня"}`
              : "обороты за всё время"}
          </span>
        </div>
        <div className="admin-card__pad">
          <div className="wpa-acc-grid">
            {/* Общий счёт = наличка + безнал: по факту это один денежный счёт
                макулатуры, а чем он наполнен — видно расшифровкой ниже. */}
            <div className="wpa-acc-card wpa-acc-card--main">
              <div className="wpa-acc-card__head">
                <span className="wpa-acc-card__icon" aria-hidden="true">
                  <Wallet size={16} />
                </span>
                <span className="wpa-acc-card__name">{WP_COMMON_ACCOUNT_LABEL}</span>
              </div>
              <div className="wpa-acc-card__value">{fmtMoney(balance.common)}</div>
              <dl className="wpa-acc-card__parts">
                <div className="wpa-acc-card__part">
                  <dt><Banknote size={12} aria-hidden="true" /> Наличка</dt>
                  <dd>{fmtMoney(balance.cash)}</dd>
                </div>
                <div className="wpa-acc-card__part">
                  <dt><CreditCard size={12} aria-hidden="true" /> Безнал</dt>
                  <dd>{fmtMoney(balance.bank)}</dd>
                </div>
              </dl>
              <div className="wpa-acc-card__turn">
                <span className="wpa-acc-card__turn-label">за период:</span>
                <span className="wp-amt wp-amt--in">
                  +{fmtMoney(periodByAccount.cash.incoming + periodByAccount.bank.incoming)}
                </span>
                <span className="wp-amt wp-amt--out">
                  −{fmtMoney(periodByAccount.cash.outgoing + periodByAccount.bank.outgoing)}
                </span>
              </div>
            </div>
            <div className="wpa-acc-card">
              <div className="wpa-acc-card__head">
                <span className="wpa-acc-card__icon" aria-hidden="true">
                  <HandCoins size={16} />
                </span>
                <span className="wpa-acc-card__name">Сторонние пополнения</span>
              </div>
              <div className="wpa-acc-card__value">{fmtMoney(balance.third_party)}</div>
              <div className="wpa-acc-card__turn">
                <span className="wpa-acc-card__turn-label">за период:</span>
                <span className="wp-amt wp-amt--in">
                  +{fmtMoney(periodByAccount.third_party.incoming)}
                </span>
                <span className="wp-amt wp-amt--out">
                  −{fmtMoney(periodByAccount.third_party.outgoing)}
                </span>
              </div>
            </div>
            <div className="wpa-acc-card wpa-acc-card--total">
              <div className="wpa-acc-card__head">
                <span className="wpa-acc-card__icon" aria-hidden="true">
                  <Scale size={16} />
                </span>
                <span className="wpa-acc-card__name">Всего с учётом сторонних</span>
              </div>
              <div className="wpa-acc-card__value">{fmtMoney(balance.total)}</div>
            </div>
          </div>
        </div>
      </div>

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
        <div className="wpa-dates">
          <input
            className="admin-input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Период с"
          />
          <span className="wpa-dates__dash" aria-hidden="true">—</span>
          <input
            className="admin-input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Период по"
          />
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
        <label className="admin-hint" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={onlyTransfers}
            onChange={(e) => setOnlyTransfers(e.target.checked)}
          />
          только переводы
        </label>
        <button type="button" className="admin-btn admin-btn--navy" onClick={onNewTransfer}>
          <ArrowLeftRight size={15} /> Перевод
        </button>
      </div>

      <p className="wp-summary">
        Показано движений: <strong>{filtered.length}</strong>
        <span className="wp-summary__chip wp-amt wp-amt--in">
          приход +{fmtMoney(totals.incoming)}
        </span>
        <span className="wp-summary__chip wp-amt wp-amt--out">
          расход −{fmtMoney(totals.outgoing)}
        </span>
        <span className="wp-summary__chip">
          переводов: {totals.transferCount} на {fmtMoney(totals.transferSum)}
        </span>
      </p>

      {filtered.length === 0 ? (
        <div className="admin-card">
          <div className="admin-card__pad">
            <p className="admin-hint">
              Движений по фильтрам нет. Здесь видны все деньги модуля: приёмы,
              сдачи, платежи, зарплаты и переводы между счетами — с остатком
              после каждой операции.
            </p>
          </div>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <WpTable className="admin-table">
            <WpHead>
              <WpRow>
                <WpHeading className="wp-cell--date">Дата</WpHeading>
                <WpHeading>Документ</WpHeading>
                <WpHeading className="wp-cell--num">Приход</WpHeading>
                <WpHeading className="wp-cell--num">Расход</WpHeading>
                <WpHeading>Счёт</WpHeading>
                <WpHeading className="wp-cell--num">
                  {account === "all" ? "Остаток денег после" : "Остаток счёта после"}
                </WpHeading>
                <WpHeading></WpHeading>
              </WpRow>
            </WpHead>
            <WpBody>
              {win.visible.map(({ event: e, accountAfter, totalAfter }) => (
                <WpRow
                  key={`${e.kind}-${e.id}`}
                  style={e.isPaid ? undefined : { opacity: 0.65 }}
                >
                  <WpCell className="wp-cell--date">{fmtDate(e.date)}</WpCell>
                  <WpCell>
                    {wpEventKindBadgeEl(e)}{" "}
                    {e.title}
                    <div style={{ color: "var(--adm-muted)", fontSize: "0.8rem", marginTop: 3 }}>
                      {e.counterpartyName || "—"}
                      {e.comment ? ` · ${e.comment}` : ""}
                    </div>
                    {!e.isPaid && (
                      <div style={{ fontSize: "0.78rem", marginTop: 3 }}>
                        <span className="admin-badge admin-badge--amber">ожидает оплаты</span>
                      </div>
                    )}
                  </WpCell>
                  <WpCell
                    className={`wp-cell--num wp-amt${e.direction === "incoming" && e.isPaid ? " wp-amt--in" : " wp-amt--muted"}`}
                    style={{ fontWeight: e.direction === "incoming" ? 700 : 400 }}
                  >
                    {e.direction === "incoming" && e.isPaid ? `+${fmtMoney(e.amount)}` : "—"}
                  </WpCell>
                  <WpCell
                    className={`wp-cell--num wp-amt${e.direction === "outgoing" && e.isPaid ? " wp-amt--out" : " wp-amt--muted"}`}
                    style={{ fontWeight: e.direction === "outgoing" ? 700 : 400 }}
                  >
                    {e.direction === "outgoing" && e.isPaid ? `−${fmtMoney(e.amount)}` : "—"}
                  </WpCell>
                  <WpCell>
                    <span className={ACCOUNT_BADGE[e.account]}>
                      {WP_ACCOUNT_LABELS[e.account]}
                    </span>
                    {e.kind === "transfer" && e.counterAccount && (
                      <div style={{ color: "var(--adm-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                        {e.direction === "outgoing" ? "куда: " : "откуда: "}
                        {WP_ACCOUNT_LABELS[e.counterAccount]}
                      </div>
                    )}
                  </WpCell>
                  <WpCell className="wp-cell--num wp-amt" style={{ fontWeight: 600 }}>
                    {accountAfter === null ? (
                      <span className="admin-hint">—</span>
                    ) : account === "all" ? (
                      <>
                        {fmtMoney(totalAfter ?? 0)}
                        <div style={{ color: "var(--adm-muted)", fontSize: "0.78rem", marginTop: 3 }}>
                          {WP_ACCOUNT_LABELS[e.account]}: {fmtMoney(accountAfter)}
                        </div>
                      </>
                    ) : (
                      fmtMoney(accountAfter)
                    )}
                  </WpCell>
                  <WpCell style={{ whiteSpace: "nowrap" }}>
                    {e.kind === "transfer" ? (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => {
                          const item = transfers.find((t) => t.id === e.transferId);
                          if (item) onEditTransfer(item);
                        }}
                        title="Открыть перевод"
                      >
                        <Pencil size={13} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={() => onEditEvent(e)}
                        title="Открыть документ"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
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
            win.observeTail(node);
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
   МОДАЛКА: ПЕРЕВОД МЕЖДУ СЧЕТАМИ
   ═══════════════════════════════════════════════════════ */

interface TransferFormPayload {
  date: string;
  fromAccount: WpAccount;
  toAccount: WpAccount;
  amount: number;
  comment: string | null;
}

function TransferModal({
  mode,
  item,
  balance,
  saving,
  error,
  onClose,
  onSubmit,
  onDelete,
}: {
  mode: "create" | "edit";
  item: WpAccountTransfer | null;
  balance: WpBalance;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (form: TransferFormPayload) => void;
  onDelete: () => void;
}) {
  // Модалка рендерится inline — блокируем скролл фона (iOS-safe).
  useBodyLock(true);
  useEscapeClose(onClose, !saving);
  const isEdit = mode === "edit";
  const [form, setForm] = useState({
    date: item?.date || todayStr(),
    fromAccount: (item?.fromAccount || "bank") as WpAccount,
    toAccount: (item?.toAccount || "cash") as WpAccount,
    amount: item?.amount || 0,
    comment: item?.comment || "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const amountValid = Number.isFinite(form.amount) && form.amount > 0;
  const sameAccounts = form.fromAccount === form.toAccount;
  const sourceBalance = balance[form.fromAccount];
  const notEnough = amountValid && form.amount > sourceBalance;
  const valid = form.date !== "" && amountValid && !sameAccounts;

  const accounts: WpAccount[] = ["cash", "bank", "third_party"];
  const sourceAfter = roundMoney(sourceBalance - (amountValid ? form.amount : 0));
  const targetAfter = roundMoney(
    balance[form.toAccount] + (amountValid ? form.amount : 0)
  );

  return (
    <div className="admin-modal-overlay">
      <div className="admin-modal wp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal__head">
          <h3 className="admin-modal__title">
            {isEdit ? `Перевод №${item?.number}` : "Перевод между счетами"}
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
          Деньги перекладываются из одного счёта модуля в другой: например,
          сняли с безнала в кассу. Внешнего прихода или расхода не возникает —
          остаток счёта-источника уменьшается, остаток счёта-получателя
          увеличивается на ту же сумму. Перевод попадёт в журнал «Банк» и в
          отчёт по дням двумя строками: расход по одному счёту и приход по
          другому.
        </p>

        <form
          className="wp-modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              date: form.date,
              fromAccount: form.fromAccount,
              toAccount: form.toAccount,
              amount: roundMoney(form.amount),
              comment: form.comment.trim() || null,
            });
          }}
        >
          <div className="wp-grid-2">
            <div className="admin-field">
              <label className="admin-label">Дата *</label>
              <input
                className="admin-input"
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                autoFocus={mode === "create"}
                required
              />
            </div>
            <div className="admin-field">
              <label className="admin-label">Сумма, ₽ *</label>
              <input
                className="admin-input"
                type="number"
                min="0"
                step="0.01"
                value={form.amount || ""}
                onChange={(e) => set("amount", parseNum(e.target.value))}
                placeholder="Сколько переводим"
                required
              />
            </div>
          </div>

          <div className="wp-grid-2">
            <div className="admin-field">
              <label className="admin-label">Откуда (списываем) *</label>
              <select
                className="admin-select"
                value={form.fromAccount}
                onChange={(e) => set("fromAccount", e.target.value as WpAccount)}
              >
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {WP_ACCOUNT_LABELS[a]} — {fmtMoney(balance[a])}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-field">
              <label className="admin-label">Куда (зачисляем) *</label>
              <select
                className="admin-select"
                value={form.toAccount}
                onChange={(e) => set("toAccount", e.target.value as WpAccount)}
              >
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {WP_ACCOUNT_LABELS[a]} — {fmtMoney(balance[a])}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {sameAccounts && (
            <p className="admin-error" style={{ marginTop: -4 }}>
              Выберите разные счета: «откуда» и «куда» не могут совпадать.
            </p>
          )}

          {/* Что станет с остатками после перевода — «маршрут» как в банке */}
          <div className="wpa-route">
            <div className="wpa-route__line">
              <span className={ACCOUNT_BADGE[form.fromAccount]}>
                {WP_ACCOUNT_LABELS[form.fromAccount]}
              </span>
              <ArrowLeftRight size={15} className="wpa-route__arrow" aria-hidden="true" />
              <span className={ACCOUNT_BADGE[form.toAccount]}>
                {WP_ACCOUNT_LABELS[form.toAccount]}
              </span>
              <strong className="wpa-route__amount">
                {amountValid ? fmtMoney(form.amount) : "—"}
              </strong>
            </div>
            <div className="wpa-route__after">
              <div className="wpa-route__acc">
                <span>{WP_ACCOUNT_LABELS[form.fromAccount]} после:</span>
                <strong className="wp-amt wp-amt--out">{fmtMoney(sourceAfter)}</strong>
              </div>
              <div className="wpa-route__acc">
                <span>{WP_ACCOUNT_LABELS[form.toAccount]} после:</span>
                <strong className="wp-amt wp-amt--in">{fmtMoney(targetAfter)}</strong>
              </div>
            </div>
            {notEnough && (
              <p className="admin-hint" style={{ margin: 0, color: "var(--adm-rust)" }}>
                На счёте «{WP_ACCOUNT_LABELS[form.fromAccount]}» меньше денег, чем
                переводите: остаток уйдёт в минус. Так можно, если часть денег
                ещё не внесена в учёт.
              </p>
            )}
          </div>

          <div className="admin-field">
            <label className="admin-label">Комментарий</label>
            <input
              className="admin-input"
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              placeholder="Например: сняли в банкомате на зарплату…"
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
                {isEdit ? "Сохранить" : "Перевести"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
