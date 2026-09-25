// =========================================================
// FILE: src/app/[adminPath]/profit-report/page.tsx
// Расчёт выгоды продажи товаров за период.
//
// Тянем товары (с закупочной ценой) и продажи из учёта (customer_deals),
// агрегируем по каждому товару список продаж (кому / когда / сколько / по
// какой цене). Дальше всё считает и полностью редактирует клиентский
// компонент ProfitReportClient (цены производства/конкурента задаются один
// раз на позицию, любые суммы можно переопределить вручную, печать A4).
// =========================================================

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getProducts } from "@/lib/supabase-queries";
import { getDeals } from "@/lib/warehouse";
import {
  ProfitReportClient,
  type ProfitProduct,
  type ProfitSale,
} from "@/components/admin/ProfitReportClient";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";
export const dynamic = "force-dynamic";

export default async function ProfitReportPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [products, deals] = await Promise.all([
    getProducts({ includeHidden: true }).catch(() => []),
    getDeals().catch(() => []),
  ]);

  // Копилка продаж по productId. Ключ отсутствующих в каталоге товаров —
  // синтетический (name), чтобы архивные/удалённые позиции тоже попали.
  const salesByProduct = new Map<string, ProfitSale[]>();
  const nameFallback = new Map<string, { name: string; sku: string | null }>();

  for (const deal of deals) {
    // Хознужды (списание на себя) — это не продажа, пропускаем.
    if (deal.isInternal) continue;
    // Отменённые сделки в выручку не идут.
    if (deal.status === "cancelled") continue;
    const items = Array.isArray(deal.items) ? deal.items : [];
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) continue;
      const price = Number(it.price) || 0;
      const lineTotal =
        it.lineTotal != null ? Number(it.lineTotal) : qty * price;
      const key = it.productId || `name:${(it.name || "").toLowerCase()}`;
      if (!salesByProduct.has(key)) salesByProduct.set(key, []);
      salesByProduct.get(key)!.push({
        dealNumber: deal.number,
        date: String(deal.date || "").slice(0, 10),
        customer: deal.customerName || "—",
        qty,
        price,
        total: lineTotal,
        status: deal.status,
        isArchive: Boolean(deal.isArchive),
      });
      if (!nameFallback.has(key)) {
        nameFallback.set(key, {
          name: it.name || "Без названия",
          sku: it.sku ?? null,
        });
      }
    }
  }

  const rows: ProfitProduct[] = [];
  const usedKeys = new Set<string>();

  for (const p of products) {
    const key = p.id;
    const sales = salesByProduct.get(key) || [];
    usedKeys.add(key);
    rows.push({
      id: p.id,
      name: p.name,
      sku: p.sku ?? null,
      price: p.price ?? null,
      priceWholesale: p.priceWholesale ?? null,
      purchasePrice: p.purchasePrice ?? null,
      sales: sales.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  // Товары, которых уже нет в каталоге, но по ним были продажи.
  for (const [key, sales] of salesByProduct) {
    if (usedKeys.has(key)) continue;
    const meta = nameFallback.get(key);
    rows.push({
      id: key,
      name: meta?.name || "Без названия",
      sku: meta?.sku ?? null,
      price: null,
      priceWholesale: null,
      purchasePrice: null,
      sales: sales.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  // Сначала товары с продажами, дальше — по названию.
  rows.sort((a, b) => {
    const av = a.sales.length > 0 ? 0 : 1;
    const bv = b.sales.length > 0 ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.name.localeCompare(b.name, "ru");
  });

  return (
    <div className="admin-stack">
      <div className="admin-page-head no-print">
        <div>
          <h1 className="admin-h1">Выгода продаж — расчёт и печать A4</h1>
          <p className="admin-sub">
            Выберите товары, за период подтянется проданное количество и
            продажи (кому, когда, на какую сумму). Задайте цену производства
            (Мы) и цену закупки у конкурента — по одному разу на позицию.
            Считается прибыль с нашего производства и выгода в сравнении с
            закупкой у конкурента. Любую сумму, включая итоги, можно
            отредактировать вручную. Готовую сводку можно распечатать на A4.
          </p>
        </div>
        <div className="admin-page-head__actions">
          <Link
            href={`/${ADMIN_PATH}/products`}
            className="admin-btn admin-btn--ghost"
          >
            <ArrowLeft size={15} /> К товарам
          </Link>
        </div>
      </div>

      <ProfitReportClient products={rows} />
    </div>
  );
}
