// =========================================================
// FILE: src/lib/trip-stops.ts
// Модель «точек маршрута» для перевозок и путевых листов.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ
// Точки нужны и редактору (TransportManager / TripStopsEditor), и
// печатным бланкам (TransportPrintSheet / TransportTripSheet), и
// серверному слою (lib/warehouse.ts). Общий тип живёт здесь, чтобы
// клиентские компоненты не импортировали серверный модуль warehouse.ts
// (тянет supabase-клиент в браузерный бандл).
//
// ПОРЯДОК ТОЧЕК
// Порядок — это порядок элементов в массиве. Он же и сохраняется в БД:
// transports.items — JSONB-массив, Postgres возвращает его в том же
// порядке, в котором записали. Отдельной колонки сортировки не нужно.
// =========================================================

/** Операция на точке: что водитель там делает. */
export type TripType = "delivery" | "pickup" | "handover";

export interface TripTypeDef {
  id: TripType;
  /** Полная подпись — в интерфейсе */
  label: string;
  /** Короткая подпись — бейджи в списке */
  short: string;
  /** Пометка в бланке водителю (компактно, капсом) */
  mark: string;
  /** Что везём/делаем — подпись списка грузов в бланке */
  cargoLabel: string;
  hint: string;
  icon: string;
}

export const TRIP_TYPES: TripTypeDef[] = [
  {
    id: "delivery",
    label: "Доставка клиенту",
    short: "Доставка",
    mark: "ДОСТАВКА",
    cargoLabel: "Выгрузить",
    hint: "везём товар клиенту",
    icon: "🚚",
  },
  {
    id: "pickup",
    label: "Забор груза",
    short: "Забор груза",
    mark: "ЗАБОР",
    cargoLabel: "Забрать",
    hint: "забираем груз у контрагента",
    icon: "📥",
  },
  {
    id: "handover",
    label: "Сдача груза",
    short: "Сдача груза",
    mark: "СДАЧА",
    cargoLabel: "Сдать",
    hint: "сдаём груз (например, на переработку)",
    icon: "📤",
  },
];

const TRIP_TYPE_MAP = new Map(TRIP_TYPES.map((t) => [t.id, t]));

/**
 * Общая инструкция на точку — печатается в бланке водителю, если диспетчер
 * не написал свою заметку (и дописывается к её концу, когда заметка есть).
 * Так водитель видит не только «куда», но и «что сделать на месте».
 */
export const TRIP_TYPE_INSTRUCTION: Record<TripType, string> = {
  delivery:
    "Выгрузить по списку, получить подпись получателя. Отказ/неполная приёмка — сразу звонок диспетчеру.",
  pickup:
    "Посчитать груз на месте, оформить забор документально (накладная/вес), проверить комплектность.",
  handover:
    "Сдать под подпись, забрать отметку приёмки с количеством/весом. Расхождение — не уезжать, звонить диспетчеру.",
};

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

export const TRIP_TYPE_MARK: Record<TripType, string> = {
  delivery: "ДОСТАВКА",
  pickup: "ЗАБОР",
  handover: "СДАЧА",
};

/** Значение по умолчанию: строка без явной пометки — это доставка. */
export function normalizeTripType(value: unknown): TripType {
  return value === "pickup" || value === "handover" ? value : "delivery";
}

export function tripTypeDef(value: unknown): TripTypeDef {
  return TRIP_TYPE_MAP.get(normalizeTripType(value))!;
}

/** Одна строка груза на точке. */
export interface TripStopLine {
  productId: string | null;
  name: string;
  /** Сколько едем везём/забираем именно сейчас */
  qty: number;
  /** Сколько заказано всего (для заказов) — подсказка в редакторе */
  orderedQty?: number | null;
  /** Максимум, который можно взять (остаток на складе) */
  maxQty?: number | null;
  /** Единица измерения для бланка («кг» у макулатуры, иначе «ед.»). */
  unit?: string | null;
}

