// =========================================================
// FILE: src/components/admin/AdminNavMenu.tsx
// Меню админки: вкладки и группы.
// Группа в боковой панели раскрывается анимацией.
// В верхнем меню и в планшетной полоске — выпадающий список.
// =========================================================

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { AdminNavIcon } from "./AdminNavIcon";
import {
  isAdminNavItemActive,
  resolveNavTree,
  type AdminNavItemDef,
  type AdminNavLayout,
  type ResolvedNavItem,
  type ResolvedNavEntry,
} from "@/lib/admin-nav";

export function AdminNavMenu({
  items,
  layout,
  pathname,
  adminPath,
  variant = "sidebar",
  interactive = true,
  onNavigate,
  className,
}: {
  items: readonly AdminNavItemDef[];
  layout: AdminNavLayout | null;
  pathname: string;
  adminPath: string;
  variant?: "sidebar" | "bar";
  /** false — предпросмотр: группы открываются, переход по ссылке нет. */
  interactive?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const entries = useMemo(() => resolveNavTree(items, layout), [items, layout]);
  const hrefs = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.type === "item"
          ? [entry.item.href]
          : entry.items.map((child) => child.item.href),
      ),
    [entries],
  );
  const root = `/${adminPath}`;
  const isActive = (href: string) => isAdminNavItemActive(pathname, href, hrefs, root);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const activeGroup = entries.find(
      (entry): entry is Extract<ResolvedNavEntry, { type: "group" }> =>
        entry.type === "group" && entry.items.some((child) => isActive(child.item.href)),
    );
    if (!activeGroup) return;
    setOpenMap((prev) =>
      prev[activeGroup.id] ? prev : { ...prev, [activeGroup.id]: true },
    );
    // isActive завязан на pathname и hrefs, которые уже в зависимостях через entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, entries]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(`[data-admin-nav-root="${uid}"]`) ||
        target?.closest(`[data-admin-nav-drop="${uid}"]`)
      ) {
        return;
      }
      const top =
        document.documentElement.getAttribute("data-admin-layout") === "sidebar-top";
      if (variant === "bar" || top) setOpenMap({});
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const top =
        document.documentElement.getAttribute("data-admin-layout") === "sidebar-top";
      if (variant === "bar" || top) setOpenMap({});
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [variant, uid]);

  function toggle(id: string) {
    setOpenMap((prev) => {
      const next = !prev[id];
      const single =
        variant === "bar" ||
        document.documentElement.getAttribute("data-admin-layout") === "sidebar-top";
      if (single) return next ? { [id]: true } : {};
      return { ...prev, [id]: next };
    });
  }

  return (
    <div
      className={`admin-nav-menu admin-nav-menu--${variant}${className ? ` ${className}` : ""}`}
      data-admin-nav-root={uid}
    >
      {entries.map((entry) =>
        entry.type === "item" ? (
          <NavLink
            key={entry.item.id}
            item={entry}
            active={isActive(entry.item.href)}
            variant={variant}
            interactive={interactive}
            onNavigate={onNavigate}
          />
        ) : (
          <NavGroup
            key={entry.id}
            entry={entry}
            open={Boolean(openMap[entry.id])}
            onToggle={() => toggle(entry.id)}
            onClose={() =>
              setOpenMap((prev) => (prev[entry.id] ? { ...prev, [entry.id]: false } : prev))
            }
            isActive={isActive}
            variant={variant}
            interactive={interactive}
            onNavigate={onNavigate}
            panelId={`${uid}-${entry.id}`}
            menuId={uid}
          />
        ),
      )}
    </div>
  );
}

