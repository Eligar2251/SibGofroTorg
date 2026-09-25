// =========================================================
// FILE: src/lib/wastepaper-account-shared.ts
// Отдельный учёт макулатуры: типы и ЧИСТЫЕ финансовые расчёты.
// Модуль не связан с сайтом и товарным учётом (warehouse) — свои
// контрагенты, приёмы, сдачи на предприятие, платежи и перевозки.
// Файл без server-only зависимостей → безопасен для клиентских
// компонентов (как warehouse-shared.ts).
// =========================================================

// ── Справочники ──────────────────────────────────────────

export const WP_ACCOUNT_LABELS = { cash: "Наличка", bank: "Безнал", third_party: "Сторонние пополнения" } as const;
export type WpAccount = keyof typeof WP_ACCOUNT_LABELS;

/**
 * Счета, которые по сути ОДИН денежный счёт макулатуры: наличка и безнал.
 *
 * В документах форму оплаты по-прежнему указываем (нужно, чтобы понимать,
 * чем платили и откуда уйдёт расход), а в остатках показываем их одной
 * строкой «Общий счёт макулатуры» с расшифровкой ниже — наличкой и
 * безналом. «Сторонние пополнения» остаются отдельным счётом.
 */
export const WP_COMMON_ACCOUNTS: readonly WpAccount[] = ["cash", "bank"];
export const WP_COMMON_ACCOUNT_LABEL = "Общий счёт макулатуры";

/** Сумма «общего счёта»: наличка + безнал. */
export function wpCommonBalance(
  balance: Pick<WpBalance, "cash" | "bank">
): number {
  return Math.round(((Number(balance.cash) || 0) + (Number(balance.bank) || 0)) * 100) / 100;
}

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

/**
 * Как приём/сдача попадает на площадку / уезжает с неё.
 * Самовывоз — клиент привозит/забирает сам, перевозка не нужна.
 * Перевозка — едем мы: приём идёт в путевой лист как «забор груза»,
 * сдача — как «сдача груза» (та же логика, что доставка ЗК в учёте).
 */
export const WP_DELIVERY_MODE_LABELS = {
  pickup: "Забор груза",
  handover: "Сдача груза",
  self: "Самовывоз",
} as const;

/** Приём ждёт перевозки: помечен «в перевозку» и не отменён. */
export function wpIntakeNeedsTransport(i: Pick<WpIntake, "needsTransport" | "status">): boolean {
  return Boolean(i.needsTransport) && i.status === "active";
}

/**
 * Приёмка выполнена перевозкой, ждём взвешивания.
 *
 * Завершение перевозки с приёмом макулатуры ничего не проводит: склад
 * макулатуры и платёж не двигаются — на приёме появляется только эта
 * пометка. Дальше макулатурщик открывает приём, вписывает фактический
 * вес и сохраняет карточку (пометка снимается) — и только тогда приём
 * уходит на склад и в банк (расход на сумму).
 */
export function wpIntakeAwaitingWeight(
  i: Pick<WpIntake, "awaitingWeight" | "status">
): boolean {
  return Boolean(i.awaitingWeight) && i.status === "active";
}

/**
 * Перевозка по приёму выполнена — груз вывезли.
 *
 * Пометка живёт дольше «ожидания взвешивания»: awaitingWeight снимается
 * первым же сохранением карточки с весом, а эта держится, пока её не
 * снимут вручную. Поэтому приём, по которому рейс уже отъездил, не
 * возвращается в доставки, даже когда вес вписан и оплата проведена.
 * Приёмы, заведённые до столбца transport_done, считаем выполненными по
 * awaitingWeight.
 */
export function wpIntakeTransportDone(
  i: Pick<WpIntake, "transportDone" | "awaitingWeight" | "status">
): boolean {
  if (i.status !== "active") return false;
  return Boolean(i.transportDone) || Boolean(i.awaitingWeight);
}

/**
 * Приём «проведён» — уходит в архив вкладки «Проведённые».
 *
 * Условия (все сразу): документ не отменён и не ждёт взвешивания, вес
 * указан — и фактически принятый, и вес к оплате, — и оплата прошла.
 * Попадание в архив автоматическое: как только приём оплачен и оба
 * веса вписаны, он пропадает из рабочего списка. Старые приёмы без
 * веса к оплате остаются в рабочем списке, пока вес не впишут.
 */
export function wpIntakeCompleted(
  i: Pick<
    WpIntake,
    "status" | "isPaid" | "acceptedWeightKg" | "payableWeightKg" | "awaitingWeight"
  >
): boolean {
  if (i.status !== "active" || !i.isPaid) return false;
  if (wpIntakeAwaitingWeight(i)) return false;
  return (
    (Number(i.acceptedWeightKg) || 0) > 0 &&
    (Number(i.payableWeightKg) || 0) > 0
  );
}

/** Сдача ждёт перевозки: помечена «в перевозку» и не отменена. */
export function wpShipmentNeedsTransport(s: Pick<WpShipment, "needsTransport" | "status">): boolean {
  return Boolean(s.needsTransport) && s.status === "active";
}

// ── Очередь макулатуры для ЕДИНЫХ перевозок ───────────────
// Приёмы и сдачи с needsTransport попадают в те же перевозки учёта
// (ПЕР-...), что и заказы ЗК: приём — «забор груза», сдача — «сдача
// груза». Здесь только логистика (без цен и сумм): очередь видна и
// макулатурщику, и менеджеру учёта.

/** Документ макулатуры, ожидающий перевозки (для конструктора рейса). */
export interface WpTransportQueueDoc {
  id: string;
  /** intake — приём (забор у клиента), shipment — сдача (везём на предприятие) */
  kind: "intake" | "shipment";
  number: number;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  /** Комментарий документа — водителю как заметка на точке. */
  note: string | null;
  date: string;
  /** Желаемая дата вывоза (если указана). */
  plannedDate: string | null;
  weightKg: number;
  /** Груз точками: вид макулатуры + кг. Цен и сумм здесь нет. */
  lines: { name: string; qty: number }[];
}

/** Ключ документа в очереди — им же помечаем точки внутри перевозки. */
export function wpQueueKey(kind: "intake" | "shipment", id: string): string {
  return `${kind}:${id}`;
}

