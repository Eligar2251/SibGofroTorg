// =========================================================
// FILE: src/app/api/cabinet/orders/route.ts
// =========================================================

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import {
  requireUserApi,
  formatPhoneDisplay,
  normalizePhone,
  getUserById,
} from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw?.toDate === "function") return raw.toDate().toISOString();
  if (raw._seconds != null) return new Date(raw._seconds * 1000).toISOString();
  if (raw.seconds != null) return new Date(raw.seconds * 1000).toISOString();
  if (typeof raw === "string") return raw;
  return null;
}

function serializeOrder(id: string, data: Record<string, any>) {
  return {
    id,
    type: data.type,
    status: data.status,
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    customerEmail: data.customerEmail ?? null,
    communicationChannel: data.communicationChannel,
    paymentMethod: data.paymentMethod ?? null,
    items: data.items ?? null,
    totalSum: data.totalSum ?? null,
    productInfo: data.productInfo ?? null,
    quantity: data.quantity ?? null,
    comment: data.comment ?? null,
    companyName: data.companyName ?? null,
    inn: data.inn ?? null,
    kpp: data.kpp ?? null,
    ogrn: data.ogrn ?? null,
    legalAddress: data.legalAddress ?? null,
    actualAddress: data.actualAddress ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
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
    const accountCreatedMs = user?.createdAt
      ? new Date(toIso(user.createdAt) || 0).getTime()
      : 0;

    const [byUserSnap, byPhoneDigitsSnap, byPhoneDisplaySnap] =
      await Promise.all([
        db.collection("orders").where("userId", "==", uid).get(),
        db
          .collection("orders")
          .where("customerPhoneDigits", "==", phoneDigits)
          .get(),
        db
          .collection("orders")
          .where("customerPhone", "==", phoneDisplay)
          .get(),
      ]);

    const map = new Map<string, ReturnType<typeof serializeOrder>>();

    // 1) Всегда: заказы, явно привязанные к аккаунту
    for (const d of byUserSnap.docs) {
      map.set(d.id, serializeOrder(d.id, d.data()));
    }

    // 2) Legacy по телефону — только при известной дате регистрации
    if (accountCreatedMs > 0) {
      for (const d of [...byPhoneDigitsSnap.docs, ...byPhoneDisplaySnap.docs]) {
        const data = d.data();

        if (data.userId && data.userId !== uid) continue;

        if (data.userId === uid) {
          map.set(d.id, serializeOrder(d.id, data));
          continue;
        }

        // нет userId
        if (data.userId) continue;

        const orderMs = new Date(toIso(data.createdAt) || 0).getTime();
        if (orderMs + 60_000 < accountCreatedMs) continue;

        if (!map.has(d.id)) {
          map.set(d.id, serializeOrder(d.id, data));
        }
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