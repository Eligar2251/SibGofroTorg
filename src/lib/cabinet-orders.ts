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
}

export function toIso(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

export function serializeCabinetOrder(row: any): CabinetOrder {
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
  };
}

/**
 * Заявки конкретного пользователя ровно в том составе и порядке, в
 * котором он видит их у себя в «Моих заказах».
 *
 * Правило подбора гостевых заявок (оформленных до/без входа) намеренно
 * повторяет поведение кабинета: они подхватываются по номеру телефона,
 * но только если оформлены не раньше, чем за минуту до регистрации
 * аккаунта — иначе к новому владельцу номера прилипла бы чужая история.
 */
export async function getCabinetOrdersForUser(input: {
  userId: string;
  phone: string | null;
  accountCreatedAt?: unknown;
}): Promise<CabinetOrder[]> {
  const db = getAdminDb();
  const uid = input.userId;
  const phoneDigits = normalizePhone(input.phone || "");
  const phoneDisplay = phoneDigits ? formatPhoneDisplay(phoneDigits) : "";
  const accountCreatedMs = input.accountCreatedAt
    ? new Date(toIso(input.accountCreatedAt) || 0).getTime()
    : 0;

  const queries: PromiseLike<any>[] = [
    db.from("orders").select("*").eq("user_id", uid),
  ];
  if (phoneDigits) {
    queries.push(
      db.from("orders").select("*").eq("customer_phone_digits", phoneDigits),
      db.from("orders").select("*").eq("customer_phone", phoneDisplay)
    );
  }

  const [byUserRes, byPhoneDigitsRes, byPhoneDisplayRes] = await Promise.all(queries);

  const map = new Map<string, CabinetOrder>();
  for (const row of byUserRes?.data || []) map.set(row.id, serializeCabinetOrder(row));

  if (accountCreatedMs > 0) {
    const extra = [
      ...(byPhoneDigitsRes?.data || []),
      ...(byPhoneDisplayRes?.data || []),
    ];
    for (const row of extra) {
      if (row.user_id && row.user_id !== uid) continue;
      if (row.user_id === uid) {
        map.set(row.id, serializeCabinetOrder(row));
        continue;
      }
      if (row.user_id) continue;
      const orderMs = new Date(toIso(row.created_at) || 0).getTime();
      if (orderMs + 60_000 < accountCreatedMs) continue;
      if (!map.has(row.id)) map.set(row.id, serializeCabinetOrder(row));
    }
  }

  const results = Array.from(map.values());
  results.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return results;
}