/** Точка маршрута: адрес + пометка + груз. */
export interface TripStop {
  key: string;
  /**
   * "deal" — точка из заказа учёта (ЗК),
   * "wp_intake" — приём макулатуры (ПМ-, забор),
   * "wp_shipment" — сдача макулатуры (СМ-, сдача),
   * "receipt" — поставка (ПО-, забор товара у поставщика),
   * "custom" — самостоятельная (своя) точка.
   */
  kind: "deal" | "custom" | "wp_intake" | "wp_shipment" | "receipt";
  dealId: string | null;
  dealNumber: number | null;
  /** Привязка к приёму/сдаче макулатуры (для kind wp_*). */
  wpDocId?: string | null;
  /** intake — приём, shipment — сдача. */
  wpDocKind?: "intake" | "shipment" | null;
  wpDocNumber?: number | null;
  /** Привязка к поставке — приходному ордеру (для kind receipt). */
  receiptId?: string | null;
  receiptNumber?: number | null;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  address: string | null;
  deliveryNote: string | null;
  /** Ориентировочное время на точке («09:30») — печатается в бланке */
  plannedTime: string | null;
  tripType: TripType;
  lines: TripStopLine[];
  totalSum: number | null;
}

/** Всё, что нужно редактору, чтобы собрать точку из заказа. */
export interface TripStopDeal {
  id: string;
  number: number;
  customerName: string;
  contactName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryNote?: string | null;
  items: { productId: string; name: string; quantity: number }[];
  totalSum?: number | null;
  shippedItems?: { productId: string; shippedQty: number }[] | null;
  deliveryItems?: { productId: string; quantity: number }[] | null;
}

/** Строка items[] перевозки (то, что лежит в transports.items JSONB). */
export interface TripStopTransportItem {
  dealId: string | null;
  dealNumber: number | null;
  /** Привязка к приёму/сдаче макулатуры (wp_intakes / wp_shipments). */
  wpDocId?: string | null;
  wpDocKind?: "intake" | "shipment" | null;
  wpDocNumber?: number | null;
  /** Привязка к поставке — приходному ордеру (warehouse_receipts). */
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
    /** Единица измерения для бланка («кг» у макулатуры). */
    unit?: string | null;
  }[];
  totalSum: number | null;
  tripType?: TripType | null;
}

let uidCounter = 0;

/** Стабильный ключ точки для React и для сопоставления списков. */
export function stopKey(prefix = "stop"): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}

export function stopTotalQty(stop: TripStop): number {
  return stop.lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
}

/** Сколько единиц груза на точке считается «везём» (qty > 0). */
export function stopLoadedLines(stop: TripStop): TripStopLine[] {
  return stop.lines.filter((line) => (Number(line.qty) || 0) > 0);
}

export function stopTitle(stop: TripStop): string {
  if (stop.kind === "deal" && stop.dealNumber) return `ЗК-${stop.dealNumber}`;
  if (stop.kind === "wp_intake" && stop.wpDocNumber != null) return `ПМ-${stop.wpDocNumber}`;
  if (stop.kind === "wp_shipment" && stop.wpDocNumber != null) return `СМ-${stop.wpDocNumber}`;
  if (stop.kind === "receipt" && stop.receiptNumber != null) return `ПО-${stop.receiptNumber}`;
  if (stop.kind === "wp_intake") return "Приём макулатуры";
  if (stop.kind === "wp_shipment") return "Сдача макулатуры";
  if (stop.kind === "receipt") return "Поставка";
  return "Своя точка";
}

/** Точка из поставки (приходного ордера) — забор товара у поставщика. */
export function isReceiptStop(stop: Pick<TripStop, "kind">): boolean {
  return stop.kind === "receipt";
}

/** Точка из документа (заказ, макулатура, поставка), а не своя. */
export function isDocStop(stop: Pick<TripStop, "kind">): boolean {
  return stop.kind !== "custom";
}

/** Точка из макулатуры (приём/сдача), а не из заказа учёта. */
export function isWpStop(stop: Pick<TripStop, "kind">): boolean {
  return stop.kind === "wp_intake" || stop.kind === "wp_shipment";
}

/** Краткая сводка грузов одной строкой — для компактных карточек и бланка. */
export function stopLinesSummary(stop: TripStop, separator = "; "): string {
  const loaded = stopLoadedLines(stop);
  // Приём/сдачу макулатуры везут и без веса: его узнают на месте,
  // поэтому пустая сводка читалась бы как «груза нет».
  if (loaded.length === 0 && isWpStop(stop) && stop.lines.length > 0) {
    return "вес уточним при взвешивании";
  }
  return loaded
    .map((line) => `${line.name.trim() || "без названия"} — ${line.qty}`)
    .join(separator);
}

