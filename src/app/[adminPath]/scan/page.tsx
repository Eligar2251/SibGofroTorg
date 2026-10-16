// =========================================================
// FILE: src/app/[adminPath]/scan/page.tsx
// Основной экран сканера: камера + ручной ввод + карточка результата
// прямо под сканером, без перехода на отдельную страницу.
// =========================================================

import { ScanCode } from "@/components/admin/ScanCode";
import { ADMIN_PATH } from "@/lib/admin-path";


export const dynamic = "force-dynamic";
export const metadata = { title: "Сканер товара — СибГофроТорг" };

export default function ScanEntryPage() {
  return <ScanCode adminPath={ADMIN_PATH} initialCode="" />;
}
