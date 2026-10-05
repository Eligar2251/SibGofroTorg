// =========================================================
// FILE: src/components/admin/rent/RentManager.tsx
// Учёт аренды: оболочка с вкладками.
//   Дашборд    — стартовая страница: счета, сбор месяца, просрочки
//   Арендаторы — договоры, офисы, периоды, отсрочки
//   Схема      — планировки этажей по клеткам (стены, двери, помещения)
//   Электроэнергия — счётчики, тарифы, начисления
//   Начисления — счета за периоды аренды
//   Банк       — банк аренды: операции, проведение, история
// =========================================================

"use client";

import { useState, type ReactNode } from "react";
import {
  Building2,
  FileText,
  LayoutDashboard,
  Settings2,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import type {
  RentInvoice,
  RentMeterReading,
  RentOrg,
  RentPayment,
  RentTenant,
} from "@/lib/rent-shared";
import type { RentBuilding, RentFloorPlan } from "@/lib/rent-building";
import { RentDashboard } from "./RentDashboard";
import { RentTenants } from "./RentTenants";
import { RentElectricity } from "./RentElectricity";
import { RentInvoices } from "./RentInvoices";
import { RentBank } from "./RentBank";
import { RentBuildingScheme } from "./RentBuildingScheme";
import { RentOrgSettings } from "./RentOrgSettings";

export type RentMode = "full" | "readonly" | "dashboard";

export type RentTabKey = "dashboard" | "tenants" | "scheme" | "electricity" | "invoices" | "bank";

export function RentManager({
  adminPath,
  mode,
  initialTab,
  orgs,
  tenants,
  invoices,
  payments,
  meterReadings,
  initialBuildings,
  initialPlans,
}: {
  adminPath: string;
  mode: RentMode;
  initialTab: string;
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payments: RentPayment[];
  meterReadings: RentMeterReading[];
  initialBuildings: RentBuilding[];
  initialPlans: RentFloorPlan[];
}) {
  const readOnly = mode !== "full";
  const allowedTabs: RentTabKey[] =
    mode === "dashboard"
      ? ["dashboard"]
      : ["dashboard", "tenants", "scheme", "electricity", "invoices", "bank"];

  const [tab, setTab] = useState<RentTabKey>(() =>
    allowedTabs.includes(initialTab as RentTabKey) ? (initialTab as RentTabKey) : "dashboard"
  );
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);

  const pendingPayments = payments.filter((p) => !p.isPaid).length;
  const awaitingInvoices = invoices.filter((i) => i.status === "awaiting").length;

  const tabs: { key: RentTabKey; label: string; icon: ReactNode; badge?: number }[] = [
    { key: "dashboard", label: "Обзор", icon: <LayoutDashboard size={13} /> },
    { key: "tenants", label: "Арендаторы", icon: <Users size={13} />, badge: tenants.filter((t) => t.status === "active").length },
    { key: "scheme", label: "Схема здания", icon: <Building2 size={13} /> },
    { key: "electricity", label: "Электроэнергия", icon: <Zap size={13} /> },
    { key: "invoices", label: "Начисления", icon: <FileText size={13} />, badge: awaitingInvoices },
    { key: "bank", label: "Банк аренды", icon: <Wallet size={13} />, badge: pendingPayments },
  ];

  return (
    <div className="admin-stack">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Учёт аренды</h1>
          <p className="admin-block__desc">
            БАУ и ИП Пакин: арендаторы и договоры, планировки зданий, начисления,
            электроэнергия и банк аренды.{" "}
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
                {typeof t.badge === "number" && t.badge > 0 ? (
                  <span className="rent-tab-badge">{t.badge}</span>
                ) : null}
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
          onOpenTab={(next) => {
            if (allowedTabs.includes(next)) setTab(next);
          }}
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
          meterReadings={meterReadings}
          onOpenElectricity={() => setTab("electricity")}
        />
      )}
      {tab === "electricity" && (
        <RentElectricity
          adminPath={adminPath}
          readOnly={readOnly}
          orgs={orgs}
          tenants={tenants}
          invoices={invoices}
          payments={payments}
          meterReadings={meterReadings}
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
      {tab === "scheme" && (
        <RentBuildingScheme
          initialBuildings={initialBuildings}
          initialPlans={initialPlans}
          tenants={tenants}
          invoices={invoices}
          orgs={orgs}
          readOnly={readOnly}
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
