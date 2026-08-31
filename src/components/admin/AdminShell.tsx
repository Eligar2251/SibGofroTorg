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
  ShieldCheck,
  PanelLeftClose,
  ChevronRight,
  Headset,
  Recycle,
  Building2,
  Printer,
  Ruler,
  Menu,
  X,
} from "lucide-react";
import { SiteLogo } from "@/components/layout/SiteLogo";
import { NavigationProgress } from "./NavigationProgress";
import { AdminNotifications } from "./AdminNotifications";
import { AdminRequestAlerts } from "./AdminRequestAlerts";
import { AdminSupplyPlans } from "./AdminSupplyPlans";
import { RealtimeStatusIndicator } from "./RealtimeStatusIndicator";
import {
  canAccessAdminPage,
  type AdminRole,
} from "@/lib/admin-rbac";

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
  // Текущая раскладка (data-admin-layout на <html>): в «Верхнем меню»
  // панель обязана быть видна всегда, даже если раньше её сворачивали.
  const [layout, setLayout] = useState("sidebar-left");

  useEffect(() => {
    // Минимальный service worker делает админку устанавливаемым PWA.
    // Он не кеширует учётные данные и не перехватывает API-запросы.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/admin-sw.js", { scope: "/" }).catch(() => {
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
        document.documentElement.getAttribute("data-admin-layout") || "sidebar-left"
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    const closeOnDesktop = () => {
      if (window.innerWidth >= 1024) setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnDesktop, { passive: true });
    return () => {
      document.body.style.overflow = previousOverflow;
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
      href: `/${adminPath}/client-requests`,
      label: "Заявки клиентов",
      icon: <Headset size={18} />,
    },
    {
      href: `/${adminPath}/warehouse`,
      label: "Учёт",
      icon: <Boxes size={18} />,
    },
    {
      // Управленческий учёт аренды: банк аренды, арендаторы, просрочки.
      // Юристу доступен только просмотр дашборда (canAccessAdminPage).
      href: `/${adminPath}/rent`,
      label: "Аренда",
      icon: <Building2 size={18} />,
    },
    {
      // Отдельный учёт макулатуры: виден admin и макулатурщику
      // (остальным пункт скроет canAccessAdminPage).
      href: `/${adminPath}/wastepaper-account`,
      label: "Макулатура (учёт)",
      icon: <Recycle size={18} />,
    },
    {
      href: `/${adminPath}/duty-schedule`,
      label: "Охрана",
      icon: <ShieldCheck size={18} />,
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
      // Редактор таблицы для печати на А4 (шрифт, размеры, поля).
      href: `/${adminPath}/print-sheet`,
      label: "Печать А4",
      icon: <Printer size={18} />,
    },
    {
      // Подбор ближайшей коробки по габаритам Д×Ш×В (мм).
      href: `/${adminPath}/box-finder`,
      label: "Подбор коробки",
      icon: <Ruler size={18} />,
    },
    {
      href: `/${adminPath}/settings`,
      label: "Настройки",
      icon: <Settings size={18} />,
    },
  ].filter((item) =>
    role ? canAccessAdminPage(role, item.href, adminPath) : false
  );

  const roleLabel =
    role === "admin"
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
      <NavigationProgress />
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
                title={link.label}
                className={`admin-sidebar__link${active ? " admin-sidebar__link--active" : ""}`}
              >
                {link.icon}
                {/* Подпись обёрнута в span: в «компактной» раскладке
                    CSS прячет текст и оставляет только иконки. */}
                <span className="admin-sidebar__label">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar__footer">
          {/* Переключателя темы здесь больше нет: вся кастомизация
              (темы, раскладка, стиль, плотность, анимации) живёт
              в Настройках → «Кастомизация оформления». */}
          <Link
            href="/"
            prefetch={false}
            target="_blank"
            title="Перейти на сайт"
            className="admin-sidebar__footer-link"
          >
            <ExternalLink size={13} /> <span className="admin-sidebar__label">Перейти на сайт</span>
          </Link>
          <form action={`/${adminPath}/api/logout`} method="POST">
            <button type="submit" className="admin-sidebar__logout" title="Выйти из аккаунта">
              <LogOut size={13} /> <span className="admin-sidebar__label">Выйти из аккаунта</span>
            </button>
          </form>
        </div>
      </aside>

      <div className="admin-mobile-bar" role="navigation" aria-label="Навигация админ-панели">
        <span className="admin-mobile-bar__title" aria-live="polite">
          {nav.find((link) => link.href === `/${adminPath}` ? pathname === link.href : pathname.startsWith(link.href))?.label || "Управление"}
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
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.icon}
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="admin-mobile-bar__actions">
            <Link href="/" prefetch={false} target="_blank" className="admin-mobile-bar__action" aria-label="Открыть сайт" title="Открыть сайт" onClick={() => setMobileMenuOpen(false)}>
              <ExternalLink size={17} aria-hidden="true" />
              <span>Открыть сайт</span>
            </Link>
            <form action={`/${adminPath}/api/logout`} method="POST">
              <button type="submit" className="admin-mobile-bar__action" aria-label="Выйти из аккаунта" title="Выйти из аккаунта">
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
      </div>
    </div>
  );
}
