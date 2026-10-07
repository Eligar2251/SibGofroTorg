// src/components/admin/AdminShell.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExternalLink,
  LogOut,
  PanelLeftClose,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { lockBodyScroll, unlockBodyScroll } from "@/hooks/use-body-lock";
import { useIsMobile, useIsPhone } from "@/hooks/use-is-mobile";
import { MobileAdminShell } from "./mobile/MobileAdminShell";
import { AdminBottomNav } from "./mobile/AdminBottomNav";
import { AdminNotifications } from "./AdminNotifications";
import { AdminRequestAlerts } from "./AdminRequestAlerts";
import { AdminSupplyPlans } from "./AdminSupplyPlans";
import { RealtimeStatusIndicator } from "./RealtimeStatusIndicator";
import { type AdminRole } from "@/lib/admin-rbac";
import {
  buildAccessibleNav,
  flattenNavTree,
  isAdminNavItemActive,
  resolveNavTree,
} from "@/lib/admin-nav";
import { AdminNavIcon } from "./AdminNavIcon";
import { AdminNavMenu } from "./AdminNavMenu";
import { AdminNavCustomizeButton, useAdminNavOptional } from "./AdminNavProvider";

const SIDEBAR_PREF_KEY = "admin-sidebar-hidden";

export function AdminShell({
  children,
  adminPath,
  role,
  displayName,
}: {
  children: ReactNode;
  adminPath: string;
  role: AdminRole | null;
  displayName: string | null;
}) {
  const pathname = usePathname() || "";
  const isLogin = pathname === `/${adminPath}/login`;
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileDrawerEnabled, setMobileDrawerEnabled] = useState(false);
  // Телефон или нет — решает, рендерить ли мобильное нижнее меню.
  // Десктопная оболочка (сайдбар + верхняя панель) при этом не меняется:
  // мобильная навигация — отдельный компонент рядом с оригиналом.
  const isMobile = useIsMobile();
  // Телефон (≤768px) получает полностью отдельную мобильную оболочку
  // MobileAdminShell: шапка приложения + нижние вкладки, без сайдбара
  // и бургера. Планшет 769–1024px остаётся на прежней панели.
  const isPhone = useIsPhone();
  // Текущая раскладка (data-admin-layout на <html>): в «Верхнем меню»
  // панель обязана быть видна всегда, даже если раньше её сворачивали.
  const [layout, setLayout] = useState("sidebar-left");

  useEffect(() => {
    // Минимальный service worker делает админку устанавливаемым PWA.
    // Он не кеширует учётные данные и не перехватывает API-запросы.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/admin-sw.js", { scope: "/" })
        .catch(() => {
          /* установка PWA недоступна — обычная веб-версия продолжает работать */
        });
    }
    try {
      setSidebarHidden(window.localStorage.getItem(SIDEBAR_PREF_KEY) === "1");
    } catch {
      /* localStorage недоступен */
    }
    const readLayout = () =>
      setLayout(
        document.documentElement.getAttribute("data-admin-layout") ||
          "sidebar-left",
      );
    readLayout();
    // Раскладку меняет кастомайзер в Настройках (атрибут на <html>) —
    // следим за атрибутом и за другими вкладками.
    const observer = new MutationObserver(readLayout);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-admin-layout"],
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key === "adm-layout") readLayout();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const sync = () => {
      setMobileDrawerEnabled(media.matches);
      if (!media.matches) setMobileMenuOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // Мобильное меню закрывается после перехода и не оставляет страницу
  // заблокированной при повороте телефона/переходе на десктопную ширину.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    // Надёжная блокировка скролла фона (в т.ч. iOS Safari)
    lockBodyScroll();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const closeOnDesktop = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnDesktop, { passive: true });
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnDesktop);
    };
  }, [mobileMenuOpen]);

  // В раскладке «сайдбар сверху» скрывать панель нельзя: другой
  // навигации на странице нет.
  const hideSidebar = sidebarHidden && layout !== "sidebar-top";

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

  // ── Навигация ──
  // Группы, порядок и иконки — личные, из базы (AdminNavProvider).
  // Плоский список нужен планшетной полоске и нижним вкладкам телефона.
  const navCtx = useAdminNavOptional();
  const navItems =
    navCtx?.items ?? (role ? buildAccessibleNav(role, adminPath) : []);
  const navTree = navCtx?.tree ?? resolveNavTree(navItems, null);
  const flatNav = flattenNavTree(navTree);
  const navHrefs = flatNav.map((link) => link.href);
  const nav = flatNav.map((link) => ({
    href: link.href,
    label: link.label,
    icon: <AdminNavIcon id={link.icon} size={18} />,
  }));
  const navActive = (href: string) =>
    isAdminNavItemActive(pathname, href, navHrefs, `/${adminPath}`);

  if (isLogin) {
    return <div data-admin="true">{children}</div>;
  }

  // ── Телефон: отдельная оболочка «как нативное приложение» ──
  // Шапка с заголовком раздела + нижние вкладки + лист «Ещё».
  // Десктопная разметка (сайдбар, тулбар, бургер) на телефон вообще
  // не рендерится — мобильный вид больше не «ужимает» десктопный,
  // телефон получает собственный интерфейс.
  if (isPhone) {
    return (
      <MobileAdminShell
        adminPath={adminPath}
        role={role}
        displayName={displayName}
        items={nav.map((link) => ({
          href: link.href,
          label: link.label,
          icon: link.icon,
        }))}
      >
        {children}
      </MobileAdminShell>
    );
  }

  const roleLabel =
    role === "owner"
      ? "Владелец"
      : role === "admin"
        ? "Администратор"
        : role === "manager"
          ? "Менеджер"
          : role === "lawyer"
            ? "Юрист"
            : role === "wastepaper"
              ? "Макулатурщик"
              : "";

  return (
    <div
      className={`admin-shell${hideSidebar ? " admin-shell--sidebar-hidden" : ""}`}
      data-admin="true"
    >
      <aside
        id="admin-sidebar"
        className={`admin-sidebar${hideSidebar ? " admin-sidebar--hidden" : ""}`}
        aria-hidden={hideSidebar}
        inert={hideSidebar}
      >
        <div className="admin-sidebar__brand">
          <SiteLogo variant="light" className="admin-sidebar__logo-svg" />
          <div className="admin-sidebar__sub">
            {displayName || "Управление"}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </div>
          {/* Единственная видимая кнопка сворачивания — на самой
              панели. Скрывать меню на мобильных не нужно: там
              сайдбара нет вовсе, навигация в верхней панели. */}
          <button
            type="button"
            className="admin-sidebar__toggle desktop-only"
            onClick={toggleSidebar}
            aria-label="Скрыть боковую панель"
            title="Скрыть боковую панель"
            aria-expanded={!sidebarHidden}
            aria-controls="admin-sidebar"
          >
            <PanelLeftClose size={15} aria-hidden="true" />
          </button>
        </div>

        <nav className="admin-sidebar__nav" aria-label="Разделы админ-панели">
          <AdminNavMenu
            items={navItems}
            layout={navCtx?.layout ?? null}
            pathname={pathname}
            adminPath={adminPath}
          />
        </nav>

        <div className="admin-sidebar__footer">
          <AdminNavCustomizeButton className="admin-sidebar__footer-link" />
          <Link
            href="/"
            prefetch={false}
            target="_blank"
            title="Перейти на сайт"
            className="admin-sidebar__footer-link"
          >
            <ExternalLink size={13} />{" "}
            <span className="admin-sidebar__label">Перейти на сайт</span>
          </Link>
          <form action={`/${adminPath}/api/logout`} method="POST">
            <button
              type="submit"
              className="admin-sidebar__logout"
              title="Выйти из аккаунта"
            >
              <LogOut size={13} />{" "}
              <span className="admin-sidebar__label">Выйти из аккаунта</span>
            </button>
          </form>
        </div>
      </aside>

      <div
        className="admin-mobile-bar"
        role="navigation"
        aria-label="Навигация админ-панели"
      >
        <span className="admin-mobile-bar__title" aria-live="polite">
          {nav.find((link) => navActive(link.href))?.label || "Управление"}
        </span>
        <button
          type="button"
          className="admin-mobile-bar__menu-toggle"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={mobileMenuOpen}
          aria-controls="admin-mobile-menu"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div
          id="admin-mobile-menu"
          className={`admin-mobile-menu${mobileMenuOpen ? " admin-mobile-menu--open" : ""}`}
          aria-hidden={mobileDrawerEnabled ? !mobileMenuOpen : undefined}
          inert={mobileDrawerEnabled && !mobileMenuOpen}
        >
          <div className="admin-mobile-menu__head">
            <strong>Разделы</strong>
            <span>{displayName || roleLabel || "Админ-панель"}</span>
          </div>
          <div className="admin-mobile-bar__nav">
            <AdminNavMenu
              items={navItems}
              layout={navCtx?.layout ?? null}
              pathname={pathname}
              adminPath={adminPath}
              variant="bar"
              onNavigate={() => setMobileMenuOpen(false)}
            />
          </div>
          <div className="admin-mobile-bar__actions">
            <AdminNavCustomizeButton
              className="admin-mobile-bar__action"
              iconSize={17}
              showLabel={false}
            />
            <Link
              href="/"
              prefetch={false}
              target="_blank"
              className="admin-mobile-bar__action"
              aria-label="Открыть сайт"
              title="Открыть сайт"
              onClick={() => setMobileMenuOpen(false)}
            >
              <ExternalLink size={17} aria-hidden="true" />
              <span>Открыть сайт</span>
            </Link>
            <form action={`/${adminPath}/api/logout`} method="POST">
              <button
                type="submit"
                className="admin-mobile-bar__action"
                aria-label="Выйти из аккаунта"
                title="Выйти из аккаунта"
              >
                <LogOut size={17} aria-hidden="true" />
                <span>Выйти</span>
              </button>
            </form>
          </div>
        </div>
      </div>
      {mobileMenuOpen && (
        <button
          type="button"
          className="admin-mobile-menu__backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Закрыть меню"
        />
      )}

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
      {hideSidebar && (
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
        {/* Индикатор состояния realtime-канала: зелёный = данные живые,
            красный = realtime недоступен, обновляем по таймеру. */}
        {role && <RealtimeStatusIndicator />}

        {/* Три кружка справа сверху: планы поставок · новые заявки ·
            срочные уведомления. Макулатурщику и юристу недоступны. */}
        {role && role !== "lawyer" && role !== "wastepaper" && (
          <>
            <AdminSupplyPlans adminPath={adminPath} />
            <AdminRequestAlerts adminPath={adminPath} />
            <AdminNotifications adminPath={adminPath} />
          </>
        )}
        <main className="admin-main">{children}</main>

        {/* Мобильная навигация: нижнее меню + лист «Ещё».
            Рендерится только на телефоне (useIsMobile), на десктопе
            компонент не создаётся вовсе. */}
        {isMobile && (
          <AdminBottomNav
            items={nav.map((link) => ({
              href: link.href,
              label: link.label,
              icon: link.icon,
            }))}
            pathname={pathname}
            adminPath={adminPath}
          />
        )}
      </div>
    </div>
  );
}
