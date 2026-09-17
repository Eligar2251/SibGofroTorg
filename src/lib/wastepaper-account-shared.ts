// =========================================================
// FILE: src/lib/wastepaper-account-shared.ts
// Отдельный учёт макулатуры: типы и ЧИСТЫЕ финансовые расчёты.
// Модуль не связан с сайтом и товарным учётом (warehouse) — свои
// контрагенты, приёмы, сдачи на предприятие, платежи и перевозки.
// Файл без server-only зависимостей → безопасен для клиентских
// компонентов (как warehouse-shared.ts).
// =========================================================

// ── Справочники ──────────────────────────────────────────

export const WP_ACCOUNT_LABELS = { cash: "Наличка", bank: "Безнал" } as const;
export type WpAccount = keyof typeof WP_ACCOUNT_LABELS;

export const WP_DIRECTION_LABELS = { incoming: "Приход", outgoing: "Расход" } as const;
export type WpDirection = keyof typeof WP_DIRECTION_LABELS;

export const WP_COUNTERPARTY_ROLE_LABELS = {
  supplier: "Сдаёт нам",
  enterprise: "Принимает у нас",
} as const;

export const WP_TRANSPORT_STATUS_LABELS = {
  planned: "Запланирована",
  active: "В пути",
  completed: "Завершена",
  cancelled: "Отменена",
} as const;
export type WpTransportStatus = keyof typeof WP_TRANSPORT_STATUS_LABELS;

export const WP_STOP_STATUS_LABELS = {
  pending: "Ожидает",
  done: "Забрано",
  skipped: "Пропущена",
} as const;
export type WpStopStatus = keyof typeof WP_STOP_STATUS_LABELS;

/** Виды макулатуры (совпадают с тарифами сайта wp_rate_*). */
export const WP_TYPE_OPTIONS = [
  { id: "cardboard", label: "Гофрокартон" },
  { id: "office_paper", label: "Белая бумага (архив)" },
  { id: "books", label: "Книги, журналы, газеты" },
  { id: "mix", label: "Смешанная макулатура" },
] as const;

export const WP_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  WP_TYPE_OPTIONS.map((o) => [o.id, o.label])
);

// ── Типы данных (сериализованные для клиента) ────────────

/**
 * Точка (филиал) контрагента. Одна фирма — например «Детский мир» —
 * может иметь несколько адресов; у каждого адреса своё контактное
 * лицо (ФИО) и свой телефон. Связка «адрес + ФИО + телефон» и есть точка.
 */
export interface WpBranch {
  /** Стабильный id точки (для React-ключей и сопоставления). */
  id: string;
  /** Необязательная метка: «Филиал №1», «Центральный», «Склад». */
  label: string;
  address: string;
  /** ФИО контактного лица этого адреса. */
  contactPerson: string;
  /** Телефон, привязанный к адресу/контактному лицу. */
  phone: string;
}

/** Позиция табличной части документа (приём/сдача): вид + вес + цена. */
export interface WpDocItem {
  id: string;
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  /** weightKg * pricePerKg (округлённо до копеек). */
  total: number;
}

