// src/app/[adminPath]/print-sheet/page.tsx — редактор печати на А4

import { PrintSheetEditor } from "@/components/admin/PrintSheetEditor";

export const dynamic = "force-dynamic";

export default function AdminPrintSheetPage() {
  return <PrintSheetEditor />;
}
