// src/app/[adminPath]/die-calc/page.tsx — калькулятор штанцформы (развертка, 3D, лист, цена)
//
// Зачем в админке: это внутренний инструмент технолога/менеджера — по внутренним
// размерам коробки он строит развертку ВЫРЕЗАНОЙ заготовки, сборку в 3D, раскладку
// по листу, длины ножей и стоимость штампа с тиражом. Публичной страницы нет.
//
// Расчёт живёт в src/lib/die-calc (чистый TypeScript, без БД и без Supabase) и
// в src/components/admin/die-calc (React). Источники — tools/die-calc, синхронизация
// `node tools/die-calc/scripts/sync-site.mjs` (там же тесты и сверка с эталонными
// чертежами: npm test && npm run check). Размеры, коэффициенты и цены администратор
// хранит у себя в localStorage; если понадобится общий прайс — сохраняйте
// resultJson(res) в jsonb и считайте тем же ядром на сервере.

import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { DieCalc } from "@/components/admin/die-calc/DieCalc";

const ADMIN_PATH = process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Штанцформа — калькулятор — СибГофроТорг",
};

export default async function AdminDieCalcPage({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) notFound();

  const session = await verifySession();
  if (!session) notFound();

  return (
    <DieCalc
      title="Калькулятор штанцформы"
      subtitle="Развертка вырезанной заготовки, сборка, лист, ножи, цена"
    />
  );
}
