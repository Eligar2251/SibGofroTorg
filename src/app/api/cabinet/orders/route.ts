// =========================================================
// FILE: src/app/api/cabinet/orders/route.ts
// =========================================================
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";
import { requireUserApi, formatPhoneDisplay, normalizePhone, getUserById } from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

function serializeOrder(row: any) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email ?? null,
    communicationChannel: row.communication_channel,
    paymentMethod: row.payment_method ?? null,
    items: Array.isArray(row.items)
      ? row.items.map((item: any) => ({
          productId: item.productId ?? null,
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
    companyName: row.company_name ?? null,
    inn: row.inn ?? null,
    kpp: row.kpp ?? null,
    ogrn: row.ogrn ?? null,
    legalAddress: row.legal_address ?? null,
    actualAddress: row.actual_address ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth instanceof NextResponse) return auth;

    const { uid, phone } = auth;
    const phoneDigits = normalizePhone(phone);
    const phoneDisplay = formatPhoneDisplay(phoneDigits);
    const db = getAdminDb();

    const user = await getUserById(uid);
    const accountCreatedMs = user?.createdAt ? new Date(toIso((user as any).createdAt) || 0).getTime() : 0;

    const [byUserRes, byPhoneDigitsRes, byPhoneDisplayRes] = await Promise.all([
      db.from("orders").select("*").eq("user_id", uid),
      db.from("orders").select("*").eq("customer_phone_digits", phoneDigits),
      db.from("orders").select("*").eq("customer_phone", phoneDisplay),
    ]);

    const map = new Map<string, ReturnType<typeof serializeOrder>>();

    for (const d of byUserRes.data || []) map.set(d.id, serializeOrder(d));

    if (accountCreatedMs > 0) {
      for (const d of [...(byPhoneDigitsRes.data || []), ...(byPhoneDisplayRes.data || [])]) {
        if (d.user_id && d.user_id !== uid) continue;
        if (d.user_id === uid) { map.set(d.id, serializeOrder(d)); continue; }
        if (d.user_id) continue;
        const orderMs = new Date(toIso(d.created_at) || 0).getTime();
        if (orderMs + 60_000 < accountCreatedMs) continue;
        if (!map.has(d.id)) map.set(d.id, serializeOrder(d));
      }
    }

    const results = Array.from(map.values());
    results.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Cabinet API Error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
