// =========================================================
// FILE: src/app/[adminPath]/settings/page.tsx
// =========================================================

import { getSettings } from "@/lib/supabase-queries";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { ExcelDataManager } from "@/components/admin/ExcelDataManager";
import { ActivityLogs } from "@/components/admin/ActivityLogs";
import { redirect } from "next/navigation";
import { hasPermission, verifySession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export default async function AdminSettingsPage() {
  const session = await verifySession();
  if (!session || !hasPermission(session, "view_settings")) {
    redirect(`/${ADMIN_PATH}`);
  }

  const settings = await getSettings();

  const settingsMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings || {})) {
    settingsMap[key] = value != null ? String(value) : "";
  }

  return (
    <div>
      <h1 className="admin-h1">Настройки</h1>
      <SettingsForm settings={settingsMap} />

      <div style={{ marginTop: "2.5rem" }}>
        <ExcelDataManager />
      </div>

      <div style={{ marginTop: "3rem", borderTop: "2px solid #e5e7eb", paddingTop: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
          📋 Журнал действий
        </h2>
        <p style={{ color: "#6b7280", marginBottom: "1rem", fontSize: "0.875rem" }}>
          Кто, когда и что сделал в админ-панели: пользователь, действие, объект, время, IP и технические детали. Журнал обновляется автоматически.
        </p>
        <ActivityLogs adminPath={ADMIN_PATH} />
      </div>

    </div>
  );
}
