// =========================================================
// FILE: src/components/admin/rent/RentManager.tsx
// Учёт аренды: оболочка с вкладками.
//   Дашборд   — финансы, просрочки, напоминания (видит и юрист)
//   Арендаторы— договоры, офисы, периоды, отсрочки
//   Начисления— счета за периоды аренды
//   Банк      — отдельный банк аренды (БАУ и ИП Пакин)
// =========================================================

"use client";

import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  FileText,
  Wallet,
  Settings2,
} from "lucide-react";
import type {
  RentInvoice,
  RentOrg,
  RentPayment,
  RentTenant,
} from "@/lib/rent-shared";
import { RentDashboard } from "./RentDashboard";
import { RentTenants } from "./RentTenants";
import { RentInvoices } from "./RentInvoices";
import { RentBank } from "./RentBank";
import { RentOrgSettings } from "./RentOrgSettings";

export type RentMode = "full" | "readonly" | "dashboard";

type RentTab = "dashboard" | "tenants" | "invoices" | "bank";

export function RentManager({
  adminPath,
  mode,
  initialTab,
  orgs,
  tenants,
  invoices,
  payments,
}: {
  adminPath: string;
  mode: RentMode;
  initialTab: string;
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payments: RentPayment[];
}) {
  const readOnly = mode !== "full";
  const allowedTabs: RentTab[] =
    mode === "dashboard"
      ? ["dashboard"]
      : ["dashboard", "tenants", "invoices", "bank"];

  const [tab, setTab] = useState<RentTab>(() =>
    allowedTabs.includes(initialTab as RentTab) ? (initialTab as RentTab) : "dashboard"
  );
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);

  const tabs: { key: RentTab; label: string; icon: ReactNode }[] = [
    { key: "dashboard", label: "Дашборд", icon: <LayoutDashboard size={13} /> },
    { key: "tenants", label: "Арендаторы", icon: <Users size={13} /> },
    { key: "invoices", label: "Начисления", icon: <FileText size={13} /> },
    { key: "bank", label: "Банк аренды", icon: <Wallet size={13} /> },
  ];

  return (
    <div className="admin-stack">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт аренды</h1>
          <p className="admin-block__desc">
            БАУ и ИП Пакин: арендаторы, договоры, начисления и отдельный банк
            аренды.{" "}
            {mode === "dashboard"
              ? "Вам доступен просмотр отчётности, финансов и просрочек."
              : mode === "readonly"
                ? "Режим просмотра: редактирование доступно только администратору."
                : ""}
          </p>
        </div>
        {mode === "full" && (
          <div className="admin-page-head__actions">
            <button
              type="button"
              className="admin-btn admin-btn--outline"
              onClick={() => setOrgSettingsOpen(true)}
            >
              <Settings2 size={14} />
              Организации и реквизиты
            </button>
          </div>
        )}
      </div>

      {allowedTabs.length > 1 && (
        <div className="admin-filters">
          {tabs
            .filter((t) => allowedTabs.includes(t.key))
            .map((t) => (
              <button
                key={t.key}
                type="button"
                className={`admin-filter${tab === t.key ? " admin-filter--active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
        </div>
      )}

      {tab === "dashboard" && (
        <RentDashboard
          adminPath={adminPath}
          readOnly={readOnly}
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payments={payments}
        />
      )}
      {tab === "tenants" && (
        <RentTenants
          adminPath={adminPath}
          readOnly={readOnly}
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payments={payments}
        />
      )}
      {tab === "invoices" && (
        <RentInvoices
          adminPath={adminPath}
          readOnly={readOnly}
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payments={payments}
        />
      )}
      {tab === "bank" && (
        <RentBank
          adminPath={adminPath}
          readOnly={readOnly}
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payments={payments}
        />
      )}

      {orgSettingsOpen && mode === "full" && (
        <RentOrgSettings orgs={orgs} onClose={() => setOrgSettingsOpen(false)} />
      )}
    </div>
  );
}
