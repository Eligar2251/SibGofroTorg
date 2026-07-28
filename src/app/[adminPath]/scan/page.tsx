// =========================================================
// FILE: src/app/[adminPath]/scan/page.tsx
// Точка входа для сканера: /admin/scan (без [code]).
// Показывает пустую форму поиска + подсказку, какие коды поддерживаются.
// При вводе кода или сканировании — редирект на /admin/scan/[code].
// =========================================================

import { ScanCode } from "@/components/admin/ScanCode";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Сканер товара — СибГофроТорг" };

export default function ScanEntryPage() {
  return <ScanCode adminPath={ADMIN_PATH} initialCode="" />;
}
