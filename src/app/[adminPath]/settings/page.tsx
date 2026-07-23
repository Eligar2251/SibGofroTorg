// =========================================================
// FILE: src/app/[adminPath]/settings/page.tsx
// =========================================================

import { getSettings } from "@/lib/supabase-queries";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { MigrationButton } from "@/components/admin/MigrationButton";
import { ExcelDataManager } from "@/components/admin/ExcelDataManager";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
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
          Миграция данных
        </h2>
        <p style={{ color: "#6b7280", marginBottom: "1rem", fontSize: "0.875rem" }}>
          Перенос всех данных из Firestore в Supabase (PostgreSQL).
          Используйте при первичном переходе или для синхронизации.
        </p>
        <MigrationButton />
      </div>
    </div>
  );
}
