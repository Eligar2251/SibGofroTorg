// =========================================================
// FILE: src/components/admin/AdminDbQuickBadge.tsx
// Быстрый индикатор и переключатель активной БД в боковой панели
// админки (доступен владельцу и администратору с любого экрана).
// =========================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Cloud,
  Database,
  HardDrive,
  Loader2,
  Server,
} from "lucide-react";

type DbBackendMode = "primary" | "secondary" | "local";

interface QuickDbState {
  activeBackend: DbBackendMode;
  primaryLabel: string;
  secondaryLabel: string;
  secondaryConfigured: boolean;
  failoverBackend: DbBackendMode | null;
  localRows: number;
}

export function AdminDbQuickBadge({ adminPath }: { adminPath: string }) {
  const router = useRouter();
  const [state, setState] = useState<QuickDbState | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<DbBackendMode | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/database/backend", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.config) return;
      setState({
        activeBackend: data.config.activeBackend,
        primaryLabel: data.config.primary?.label || "Supabase #1",
        secondaryLabel: data.config.secondary?.label || "Supabase #2",
        secondaryConfigured: Boolean(data.config.secondary?.configured),
        failoverBackend: data.config.failover?.activeFallbackBackend || null,
        localRows: Number(data.localSummary?.totalRows || 0),
      });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchState();
    const onChanged = () => fetchState();
    window.addEventListener("sgt-db-backend-changed", onChanged);
    return () =>
      window.removeEventListener("sgt-db-backend-changed", onChanged);
  }, [fetchState]);

  async function quickSwitch(mode: DbBackendMode) {
    setSwitching(mode);
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeBackend: mode }),
      });
      if (res.ok) {
        await fetchState();
        window.dispatchEvent(new CustomEvent("sgt-db-backend-changed"));
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSwitching(null);
    }
  }

  if (!state) return null;

  const currentShortLabel = state.failoverBackend
    ? "Аварийный резерв БД"
    : state.activeBackend === "local"
      ? "Локальная JSON-БД"
      : state.activeBackend === "secondary"
        ? "Supabase #2"
        : "Supabase #1";

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="admin-sidebar__footer-link"
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: state.failoverBackend ? "#f59e0b" : undefined,
        }}
        title="Активный сервер базы данных — нажмите для быстрого переключения"
      >
        {state.failoverBackend ? (
          <AlertTriangle size={13} />
        ) : state.activeBackend === "local" ? (
          <HardDrive size={13} />
        ) : state.activeBackend === "secondary" ? (
          <Cloud size={13} />
        ) : (
          <Database size={13} />
        )}{" "}
        <span className="admin-sidebar__label">БД: {currentShortLabel}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            left: 6,
            right: 6,
            bottom: "calc(100% + 6px)",
            zIndex: 80,
            padding: 10,
            borderRadius: 10,
            background: "var(--adm-surface, #1b2029)",
            color: "var(--adm-text, #f3f4f6)",
            border: "1px solid var(--adm-border, rgba(255,255,255,0.16))",
            boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 11.5,
              opacity: 0.78,
              marginBottom: 2,
            }}
          >
            Быстрое переключение БД
          </div>

          <button
            type="button"
            onClick={() => quickSwitch("primary")}
            disabled={switching !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 7,
              border: "1px solid rgba(128,128,128,0.22)",
              background:
                state.activeBackend === "primary"
                  ? "rgba(44, 94, 79, 0.22)"
                  : "transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Server size={12} /> Supabase #1
            </span>
            {switching === "primary" ? (
              <Loader2 size={12} className="spin" />
            ) : state.activeBackend === "primary" ? (
              <Check size={12} />
            ) : null}
          </button>

          <button
            type="button"
            onClick={() =>
              state.secondaryConfigured
                ? quickSwitch("secondary")
                : router.push(`/${adminPath}/database`)
            }
            disabled={switching !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 7,
              border: "1px solid rgba(128,128,128,0.22)",
              background:
                state.activeBackend === "secondary"
                  ? "rgba(44, 94, 79, 0.22)"
                  : "transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Cloud size={12} />{" "}
              {state.secondaryConfigured ? "Supabase #2" : "Supabase #2 (настроить)"}
            </span>
            {switching === "secondary" ? (
              <Loader2 size={12} className="spin" />
            ) : state.activeBackend === "secondary" ? (
              <Check size={12} />
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => quickSwitch("local")}
            disabled={switching !== null}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 7,
              border: "1px solid rgba(128,128,128,0.22)",
              background:
                state.activeBackend === "local"
                  ? "rgba(44, 94, 79, 0.22)"
                  : "transparent",
              color: "inherit",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <HardDrive size={12} /> Локальная JSON ({state.localRows})
            </span>
            {switching === "local" ? (
              <Loader2 size={12} className="spin" />
            ) : state.activeBackend === "local" ? (
              <Check size={12} />
            ) : null}
          </button>

          <Link
            href={`/${adminPath}/database`}
            onClick={() => setOpen(false)}
            style={{
              marginTop: 2,
              fontSize: 11.5,
              textAlign: "center",
              padding: "4px 6px",
              textDecoration: "underline",
              color: "inherit",
              opacity: 0.85,
            }}
          >
            Резервные копии, ключи и SQL →
          </Link>
        </div>
      )}
    </div>
  );
}
