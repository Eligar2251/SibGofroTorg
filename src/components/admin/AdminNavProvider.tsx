// =========================================================
// FILE: src/components/admin/AdminNavProvider.tsx
// Доступ к настройке меню из сайдбара, планшета, телефона
// и страницы «Настройки». Одна модалка на всё приложение.
// =========================================================

"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { AdminRole } from "@/lib/admin-rbac";
import {
  buildAccessibleNav,
  resolveNavTree,
  type AdminNavItemDef,
  type AdminNavLayout,
  type ResolvedNavEntry,
} from "@/lib/admin-nav";
import { useAdminNavLayout } from "./use-admin-nav-layout";
import { AdminNavCustomizer } from "./AdminNavCustomizer";

type AdminNavContextValue = {
  role: AdminRole;
  adminPath: string;
  username: string;
  items: AdminNavItemDef[];
  tree: ResolvedNavEntry[];
  layout: AdminNavLayout | null;
  openCustomizer: () => void;
};

const AdminNavContext = createContext<AdminNavContextValue | null>(null);

export function useAdminNavOptional() {
  return useContext(AdminNavContext);
}

export function AdminNavProvider({
  role,
  adminPath,
  username,
  children,
}: {
  role: AdminRole | null;
  adminPath: string;
  username: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const stored = useAdminNavLayout(role && username ? username : "");
  const items = useMemo(
    () => (role ? buildAccessibleNav(role, adminPath) : []),
    [role, adminPath],
  );
  const tree = useMemo(
    () => resolveNavTree(items, stored.layout),
    [items, stored.layout],
  );
  const value = useMemo<AdminNavContextValue | null>(() => {
    if (!role || !username) return null;
    return {
      role,
      adminPath,
      username,
      items,
      tree,
      layout: stored.layout,
      openCustomizer: () => setOpen(true),
    };
  }, [role, username, adminPath, items, tree, stored.layout]);

  if (!value) return <>{children}</>;

  return (
    <AdminNavContext.Provider value={value}>
      {children}
      {open && (
        <AdminNavCustomizer
          items={items}
          layout={stored.layout}
          username={username}
          saving={stored.saving}
          error={stored.error}
          onClose={() => setOpen(false)}
          onSave={async (next) => {
            await stored.save(next);
            setOpen(false);
          }}
          onReset={async () => {
            await stored.reset();
            setOpen(false);
          }}
        />
      )}
    </AdminNavContext.Provider>
  );
}

export function AdminNavCustomizeButton({
  className,
  iconSize = 13,
  showLabel = true,
}: {
  className?: string;
  iconSize?: number;
  showLabel?: boolean;
}) {
  const nav = useAdminNavOptional();
  if (!nav) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={nav.openCustomizer}
      title="Настроить меню"
      aria-label="Настроить меню"
    >
      <SlidersHorizontal size={iconSize} aria-hidden="true" />
      {showLabel ? <span className="admin-sidebar__label">Настроить меню</span> : null}
    </button>
  );
}

/** Блок на странице «Настройки» — тот же редактор, что и кнопка в меню. */
export function AdminNavSettingsCard() {
  const nav = useAdminNavOptional();
  if (!nav) return null;
  return (
    <div className="admin-card" style={{ marginBottom: "1.5rem" }}>
      <div className="admin-card__head">
        <h2 className="admin-card__title">Навигация админ-панели</h2>
      </div>
      <div className="admin-card__pad">
        <p className="admin-muted" style={{ marginBottom: 12 }}>
          Группы, выпадающие списки, порядок вкладок и иконки. Иконка выравнивается
          по центру строки, вровень с текстом — и у группы, и у каждой вкладки.
          Настройка доступна всем ролям: кнопка «Настроить меню» внизу боковой панели,
          в меню телефона и здесь. В базе хранится отдельно для каждого аккаунта.
        </p>
        <button type="button" className="admin-btn admin-btn--primary" onClick={nav.openCustomizer}>
          <SlidersHorizontal size={15} aria-hidden="true" />
          Настроить меню
        </button>
      </div>
    </div>
  );
}
