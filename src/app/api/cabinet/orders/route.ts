// =========================================================
// FILE: src/app/api/cabinet/orders/route.ts
//
// Выборка и сериализация живут в @/lib/cabinet-orders: тот же код
// использует админский просмотр кабинета клиента, поэтому менеджер
// физически не может увидеть картинку, отличную от клиентской.
// =========================================================
import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/user-auth";
import { getUserById } from "@/lib/user-auth";
import { getCabinetOrdersForUser } from "@/lib/cabinet-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireUserApi();
    if (auth instanceof NextResponse) return auth;

    const { uid, phone } = auth;
    const user = await getUserById(uid);

    // Прямая связь со статусами сайта: показываем ВСЕ заявки, включая
    // отменённые («Отменён») и проведённые («Выполнен»), — клиент видит
    // ровно то, что видит менеджер на странице заявок.
    const results = await getCabinetOrdersForUser({
      userId: uid,
      phone,
      accountCreatedAt: user?.createdAt ?? null,
    });

    return NextResponse.json(results);
  } catch (error) {
    console.error("Cabinet API Error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
