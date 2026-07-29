// src/components/admin/AdminShell.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Package,
  ClipboardList,
  Settings,
  LayoutDashboard,
  ExternalLink,
  LogOut,
  Megaphone,
  Star,
  Boxes,
  Truck,
  QrCode,
  PanelLeftClose,
  ChevronRight,
} from "lucide-react";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { NavigationProgress } from "./NavigationProgress";
import { AdminNotifications } from "./AdminNotifications";

const SIDEBAR_PREF_KEY = "admin-sidebar-hidden";

export function AdminShell({
  children,
  adminPath,
}: {
  children: ReactNode;
  adminPath: string;
}) {
  const pathname = usePathname() || "";
  const isLogin = pathname === `/${adminPath}/login`;
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    try {
      setSidebarHidden(window.localStorage.getItem(SIDEBAR_PREF_KEY) === "1");
    } catch {
      /* localStorage недоступен */
    }
  }, []);

  function toggleSidebar() {
    setSidebarHidden((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, next ? "1" : "0");
      } catch {
        /* localStorage недоступен */
      }
      return next;
    });
  }

  if (isLogin) {
    return <div data-admin="true">{children}</div>;
  }

  const nav = [
    {
      href: `/${adminPath}`,
      label: "Панель",
      icon: <LayoutDashboard size={18} />,
    },
    {
      href: `/${adminPath}/products`,
      label: "Товары и категории",
      icon: <Package size={18} />,
    },
    {
      href: `/${adminPath}/promotions`,
      label: "Акции и окна",
      icon: <Megaphone size={18} />,
    },
    {
      href: `/${adminPath}/reviews`,
      label: "Отзывы",
      icon: <Star size={18} />,
    },
    {
      href: `/${adminPath}/orders`,
      label: "Заявки",
      icon: <ClipboardList size={18} />,
    },
    {
      href: `/${adminPath}/warehouse`,
      label: "Учёт",
      icon: <Boxes size={18} />,
    },
    {
      // Отдельная страница сканера /admin/scan (без [code] — это
      // просто точка входа: открывается пустая форма поиска +
      // доступ к камере, можно начать ввод кода).
      href: `/${adminPath}/scan`,
      label: "Сканер",
      icon: <QrCode size={18} />,
    },
    {
      href: `/${adminPath}/settings`,
      label: "Настройки",
      icon: <Settings size={18} />,
    },
  ];

  return (
    <div
      className={`admin-shell${sidebarHidden ? " admin-shell--sidebar-hidden" : ""}`}
      data-admin="true"
    >
      <NavigationProgress />
      <aside
        id="admin-sidebar"
        className={`admin-sidebar${sidebarHidden ? " admin-sidebar--hidden" : ""}`}
        aria-hidden={sidebarHidden}
      >
        <div className="admin-sidebar__brand">
          <SiteLogo variant="light" className="admin-sidebar__logo-svg" />
          <div className="admin-sidebar__sub">Управление</div>
          {/* Единственная видимая кнопка сворачивания — на самой
              панели. Скрывать меню на мобильных не нужно: там
              сайдбара нет вовсе, навигация в верхней панели. */}
          <button
            type="button"
            className="admin-sidebar__toggle desktop-only"
            onClick={toggleSidebar}
            aria-label="Скрыть боковую панель"
            title="Скрыть боковую панель"
            aria-expanded
            aria-controls="admin-sidebar"
          >
            <PanelLeftClose size={15} aria-hidden="true" />
          </button>
        </div>

        <nav className="admin-sidebar__nav">
          {nav.map((link) => {
            const active =
              link.href === `/${adminPath}`
                ? pathname === link.href
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`admin-sidebar__link${active ? " admin-sidebar__link--active" : ""}`}
              >
                {link.icon}
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar__footer">
          <Link
            href="/"
            prefetch={false}
            target="_blank"
            className="admin-sidebar__footer-link"
          >
            <ExternalLink size={13} /> Перейти на сайт
          </Link>
          <form action={`/${adminPath}/api/logout`} method="POST">
            <button type="submit" className="admin-sidebar__logout">
              <LogOut size={13} /> Выйти из аккаунта
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-mobile-bar">
        <div className="admin-mobile-bar__nav">
          {nav.map((link) => {
            const active =
              link.href === `/${adminPath}`
                ? pathname === link.href
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                prefetch={false}
                className={`admin-mobile-bar__link${
                  active ? " admin-mobile-bar__link--active" : ""
                }`}
                title={link.label}
                aria-label={link.label}
                aria-current={active ? "page" : undefined}
              >
                {link.icon}
              </Link>
            );
          })}
        </div>
      </div>

      {/*
       * ── Язычок раскрытия панели ──
       * Вторая (скрытая) кнопка вместо прежней громоздкой «Показать
       * меню» в тулбаре. Живёт у самого левого края экрана:
       *  • десктоп — почти невидимая полоска, проявляется при
       *    наведении на левый край (:hover / :focus-visible);
       *  • мобильные — всегда чуть выглядывает из-за края,
       *    чтобы её можно было нащупать пальцем.
       * Рендерится только когда панель скрыта: пока сайдбар открыт,
       * закрывать его нужно кнопкой на самой панели.
       */}
      {sidebarHidden && (
        <button
          type="button"
          className="admin-sidebar-handle"
          onClick={toggleSidebar}
          aria-label="Показать боковую панель"
          title="Показать боковую панель"
          aria-expanded={false}
          aria-controls="admin-sidebar"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      )}

      <div className="admin-content">
        <AdminNotifications adminPath={adminPath} />
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
