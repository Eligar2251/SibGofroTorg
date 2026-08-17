// =========================================================
// FILE: src/app/[adminPath]/settings/page.tsx
// =========================================================

import { getSettings } from "@/lib/supabase-queries";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { ExcelDataManager } from "@/components/admin/ExcelDataManager";
import { AdminUsersManager } from "@/components/admin/AdminUsersManager";
import { ThemeCustomizer } from "@/components/admin/AdminTheme";
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

      <div className="admin-card" style={{ marginBottom: "1.5rem" }}>
        <div className="admin-card__head">
          <h2 className="admin-card__title">🎨 Кастомизация оформления админ-панели</h2>
        </div>
        <div className="admin-card__pad">
          <p className="admin-muted" style={{ marginBottom: 12 }}>
            Единый центр оформления: цветовая схема (12 тем, включая тёмные),
            расположение навигации, стиль элементов, плотность интерфейса,
            анимации и эффект стекла. Изменения применяются мгновенно и
            сохраняются в вашем браузере — переключатель темы из сайдбара
            переехал сюда.
          </p>
          <ThemeCustomizer />
        </div>
      </div>

      <AdminUsersManager />

      <div className="admin-settings-section">
        <SettingsForm settings={settingsMap} adminPath={ADMIN_PATH} />
      </div>

      <div style={{ marginTop: "2.5rem" }}>
        <ExcelDataManager />
      </div>
    </div>
  );
}