/**
 * Документы макулатуры, уже лежащие точками в активных (черновик/в пути)
 * единых перевозках. Их убираем из очереди «Ожидают формирования» —
 * та же логика, что activeTransportDealIds у заказов учёта.
 */
export function wpTakenKeysFromTransports(
  transports:
    | {
        status: string;
        items?:
          | {
              wpDocKind?: string | null;
              wpDocId?: string | null;
            }[]
          | null;
      }[]
    | null
    | undefined
): Set<string> {
  const taken = new Set<string>();
  for (const t of transports || []) {
    if (t.status !== "draft" && t.status !== "active") continue;
    for (const it of t.items || []) {
      if (
        (it.wpDocKind === "intake" || it.wpDocKind === "shipment") &&
        it.wpDocId
      ) {
        taken.add(wpQueueKey(it.wpDocKind, String(it.wpDocId)));
      }
    }
  }
  return taken;
}

function wpQueueLines(
  items: WpDocItem[],
  fallbackType: string,
  fallbackKg: number,
  typeLabels: Record<string, string>
): { name: string; qty: number }[] {
  const source =
    items && items.length > 0
      ? items.map((it) => ({
          name: wpTypeLabel(it.wastepaperType, typeLabels),
          qty: Number(it.weightKg) || 0,
        }))
      : [
          {
            name: wpTypeLabel(fallbackType, typeLabels),
            qty: Number(fallbackKg) || 0,
          },
        ];
  return source.filter((l) => l.qty > 0);
}

/**
 * Очередь «ожидают формирования»: приёмы/сдачи с needsTransport,
 * кроме отменённых и уже взятых в активный рейс. Сортировка — сначала
 * с желаемой датой вывоза (раньше — выше), затем по дате документа.
 */
export function buildWpTransportQueue(args: {
  intakes: WpIntake[];
  shipments: WpShipment[];
  /** Документы, уже лежащие в активных перевозках (wpQueueKey). */
  takenKeys: Set<string>;
  /** Подписи видов макулатуры (WP_TYPE_LABELS + справочник видов). */
  typeLabels: Record<string, string>;
}): WpTransportQueueDoc[] {
  const { intakes, shipments, takenKeys, typeLabels } = args;
  const out: WpTransportQueueDoc[] = [];
  for (const i of intakes) {
    if (!wpIntakeNeedsTransport(i)) continue;
    // Перевозка выполнена (рейс завершили или пометили вручную) — приём
    // больше не показываем: по нему остались только вес и оплата.
    if (wpIntakeTransportDone(i)) continue;
    if (takenKeys.has(wpQueueKey("intake", i.id))) continue;
    out.push({
      id: i.id,
      kind: "intake",
      number: i.number,
      customerName: i.counterpartyName || "Без имени",
      contactName: i.contactPerson,
      phone: i.phone,
      address: i.address,
      note: i.comment,
      date: i.date,
      plannedDate: i.transportPlannedDate,
      // Водителю нужен физический вес груза, а не вес к оплате.
      weightKg: i.acceptedWeightKg > 0 ? i.acceptedWeightKg : i.weightKg,
      lines: wpQueueLines(i.items, i.wastepaperType, i.weightKg, typeLabels),
    });
  }
  for (const s of shipments) {
    if (!wpShipmentNeedsTransport(s)) continue;
    if (takenKeys.has(wpQueueKey("shipment", s.id))) continue;
    out.push({
      id: s.id,
      kind: "shipment",
      number: s.number,
      customerName: s.enterpriseName || "Без имени",
      contactName: s.contactPerson,
      phone: s.phone,
      address: s.address,
      note: s.comment,
      date: s.date,
      plannedDate: s.transportPlannedDate,
      // Водителю нужен физический вес груза — сколько отгрузили с площадки.
      weightKg: s.shippedWeightKg > 0 ? s.shippedWeightKg : s.weightKg,
      lines: wpQueueLines(s.items, s.wastepaperType, s.weightKg, typeLabels),
    });
  }
  const rank = (d: WpTransportQueueDoc) => d.plannedDate || `~${d.date}`;
  out.sort((a, b) => rank(a).localeCompare(rank(b)) || a.number - b.number);
  return out;
}

/** Подпись документа очереди: «ПМ-12» / «СМ-34». */
export function wpQueueDocLabel(doc: Pick<WpTransportQueueDoc, "kind" | "number">): string {
  return `${doc.kind === "intake" ? "ПМ" : "СМ"}-${doc.number}`;
}

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