export interface WpCounterparty {
  id: string;
  name: string;
  roles: string[];
  /** Зеркало первой точки — для совместимости и быстрых подписей. */
  phone: string | null;
  address: string | null;
  contactPerson: string | null;
  /** Точки/филиалы: адрес + ФИО + телефон. */
  branches: WpBranch[];
  inn: string | null;
  comment: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WpIntake {
  id: string;
  number: number;
  date: string; // YYYY-MM-DD
  counterpartyId: string | null;
  counterpartyName: string;
  address: string | null;
  /** Телефон и контактное лицо точки — подставляются в путевой лист. */
  phone: string | null;
  contactPerson: string | null;
  /** Позиции документа (макулатура разных профилей). */
  items: WpDocItem[];
  /** Агрегат первой/единственной позиции — для списков и совместимости. */
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  total: number;
  account: WpAccount;
  isPaid: boolean;
  paidAt: string | null; // ISO datetime фактической оплаты
  transportId: string | null;
  transportItemId: string | null;
  status: "active" | "cancelled";
  comment: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WpShipment {
  id: string;
  number: number;
  date: string;
  enterpriseId: string | null;
  enterpriseName: string;
  /** Куда везём (точка/филиал предприятия). */
  address: string | null;
  /** Телефон и контактное лицо точки — подставляются в путевой лист. */
  phone: string | null;
  contactPerson: string | null;
  /** Позиции документа (макулатура разных профилей). */
  items: WpDocItem[];
  /** Агрегат первой/единственной позиции — для списков и совместимости. */
  wastepaperType: string;
  weightKg: number;
  pricePerKg: number;
  total: number;
  account: WpAccount;
  isPaid: boolean;
  paidAt: string | null;
  status: "active" | "cancelled";
  comment: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WpManualPayment {
  id: string;
  number: number;
  date: string;
  direction: WpDirection;
  account: WpAccount;
  counterpartyId: string | null;
  counterpartyName: string;
  amount: number;
  isPaid: boolean;
  paidAt: string | null;
  comment: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Остановка перевозки за макулатурой. */
export interface WpTransportItem {
  id: string;
  counterpartyId: string | null;
  counterpartyName: string;
  address: string;
  /** Телефон и контактное лицо точки — подставляются в путевой лист. */
  phone: string;
  contactPerson: string;
  /** Примерное время заезда (HH:MM или «~14:00»). */
  approxTime: string;
  wastepaperType: string;
  plannedKg: number;
  actualKg: number | null;
  note: string;
  status: WpStopStatus;
  /** Оформленный по этой остановке приём (wp_intakes.id). */
  intakeId: string | null;
}

export interface WpTransport {
  id: string;
  number: number;
  date: string;
  /** Примерное время выезда (HH:MM или текст вроде «утром»). */
  startTime: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehicle: string | null;
  status: WpTransportStatus;
  note: string | null;
  items: WpTransportItem[];
  totalPlannedKg: number;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Нормализация точек и позиций документа ───────────────

function round2kg(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Приводит произвольный JSONB к списку точек контрагента. */
export function normalizeWpBranches(raw: unknown): WpBranch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b: any, idx: number) => ({
      id: String(b?.id || `br-${idx + 1}`),
      label: String(b?.label || "").slice(0, 120),
      address: String(b?.address || "").slice(0, 400),
      contactPerson: String(b?.contactPerson || "").slice(0, 200),
      phone: String(b?.phone || "").slice(0, 60),
    }))
    .filter((b) => b.address || b.phone || b.contactPerson);
}

/** Приводит произвольный JSONB к позициям документа (приём/сдача). */
export function normalizeWpDocItems(raw: unknown): WpDocItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it: any, idx: number) => {
      const weightKg = Math.max(0, Number(it?.weightKg) || 0);
      const pricePerKg = Math.max(0, Number(it?.pricePerKg) || 0);
      return {
        id: String(it?.id || `it-${idx + 1}`),
        wastepaperType: String(it?.wastepaperType || "cardboard").slice(0, 120),
        weightKg,
        pricePerKg,
        total: round2money(weightKg * pricePerKg),
      };
    })
    .filter((it) => it.weightKg > 0 || it.pricePerKg > 0);
}

/** Итоги документа по позициям: суммарный вес и сумма. */
export function wpDocTotals(items: WpDocItem[]): { weightKg: number; total: number } {
  let weightKg = 0;
  let total = 0;
  for (const it of items) {
    weightKg += Number(it.weightKg) || 0;
    total += Number(it.total) || 0;
  }
  return { weightKg: round2kg(weightKg), total: round2money(total) };
}

/** Краткая подпись позиций: «Гофрокартон 500 кг; Белая бумага 120 кг». */
export function wpItemsSummary(items: WpDocItem[], labels: Record<string, string>): string {
  return items
    .map((it) => `${wpTypeLabel(it.wastepaperType, labels)} · ${fmtKg(it.weightKg)}`)
    .join("; ");
}

/**
 * Найти точку контрагента по адресу (нечувствительно к регистру/пробелам).
 * Используется, чтобы не дублировать филиалы при автосохранении.
 */
export function findWpBranchByAddress(
  branches: WpBranch[],
  address: string
): WpBranch | null {
  const key = String(address || "").trim().toLowerCase();
  if (!key) return null;
  return branches.find((b) => b.address.trim().toLowerCase() === key) || null;
}

/**
 * Точное совпадение точки: сначала по адресу+телефону+контакту (чтобы
 * различать несколько контактов на одном адресе), иначе — по адресу.
 */
export function findWpBranchMatch(
  branches: WpBranch[],
  address: string,
  phone?: string,
  contactPerson?: string
): WpBranch | null {
  const a = String(address || "").trim().toLowerCase();
  if (!a) return null;
  const p = String(phone || "").trim().toLowerCase();
  const c = String(contactPerson || "").trim().toLowerCase();
  const exact = branches.find(
    (b) =>
      b.address.trim().toLowerCase() === a &&
      b.phone.trim().toLowerCase() === p &&
      b.contactPerson.trim().toLowerCase() === c
  );
  return exact || findWpBranchByAddress(branches, address);
}

/** Новый id точки/позиции. */
export function wpUid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Денежные события (единая лента для финансов) ─────────

