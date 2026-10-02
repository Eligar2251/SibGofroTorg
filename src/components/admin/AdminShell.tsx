// src/components/admin/AdminShell.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ExternalLink,
  LogOut,
  PanelLeftClose,
  ChevronRight,
  Menu,
  X,
  SlidersHorizontal,
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
import { AdminNavGroup } from "./AdminNavGroup";
import { AdminNavCustomizer } from "./AdminNavCustomizer";
import { canAccessAdminPage, type AdminRole } from "@/lib/admin-rbac";
import {
  ADMIN_NAV_ITEMS,
  buildNavModel,
  flattenNavModel,
  getNavIcon,
  isNavHrefActive,
  navItemHref,
  type AdminNavItemDef,
  type AdminNavSettingsDto,
} from "@/lib/admin-nav";

const SIDEBAR_PREF_KEY = "admin-sidebar-hidden";

export function AdminShell({
  children,
  adminPath,
  role,
  displayName,
  navSettings,
}: {
  children: ReactNode;
  adminPath: string;
  role: AdminRole | null;
  displayName: string | null;
  /** Персональные настройки навигации пользователя (порядок/скрытие/группы). */
  navSettings: AdminNavSettingsDto | null;
}) {
  const pathname = usePathname() || "";
  const isLogin = pathname === `/${adminPath}/login`;
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileDrawerEnabled, setMobileDrawerEnabled] = useState(false);
  const [customizerOpen, setCustomizerOpen] = useState(false);
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

  // Персональные настройки меню: приходят с сервера (БД) и дальше
  // живут в состоянии — настройщик обновляет их без перезагрузки.
  const [navSettingsState, setNavSettingsState] = useState<AdminNavSettingsDto | null>(navSettings);
  useEffect(() => {
    // Повторная загрузка страницы/навигация могла принести свежие
    // настройки из БД — применяем, если они отличаются от текущих.
    setNavSettingsState((prev) =>
      JSON.stringify(prev ?? null) === JSON.stringify(navSettings ?? null)
        ? prev
        : navSettings
    );
  }, [navSettings]);

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
          "sidebar-left"
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

  // Страница «Настройки» может открыть настройщик меню этим событием
  // (состояние модалки живёт здесь, в оболочке).
  useEffect(() => {
    const onOpenCustomizer = () => setCustomizerOpen(true);
    window.addEventListener("admin-open-nav-customizer", onOpenCustomizer);
    return () =>
      window.removeEventListener("admin-open-nav-customizer", onOpenCustomizer);
  }, []);

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
  // Реестр фильтруется по роли, затем к нему применяются персональные
  // настройки пользователя (порядок, скрытые разделы, группы). Модель
  // нужна сайдбару (десктоп), планшетной панели, мобильной оболочке
  // и нижнему меню — считается один раз до ветки рендера.
  const availableItems = useMemo<AdminNavItemDef[]>(() => {
    if (!role) return [];
    return ADMIN_NAV_ITEMS.filter((item) =>
      canAccessAdminPage(role, navItemHref(adminPath, item.key), adminPath)
    );
  }, [role, adminPath]);

  const navModel = useMemo(
    () => buildNavModel(availableItems, navSettingsState, adminPath),
    [availableItems, navSettingsState, adminPath]
  );
  const flatNav = useMemo(() => flattenNavModel(navModel), [navModel]);

  if (isLogin) {
    return <div data-admin="true">{children}</div>;
  }

  // Модалка «Настройка меню»: одна на все варианты оболочки.
  const customizer = role ? (
    <AdminNavCustomizer
      open={customizerOpen}
      availableItems={availableItems}
      settings={navSettingsState}
      onClose={() => setCustomizerOpen(false)}
      onSaved={setNavSettingsState}
    />
  ) : null;

  // ── Телефон: отдельная оболочка «как нативное приложение» ──
  // Шапка с заголовком раздела + нижние вкладки + лист «Ещё».
  // Десктопная разметка (сайдбар, тулбар, бургер) на телефон вообще
  // не рендерится — мобильный вид больше не «ужимает» десктопный,
  // телефон получает собственный интерфейс.
  if (isPhone) {
    return (
      <>
        <MobileAdminShell
          adminPath={adminPath}
          role={role}
          displayName={displayName}
          entries={navModel}
          onCustomizeNav={() => setCustomizerOpen(true)}
        >
          {children}
        </MobileAdminShell>
        {customizer}
      </>
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

        <nav className="admin-sidebar__nav">
          {navModel.map((entry) => {
            if (entry.kind === "group") {
              return (
                <AdminNavGroup
                  key={`group-${entry.id}`}
                  group={entry}
                  pathname={pathname}
                  adminPath={adminPath}
                />
              );
            }
            const Icon = getNavIcon(entry.icon);
            const active = isNavHrefActive(entry.href, pathname, adminPath);
            return (
              <Link
                key={entry.key}
                href={entry.href}
                title={entry.label}
                className={`admin-sidebar__link${active ? " admin-sidebar__link--active" : ""}`}
              >
                <Icon size={18} aria-hidden="true" />
                {/* Подпись обёрнута в span: в «компактной» раскладке
                    CSS прячет текст и оставляет только иконки. */}
                <span className="admin-sidebar__label">{entry.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar__footer">
          {/* Переключателя темы здесь больше нет: вся кастомизация
              (темы, раскладка, стиль, плотность, анимации) живёт
              в Настройках → «Кастомизация оформления». */}
          <button
            type="button"
            className="admin-sidebar__footer-link"
            onClick={() => setCustomizerOpen(true)}
            title="Порядок разделов, скрытие ненужных и группы"
          >
            <SlidersHorizontal size={13} aria-hidden="true" />{" "}
            <span className="admin-sidebar__label">Настроить меню</span>
          </button>
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
          {flatNav.find((item) => isNavHrefActive(item.href, pathname, adminPath))
            ?.label || "Управление"}
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
            {navModel.map((entry) => {
              if (entry.kind === "group") {
                return (
                  <AdminNavGroup
                    key={`menu-group-${entry.id}`}
                    group={entry}
                    pathname={pathname}
                    adminPath={adminPath}
                    variant="menu"
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                );
              }
              const Icon = getNavIcon(entry.icon);
              const active = isNavHrefActive(entry.href, pathname, adminPath);
              return (
                <Link
                  key={entry.key}
                  href={entry.href}
                  prefetch={false}
                  className={`admin-mobile-bar__link${
                    active ? " admin-mobile-bar__link--active" : ""
                  }`}
                  title={entry.label}
                  aria-label={entry.label}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{entry.label}</span>
                </Link>
              );
            })}
          </div>
          <div className="admin-mobile-bar__actions">
            <button
              type="button"
              className="admin-mobile-bar__action"
              aria-label="Настроить меню"
              title="Порядок разделов, скрытие ненужных и группы"
              onClick={() => {
                setMobileMenuOpen(false);
                setCustomizerOpen(true);
              }}
            >
              <SlidersHorizontal size={17} aria-hidden="true" />
              <span>Настроить меню</span>
            </button>
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
            компонент не создаётся вовсе. Группы в нижнем меню не
            раскрываются — туда попадает плоский список с учётом
            пользовательского порядка и скрытых разделов. */}
        {isMobile && (
          <AdminBottomNav
            items={flatNav.map((item) => {
              const Icon = getNavIcon(item.icon);
              return {
                href: item.href,
                label: item.label,
                icon: <Icon size={20} aria-hidden="true" />,
              };
            })}
            pathname={pathname}
            adminPath={adminPath}
          />
        )}
      </div>

      {customizer}
    </div>
  );
}