/** Собственный справочник закупаемых видов макулатуры (не товары сайта). */
export interface WpProduct {
  id: string;
  name: string;
  pricePerKg: number;
  isActive: boolean;
  /**
   * Старый код вида (cardboard / office_paper / books / mix) у четырёх
   * исходных видов — под ним они записаны в прежних документах и в
   * тарифах калькулятора сайта. У новых видов кода нет: документ хранит
   * UUID строки справочника (см. wpProductTypeKey).
   */
  code: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Вариант вида макулатуры для селектов документов. */
export interface WpTypeOption {
  /** Ключ, который хранится в документе (код исходного вида или UUID). */
  id: string;
  label: string;
  /** Закупочная цена из справочника, 0 — не задана. */
  pricePerKg: number;
}

/**
 * Ключ вида в документах: код исходного вида (если есть) либо UUID.
 * Если миграция с колонкой code ещё не применена, исходные виды
 * распознаём по неизменённому названию — тогда прежние документы
 * («cardboard» и т.п.) остаются связаны со строкой справочника.
 */
export function wpProductTypeKey(p: Pick<WpProduct, "id" | "name" | "code">): string {
  if (p.code) return p.code;
  const legacy = WP_TYPE_OPTIONS.find((o) => o.label === p.name.trim());
  return legacy ? legacy.id : p.id;
}

/**
 * Подписи видов по ключу документа: старые коды → названия из
 * справочника (если вид переименован, документы покажут новое имя),
 * UUID → название, плюс скрытые виды — старые документы не теряют подпись.
 */
export function buildWpTypeLabels(products: readonly WpProduct[]): Record<string, string> {
  const labels: Record<string, string> = { ...WP_TYPE_LABELS };
  for (const p of products) {
    const name = p.name.trim();
    if (!name) continue;
    labels[wpProductTypeKey(p)] = name;
    labels[p.id] = name;
  }
  return labels;
}

/**
 * Варианты для селектов документов: активные виды справочника (пока
 * справочник пуст — четыре исходных вида). `extraKeys` — ключи, уже
 * записанные в редактируемом документе: скрытый вид не должен
 * «выпадать» из формы при открытии старого документа.
 */
export function buildWpTypeOptions(
  products: readonly WpProduct[],
  extraKeys: readonly string[] = []
): WpTypeOption[] {
  const out: WpTypeOption[] = [];
  const seen = new Set<string>();
  const push = (o: WpTypeOption) => {
    if (seen.has(o.id)) return;
    seen.add(o.id);
    out.push(o);
  };
  for (const p of products) {
    if (!p.isActive || !p.name.trim()) continue;
    push({ id: wpProductTypeKey(p), label: p.name.trim(), pricePerKg: p.pricePerKg || 0 });
  }
  if (out.length === 0 && products.length === 0) {
    for (const o of WP_TYPE_OPTIONS) push({ id: o.id, label: o.label, pricePerKg: 0 });
  }
  const labels = buildWpTypeLabels(products);
  for (const key of extraKeys) {
    if (!key || seen.has(key)) continue;
    push({ id: key, label: labels[key] || key, pricePerKg: 0 });
  }
  return out;
}

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

/**
 * Позиция табличной части документа (приём/сдача): вид + веса + сумма.
 *
 * Каждую позицию заполняют отдельно: сначала фактический вес (что
 * реально взвесили), потом расчётный вес (за что платим / что приняли
 * по акту) и сумму. Все три поля необязательные — документ добивают
 * частями: сегодня взвешивание, завтра расчёт. Цена за кг нигде не
 * вводится вручную: это подсказка из справочника видов, а когда вписана
 * сумма — сумма / расчётный вес.
 */
export interface WpDocItem {
  id: string;
  wastepaperType: string;
  /**
   * Фактический вес позиции, кг: в приёме — сколько реально принято на
   * склад, в сдаче — сколько отгружено с площадки по нашим весам.
   * Именно он двигает склад и виден водителю в перевозке.
   */
  weightKg: number;
  /**
   * Расчётный вес позиции, кг: в приёме — вес к оплате клиенту, в сдаче —
   * вес, принятый предприятием по акту. 0 — пока не указан.
   */
  payableWeightKg: number;
  /**
   * Цена за кг: подсказка из справочника, а когда вписана сумма —
   * пересчитывается как сумма / расчётный вес. Итогом документа всегда
   * считается сумма позиций, а не вес × цена (цены позиций различаются).
   */
  pricePerKg: number;
  /** Сумма позиции, ₽ — вводится вручную по каждой строке. */
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
  /** Реквизиты/куда переводить деньги поставщику. */
  paymentDetails: string | null;
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
  /** Фактически принято на склад, независимо от веса к оплате. */
  acceptedWeightKg: number;
  /** Вес, за который рассчитываем выплату. */
  payableWeightKg: number;
  pricePerKg: number;
  total: number;
  account: WpAccount;
  /** Раздельные фактические суммы; старые записи используют account/total. */
  cashAmount: number;
  bankAmount: number;
  isPaid: boolean;
  paidAt: string | null; // ISO datetime фактической оплаты
  transportId: string | null;
  transportItemId: string | null;
  /**
   * TRUE — приём нужно забрать нашей перевозкой (очередь перевозок учёта,
   * в путевом листе — «забор груза»); FALSE — самопривоз.
   */
  needsTransport: boolean;
  /** Желаемая дата забора (подсказка диспетчеру, необязательно). */
  transportPlannedDate: string | null;
  /**
   * TRUE — приёмку выполнили перевозкой, ждём взвешивания (склад и
   * платёж не двигаются, пока не впишут вес). Снимается сохранением
   * карточки приёма. См. wpIntakeAwaitingWeight().
   */
  awaitingWeight?: boolean;
  /**
   * TRUE — перевозка выполнена: груз вывезли. Ставится автоматически при
   * завершении рейса с точкой этого приёма и вручную кнопкой «Перевозка
   * выполнена». Приём уходит из доставок и очереди перевозок; дальше по
   * нему работают только вес и оплата. Сохранение карточки не снимает
   * пометку (в отличие от awaitingWeight). См. wpIntakeTransportDone().
   */
  transportDone?: boolean;
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
  shippedWeightKg: number;
  acceptedWeightKg: number;
  receivedAmount: number;
  bankPostedAt: string | null;
  pricePerKg: number;
  total: number;
  account: WpAccount;
  isPaid: boolean;
  paidAt: string | null;
  /**
   * TRUE — сдачу нужно отвезти нашей перевозкой (очередь перевозок учёта,
   * в путевом листе — «сдача груза»); FALSE — без нашей перевозки.
   */
  needsTransport: boolean;
  /** Желаемая дата вывоза (подсказка диспетчеру, необязательно). */
  transportPlannedDate: string | null;
  /**
   * TRUE — деньги по сдаче проводим, а остаток макулатуры на площадке
   * НЕ уменьшаем (груз ушёл не с нашей площадки: перегруз, чужой склад).
   */
  skipStock: boolean;
  status: "active" | "cancelled";
  comment: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Тип документа макулатуры, к которому можно привязать платёж. */
export type WpDocKind = "intake" | "shipment";

/** Как платёж связан с документом в форме (приём/продажа). */
export type WpDocPaymentMode = "none" | "create" | "attach" | "keep";

/** Блок «Оплата» из формы документа (приём/продажа). */
export interface WpDocPaymentSpec {
  /** none — не оплачено (отвязать всё), create — новая оплата, attach — привязать свободный платёж, keep — обновить привязанный. */
  mode: WpDocPaymentMode;
  /** Для attach/keep — id платежа. */
  paymentId?: string | null;
  date?: string;
  account?: WpAccount;
  amount?: number;
  isPaid?: boolean;
  comment?: string | null;
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
  /** Привязка к документу: платёж = оплата приёма или продажи (сдачи). */
  docType: WpDocKind | null;
  docId: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * Перевод денег между счетами модуля (безнал ↔ наличка ↔ сторонние).
 * Внутреннее движение: с одного счёта уходит, на другой приходит,
 * внешний приход/расход не создаётся.
 */
export interface WpAccountTransfer {
  id: string;
  number: number;
  date: string;
  /** Счёт, с которого уходят деньги. */
  fromAccount: WpAccount;
  /** Счёт, на который приходят деньги. */
  toAccount: WpAccount;
  amount: number;
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
  /** Цена закупки за кг и раздельная оплата остановки. */
  pricePerKg: number;
  plannedKg: number;
  actualKg: number | null;
  cashAmount: number;
  bankAmount: number;
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
      const payableWeightKg = Math.max(0, Number(it?.payableWeightKg) || 0);
      const pricePerKg = Math.max(0, Number(it?.pricePerKg) || 0);
      // Сумму храним как ввели: при разной цене позиций она НЕ равна
      // вес × цена. У старых строк без суммы считаем по весу и цене.
      const totalRaw = it?.total;
      const total =
        totalRaw === undefined || totalRaw === null || totalRaw === ""
          ? round2money(weightKg * pricePerKg)
          : round2money(Math.max(0, Number(totalRaw) || 0));
      return {
        id: String(it?.id || `it-${idx + 1}`),
        wastepaperType: String(it?.wastepaperType || "cardboard").slice(0, 120),
        weightKg,
        payableWeightKg,
        pricePerKg,
        total,
      };
    })
    // Строка с одной ценой-подсказкой (пустая строка новой формы) —
    // не позиция, её не храним.
    .filter((it) => it.weightKg > 0 || it.payableWeightKg > 0 || it.total > 0);
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

/**
 * Подробные итоги документа по позициям: Σ фактического веса (движение
 * склада), Σ расчётного веса (к оплате / принятый) и Σ сумм. Шапка
 * документа (принято / к оплате / сумма) всегда повторяет эти итоги —
 * их не вписывают отдельно, они считаются из строк.
 */
export function wpDocDetailedTotals(items: WpDocItem[]): {
  acceptedKg: number;
  payableKg: number;
  total: number;
} {
  let acceptedKg = 0;
  let payableKg = 0;
  let total = 0;
  for (const it of items) {
    acceptedKg += Number(it.weightKg) || 0;
    payableKg += Number(it.payableWeightKg) || 0;
    total += Number(it.total) || 0;
  }
  return {
    acceptedKg: round2kg(acceptedKg),
    payableKg: round2kg(payableKg),
    total: round2money(total),
  };
}

/**
 * Перевод старых позиций в формат «факт + к оплате + сумма».
 *
 * Раньше у строки был один вес (расчётный: вес к оплате в приёме,
 * принятый вес в сдаче), а фактический жил только в шапке документа.
 * Теперь оба веса живут в строке. Правило простое: если расчётный вес
 * в строках уже есть — это новый формат, ничего не трогаем. Иначе одна
 * строка получает факт из шапки (factTotal), а расчётный — свой прежний
 * вес; несколько строк: чей вес они хранят, определяем сравнением суммы
 * строк с шапкой, недостающий вес раскладываем пропорционально.
 * Суммы строк не трогаем — они и раньше хранились построчно.
 *
 * Для приёма: factTotal = принято на склад, calcTotal = вес к оплате.
 * Для сдачи: factTotal = отгружено с площадки, calcTotal = принято.
 */
export function migrateWpDocItems(
  items: WpDocItem[],
  factTotal: number,
  calcTotal: number
): WpDocItem[] {
  if (!items || items.length === 0) return items || [];
  if (items.some((it) => (Number(it.payableWeightKg) || 0) > 0)) return items;
  const fact = Math.max(0, Number(factTotal) || 0);
  const calc = Math.max(0, Number(calcTotal) || 0);
  if (!(calc > 0)) return items;
  const sumW = items.reduce((s, it) => s + (Number(it.weightKg) || 0), 0);
  if (!(sumW > 0)) return items;
  const round1 = (n: number) => Math.round(n * 10) / 10;
  if (items.length === 1) {
    // Одна строка старого документа всегда повторяла расчётный вес шапки.
    const it = items[0];
    return [
      {
        ...it,
        weightKg: fact > 0 ? round1(fact) : it.weightKg,
        payableWeightKg: round1(calc),
      },
    ];
  }
  // Несколько строк: вес строк — это либо факт, либо расчётный вес.
  const rowsAreCalc =
    Math.abs(sumW - calc) < 0.051 && Math.abs(sumW - fact) >= 0.051;
  if (rowsAreCalc && fact > 0) {
    return items.map((it) => ({
      ...it,
      weightKg: round1((fact * (Number(it.weightKg) || 0)) / sumW),
      payableWeightKg: round1(Number(it.weightKg) || 0),
    }));
  }
  return items.map((it) => ({
    ...it,
    payableWeightKg: round1((calc * (Number(it.weightKg) || 0)) / sumW),
  }));
}

/** Краткая подпись позиций: «Гофрокартон 500 кг; Белая бумага 120 кг». */
export function wpItemsSummary(items: WpDocItem[], labels: Record<string, string>): string {
  return items
    .map((it) => `${wpTypeLabel(it.wastepaperType, labels)} · ${fmtKg(it.weightKg)}`)
    .join("; ");
}

/**
 * Цена за кг для показа в полях ввода: до 4 знаков после запятой,
 * без хвостовых нулей («8» вместо «8.00», «8.3333» вместо
 * «8.333333333333334»). Сама цена при этом хранится в полной точности —
 * иначе вес × цена после округления не сойдётся с введённой суммой.
 */
export function fmtWpPrice(value: number): string {
  const n = Number(value) || 0;
  if (!(n > 0)) return "";
  const rounded = Math.round(n * 10000) / 10000;
  return String(rounded > 0 ? rounded : n);
}

/**
 * Раскладывает введённую вручную итоговую сумму по позициям документа.
 *
 * Обычный случай (позиция одна или её нет): вес позиции становится равен
 * расчётному весу (вес к оплате в приёме, принятый вес в сдаче), а цена —
 * сумма / вес в полной точности. Тогда вес × цена после округления до
 * копеек всегда даёт ровно введённую сумму — подбирать цену не нужно.
 *
 * Несколько позиций: веса не трогаем (это разбивка фактического веса —
 * она же уходит на склад), сумму делим пропорционально весам; копеечный
 * остаток от округления кладём в последнюю ненулевую позицию, чтобы сумма
 * позиций сошлась с введённой копейка в копейку. Если все веса нулевые —
 * делим расчётный вес и сумму поровну, иначе сумму не к чему привязать.
 *
 * Возвращает НОВЫЙ массив; при пустой сумме или нулевом весе возвращает
 * позиции как есть (тогда итог по-прежнему считается по позициям).
 */
export function distributeWpTotal(
  items: WpDocItem[],
  total: number,
  baseWeight: number,
  fallbackType: string
): WpDocItem[] {
  const sum = round2money(Math.max(0, Number(total) || 0));
  const base = Math.max(0, Number(baseWeight) || 0);
  if (!(sum > 0) || !(base > 0)) return items;
  const type = String(fallbackType || "").trim() || "cardboard";

  if (items.length <= 1) {
    const weight = round2kg(base);
    if (!(weight > 0)) return items;
    // Цену считаем от ОКРУГЛЁННОГО веса — иначе вес × цена не сойдётся
    // с суммой ровно (хватит и тысячных долей кг из старых записей).
    const price = sum / weight;
    const prev = items[0];
    return [
      {
        id: prev?.id || wpUid("it"),
        wastepaperType: prev?.wastepaperType || type,
        weightKg: weight,
        payableWeightKg: prev?.payableWeightKg ?? 0,
        pricePerKg: price,
        total: round2money(weight * price),
      },
    ];
  }

  const weights = items.map((it) => Math.max(0, Number(it.weightKg) || 0));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const effWeights =
    weightSum > 0
      ? weights
      : items.map((_, idx) => {
          if (idx < items.length - 1) return round2kg(base / items.length);
          const rest =
            base - round2kg(base / items.length) * (items.length - 1);
          return Math.max(0, round2kg(rest));
        });
  const effSum = effWeights.reduce((s, w) => s + w, 0);
  if (!(effSum > 0)) return items;

  // Последняя позиция с ненулевым весом — ей достанется остаток округления.
  let lastIdx = -1;
  effWeights.forEach((w, idx) => {
    if (w > 0) lastIdx = idx;
  });
  let assigned = 0;
  return items.map((it, idx) => {
    const w = effWeights[idx];
    if (!(w > 0)) {
      return { ...it, weightKg: weights[idx], pricePerKg: 0, total: 0 };
    }
    if (idx === lastIdx) {
      const itemTotal = Math.max(0, round2money(sum - assigned));
      return { ...it, weightKg: w, pricePerKg: itemTotal / w, total: itemTotal };
    }
    const itemTotal = round2money((sum * w) / effSum);
    assigned = round2money(assigned + itemTotal);
    return { ...it, weightKg: w, pricePerKg: itemTotal / w, total: itemTotal };
  });
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

/**
 * Вид движения денег. «salary» — зарплата сотрудника, выплаченная наличными
 * из кассы макулатуры: сама запись живёт в разделе «Зарплаты» учёта
 * (тег [Макулатура]), а здесь показывается расходом по счёту «Наличка».
 */
export type WpMoneyEventKind = "intake" | "shipment" | "manual" | "salary" | "transfer";

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
  /**
   * TRUE — внутреннее движение между своими счетами (перевод). Такой
   * оборот не является внешним приходом/расходом: в «деньгах за месяц»
   * и в итогах журнала он не учитывается, хотя по счетам проходит.
   */
  internal?: boolean;
  /** Для перевода: id записи wp_account_transfers (общий у обеих сторон). */
  transferId?: string;
  /** Для перевода: второй счёт операции (куда/откуда пришли деньги). */
  counterAccount?: WpAccount;
  /**
   * Платёж-оплата документа (kind «manual» с привязкой): docType/docId —
   * приём или продажа (сдача), docNumber — номер документа для заголовка
   * «Оплата приёма №N». Привязанный платёж — ЕДИНСТВЕННОЕ денежное
   * движение документа: собственное событие документа при наличии
   * привязанных платежей не создаётся (анти-двойной счёт).
   */
  docType?: WpDocKind | null;
  docId?: string | null;
  docNumber?: number | null;
}

/**
 * Минимум полей зарплаты, нужный финансам макулатуры. Структурный тип,
 * чтобы модуль не тянул типы товарного учёта (warehouse-shared).
 */
export interface WpSalaryLike {
  id: string;
  employeeName: string;
  amount: number;
  date: string;
  /** Расчётный месяц YYYY-MM (за какой месяц зарплата). */
  periodMonth?: string | null;
  source?: string | null;
  isPaid: boolean;
  paidAt?: string | null;
  comment?: string | null;
}

/** Тег зарплаты «выплачено из денег макулатуры» (см. warehouse-shared). */
export const WP_SALARY_TAG = "[Макулатура]";
/** Тег «сторонние средства» с пометкой источника: [Сторонние:откуда]. */
const WP_SALARY_THIRD_TAG_RE = /\[Сторонние(?::([^\]]*))?\]/;

/** Зарплата выплачена (или запланирована) из денег макулатуры (любой счёт). */
export function isWpSalary(s: Pick<WpSalaryLike, "source" | "comment">): boolean {
  return (
    s.source === "wastepaper" ||
    s.source === "wastepaper_bank" ||
    s.source === "wastepaper_third" ||
    String(s.comment || "").includes(WP_SALARY_TAG)
  );
}

/**
 * Счёт модуля, с которого идёт зарплата: виртуальный source из учёта
 * (wastepaper → наличка, wastepaper_bank → безнал, wastepaper_third →
 * сторонние), для «сырых» записей — по тегам комментария.
 */
export function wpSalaryAccount(s: Pick<WpSalaryLike, "source" | "comment">): WpAccount {
  if (s.source === "wastepaper_third") return "third_party";
  if (s.source === "wastepaper_bank") return "bank";
  if (s.source === "wastepaper") return "cash";
  const comment = String(s.comment || "");
  if (WP_SALARY_THIRD_TAG_RE.test(comment)) return "third_party";
  return s.source === "bank" ? "bank" : "cash";
}

/** Откуда пришли сторонние деньги на зарплату (пометка тега [Сторонние:…]). */
export function wpSalaryThirdPartyOrigin(comment: string | null | undefined): string {
  const match = WP_SALARY_THIRD_TAG_RE.exec(String(comment || ""));
  return String(match?.[1] || "").trim();
}

/** Комментарий зарплаты без служебных тегов — для ленты финансов. */
function wpSalaryCleanComment(comment: string | null | undefined): string | null {
  const clean = String(comment || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || null;
}

/** «за август 2026» по ключу YYYY-MM; пустая строка, если ключа нет. */
function wpSalaryPeriodLabel(periodMonth: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(periodMonth || ""));
  if (!match) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return "";
  return `за ${date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(/\s*г\.$/, "")}`;
}

/**
 * Зарплаты из денег макулатуры → денежные события модуля.
 * Расход по счёту выплаты — «Наличка», «Безнал» или «Сторонние»:
 * проведённая выплата уменьшает остаток счёта на дату выплаты,
 * запланированная — попадает в прогноз «Нужно выплатить». Для сторонних
 * средств в комментарий события добавляется пометка «откуда». Записи
 * «вне баланса» пропускаем.
 */
export function wpSalaryMoneyEvents(salaries: WpSalaryLike[]): WpMoneyEvent[] {
  const events: WpMoneyEvent[] = [];
  for (const s of salaries) {
    if (!isWpSalary(s)) continue;
    if (String(s.comment || "").includes("[Вне баланса]")) continue;
    const amount = Math.max(0, Number(s.amount) || 0);
    if (amount <= 0) continue;
    const account = wpSalaryAccount(s);
    const origin = account === "third_party" ? wpSalaryThirdPartyOrigin(s.comment) : "";
    const comment = [origin ? `Откуда: ${origin}` : "", wpSalaryCleanComment(s.comment)]
      .filter(Boolean)
      .join(" · ");
    events.push({
      kind: "salary",
      id: s.id,
      number: 0,
      date: String(s.date || "").slice(0, 10),
      direction: "outgoing",
      account,
      amount,
      isPaid: Boolean(s.isPaid),
      paidAt: s.isPaid ? String(s.paidAt || s.date || "").slice(0, 10) || null : null,
      counterpartyName: s.employeeName || "Сотрудник",
      title: ["Выплата ЗП", wpSalaryPeriodLabel(s.periodMonth)].filter(Boolean).join(" "),
      comment: comment || null,
      cancelled: false,
    });
  }
  return events;
}

/**
 * Перевод между счетами → два денежных события: расход по счёту-источнику
 * и приход по счёту-получателю. Оба помечены internal — внешний
 * приход/расход модуля при этом не меняется, двигаются только счета.
 */
export function wpTransferMoneyEvents(transfers: WpAccountTransfer[]): WpMoneyEvent[] {
  const events: WpMoneyEvent[] = [];
  for (const t of transfers) {
    const amount = Math.max(0, Number(t.amount) || 0);
    // Перевод «сам себе» и пустые суммы в деньги не попадают.
    if (amount <= 0 || t.fromAccount === t.toAccount) continue;
    const title = `Перевод №${t.number}: ${WP_ACCOUNT_LABELS[t.fromAccount]} → ${WP_ACCOUNT_LABELS[t.toAccount]}`;
    const base = {
      kind: "transfer" as const,
      number: t.number,
      date: t.date,
      amount,
      // Перевод проводится сразу: как только записан, он двигает счета.
      isPaid: true,
      paidAt: t.date,
      counterpartyName: "Между счетами макулатуры",
      comment: t.comment,
      cancelled: false,
      internal: true,
      transferId: t.id,
    };
    events.push({
      ...base,
      id: `${t.id}:out`,
      direction: "outgoing",
      account: t.fromAccount,
      counterAccount: t.toAccount,
      title,
    });
    events.push({
      ...base,
      id: `${t.id}:in`,
      direction: "incoming",
      account: t.toAccount,
      counterAccount: t.fromAccount,
      title,
    });
  }
  return events;
}

/** Фактическая дата для баланса: день оплаты (paidAt) или дата документа. */
export function wpEventEffectiveDate(event: WpMoneyEvent): string {
  const paidDate = String(event.paidAt || "").slice(0, 10);
  return paidDate || String(event.date || "").slice(0, 10);
}

/**
 * Сумма приёма к выплате = сумма позиций. Цены за кг у позиций разные
 * (картон дешевле архива), поэтому вес × цена шапки здесь не считаем —
 * каждая строка хранит свою введённую сумму, итог = их сумма.
 */
export function wpIntakePayableTotal(i: Pick<WpIntake, "total">): number {
  return Number(i.total) || 0;
}

/**
 * Собирает единую ленту денежных движений: приёмы, сдачи, ручные платежи,
 * зарплаты из кассы макулатуры и переводы между счетами модуля.
 */
export function wpCollectMoneyEvents(
  intakes: WpIntake[],
  shipments: WpShipment[],
  manualPayments: WpManualPayment[],
  salaries: WpSalaryLike[] = [],
  accountTransfers: WpAccountTransfer[] = []
): WpMoneyEvent[] {
  const events: WpMoneyEvent[] = [];
  // Номера документов — для заголовков «Оплата приёма №N / Оплата продажи №N».
  const intakeNumbers = new Map(intakes.map((i) => [i.id, i.number]));
  const shipmentNumbers = new Map(shipments.map((s) => [s.id, s.number]));
  // Документ с привязанными платежами: движение уже несёт платёж —
  // собственное событие документа НЕ создаём, иначе деньги задваиваются.
  // Документ без платежей работает как раньше (событие по отметке «оплачено»).
  const coveredDocs = new Set<string>();
  for (const p of manualPayments) {
    if (p.docType && p.docId) coveredDocs.add(`${p.docType}:${p.docId}`);
  }
  // Отменённый документ гасит и свои платежи: денег по нему нет.
  const cancelledDocs = new Set<string>();
  for (const i of intakes) if (i.status === "cancelled") cancelledDocs.add(`intake:${i.id}`);
  for (const s of shipments) if (s.status === "cancelled") cancelledDocs.add(`shipment:${s.id}`);
  for (const i of intakes) {
    if (coveredDocs.has(`intake:${i.id}`)) continue;
    const splits = i.cashAmount > 0 && i.bankAmount > 0
      ? ([{ account: "cash" as WpAccount, amount: i.cashAmount }, { account: "bank" as WpAccount, amount: i.bankAmount }])
      : [{ account: i.account, amount: wpIntakePayableTotal(i) }];
    for (const split of splits) events.push({
      kind: "intake",
      id: i.id,
      number: i.number,
      date: i.date,
      direction: "outgoing",
      account: split.account,
      // Каждое событие несёт свою сумму: в обычном случае это итог
      // позиций, при раздельной оплате — часть по своему счёту
      // (раньше обе части несли полный итог и расход удваивался).
      amount: split.amount,
      isPaid: i.isPaid,
      paidAt: i.paidAt,
      counterpartyName: i.counterpartyName,
      title: `Приём №${i.number}`,
      comment: i.comment,
      cancelled: i.status === "cancelled",
    });
  }
  for (const s of shipments) {
    if (coveredDocs.has(`shipment:${s.id}`)) continue;
    events.push({
      kind: "shipment",
      id: s.id,
      number: s.number,
      date: s.date,
      direction: "incoming",
      account: s.account,
      amount: s.receivedAmount > 0 ? s.receivedAmount : s.total,
      isPaid: s.isPaid && (s.receivedAmount > 0 ? Boolean(s.bankPostedAt) : true),
      paidAt: s.paidAt,
      counterpartyName: s.enterpriseName,
      title: `Сдача №${s.number}`,
      comment: s.comment,
      cancelled: s.status === "cancelled",
    });
  }
  for (const p of manualPayments) {
    // Платёж-оплата документа титулуется по документу: «Оплата приёма №N».
    const docNumber =
      p.docType === "intake"
        ? (intakeNumbers.get(p.docId ?? "") ?? null)
        : p.docType === "shipment"
          ? (shipmentNumbers.get(p.docId ?? "") ?? null)
          : null;
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
      title:
        p.docType === "intake"
          ? `Оплата приёма №${docNumber ?? p.number}`
          : p.docType === "shipment"
            ? `Оплата продажи №${docNumber ?? p.number}`
            : `Платёж №${p.number}`,
      comment: p.comment,
      cancelled: Boolean(p.docType && p.docId && cancelledDocs.has(`${p.docType}:${p.docId}`)),
      docType: p.docType ?? null,
      docId: p.docId ?? null,
      docNumber,
    });
  }
  // Зарплаты «с макулатуры» — расход наличных, запись ведётся в «Зарплатах».
  events.push(...wpSalaryMoneyEvents(salaries));
  // Переводы между своими счетами: расход по одному счёту, приход по другому.
  events.push(...wpTransferMoneyEvents(accountTransfers));
  return events;
}