export type WpMoneyEventKind = "intake" | "shipment" | "manual";

export interface WpMoneyEvent {
  kind: WpMoneyEventKind;
  id: string;
  number: number;
  /** Плановая дата операции (для прогноза). */
  date: string;
  direction: WpDirection;
  account: WpAccount;
  amount: number;
  isPaid: boolean;
  paidAt: string | null;
  counterpartyName: string;
  /** Подпись документа: «Приём №12 · картон 500 кг». */
  title: string;
  comment: string | null;
  cancelled: boolean;
}

/** Фактическая дата для баланса: день оплаты (paidAt) или дата документа. */
export function wpEventEffectiveDate(event: WpMoneyEvent): string {
  const paidDate = String(event.paidAt || "").slice(0, 10);
  return paidDate || String(event.date || "").slice(0, 10);
}

/** Собирает единую ленту денежных движений из трёх источников. */
export function wpCollectMoneyEvents(
  intakes: WpIntake[],
  shipments: WpShipment[],
  manualPayments: WpManualPayment[]
): WpMoneyEvent[] {
  const events: WpMoneyEvent[] = [];
  for (const i of intakes) {
    events.push({
      kind: "intake",
      id: i.id,
      number: i.number,
      date: i.date,
      direction: "outgoing",
      account: i.account,
      amount: i.total,
      isPaid: i.isPaid,
      paidAt: i.paidAt,
      counterpartyName: i.counterpartyName,
      title: `Приём №${i.number}`,
      comment: i.comment,
      cancelled: i.status === "cancelled",
    });
  }
  for (const s of shipments) {
    events.push({
      kind: "shipment",
      id: s.id,
      number: s.number,
      date: s.date,
      direction: "incoming",
      account: s.account,
      amount: s.total,
      isPaid: s.isPaid,
      paidAt: s.paidAt,
      counterpartyName: s.enterpriseName,
      title: `Сдача №${s.number}`,
      comment: s.comment,
      cancelled: s.status === "cancelled",
    });
  }
  for (const p of manualPayments) {
    events.push({
      kind: "manual",
      id: p.id,
      number: p.number,
      date: p.date,
      direction: p.direction,
      account: p.account,
      amount: p.amount,
      isPaid: p.isPaid,
      paidAt: p.paidAt,
      counterpartyName: p.counterpartyName,
      title: `Платёж №${p.number}`,
      comment: p.comment,
      cancelled: false,
    });
  }
  return events;
}

// ── Балансы и прогноз ────────────────────────────────────

