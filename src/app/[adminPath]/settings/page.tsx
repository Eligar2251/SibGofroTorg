// =========================================================
// FILE: src/app/[adminPath]/settings/page.tsx
// =========================================================

import { getSettings } from "@/lib/firestore-queries";
import { SettingsForm } from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const settings = await getSettings();

  const settingsMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    settingsMap[key] = value != null ? String(value) : "";
  }

  return (
    <div>
      <h1 className="admin-h1">Настройки</h1>
      <SettingsForm settings={settingsMap} />
    </div>
  );
}