// ── Балансы и прогноз ────────────────────────────────────

export interface WpBalance {
  cash: number;
  bank: number;
  /** Наличка + безнал — по факту один денежный счёт макулатуры. */
  common: number;
  third_party: number;
  total: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Фактический остаток денег на конец дня asOfDate (только оплаченные). */
export function getWpBalance(events: WpMoneyEvent[], asOfDate: string): WpBalance {
  let cash = 0;
  let bank = 0;
  let third_party = 0;
  for (const e of events) {
    if (e.cancelled || !e.isPaid) continue;
    const effDate = wpEventEffectiveDate(e);
    if (!effDate || effDate > asOfDate) continue;
    const signed = e.direction === "incoming" ? e.amount : -e.amount;
    if (e.account === "cash") cash += signed;
    else if (e.account === "bank") bank += signed;
    else third_party += signed;
  }
  cash = round2(cash);
  bank = round2(bank);
  third_party = round2(third_party);
  return {
    cash,
    bank,
    common: round2(cash + bank),
    third_party,
    total: round2(cash + bank + third_party),
  };
}

export interface WpForecast {
  inCash: number;
  inBank: number;
  inThirdParty: number;
  outCash: number;
  outBank: number;
  outThirdParty: number;
  inTotal: number;
  outTotal: number;
}

/** Прогноз: запланированные, но ещё не оплаченные приходы/расходы. */
export function getWpForecast(events: WpMoneyEvent[]): WpForecast {
  const f: WpForecast = {
    inCash: 0,
    inBank: 0,
    inThirdParty: 0,
    outCash: 0,
    outBank: 0,
    outThirdParty: 0,
    inTotal: 0,
    outTotal: 0,
  };
  for (const e of events) {
    if (e.cancelled || e.isPaid) continue;
    if (e.direction === "incoming") {
      if (e.account === "cash") f.inCash += e.amount;
      else if (e.account === "bank") f.inBank += e.amount;
      else f.inThirdParty += e.amount;
    } else {
      if (e.account === "cash") f.outCash += e.amount;
      else if (e.account === "bank") f.outBank += e.amount;
      else f.outThirdParty += e.amount;
    }
  }
  f.inCash = round2(f.inCash);
  f.inBank = round2(f.inBank);
  f.inThirdParty = round2(f.inThirdParty);
  f.outCash = round2(f.outCash);
  f.outBank = round2(f.outBank);
  f.outThirdParty = round2(f.outThirdParty);
  f.inTotal = round2(f.inCash + f.inBank + f.inThirdParty);
  f.outTotal = round2(f.outCash + f.outBank + f.outThirdParty);
  return f;
}

// ── Отчёт по дням ────────────────────────────────────────

export interface WpDayRow {
  date: string;
  /** Остаток на начало дня (= остаток предыдущего дня). */
  openingCash: number;
  openingBank: number;
  openingThirdParty: number;
  inCash: number;
  inBank: number;
  inThirdParty: number;
  outCash: number;
  outBank: number;
  outThirdParty: number;
  closingCash: number;
  closingBank: number;
  closingThirdParty: number;
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
    let inThirdParty = 0;
    let outCash = 0;
    let outBank = 0;
    let outThirdParty = 0;
    for (const e of byDay.get(date) || []) {
      if (e.direction === "incoming") {
        if (e.account === "cash") inCash += e.amount;
        else if (e.account === "bank") inBank += e.amount;
        else inThirdParty += e.amount;
      } else {
        if (e.account === "cash") outCash += e.amount;
        else if (e.account === "bank") outBank += e.amount;
        else outThirdParty += e.amount;
      }
    }
    rows.push({
      date,
      openingCash: opening.cash,
      openingBank: opening.bank,
      openingThirdParty: opening.third_party,
      inCash: round2(inCash),
      inBank: round2(inBank),
      inThirdParty: round2(inThirdParty),
      outCash: round2(outCash),
      outBank: round2(outBank),
      outThirdParty: round2(outThirdParty),
      closingCash: round2(opening.cash + inCash - outCash),
      closingBank: round2(opening.bank + inBank - outBank),
      closingThirdParty: round2(opening.third_party + inThirdParty - outThirdParty),
      events: (byDay.get(date) || []) as WpMoneyEvent[],
    });
  }
  if (opts.sortDesc) rows.reverse();
  return rows;
}

