// =========================================================
// FILE: src/lib/cabinet-orders.ts
// Единственный источник «что видит клиент в личном кабинете».
//
// Раньше выборка и сериализация заявок жили прямо в
// /api/cabinet/orders. Как только админке понадобилось показывать
// кабинет клиента глазами клиента, копировать эту логику было нельзя:
// две копии неизбежно разошлись бы, и менеджер проверял бы синхронизацию
// по картинке, которой у клиента нет. Поэтому обе стороны —
// /api/cabinet/orders и /api/admin/user-orders — вызывают одни и те же
// функции отсюда.
// =========================================================

import { getAdminDb } from "@/lib/supabase";
import { formatPhoneDisplay, normalizePhone } from "@/lib/user-auth";

export interface CabinetOrderItem {
  productId: string | null;
  variantId: string | null;
  variantName: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  price: number;
}

export interface CabinetOrder {
  id: string;
  type: string;
  status: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  communicationChannel: string | null;
  paymentMethod: string | null;
  items: CabinetOrderItem[] | null;
  totalSum: number | null;
  productInfo: string | null;
  quantity: number | null;
  comment: string | null;
  pickupCode: string | null;
  issuedAt: string | null;
  closeReason: string | null;
  dealNumber: number | null;
  companyName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  actualAddress: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Заявка оформлена без входа в аккаунт и найдена по номеру телефона. */
  guest: boolean;
  /** Только для админки: заявка принадлежит другому аккаунту с тем же
   *  телефоном. Клиент её видит у себя, поэтому и менеджер обязан увидеть —
   *  иначе «в кабинете клиента» показывает меньше, чем в кабинете клиента. */
  otherAccount: boolean;
  /** Владелец заявки (user_id строки orders) — нужен, чтобы объяснить
   *  менеджеру, чей это аккаунт. */
  ownerUserId: string | null;
}

export function toIso(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

export function serializeCabinetOrder(
  row: any,
  flags: { otherAccount?: boolean } = {}
): CabinetOrder {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    customerName: row.customer_name ?? null,
    customerPhone: row.customer_phone ?? null,
    customerEmail: row.customer_email ?? null,
    communicationChannel: row.communication_channel ?? null,
    paymentMethod: row.payment_method ?? null,
    items: Array.isArray(row.items)
      ? row.items.map((item: any) => ({
          productId: item.productId ?? null,
          variantId: item.variantId ?? null,
          variantName: item.variantName ?? null,
          name: item.name,
          sku: item.sku ?? null,
          quantity: item.quantity,
          price: item.price,
        }))
      : null,
    totalSum: row.total_sum ?? null,
    productInfo: row.product_info ?? null,
    quantity: row.quantity ?? null,
    comment: row.comment ?? null,
    // Код выдачи — показываем клиенту, чтобы он назвал его при получении.
    pickupCode: row.pickup_code ?? null,
    issuedAt: toIso(row.issued_at),
    // Итог/причина закрытия — клиент видит, чем закончилась заявка.
    closeReason: row.close_reason ?? null,
    dealNumber: row.deal_number ?? null,
    companyName: row.company_name ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    ogrn: row.ogrn ?? null,
    legalAddress: row.legal_address ?? null,
    actualAddress: row.actual_address ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    guest: !row.user_id,
    otherAccount: flags.otherAccount === true,
    ownerUserId: row.user_id ?? null,
  };
}

/**
 * Потолок PostgREST: один запрос отдаёт не больше этого числа строк.
 * Если у клиента заявок больше, мы обязаны честно сказать об этом,
 * а не показывать «не все заявки» как будто так и надо.
 */
export const CABINET_QUERY_LIMIT = 1000;

export interface CabinetOrdersResult {
  orders: CabinetOrder[];
  /** true — где-то сработал потолок выборки: возможен пропуск старых заявок. */
  capped: boolean;
}

/**
 * Заявки конкретного пользователя ровно в том составе и порядке, в
 * котором он видит их у себя в «Моих заказах».
 *
 * Гостевые заявки (оформленные до/без входа) подбираются по тому же
 * номеру телефона. После регистрации/входа клиент ожидает увидеть весь
 * свой заказ в кабинете, поэтому ограничение по времени создания аккаунта
 * убрано: сам факт совпадения номера — достаточное условие.
 *
 * Режим forAdmin (вкладка «Кабинет клиента») шире клиентского ровно на одно:
 * в него попадают и заявки ДРУГОГО аккаунта с тем же телефоном. Клиент,
 * у которого два аккаунта (или телефон перешёл на новый), видит их все у
 * себя — значит и менеджер обязан их увидеть, иначе экран «не все заявки».
 * Такие карточки помечаются otherAccount: это не «лишние» заявки, а подсказка,
 * что у телефона два аккаунта.
 */
export async function getCabinetOrdersDetailed(input: {
  userId: string;
  phone: string | null;
  accountCreatedAt?: unknown;
  forAdmin?: boolean;
}): Promise<CabinetOrdersResult> {
  const db = getAdminDb();
  const uid = input.userId;
  const phoneDigits = normalizePhone(input.phone || "");
  const phoneDisplay = phoneDigits ? formatPhoneDisplay(phoneDigits) : "";

  // Свежие заявки важнее старых: сортировка + лимит гарантируют, что при
  // очень большой истории на экран попадут последние, а не «первые 1000
  // когда-то созданных».
  const shape = (q: any) =>
    q.order("created_at", { ascending: false }).limit(CABINET_QUERY_LIMIT);
  const run = async (build: (q: any) => any) => {
    const { data, count, error } = await build(
      db.from("orders").select("*", { count: "exact" })
    );
    if (error) throw error;
    const rows = data || [];
    return {
      rows,
      total: typeof count === "number" ? count : rows.length,
    };
  };

  const parts = [await run((q) => shape(q.eq("user_id", uid)))];
  if (phoneDigits) {
    parts.push(
      ...(await Promise.all([
        run((q) => shape(q.eq("customer_phone_digits", phoneDigits))),
        run((q) => shape(q.eq("customer_phone", phoneDisplay))),
      ]))
    );
  }

  const capped = parts.some((part) => part.total > part.rows.length);

  const map = new Map<string, CabinetOrder>();
  for (const part of parts) {
    for (const row of part.rows) {
      if (row.user_id === uid) {
        map.set(row.id, serializeCabinetOrder(row));
        continue;
      }
      // Заявка вообще без владельца — гостевая, найдена по телефону.
      if (!row.user_id) {
        if (!map.has(row.id)) map.set(row.id, serializeCabinetOrder(row));
        continue;
      }
      // Заявка другого аккаунта с этим же телефоном: клиенту она показана,
      // значит и здесь она обязана быть.
      if (input.forAdmin && !map.has(row.id)) {
        map.set(row.id, serializeCabinetOrder(row, { otherAccount: true }));
      }
    }
  }

  const results = Array.from(map.values());
  results.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return { orders: results, capped };
}

/** Клиентский вариант: ровно то, что видит сам клиент (без админских примесей). */
export async function getCabinetOrdersForUser(input: {
  userId: string;
  phone: string | null;
  accountCreatedAt?: unknown;
}): Promise<CabinetOrder[]> {
  const { orders } = await getCabinetOrdersDetailed(input);
  return orders;
}
