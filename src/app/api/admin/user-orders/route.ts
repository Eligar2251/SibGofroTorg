// =========================================================
// FILE: src/app/api/admin/user-orders/route.ts
// «Кабинет клиента глазами клиента» для админки.
//
// Отдаёт заявки конкретного пользователя ровно той же функцией, что и
// /api/cabinet/orders, поэтому проверка синхронизации осмысленна: если
// менеджер отметил товар выданным, здесь он обязан увидеть «Выдан» —
// именно это и увидит клиент.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { getCabinetOrdersForUser, toIso } from "@/lib/cabinet-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AdminCabinetUser {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  username: string | null;
  customerType: string | null;
  companyName: string | null;
  createdAt: string | null;
  ordersCount: number;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const userId = String(request.nextUrl.searchParams.get("userId") || "").trim();
  const query = String(request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  try {
    const db = getAdminDb();

    // Один пользователь: полный кабинет.
    if (userId) {
      const { data: row } = await db
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (!row) {
        return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
      }
      const orders = await getCabinetOrdersForUser({
        userId: row.id,
        phone: row.phone ?? row.phone_digits ?? null,
        accountCreatedAt: row.created_at,
      });
      return NextResponse.json({
        user: {
          id: row.id,
          name: row.name ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          username: row.username ?? null,
          customerType: row.customer_type ?? null,
          companyName: row.company_name ?? null,
          createdAt: toIso(row.created_at),
          ordersCount: orders.length,
        } satisfies AdminCabinetUser,
        orders,
      });
    }

    // Список пользователей для выбора. Счётчик заявок считаем по одной
    // выборке заказов, чтобы не делать N запросов на N клиентов.
    const [usersRes, ordersRes] = await Promise.all([
      db.from("users").select("*").order("created_at", { ascending: false }).limit(300),
      db
        .from("orders")
        .select("id, user_id, customer_phone_digits, created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);

    const orders = ordersRes.data || [];
    const users = (usersRes.data || [])
      .map((row: any) => {
        const count = orders.filter(
          (o: any) =>
            o.user_id === row.id ||
            (row.phone_digits && o.customer_phone_digits === row.phone_digits)
        ).length;
        return {
          id: row.id,
          name: row.name ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          username: row.username ?? null,
          customerType: row.customer_type ?? null,
          companyName: row.company_name ?? null,
          createdAt: toIso(row.created_at),
          ordersCount: count,
        } satisfies AdminCabinetUser;
      })
      .filter((u) => {
        if (!query) return true;
        return [u.name, u.phone, u.email, u.username, u.companyName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("Admin user-orders error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