// ── Остаток сырья на площадке ────────────────────────────

/**
 * Ручная правка остатка по виду макулатуры (таблица wp_stock_adjustments).
 *
 * Храним НЕ абсолютный остаток, а разницу с расчётом «принято − продано»:
 * макулатурщик вписывает фактическое количество во вкладке «Склад», мы
 * запоминаем расхождение — и дальше новые приёмы/продажи продолжают
 * двигать остаток поверх правки, а не перетирают её.
 */
export interface WpStockAdjustment {
  id: string;
  /** Ключ вида (как в документах: код/идентификатор из справочника). */
  wastepaperType: string;
  /** Разница с расчётным остатком, кг (может быть отрицательной). */
  deltaKg: number;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface WpStockRow {
  wastepaperType: string;
  intakeKg: number;
  shipmentKg: number;
  /**
   * Сколько уехало по продажам с пометкой «не списывать со склада»:
   * деньги прошли, остаток на площадке не трогали. В shipmentKg не входит.
   */
  skippedShipmentKg: number;
  /** Расчёт по документам: принято − продано, без ручной правки. */
  docKg: number;
  /** Ручная корректировка остатка, кг (+/−) — из вкладки «Склад». */
  adjustmentKg: number;
  /** docKg + adjustmentKg — то, что показываем как остаток на площадке. */
  stockKg: number;
}

/**
 * Остаток макулатуры на площадке.
 *
 * Считается по документам: фактически принятое − отгруженное. Две
 * поправки, которые видно в интерфейсе:
 *  - сдачи с пометкой «не списывать со склада» (skipStock) склад НЕ
 *    уменьшают — деньги по ним проходят как обычно;
 *  - ручная правка остатка (wp_stock_adjustments) добавляется к расчёту.
 */
export function getWpStock(
  intakes: WpIntake[],
  shipments: WpShipment[],
  adjustments: WpStockAdjustment[] = []
): WpStockRow[] {
  const intakeMap = new Map<string, number>();
  const shipmentMap = new Map<string, number>();
  const skippedMap = new Map<string, number>();
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
    // На склад попадает фактически принятое, а не оплачиваемое количество.
    if (i.acceptedWeightKg > 0 && (!i.items || i.items.length <= 1)) {
      intakeMap.set(i.wastepaperType, (intakeMap.get(i.wastepaperType) || 0) + i.acceptedWeightKg);
    } else {
      accumulate(intakeMap, i.items, i.wastepaperType, i.weightKg);
    }
  }
  for (const s of shipments) {
    if (s.status !== "active") continue;
    // «Не списывать со склада»: груз ушёл не с нашей площадки, поэтому
    // склад не двигаем — вес считаем отдельно, чтобы показать в справке.
    const target = s.skipStock ? skippedMap : shipmentMap;
    // Со склада ушло столько, сколько отгрузили по нашим весам, а не столько,
    // сколько потом приняло предприятие (разница — засор/усушка в пути).
    // При нескольких позициях разбивка факта живёт в самих позициях.
    if (s.shippedWeightKg > 0 && (!s.items || s.items.length <= 1)) {
      target.set(
        s.wastepaperType,
        (target.get(s.wastepaperType) || 0) + s.shippedWeightKg
      );
    } else {
      accumulate(target, s.items, s.wastepaperType, s.weightKg);
    }
  }
  // Ручные правки: один вид — одна строка, но суммируем на случай дублей.
  const adjustMap = new Map<string, number>();
  for (const a of adjustments) {
    const type = String(a?.wastepaperType || "").trim();
    if (!type) continue;
    adjustMap.set(type, (adjustMap.get(type) || 0) + (Number(a.deltaKg) || 0));
  }
  const types = new Set([
    ...intakeMap.keys(),
    ...shipmentMap.keys(),
    ...skippedMap.keys(),
    ...adjustMap.keys(),
  ]);
  return [...types]
    .map((t) => {
      const i = Math.round((intakeMap.get(t) || 0) * 10) / 10;
      const s = Math.round((shipmentMap.get(t) || 0) * 10) / 10;
      const skipped = Math.round((skippedMap.get(t) || 0) * 10) / 10;
      const adjustment = Math.round((adjustMap.get(t) || 0) * 10) / 10;
      const docKg = Math.round((i - s) * 10) / 10;
      return {
        wastepaperType: t,
        intakeKg: i,
        shipmentKg: s,
        skippedShipmentKg: skipped,
        docKg,
        adjustmentKg: adjustment,
        stockKg: Math.round((docKg + adjustment) * 10) / 10,
      };
    })
    .sort((a, b) => b.stockKg - a.stockKg);
}

// ── Форматтеры ───────────────────────────────────────────

export function fmtMoney(value: number): string {
  // Неразрывный пробел перед ₽: сумма («12 500 ₽») никогда не рвётся
  // между числом и валютой ни в таблице, ни в карточке телефона.
  return `${round2(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}\u00A0₽`;
}

export function fmtKg(value: number): string {
  // Неразрывный пробел перед кг — вес не рвётся пополам.
  return `${(Math.round(value * 10) / 10).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}\u00A0кг`;
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