/** Остаток заказа к отгрузке: сколько ещё не развезли по перевозкам. */
function dealAvailableQty(
  deal: TripStopDeal,
  productId: string
): { ordered: number; available: number } {
  const item = deal.items.find((i) => String(i.productId) === String(productId));
  const ordered = Number(item?.quantity || 0);
  const shipped =
    (deal.shippedItems || []).find((s) => String(s.productId) === String(productId))
      ?.shippedQty || 0;
  const planned =
    (deal.deliveryItems || []).find((d) => String(d.productId) === String(productId))
      ?.quantity || 0;
  return { ordered, available: Math.max(0, ordered - shipped - planned) };
}

/** Точка из заказа учёта (груз = позиции заказа, сколько не развезено). */
export function stopFromDeal(deal: TripStopDeal): TripStop {
  return {
    key: `deal-${deal.id}`,
    kind: "deal",
    dealId: deal.id,
    dealNumber: deal.number,
    customerName: deal.customerName || "",
    contactName: deal.contactName ?? null,
    phone: deal.customerPhone ?? null,
    address: deal.deliveryAddress ?? null,
    deliveryNote: deal.deliveryNote ?? null,
    plannedTime: null,
    // Заказ — это всегда доставка клиенту; пометку можно поменять вручную
    // (например, если едем забрать возврат).
    tripType: "delivery",
    lines: deal.items.map((item) => {
      const { ordered, available } = dealAvailableQty(deal, item.productId);
      return {
        productId: item.productId,
        name: item.name,
        qty: available,
        orderedQty: ordered,
        maxQty: available,
      };
    }),
    totalSum: deal.totalSum ?? null,
  };
}

/** Сколько всего можно взять с заказа по позиции (для max в инпутах). */
export function dealAvailableFor(deal: TripStopDeal, productId: string): number {
  return dealAvailableQty(deal, productId).available;
}

/** Всё, что нужно редактору, чтобы собрать точку из поставки (ПО-). */
export interface TripStopReceipt {
  id: string;
  number: number;
  supplierName: string;
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  /** Остаток к приёмке по позициям (заказано − уже принято). */
  lines: { productId: string; name: string; qty: number; orderedQty?: number | null }[];
}

/**
 * Точка из поставки (приходного ордера) — «забор груза» у поставщика.
 * Груз — остаток по приёмке: количество можно уменьшить руками (приняли
 * меньше), тогда остаток останется в поставке («остаток по приёмке»).
 */
export function stopFromReceipt(doc: TripStopReceipt): TripStop {
  return {
    key: `receipt-${doc.id}`,
    kind: "receipt",
    dealId: null,
    dealNumber: null,
    receiptId: doc.id,
    receiptNumber: doc.number,
    customerName: doc.supplierName || "",
    contactName: doc.contactName ?? null,
    phone: doc.phone ?? null,
    address: doc.address ?? null,
    deliveryNote: doc.note ?? null,
    plannedTime: null,
    tripType: "pickup",
    lines: doc.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      qty: Number(line.qty) || 0,
      orderedQty: Number(line.orderedQty ?? line.qty) || 0,
      maxQty: Number(line.qty) || 0,
    })),
    totalSum: null,
  };
}

/**
 * Точка из приёма/сдачи макулатуры.
 * Приём — всегда «забор груза» (едем забирать у клиента),
 * сдача — всегда «сдача груза» (везём на предприятие).
 * Груз — позиции документа в кг; пометку можно поменять вручную.
 */
export function stopFromWpDoc(doc: {
  id: string;
  kind: "intake" | "shipment";
  number: number;
  customerName: string;
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  lines: { name: string; qty: number }[];
}): TripStop {
  return {
    key: `wp-${doc.kind}-${doc.id}`,
    kind: doc.kind === "intake" ? "wp_intake" : "wp_shipment",
    dealId: null,
    dealNumber: null,
    wpDocId: doc.id,
    wpDocKind: doc.kind,
    wpDocNumber: doc.number,
    customerName: doc.customerName || "",
    contactName: doc.contactName ?? null,
    phone: doc.phone ?? null,
    address: doc.address ?? null,
    deliveryNote: doc.note ?? null,
    plannedTime: null,
    tripType: doc.kind === "intake" ? "pickup" : "handover",
    lines: (doc.lines.length > 0 ? doc.lines : [{ name: "Макулатура (вес уточнить)", qty: 0 }]).map((line) => ({
      productId: null,
      name: line.name,
      qty: Number(line.qty) || 0,
      orderedQty: Number(line.qty) || 0,
      maxQty: null,
      unit: "кг",
    })),
    totalSum: null,
  };
}