export interface WpBalance {
  cash: number;
  bank: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Фактический остаток денег на конец дня asOfDate (только оплаченные). */
export function getWpBalance(events: WpMoneyEvent[], asOfDate: string): WpBalance {
  let cash = 0;
  let bank = 0;
  for (const e of events) {
    if (e.cancelled || !e.isPaid) continue;
    const effDate = wpEventEffectiveDate(e);
    if (!effDate || effDate > asOfDate) continue;
    const signed = e.direction === "incoming" ? e.amount : -e.amount;
    if (e.account === "cash") cash += signed;
    else bank += signed;
  }
  cash = round2(cash);
  bank = round2(bank);
  return { cash, bank, total: round2(cash + bank) };
}

export interface WpForecast {
  inCash: number;
  inBank: number;
  outCash: number;
  outBank: number;
  inTotal: number;
  outTotal: number;
}

/** Прогноз: запланированные, но ещё не оплаченные приходы/расходы. */
export function getWpForecast(events: WpMoneyEvent[]): WpForecast {
  const f: WpForecast = {
    inCash: 0,
    inBank: 0,
    outCash: 0,
    outBank: 0,
    inTotal: 0,
    outTotal: 0,
  };
  for (const e of events) {
    if (e.cancelled || e.isPaid) continue;
    if (e.direction === "incoming") {
      if (e.account === "cash") f.inCash += e.amount;
      else f.inBank += e.amount;
    } else {
      if (e.account === "cash") f.outCash += e.amount;
      else f.outBank += e.amount;
    }
  }
  f.inCash = round2(f.inCash);
  f.inBank = round2(f.inBank);
  f.outCash = round2(f.outCash);
  f.outBank = round2(f.outBank);
  f.inTotal = round2(f.inCash + f.inBank);
  f.outTotal = round2(f.outCash + f.outBank);
  return f;
}

// ── Отчёт по дням ────────────────────────────────────────

export interface WpDayRow {
  date: string;
  /** Остаток на начало дня (= остаток предыдущего дня). */
  openingCash: number;
  openingBank: number;
  inCash: number;
  inBank: number;
  outCash: number;
  outBank: number;
  closingCash: number;
  closingBank: number;
  /** Оплаченные операции этого дня. */
  events: WpMoneyEvent[];
}

/**
 * Сводка по дням: остаток предыдущего дня → движения → остаток на конец.
 * Возвращает строки только для дней, где были оплаченные операции,
 * в диапазоне [from; to] (если задан), с сортировкой по дате.
 */
export function buildWpDayReport(
  events: WpMoneyEvent[],
  opts: { from?: string; to?: string; sortDesc?: boolean } = {}
): WpDayRow[] {
  const paid = events
    .filter((e) => !e.cancelled && e.isPaid)
    .map((e) => ({ ...e, effDate: wpEventEffectiveDate(e) }))
    .filter((e) => e.effDate)
    .sort((a, b) => a.effDate.localeCompare(b.effDate));

  const byDay = new Map<string, (typeof paid)[number][]>();
  for (const e of paid) {
    if (opts.from && e.effDate < opts.from) continue;
    if (opts.to && e.effDate > opts.to) continue;
    const list = byDay.get(e.effDate) || [];
    list.push(e);
    byDay.set(e.effDate, list);
  }

  const dates = [...byDay.keys()].sort();
  const rows: WpDayRow[] = [];
  for (const date of dates) {
    // Остаток предыдущего дня — по всем оплаченным операциям строго раньше дня.
    const dayBefore = new Date(`${date}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const prevDate = dayBefore.toISOString().slice(0, 10);
    const opening = getWpBalance(paid, prevDate);

    let inCash = 0;
    let inBank = 0;
    let outCash = 0;
    let outBank = 0;
    for (const e of byDay.get(date) || []) {
      if (e.direction === "incoming") {
        if (e.account === "cash") inCash += e.amount;
        else inBank += e.amount;
      } else {
        if (e.account === "cash") outCash += e.amount;
        else outBank += e.amount;
      }
    }
    rows.push({
      date,
      openingCash: opening.cash,
      openingBank: opening.bank,
      inCash: round2(inCash),
      inBank: round2(inBank),
      outCash: round2(outCash),
      outBank: round2(outBank),
      closingCash: round2(opening.cash + inCash - outCash),
      closingBank: round2(opening.bank + inBank - outBank),
      events: (byDay.get(date) || []) as WpMoneyEvent[],
    });
  }
  if (opts.sortDesc) rows.reverse();
  return rows;
}

// ── Остаток сырья на площадке ────────────────────────────

export interface WpStockRow {
  wastepaperType: string;
  intakeKg: number;
  shipmentKg: number;
  stockKg: number;
}

export function getWpStock(intakes: WpIntake[], shipments: WpShipment[]): WpStockRow[] {
  const intakeMap = new Map<string, number>();
  const shipmentMap = new Map<string, number>();
  // Учитываем позиции документа; если позиций нет (старые записи) —
  // берём одиночные вид/вес.
  const accumulate = (
    map: Map<string, number>,
    items: WpDocItem[],
    fallbackType: string,
    fallbackKg: number
  ) => {
    if (items && items.length > 0) {
      for (const it of items) {
        map.set(it.wastepaperType, (map.get(it.wastepaperType) || 0) + (Number(it.weightKg) || 0));
      }
    } else if (fallbackKg > 0) {
      map.set(fallbackType, (map.get(fallbackType) || 0) + fallbackKg);
    }
  };
  for (const i of intakes) {
    if (i.status !== "active") continue;
    accumulate(intakeMap, i.items, i.wastepaperType, i.weightKg);
  }
  for (const s of shipments) {
    if (s.status !== "active") continue;
    accumulate(shipmentMap, s.items, s.wastepaperType, s.weightKg);
  }
  const types = new Set([...intakeMap.keys(), ...shipmentMap.keys()]);
  return [...types]
    .map((t) => {
      const i = Math.round((intakeMap.get(t) || 0) * 10) / 10;
      const s = Math.round((shipmentMap.get(t) || 0) * 10) / 10;
      return { wastepaperType: t, intakeKg: i, shipmentKg: s, stockKg: Math.round((i - s) * 10) / 10 };
    })
    .sort((a, b) => b.stockKg - a.stockKg);
}

// ── Форматтеры ───────────────────────────────────────────

export function fmtMoney(value: number): string {
  return `${round2(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

export function fmtKg(value: number): string {
  return `${(Math.round(value * 10) / 10).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} кг`;
}

export function fmtDate(date: string): string {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date || "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtTime(raw: string | null): string {
  if (!raw) return "";
  return raw.startsWith("~") ? raw : `~${raw}`;
}

/** Подпись вида сырья: id из настроек сайта или произвольный текст. */
export function wpTypeLabel(type: string, labels: Record<string, string>): string {
  return labels[type] || type || "—";
}
