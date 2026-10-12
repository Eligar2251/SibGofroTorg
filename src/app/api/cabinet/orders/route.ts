// =========================================================
// FILE: src/app/api/cabinet/orders/route.ts
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

    // Показываем все заявки пользователя, включая завершённые.
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
