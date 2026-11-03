// =========================================================
// FILE: src/app/api/admin/warehouse/assemblies/route.ts
// API комплектации номенклатуры (1С): список документов КМП-…,
// цены последних приходов поставщиков и проведение новой комплектации
// с автопоставкой ПО-… от «СибГофроТорг».
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import {
  createWarehouseAssembly,
  getLatestSupplierReceiptPrices,
  getWarehouseAssemblies,
} from "@/lib/warehouse-assembly-store";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const [assemblies, latestSupplierPrices] = await Promise.all([
      getWarehouseAssemblies(),
      getLatestSupplierReceiptPrices(),
    ]);
    return NextResponse.json({ assemblies, latestSupplierPrices });
  } catch (e: any) {
    console.error("[warehouse/assemblies GET]", e);
    return NextResponse.json(
      { error: e?.message || "Не удалось загрузить комплектации" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();

    // Поддерживаем как компактный формат (spentProductId/spentQty + producedProductId/producedQty),
    // так и табличный массив spent[] / produced[] (включая пользовательскую цену unitPrice).
    const spent = Array.isArray(body?.spent)
      ? body.spent
      : body?.spentProductId
        ? [
            {
              productId: String(body.spentProductId),
              quantity: Number(body.spentQty || 0),
            },
          ]
        : [];

    const produced = Array.isArray(body?.produced)
      ? body.produced
      : body?.producedProductId
        ? [
            {
              productId: String(body.producedProductId),
              quantity: Number(body.producedQty || 0),
              ...(body?.producedUnitPrice !== undefined &&
              body?.producedUnitPrice !== null &&
              String(body.producedUnitPrice).trim() !== ""
                ? { unitPrice: Number(body.producedUnitPrice) }
                : {}),
            },
          ]
        : [];

    const created = await createWarehouseAssembly({
      kind: body?.kind === "disassembly" ? "disassembly" : "assembly",
      date: body?.date ? String(body.date) : null,
      spent,
      produced,
      surchargeRub:
        body?.surchargeRub !== undefined && body?.surchargeRub !== null
          ? Number(body.surchargeRub)
          : undefined,
      updatePurchasePrice: body?.updatePurchasePrice !== false,
      createSupplierReceipt: body?.createSupplierReceipt !== false,
      allowNegativeStock: body?.allowNegativeStock === true,
      comment: body?.comment ?? null,
      createdBy: auth.displayName || auth.username || null,
    });

    const spentSummary = created.spentItems
      .map((i) => `${i.name} (−${i.quantity} шт.)`)
      .join(", ");
    const producedSummary = created.producedItems
      .map(
        (i) =>
          `${i.name} (+${i.quantity} шт.${
            i.unitCost != null ? ` по ${i.unitCost} ₽` : ""
          })`
      )
      .join(", ");
    const receiptLabel = created.linkedReceiptNumber
      ? ` · ПО-${created.linkedReceiptNumber} (СибГофроТорг)`
      : "";

    await logActivity({
      adminName: auth.displayName || auth.username || "Администратор",
      adminRole: auth.role || "admin",
      action: "post",
      entityType: "assembly",
      entityId: created.id,
      entityLabel: `${
        created.kind === "disassembly" ? "Разукомплектация" : "Комплектация"
      } КМП-${created.number}: ${spentSummary} → ${producedSummary}${receiptLabel}`,
      details: {
        number: created.number,
        kind: created.kind,
        spentItems: created.spentItems,
        producedItems: created.producedItems,
        totalCost: created.totalCost,
        producedTotalCost: created.producedTotalCost,
        linkedReceiptId: created.linkedReceiptId,
        linkedReceiptNumber: created.linkedReceiptNumber,
        updatePurchasePrice: created.updatePurchasePrice,
      },
    });

    return NextResponse.json({ ok: true, assembly: created });
  } catch (e: any) {
    console.error("[warehouse/assemblies POST]", e);
    return NextResponse.json(
      { error: e?.message || "Ошибка проведения комплектации" },
      { status: 400 }
    );
  }
}
