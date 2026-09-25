// =========================================================
// FILE: src/app/profit-report-preview/page.tsx
// ВРЕМЕННЫЙ предпросмотр раздела «Выгода продаж» на моковых данных
// (без БД и без авторизации админки). В production маршрут 404.
// Реальный раздел живёт по адресу /<admin>/profit-report.
// =========================================================

import { notFound } from "next/navigation";
import {
  ProfitReportClient,
  type ProfitProduct,
} from "@/components/admin/ProfitReportClient";
// Стили админки нужны, чтобы карточки/кнопки выглядели как в панели.
import "../admin.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Предпросмотр — Выгода продаж" };

const DEMO_PRODUCTS: ProfitProduct[] = [
  {
    id: "demo-1",
    name: "Гофрокороб 400×300×300, Т-23 бурый",
    sku: "GK-403033",
    price: 42,
    priceWholesale: 36,
    purchasePrice: 21,
    sales: [
      { dealNumber: 101, date: "2026-09-03", customer: "ООО «Пекарь»", qty: 500, price: 40, total: 20000, status: "completed", isArchive: false },
      { dealNumber: 108, date: "2026-09-11", customer: "ИП Смирнов А.В.", qty: 300, price: 42, total: 12600, status: "completed", isArchive: false },
      { dealNumber: 121, date: "2026-09-20", customer: "Маркетплейс-Сервис", qty: 700, price: 39, total: 27300, status: "completed", isArchive: false },
    ],
  },
  {
    id: "demo-2",
    name: "Короб для маркетплейсов 310×230×105",
    sku: "MP-312310",
    price: 28,
    priceWholesale: 24,
    purchasePrice: 15,
    sales: [
      { dealNumber: 104, date: "2026-09-05", customer: "WB-поставщик (ИП Котов)", qty: 1200, price: 26, total: 31200, status: "completed", isArchive: false },
      { dealNumber: 130, date: "2026-09-24", customer: "ООО «Озон-Логистик»", qty: 800, price: 27, total: 21600, status: "completed", isArchive: false },
    ],
  },
  {
    id: "demo-3",
    name: "Овощной ящик №1, 590×390×190",
    sku: "OV-590391",
    price: 65,
    priceWholesale: 58,
    purchasePrice: 34,
    sales: [
      { dealNumber: 112, date: "2026-09-14", customer: "Тепличный к-т «Сибирь»", qty: 450, price: 62, total: 27900, status: "completed", isArchive: false },
      { dealNumber: 127, date: "2026-09-22", customer: "База «Овощторг»", qty: 250, price: 65, total: 16250, status: "completed", isArchive: false },
    ],
  },
];

export default function ProfitReportPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px" }}>
      <div className="no-print" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>
          Выгода продаж — предпросмотр (демо-данные)
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "6px 0 0" }}>
          Это временная страница для оценки интерфейса без базы данных. Рабочий
          раздел находится в админке: «Выгода продаж».
        </p>
      </div>
      <ProfitReportClient
        products={DEMO_PRODUCTS}
        storageKey="profit-report-preview-v1"
        demo
      />
    </div>
  );
}
