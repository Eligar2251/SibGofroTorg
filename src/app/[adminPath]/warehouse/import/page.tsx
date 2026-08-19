// =========================================================
// FILE: src/app/[adminPath]/warehouse/import/page.tsx
// Массовая загрузка старых проведённых заказов контрагентов.
// =========================================================

import { notFound } from "next/navigation";
import { getWarehouseStock, getCounterparties } from "@/lib/warehouse";
import { BulkDealImporter } from "@/components/admin/BulkDealImporter";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export default async function WarehouseImportPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const [stock, counterpartyRows] = await Promise.all([
    getWarehouseStock().catch(() => []),
    getCounterparties().catch(() => []),
  ]);

  const pickerProducts: PickerProduct[] = stock.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    price: p.price,
    priceWholesale: p.priceWholesale,
    purchasePrice: (p as any).purchasePrice ?? null,
    stockQty: p.stockQty,
    isCuttable: (p as any).isCuttable ?? false,
    cutMetersPerRoll: (p as any).cutMetersPerRoll ?? null,
    cutPricePerMeter: (p as any).cutPricePerMeter ?? null,
    cutUnitName: (p as any).cutUnitName || "м",
  }));

  const counterpartyOptions: CounterpartyOption[] = counterpartyRows.map(
    (item) => ({
      id: item.id,
      name: item.name,
      roles: item.roles,
      supplierPrices: item.supplierPrices ?? {},
      phone: item.phone ?? null,
      email: item.email ?? null,
      inn: item.inn ?? null,
      kpp: item.kpp ?? null,
      ogrn: item.ogrn ?? null,
      fullName: item.fullName ?? null,
      shortName: item.shortName ?? null,
      legalAddress: item.legalAddress ?? null,
      taxSystem: item.taxSystem ?? null,
      bankAccount: item.bankAccount ?? null,
      bankName: item.bankName ?? null,
      bik: item.bik ?? null,
      correspondentAccount: item.correspondentAccount ?? null,
      address: item.address ?? null,
      contactName: item.contactName ?? null,
      comment: item.comment ?? null,
    })
  );

  return (
    <BulkDealImporter
      products={pickerProducts}
      counterparties={counterpartyOptions}
      adminPath={ADMIN_PATH}
    />
  );
}
