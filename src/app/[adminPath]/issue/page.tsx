// src/app/[adminPath]/issue/page.tsx — вкладка «Выдача товара»

import { OrderIssueClient } from "@/components/admin/OrderIssueClient";

export const dynamic = "force-dynamic";

export default function AdminIssuePage() {
  return <OrderIssueClient />;
}
