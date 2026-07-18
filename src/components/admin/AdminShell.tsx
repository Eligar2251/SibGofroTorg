// src/components/admin/AdminShell.tsx
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Package,
  FolderOpen,
  ClipboardList,
  Settings,
  LayoutDashboard,
  ExternalLink,
  LogOut,
  Users,
  Megaphone,
} from "lucide-react";

export function AdminShell({
  children,
  adminPath,
}: {
  children: ReactNode;
  adminPath: string;
}) {
  const pathname = usePathname() || "";
  const isLogin = pathname === `/${adminPath}/login`;

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
      label: "Товары",
      icon: <Package size={18} />,
    },
    {
      href: `/${adminPath}/categories`,
      label: "Категории",
      icon: <FolderOpen size={18} />,
    },
    {
      href: `/${adminPath}/promotions`,
      label: "Акции",
      icon: <Megaphone size={18} />,
    },
    {
      href: `/${adminPath}/orders`,
      label: "Заявки",
      icon: <ClipboardList size={18} />,
    },
    {
      href: `/${adminPath}/clients`,
      label: "Клиенты",
      icon: <Users size={18} />,
    },
    {
      href: `/${adminPath}/settings`,
      label: "Настройки",
      icon: <Settings size={18} />,
    },
  ];

  return (
    <div className="admin-shell" data-admin="true">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">
          <div className="admin-sidebar__logo">С</div>
          <div>
            <div className="admin-sidebar__name">СибГофроТорг</div>
            <div className="admin-sidebar__sub">Управление</div>
          </div>
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
            target="_blank"
            className="admin-sidebar__footer-link"
          >
            <ExternalLink size={13} /> Перейти на site
          </Link>
          <form action={`/${adminPath}/api/logout`} method="POST">
            <button type="submit" className="admin-sidebar__logout">
              <LogOut size={13} /> Выйти из аккаунта
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-mobile-bar">
        <span className="admin-mobile-bar__title">
          <span>С</span> Управление
        </span>
        <div className="admin-mobile-bar__nav">
          {nav.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="admin-mobile-bar__link"
              title={link.label}
            >
              {link.icon}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-content">
        <main className="admin-main">{children}</main>
      </div>
    </div>
  );
}
