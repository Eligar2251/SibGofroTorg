// =========================================================
// FILE: src/app/api/admin/user-orders/route.ts
// «Кабинет клиента глазами клиента» для админки.
//
// Отдаёт заявки конкретного пользователя ровно той же функцией, что и
// /api/cabinet/orders, поэтому проверка синхронизации осмысленна: если
// менеджер отметил товар выданным, здесь он обязан увидеть «Выдан» —
// именно это и увидит клиент.
//
// Два правила, без которых экран «показывает не все заявки»:
// 1) список ищется НА СЕРВЕРЕ по всей таблице users, а не по первым 300
//    клиентам — иначе клиент из архива просто не находится, и менеджер
//    делает вывод, что у него «нет заявок»;
// 2) срез любой выборки ограничен сверху (потолок PostgREST), поэтому
//    вместе с данными всегда отдаём truncated/approx — экран обязан
//    сказать, что список мог быть обрезан, а не молчать.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { normalizePhone } from "@/lib/user-auth";
import { getAdminDb } from "@/lib/supabase";
import {
  CABINET_QUERY_LIMIT,
  getCabinetOrdersDetailed,
  toIso,
} from "@/lib/cabinet-orders";

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
  /** Счётчик мог быть обрезан потолком выборки — цифра тогда нижняя граница. */
  ordersCountApprox?: boolean;
}

/** Сколько клиентов показываем в списке (свежие сверху). */
const USERS_PAGE_SIZE = 300;
/** Сколько id в одном `.in(...)` — чтобы не упереться в потолок строк на запрос. */
const COUNT_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const userId = String(params.get("userId") || "").trim();
  const rawQuery = String(params.get("q") || "").trim();
  const query = rawQuery.toLowerCase();

  try {
    const db = getAdminDb();

    // ── Один пользователь: полный кабинет ──
    if (userId) {
      const { data: row, error: userError } = await db
        .from("users")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (userError) throw userError;
      if (!row) {
        return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
      }
      // forAdmin: показываем и заявки других аккаунтов с тем же телефоном —
      // их клиент видит у себя, значит и здесь они обязаны быть.
      const { orders, capped } = await getCabinetOrdersDetailed({
        userId: row.id,
        phone: row.phone ?? row.phone_digits ?? null,
        accountCreatedAt: row.created_at,
        forAdmin: true,
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
        truncated: capped,
        limit: CABINET_QUERY_LIMIT,
      });
    }

    // ── Список клиентов для выбора ──
    const selectUsers = (orExpr?: string) => {
      let q = db
        .from("users")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(USERS_PAGE_SIZE);
      if (orExpr) q = q.or(orExpr);
      return q;
    };

    // Поиск серверный: `ilike` по списку полей. Запятые/скобки ломают
    // синтаксис PostgREST, поэтому для таких строк откатываемся на прежний
    // вариант «первые N + фильтр на клиенте».
    const orExpr =
      rawQuery && !/[%,()"']/.test(rawQuery)
        ? [
            `name.ilike.%${rawQuery}%`,
            `phone.ilike.%${rawQuery}%`,
            `email.ilike.%${rawQuery}%`,
            `username.ilike.%${rawQuery}%`,
            `company_name.ilike.%${rawQuery}%`,
          ].join(",")
        : undefined;

    let usersRes: any = null;
    const serverSearch = Boolean(orExpr);
    if (orExpr) {
      usersRes = await selectUsers(orExpr);
      if (usersRes.error) usersRes = null;
    }
    if (!usersRes) usersRes = await selectUsers();
    if (usersRes.error) throw usersRes.error;

    const rows: any[] = usersRes.data || [];
    const users = rows
      .map((row: any) => ({
        row,
        user: {
          id: row.id,
          name: row.name ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          username: row.username ?? null,
          customerType: row.customer_type ?? null,
          companyName: row.company_name ?? null,
          createdAt: toIso(row.created_at),
          ordersCount: 0,
        } satisfies AdminCabinetUser,
      }))
      .filter(({ row }) => {
        // Клиентский фильтр нужен только когда серверный поиск недоступен.
        if (serverSearch || !query) return true;
        return [row.name, row.phone, row.email, row.username, row.company_name]
          .filter(Boolean)
          .some((value: any) => String(value).toLowerCase().includes(query));
      });

    // ── Счётчик заявок ──
    // Раньше считался по «последним 2000 заказам» на всю базу, поэтому у
    // клиента с историей цифра была меньше реальной. Теперь считаем по
    // владельцу и по телефону клиента, чанками, с честным флагом обрезки.
    const counts = new Map<string, Set<string>>();
    let countsTruncated = false;
    const addCount = (uid: string, orderId: string) => {
      let set = counts.get(uid);
      if (!set) {
        set = new Set<string>();
        counts.set(uid, set);
      }
      set.add(orderId);
    };

    const ids = users.map(({ user }) => user.id).filter(Boolean);
    const digitsByUser = new Map<string, string>();
    for (const { row, user } of users) {
      // Те же телефоны, по которым кабинет добирает гостевые заявки, —
      // иначе счётчик и список заявок на экране разойдутся.
      const digits = normalizePhone(String(row.phone_digits || row.phone || ""));
      if (digits) digitsByUser.set(user.id, digits);
    }

    for (const part of chunk(ids, COUNT_CHUNK)) {
      const { data, count, error } = await db
        .from("orders")
        .select("id, user_id", { count: "exact" })
        .in("user_id", part);
      if (error) throw error;
      const list = data || [];
      if (typeof count === "number" && count > list.length) countsTruncated = true;
      for (const order of list) {
        if (order.user_id) addCount(order.user_id, order.id);
      }
    }

    const digits = Array.from(new Set(digitsByUser.values()));
    const usersByDigit = new Map<string, string[]>();
    for (const [uid, digitsOfUser] of digitsByUser) {
      const list = usersByDigit.get(digitsOfUser) || [];
      list.push(uid);
      usersByDigit.set(digitsOfUser, list);
    }

    for (const part of chunk(digits, COUNT_CHUNK)) {
      const { data, count, error } = await db
        .from("orders")
        .select("id, user_id, customer_phone_digits", { count: "exact" })
        .in("customer_phone_digits", part);
      if (error) throw error;
      const list = data || [];
      if (typeof count === "number" && count > list.length) countsTruncated = true;
      for (const order of list) {
        const owners = usersByDigit.get(order.customer_phone_digits) || [];
        for (const uid of owners) {
          // Своя заявка уже посчитана по владельцу; по телефону берём только
          // гостевые и заявки «чужих» аккаунтов с этим номером — ровно те,
          // что попадают в кабинет.
          if (uid === order.user_id) continue;
          addCount(uid, order.id);
        }
      }
    }

    const total =
      typeof usersRes.count === "number" ? usersRes.count : rows.length;

    return NextResponse.json({
      users: users.map(({ user }) => ({
        ...user,
        ordersCount: counts.get(user.id)?.size ?? 0,
        ordersCountApprox: countsTruncated,
      })),
      total,
      pageSize: USERS_PAGE_SIZE,
      // Список обрезан: клиента, которого здесь нет, надо искать поиском
      // (он ходит по всей таблице), а не делать вывод «заявок нет».
      truncated: total > rows.length,
      serverSearch,
    });
  } catch (error) {
    console.error("Admin user-orders error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
