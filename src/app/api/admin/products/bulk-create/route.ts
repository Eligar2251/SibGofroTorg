// =========================================================
// FILE: src/app/api/admin/products/bulk-create/route.ts
// Массовое СОЗДАНИЕ новых товаров (минимальный набор полей:
// название, артикул, цена, размеры, остаток). Остальное админ
// доредактирует в массовом редактировании.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createProduct, getProducts } from "@/lib/supabase-queries";
import { logAdminAction } from "@/lib/activity-log";

interface BulkCreateItem {
  name: string;
  sku?: string | null;
  price?: number | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  stockQty?: number | null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", ".").replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const items: BulkCreateItem[] = Array.isArray(body?.products)
      ? body.products
      : [];

    const rows = items
      .map((r) => ({
        name: String(r?.name || "").trim(),
        sku: String(r?.sku || "").trim(),
        price: toNum(r?.price),
        dimensionLength: toNum(r?.dimensionLength),
        dimensionWidth: toNum(r?.dimensionWidth),
        dimensionHeight: toNum(r?.dimensionHeight),
        stockQty: toNum(r?.stockQty),
      }))
      .filter((r) => r.name);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Нет строк с названием товара" },
        { status: 400 }
      );
    }
    if (rows.length > 500) {
      return NextResponse.json(
        { error: "За один раз можно создать не более 500 товаров" },
        { status: 400 }
      );
    }

    // Уже занятые артикулы: не создаём дубли, сообщаем построчно.
    const existing = await getProducts({ includeHidden: true });
    const usedSkus = new Map<string, string>();
    for (const p of existing) {
      const sku = (p.sku || "").trim().toLocaleLowerCase("ru-RU");
      if (sku) usedSkus.set(sku, p.name);
    }

    let created = 0;
    const errors: { row: number; name: string; error: string }[] = [];
    const batchSkus = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const skuLower = r.sku.toLocaleLowerCase("ru-RU");
      try {
        if (skuLower && usedSkus.has(skuLower)) {
          throw new Error(
            `артикул «${r.sku}» уже у товара «${usedSkus.get(skuLower)}»`
          );
        }
        if (skuLower && batchSkus.has(skuLower)) {
          throw new Error(`артикул «${r.sku}» повторяется в списке`);
        }
        await createProduct({
          name: r.name,
          sku: r.sku || null,
          price: r.price,
          dimensionLength: r.dimensionLength,
          dimensionWidth: r.dimensionWidth,
          dimensionHeight: r.dimensionHeight,
          dimensionUnit: "мм",
          stockQty: r.stockQty,
          inStock: (r.stockQty ?? 0) > 0,
          // Остальные поля админ заполнит позже в массовом
          // редактировании. Штрихкод создаётся автоматически.
          isVisible: true,
        });
        if (skuLower) batchSkus.add(skuLower);
        created++;
      } catch (e: any) {
        errors.push({
          row: i + 1,
          name: r.name,
          error: e?.message ? String(e.message).slice(0, 200) : "Ошибка создания",
        });
      }
    }

    await logAdminAction(
      auth.displayName,
      auth.role,
      "bulk_update",
      "product",
      "",
      `Массовое добавление товаров: создано ${created} из ${rows.length}`,
      { created, errors: errors.length }
    );

    return NextResponse.json({ created, total: rows.length, errors });
  } catch (error: any) {
    console.error("Bulk create products error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
