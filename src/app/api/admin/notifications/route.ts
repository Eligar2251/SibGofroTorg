// src/app/api/admin/notifications/route.ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { getRentInvoices, getRentTenants } from "@/lib/rent";
import {
  rentInvoiceState,
  rentTodayIso,
  rentDaysBetween,
  type RentInvoice,
  type RentTenant,
} from "@/lib/rent-shared";

export const dynamic = "force-dynamic";

type AdminNotification = {
  id: string;
  type: "order" | "stock" | "unpaid_released" | "rent";
  severity: "danger" | "warning" | "info";
  title: string;
  description: string;
  href: string;
  createdAt?: string | null;
};

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

function toIso(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (raw instanceof Date) return raw.toISOString();
  return null;
}

function fmtRub(value: unknown): string {
  return `${(Number(value) || 0).toLocaleString("ru-RU")} ₽`;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const db = getAdminDb();

    const [ordersRes, wasteRes, productsRes, dealsRes, paymentsRes] = await Promise.all([
      db
        .from("orders")
        .select("id,type,customer_name,total_sum,product_info,created_at")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("wastepaper_requests")
        .select("id,customer_name,wastepaper_type,weight,estimated_payout,created_at")
        .eq("status", "new")
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("products")
        .select("id,name,sku,stock_qty,stock_warn_qty,is_visible")
        .neq("is_visible", false)
        .limit(1000),
      db
        .from("customer_deals")
        .select("id,number,date,customer_name,total,status,created_at")
        .eq("status", "completed")
        .order("date", { ascending: false })
        .limit(300),
      db
        .from("bank_payments")
        .select("id,direction,deal_ids,amount,is_paid,exclude_from_balance")
        .eq("direction", "incoming")
        .eq("is_paid", true)
        .limit(2000),
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (wasteRes.error) throw wasteRes.error;
    if (productsRes.error) throw productsRes.error;
    if (dealsRes.error) throw dealsRes.error;
    if (paymentsRes.error) throw paymentsRes.error;

    const notifications: AdminNotification[] = [];

    for (const order of ordersRes.data || []) {
      notifications.push({
        id: `order-${order.id}`,
        type: "order",
        severity: "warning",
        title: order.type === "inquiry" ? "Новая заявка на уточнение" : "Новая заявка с сайта",
        description:
          order.type === "inquiry"
            ? `${order.customer_name || "Клиент"}: ${order.product_info || "уточнение по товару"}`
            : `${order.customer_name || "Клиент"}${order.total_sum ? ` · ${fmtRub(order.total_sum)}` : ""}`,
        href: `/${ADMIN_PATH}/orders?status=new&q=${encodeURIComponent(order.id)}`,
        createdAt: toIso(order.created_at),
      });
    }

    for (const request of wasteRes.data || []) {
      notifications.push({
        id: `waste-${request.id}`,
        type: "order",
        severity: "warning",
        title: "Новая заявка на макулатуру",
        description: `${request.customer_name || "Клиент"}: ${request.wastepaper_type || "макулатура"}${request.weight ? ` · ${request.weight} кг` : ""}`,
        href: `/${ADMIN_PATH}/orders?status=new&q=${encodeURIComponent(request.id)}`,
        createdAt: toIso(request.created_at),
      });
    }

    for (const product of productsRes.data || []) {
      const qty = Number(product.stock_qty) || 0;
      const warn = product.stock_warn_qty != null ? Number(product.stock_warn_qty) : 10;
      if (qty > warn) continue;
      notifications.push({
        id: `stock-${product.id}`,
        type: "stock",
        severity: qty <= 0 ? "danger" : "warning",
        title: qty <= 0 ? "Товар закончился" : "Товар скоро закончится",
        description: `${product.name || "Товар"}${product.sku ? ` · арт. ${product.sku}` : ""} · остаток ${qty} шт.`,
        href: `/${ADMIN_PATH}/warehouse?tab=stock&product=${encodeURIComponent(product.id)}`,
      });
    }

    const paidByDeal = new Map<string, number>();
    for (const payment of paymentsRes.data || []) {
      // Платёж «вне баланса» не влияет на банк, но закрывает документ.
      // Поэтому для уведомления «отпущено без оплаты» учитываем его как оплату.
      const dealIds = Array.isArray(payment.deal_ids) ? payment.deal_ids.map(String) : [];
      if (dealIds.length === 0) continue;
      const share = (Number(payment.amount) || 0) / dealIds.length;
      for (const dealId of dealIds) {
        paidByDeal.set(dealId, (paidByDeal.get(dealId) || 0) + share);
      }
    }

    for (const deal of dealsRes.data || []) {
      const total = Number(deal.total) || 0;
      const paid = paidByDeal.get(String(deal.id)) || 0;
      if (total <= 0 || paid + 0.009 >= total) continue;
      notifications.push({
        id: `unpaid-released-${deal.id}`,
        type: "unpaid_released",
        severity: "danger",
        title: "Отпущен товар без полной оплаты",
        description: `ЗК-${deal.number} · ${deal.customer_name || "Клиент"} · долг ${fmtRub(total - paid)}`,
        href: `/${ADMIN_PATH}/warehouse?tab=deals&deal=${encodeURIComponent(deal.id)}`,
        createdAt: toIso(deal.created_at) || deal.date || null,
      });
    }

    // Напоминания учёта аренды: просрочки (после отсрочки) и оплаты
    // в ближайшие 3 дня. При сбое (миграция не применена) просто
    // пропускаем блок.
    const rentData = await Promise.all([
      getRentTenants().catch(() => null as RentTenant[] | null),
      getRentInvoices().catch(() => null as RentInvoice[] | null),
    ]);
    const [rentTenants, rentInvoices] = rentData;
    if (rentTenants && rentInvoices) {
      const today = rentTodayIso();
      const tenantById = new Map(rentTenants.map((t) => [t.id, t]));
      for (const inv of rentInvoices) {
        if (inv.status !== "awaiting") continue;
        const tenant = tenantById.get(inv.tenantId);
        if (!tenant) continue;
        const state = rentInvoiceState(inv, tenant.deferralDays, today);
        if (state === "overdue") {
          const limitIso = new Date(
            new Date(inv.dueDate).getTime() + tenant.deferralDays * 86_400_000
          )
            .toISOString()
            .slice(0, 10);
          notifications.push({
            id: `rent-overdue-${inv.id}`,
            type: "rent",
            severity: "danger",
            title: "Просрочена оплата аренды",
            description: `${tenant.name}${tenant.office ? ` · ${tenant.office}` : ""} · АР-${inv.number} · ${fmtRub(inv.amount)} · просрочка ${rentDaysBetween(limitIso, today)} дн.`,
            href: `/${ADMIN_PATH}/rent`,
            createdAt: `${today}T00:00:00.000Z`,
          });
        } else if (state === "due_today" || (state === "upcoming" && rentDaysBetween(today, inv.dueDate) <= 3)) {
          notifications.push({
            id: `rent-due-${inv.id}`,
            type: "rent",
            severity: "warning",
            title: state === "due_today" ? "Сегодня оплата аренды" : "Скоро оплата аренды",
            description: `${tenant.name}${tenant.office ? ` · ${tenant.office}` : ""} · АР-${inv.number} · ${fmtRub(inv.amount)}`,
            href: `/${ADMIN_PATH}/rent`,
            createdAt: `${today}T00:00:00.000Z`,
          });
        }
      }
    }

    const bySeverityThenDate = (a: AdminNotification, b: AdminNotification) => {
      const priority = { danger: 2, warning: 1, info: 0 } as const;
      const pa = priority[a.severity];
      const pb = priority[b.severity];
      if (pa !== pb) return pb - pa;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    };

    notifications.sort(bySeverityThenDate);

    // ── ГЛАВНОЕ: заявки клиентов НЕЛЬЗЯ терять при обрезке списка ──
    // Раньше здесь стоял общий `notifications.slice(0, 50)`. Заявки имеют
    // severity "warning", а остатки товаров — "danger", и сортировка ставит
    // danger выше. Стоило накопиться полусотне товаров с низким остатком
    // (а их тысяча в выборке), как ВСЕ новые заявки вылетали за границу
    // первых 50 элементов. Колокольчик заявок фильтрует `items` по
    // type === "order" и получал пустой массив — «уведомления не работают».
    // Теперь заявки выделяются в отдельный, не обрезаемый список.
    const requestItems = notifications.filter((n) => n.type === "order");
    const otherItems = notifications.filter((n) => n.type !== "order");

    const counts = {
      orders: requestItems.length,
      stock: notifications.filter((n) => n.type === "stock").length,
      unpaidReleased: notifications.filter((n) => n.type === "unpaid_released").length,
      rent: notifications.filter((n) => n.type === "rent").length,
    };

    return NextResponse.json({
      total: notifications.length,
      counts,
      // Заявки — целиком (их максимум 100: по 50 из orders и wastepaper),
      // остальное обрезаем, чтобы ответ не разрастался.
      items: [...requestItems, ...otherItems.slice(0, 50)],
      /** Отдельный ключ для колокольчика заявок: не зависит от обрезки. */
      requests: requestItems,
    });
  } catch (error) {
    console.error("Admin notifications error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