/** Своя (самостоятельная) точка — адрес и груз пишем руками. */
export function emptyCustomStop(): TripStop {
  return {
    key: stopKey("custom"),
    kind: "custom",
    dealId: null,
    dealNumber: null,
    wpDocId: null,
    wpDocKind: null,
    wpDocNumber: null,
    receiptId: null,
    receiptNumber: null,
    customerName: "",
    contactName: "",
    phone: "",
    address: "",
    deliveryNote: "",
    plannedTime: "",
    tripType: "pickup",
    lines: [{ productId: null, name: "", qty: 1, orderedQty: null, maxQty: null }],
    totalSum: null,
  };
}

/** Точка из сохранённой перевозки (transports.items). */
export function stopFromTransportItem(
  item: TripStopTransportItem,
  index: number
): TripStop {
  const dealId = item.dealId ? String(item.dealId) : null;
  const wpDocId = item.wpDocId ? String(item.wpDocId) : null;
  const wpDocKind =
    item.wpDocKind === "intake" || item.wpDocKind === "shipment"
      ? item.wpDocKind
      : null;
  const receiptId = item.receiptId ? String(item.receiptId) : null;
  const kind: TripStop["kind"] = dealId
    ? "deal"
    : wpDocId && wpDocKind
      ? wpDocKind === "intake"
        ? "wp_intake"
        : "wp_shipment"
      : receiptId
        ? "receipt"
        : "custom";
  return {
    key: dealId
      ? `deal-${dealId}`
      : wpDocId && wpDocKind
        ? `wp-${wpDocKind}-${wpDocId}`
        : receiptId
          ? `receipt-${receiptId}`
          : `custom-legacy-${index}`,
    kind,
    dealId,
    dealNumber: item.dealNumber ?? null,
    wpDocId,
    wpDocKind,
    wpDocNumber: item.wpDocNumber ?? null,
    receiptId,
    receiptNumber: item.receiptNumber ?? null,
    customerName: item.customerName || "",
    contactName: item.contactName ?? null,
    phone: item.phone ?? null,
    address: item.address ?? null,
    deliveryNote: item.deliveryNote ?? null,
    plannedTime: item.plannedTime ?? null,
    tripType: normalizeTripType(item.tripType),
    lines: (Array.isArray(item.items) ? item.items : []).map((line) => ({
      productId: line.productId ?? null,
      name: line.name || "",
      qty: Number(line.transportQty) || 0,
      orderedQty: Number(line.orderedQty) || null,
      maxQty: dealId || receiptId ? Number(line.orderedQty) || null : null,
      unit: line.unit ?? (wpDocId ? "кг" : null),
    })),
    totalSum: item.totalSum ?? null,
  };
}

export function stopsFromTransportItems(items: TripStopTransportItem[] | null | undefined): TripStop[] {
  return (Array.isArray(items) ? items : []).map(stopFromTransportItem);
}

/**
 * Точки → items[] перевозки. Пустые точки (без груза) отбрасываем:
 * сервер всё равно их выкидывает, а порядок значим — поэтому чистим
 * заранее, чтобы номерация в бланке совпадала с тем, что сохранится.
 */
export function stopsToTransportItems(stops: TripStop[]): TripStopTransportItem[] {
  return stops
    .map((stop) => {
      // Для пустого приёма/сдачи сохраняем нулевую строку в рейсе:
      // вес уточняется после забора и взвешивания.
      const lines = stopLoadedLines(stop).length > 0
        ? stopLoadedLines(stop)
        : (stop.kind === "wp_intake" || stop.kind === "wp_shipment" ? stop.lines : []);
      return {
        dealId: stop.dealId,
        dealNumber: stop.dealNumber,
        wpDocId: stop.wpDocId,
        wpDocKind: stop.wpDocKind,
        wpDocNumber: stop.wpDocNumber,
        receiptId: stop.receiptId ?? null,
        receiptNumber: stop.receiptNumber ?? null,
        customerName: stop.customerName.trim(),
        contactName: stop.contactName?.trim() || null,
        address: stop.address?.trim() || null,
        phone: stop.phone?.trim() || null,
        deliveryNote: stop.deliveryNote?.trim() || null,
        plannedTime: stop.plannedTime?.trim() || null,
        items: lines.map((line) => ({
          productId: line.productId ?? null,
          name: line.name.trim(),
          orderedQty: Number(line.orderedQty) || line.qty,
          transportQty: Number(line.qty) || 0,
          unit: line.unit ?? null,
        })),
        totalSum: stop.totalSum ?? null,
        tripType: stop.tripType,
      } satisfies TripStopTransportItem;
    })
    .filter((item) => item.items.length > 0);
}

