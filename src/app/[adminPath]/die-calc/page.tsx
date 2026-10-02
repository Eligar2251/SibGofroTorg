// src/app/[adminPath]/die-calc/page.tsx — калькулятор штанцформы (упрощённый)
//
// Ввод: тип коробки, L, W, H  →  размер заготовки, площадь, раскладка по листу.
// Обучение на реальных данных (чертежах матриц), которые пользователь вводит сам.

import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth";
import { canAccessAdminPage } from "@/lib/admin-rbac";
import { SimpleDieCalc } from "@/components/admin/die-calc/SimpleDieCalc";

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
  if (!canAccessAdminPage(session.role, `/${adminPath}/die-calc`, adminPath)) notFound();

  return <SimpleDieCalc />;
}