function NavLink({
  item,
  active,
  variant,
  nested = false,
  interactive,
  onNavigate,
}: {
  item: ResolvedNavItem;
  active: boolean;
  variant: "sidebar" | "bar";
  nested?: boolean;
  interactive: boolean;
  onNavigate?: () => void;
}) {
  const barTab = variant === "bar" && !nested;
  const className = barTab
    ? `admin-mobile-bar__link${active ? " admin-mobile-bar__link--active" : ""}`
    : `admin-sidebar__link${nested ? " admin-nav-group__item" : ""}${
        active ? " admin-sidebar__link--active" : ""
      }`;
  const body = (
    <>
      <AdminNavIcon id={item.icon} size={barTab ? 17 : 18} />
      <span className={barTab ? undefined : "admin-sidebar__label"}>{item.label}</span>
    </>
  );
  if (!interactive) {
    return (
      <span className={className} aria-current={active ? "page" : undefined}>
        {body}
      </span>
    );
  }
  return (
    <Link
      href={item.item.href}
      prefetch={false}
      className={className}
      title={item.label}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      {body}
    </Link>
  );
}

function NavGroup({
  entry,
  open,
  onToggle,
  onClose,
  isActive,
  variant,
  interactive,
  onNavigate,
  panelId,
  menuId,
}: {
  entry: Extract<ResolvedNavEntry, { type: "group" }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  isActive: (href: string) => boolean;
  variant: "sidebar" | "bar";
  interactive: boolean;
  onNavigate?: () => void;
  panelId: string;
  menuId: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const childActive = entry.items.some((child) => isActive(child.item.href));

  useEffect(() => {
    if (!open || variant !== "bar") return;
    // Полоска планшета fixed: скролл страницы её не двигает.
    // Закрываем список, только если прокрутили саму полоску или изменили окно.
    const scroller = btnRef.current?.closest(".admin-mobile-bar__nav");
    const close = () => onClose();
    scroller?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      scroller?.removeEventListener("scroll", close);
      window.removeEventListener("resize", close);
    };
  }, [open, variant, onClose]);

  function handleToggle() {
    if (variant === "bar") {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        const width = 240;
        const estimated = Math.min(320, entry.items.length * 40 + 16);
        let top = rect.bottom + 6;
        if (top + estimated > window.innerHeight - 8 && rect.top > estimated) {
          top = Math.max(8, rect.top - estimated - 6);
        }
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        setBox({ top, left });
      }
    }
    onToggle();
  }

  const links = entry.items.map((child) => (
    <NavLink
      key={child.item.id}
      item={child}
      active={isActive(child.item.href)}
      variant={variant}
      nested
      interactive={interactive}
      onNavigate={() => {
        onNavigate?.();
        if (variant === "bar") onToggle();
      }}
    />
  ));

  return (
    <div
      className={`admin-nav-group${open ? " is-open" : ""}${
        variant === "bar" ? " admin-nav-group--bar" : ""
      }${childActive ? " admin-nav-group--has-active" : ""}`}
    >
      <button
        ref={btnRef}
        type="button"
        className={
          variant === "bar"
            ? `admin-mobile-bar__link${childActive ? " admin-mobile-bar__link--active" : ""}`
            : `admin-sidebar__link admin-nav-group__toggle${
                childActive ? " admin-nav-group__toggle--has-active" : ""
              }`
        }
        aria-expanded={open}
        aria-controls={panelId}
        title={entry.label}
        onClick={handleToggle}
      >
        <AdminNavIcon id={entry.icon} size={variant === "bar" ? 17 : 18} />
        <span className={variant === "bar" ? undefined : "admin-sidebar__label"}>
          {entry.label}
        </span>
        {variant !== "bar" && (
          <ChevronDown size={14} className="admin-nav-group__chevron" aria-hidden="true" />
        )}
      </button>
      {variant === "bar" ? (
        open && box && typeof document !== "undefined" ? (
          createPortal(
            <div
              id={panelId}
              className="admin-nav-drop"
              data-admin-nav-drop={menuId}
              style={{ top: box.top, left: box.left }}
            >
              {links}
            </div>,
            document.body,
          )
        ) : null
      ) : (
        <div className="admin-nav-group__panel" id={panelId}>
          <div className="admin-nav-group__panel-inner">{links}</div>
        </div>
      )}
    </div>
  );
}