/** Проверка точек перед сохранением. Возвращает текст ошибки или null. */
export function validateStops(stops: TripStop[]): string | null {
  if (stops.length === 0) return "Добавьте хотя бы одну точку";
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    const num = i + 1;
    if (!stop.address || !stop.address.trim()) {
      return `Точка ${num}: укажите адрес — куда ехать водителю`;
    }
    // Для макулатуры вес может быть неизвестен до приезда и взвешивания.
    if (stopLoadedLines(stop).length === 0 && stop.kind !== "wp_intake" && stop.kind !== "wp_shipment") {
      return `Точка ${num}: укажите груз (что ${tripTypeDef(stop.tripType).cargoLabel.toLowerCase()})`;
    }
    if (stop.kind === "custom" && !stop.customerName.trim()) {
      return `Точка ${num}: укажите контрагента — от кого/кому груз`;
    }
  }
  return null;
}

export function moveStop<T extends { key: string }>(
  list: T[],
  from: number,
  to: number
): T[] {
  const clamped = Math.max(0, Math.min(list.length - 1, to));
  if (from === clamped || from < 0 || from >= list.length || list.length < 2) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return next;
}

export type StopSortMode = "type-pickup" | "type-delivery" | "address" | "time";

export const STOP_SORT_OPTIONS: { id: StopSortMode; label: string }[] = [
  { id: "type-pickup", label: "Сначала забор" },
  { id: "type-delivery", label: "Сначала доставка" },
  { id: "address", label: "По адресу (А→Я)" },
  { id: "time", label: "По времени" },
];

/**
 * Быстрая сортировка точек. Типы ранжируем «забор → доставка → сдача»
 * (логика маршрута: сначала подбираем груз по пути, потом развозим),
 * внутри группы порядок не трогаем — он и есть ручной.
 */
export function sortStops<T extends TripStop>(stops: T[], mode: StopSortMode): T[] {
  const TYPE_WEIGHT: Record<TripType, number> = { pickup: 0, delivery: 1, handover: 2 };
  const withIndex = stops.map((stop, index) => ({ stop, index }));
  const sorted = [...withIndex];

  if (mode === "type-pickup" || mode === "type-delivery") {
    const weight = mode === "type-pickup" ? TYPE_WEIGHT : { pickup: 2, delivery: 0, handover: 1 };
    sorted.sort((a, b) => {
      const wa = weight[normalizeTripType(a.stop.tripType)];
      const wb = weight[normalizeTripType(b.stop.tripType)];
      if (wa !== wb) return wa - wb;
      return a.index - b.index;
    });
  } else if (mode === "address") {
    sorted.sort((a, b) => {
      const va = String(a.stop.address || "").toLocaleLowerCase("ru-RU");
      const vb = String(b.stop.address || "").toLocaleLowerCase("ru-RU");
      const cmp = va.localeCompare(vb, "ru");
      return cmp !== 0 ? cmp : a.index - b.index;
    });
  } else {
    // По времени: пустое время — в конец
    sorted.sort((a, b) => {
      const va = String(a.stop.plannedTime || "").trim();
      const vb = String(b.stop.plannedTime || "").trim();
      if (!va && !vb) return a.index - b.index;
      if (!va) return 1;
      if (!vb) return -1;
      return va.localeCompare(vb);
    });
  }

  return sorted.map((x) => x.stop);
}

/** Сводка по точкам — для подписей «всего N точек · M ед.». */
export function summarizeStops(stops: TripStop[]): {
  total: number;
  /** Единицы товара учёта (штуки). Макулатура считается отдельно в кг. */
  qty: number;
  /** Килограммы макулатуры (точки ПМ-/СМ-). */
  kg: number;
  positions: number;
  byType: Record<TripType, number>;
} {
  const byType: Record<TripType, number> = { delivery: 0, pickup: 0, handover: 0 };
  let qty = 0;
  let kg = 0;
  let positions = 0;
  for (const stop of stops) {
    byType[normalizeTripType(stop.tripType)] += 1;
    const lines = stopLoadedLines(stop);
    positions += lines.length;
    const sum = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
    if (isWpStop(stop)) kg += sum;
    else qty += sum;
  }
  return { total: stops.length, qty, kg, positions, byType };
}
