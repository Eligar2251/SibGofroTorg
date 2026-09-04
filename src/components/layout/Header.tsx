// =========================================================
// FILE: src/components/layout/Header.tsx
// =========================================================

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { useCart } from "@/context/CartContext";
import {
  ShoppingCart,
  User,
  Menu,
  X,
  ChevronDown,
  MapPin,
  Clock,
  LogIn,
  Recycle,
  Mail,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { SearchBar } from "./SearchBar";
import { SiteLogo } from "./SiteLogo";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_HOURS_LABEL,
  SITE_EMAIL,
} from "@/lib/site-config";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { lockBodyScroll, unlockBodyScroll } from "@/hooks/use-body-lock";
import { fetchJsonSafe } from "@/lib/safe-fetch";

/** Категория в меню шапки. Приходит из серверного layout. */
export interface HeaderCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

export function Header({
  initialCategories = [],
}: {
  /**
   * Категории меню приходят с сервера (см. src/app/layout.tsx).
   * Раньше шапка запрашивала /api/categories из браузера на каждой
   * странице: лишний запрос в критическом пути и источник ошибки
   * «Failed to fetch», когда запрос перехватывал антивирус или
   * расширение браузера.
   */
  initialCategories?: HeaderCategory[];
} = {}) {
  const pathname = usePathname();
  const [categories, setCategories] = useState<HeaderCategory[]>(initialCategories);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const { totalItems } = useCart();
  // Подхватываем телефон/email/адрес из БД (админ-панель «Настройки»).
  // Пока запрос идёт, показываем дефолты из site-config.ts.
  const siteSettings = useSiteSettings();
  const headerPhone = siteSettings.phone || SITE_PHONE;
  const headerPhoneHref =
    siteSettings.phoneHref || SITE_PHONE_HREF;
  const headerEmail = siteSettings.email || SITE_EMAIL;
  const headerAddress = siteSettings.address || SITE_ADDRESS;
  const headerHours =
    siteSettings.hoursLabel || SITE_HOURS_LABEL;

  // Когда страница прокручена, шапка «отлипает» от верхней плашки —
  // добавляем тень, чтобы было видно, что она парит над контентом.
  useEffect(() => {
    function onScroll() {
      const isScrolled = window.scrollY > 8;
      setScrolled((prev) => (prev === isScrolled ? prev : isScrolled));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Список с сервера приходит новым массивом на каждый рендер layout,
  // поэтому сравниваем по содержимому — иначе state обновлялся бы вхолостую
  // на каждой навигации.
  const serverCategoriesKey = initialCategories.map((c) => c.id).join(",");
  useEffect(() => {
    if (!serverCategoriesKey) return;
    setCategories((prev) =>
      prev.map((c) => c.id).join(",") === serverCategoriesKey
        ? prev
        : initialCategories
    );
    // initialCategories намеренно не в зависимостях: ключ выше описывает
    // его содержимое, а сама ссылка меняется каждый рендер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverCategoriesKey]);

  // Фоллбэк на случай, если серверный layout категории не отдал
  // (например, БД была недоступна в момент рендера). Запрос
  // необязательный: не сработал — меню просто останется без разделов,
  // ошибку в консоль не пишем.
  useEffect(() => {
    if (serverCategoriesKey) return;
    const controller = new AbortController();
    void fetchJsonSafe<HeaderCategory[]>("/api/categories", {
      signal: controller.signal,
      label: "категории меню",
    }).then((data) => {
      if (Array.isArray(data) && data.length > 0) setCategories(data);
    });
    return () => controller.abort();
  }, [serverCategoriesKey]);

  // Header живёт между клиентскими переходами. Перепроверяем cookie сессии
  // на каждом маршруте, чтобы после регистрации второго номера на том же ПК
  // не оставались данные предыдущего аккаунта.
  useEffect(() => {
    let cancelled = false;
    setUserLoaded(false);
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.user) {
          setUserName(data.user.name || data.user.phone || "Кабинет");
        } else {
          setUserName(null);
        }
      })
      .catch(() => {
        if (!cancelled) setUserName(null);
      })
      .finally(() => {
        if (!cancelled) setUserLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function openCatalog() {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsCatalogOpen(true);
  }
  function closeCatalogDelayed() {
    hoverTimeout.current = setTimeout(() => setIsCatalogOpen(false), 150);
  }

  function closeMobileMenu({ returnFocus = false } = {}) {
    setIsMobileMenuOpen(false);
    if (returnFocus) requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Надёжная блокировка скролла (в т.ч. iOS Safari) — см. use-body-lock.ts
    lockBodyScroll();
    mobileMenuRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileMenu({ returnFocus: true });
        return;
      }
      if (event.key !== "Tab" || !mobileMenuRef.current) return;
      const focusable = Array.from(mobileMenuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      unlockBodyScroll();
      document.removeEventListener("keydown", onKeyDown);
      if (document.activeElement === document.body) previouslyFocused?.focus();
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="site-header-wrap">
      <div className="topbar">
        <div className="container-wide topbar-inner">
          <div className="topbar-left">
            <span className="topbar-item">
              <MapPin size={12} />
              <span className="hide-mobile">{headerAddress}</span>
            </span>
            <span className="topbar-item hide-mobile">
              <Clock size={12} />
              {headerHours}
            </span>
            <a
              href={headerEmail ? `mailto:${headerEmail}` : undefined}
              className="topbar-item topbar-email hide-mobile"
              aria-label="Написать нам на email"
            >
              <Mail size={12} />
              <span className="hide-mobile">{headerEmail}</span>
            </a>
          </div>
          <div className="topbar-right">
            <Link href="/about" className="hide-mobile">
              О компании
            </Link>
            <Link href="/delivery" className="hide-mobile">
              Доставка
            </Link>
            <Link
              href="/user-agreement"
              className="mobile-simple-link"
              onClick={() => closeMobileMenu()}
            >
              Пользовательское соглашение
            </Link>
            <Link href="/contacts" className="hide-mobile">
              Контакты
            </Link>
            <Link href="/wastepaper" className="hide-mobile">
              Макулатура
            </Link>
            <a href={headerPhoneHref} className="topbar-phone">
              {headerPhone}
            </a>
          </div>
        </div>
      </div>

      <header className={`site-header${scrolled ? " site-header--scrolled" : ""}`}>
        <div className="container-wide header-inner">
          <Link href="/" className="logo" aria-label="СибГофроТорг — на главную">
            <SiteLogo />
          </Link>

          <div
            className="catalog-dropdown-wrap"
            onMouseEnter={openCatalog}
            onMouseLeave={closeCatalogDelayed}
          >
            <button className={`catalog-toggle${isCatalogOpen ? " active" : ""}`}>
              <Menu size={17} />
              <span className="catalog-toggle-text">Каталог товаров</span>
              <ChevronDown size={14} className="chevron" />
            </button>

            {isCatalogOpen && (
              <div className="catalog-dropdown">
                {categories.length > 0 ? (
                  categories.map((cat) => (
                    <Link
                      key={cat.id}
                      href={`/catalog/${cat.slug}`}
                      className="catalog-dropdown-link"
                      onClick={() => setIsCatalogOpen(false)}
                    >
                      <span className="catalog-dropdown-icon">
                        <GlyphIcon value={cat.icon} size={18} />
                      </span>
                      {cat.name}
                    </Link>
                  ))
                ) : (
                  <div style={{ padding: "10px 16px", color: "var(--ink-muted)", fontSize: 13 }}>
                    Загрузка...
                  </div>
                )}
                <Link
                  href="/catalog"
                  className="catalog-dropdown-footer"
                  onClick={() => setIsCatalogOpen(false)}
                >
                  Открыть весь каталог →
                </Link>
              </div>
            )}
          </div>

          <SearchBar variant="header" placeholder="Поиск: коробки, скотч, плёнка..." />

          <div className="header-actions">
            {userLoaded && userName ? (
              <Link href="/cabinet" className="header-icon-btn">
                <User size={22} />
                <span>Кабинет</span>
              </Link>
            ) : (
              <Link href="/login?next=/cabinet" className="header-icon-btn">
                <LogIn size={22} />
                <span>Войти</span>
              </Link>
            )}

            <Link href="/order" className="header-icon-btn">
              <div style={{ position: "relative" }}>
                <ShoppingCart size={22} />
                {totalItems > 0 && (
                  <span className="cart-count">{totalItems > 99 ? "99+" : totalItems}</span>
                )}
              </div>
              <span>Корзина</span>
            </Link>

            <button
              ref={mobileMenuButtonRef}
              className="mobile-burger"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              aria-label={isMobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>
      </div>

      {isMobileMenuOpen && (
        <div
          ref={mobileMenuRef}
          id="mobile-navigation"
          className="mobile-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Мобильное меню"
          tabIndex={-1}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#999",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              margin: "16px 0 8px",
            }}
          >
            Категории
          </div>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/catalog/${cat.slug}`}
              className="mobile-cat-link"
              onClick={() => closeMobileMenu()}
            >
              <GlyphIcon value={cat.icon} size={20} />
              {cat.name}
            </Link>
          ))}

          <div style={{ marginTop: 16 }}>
            {userName ? (
              <Link
                href="/cabinet"
                className="mobile-simple-link"
                onClick={() => closeMobileMenu()}
              >
                <User size={15} /> Мои заказы
              </Link>
            ) : (
              <Link
                href="/login?next=/cabinet"
                className="mobile-simple-link"
                onClick={() => closeMobileMenu()}
              >
                <LogIn size={15} /> Войти / Регистрация
              </Link>
            )}
            <Link
              href="/wastepaper"
              className="mobile-simple-link"
              style={{ color: "var(--green)", fontWeight: 600 }}
              onClick={() => closeMobileMenu()}
            >
              <Recycle size={15} /> Приём макулатуры
            </Link>
            <Link
              href="/delivery"
              className="mobile-simple-link"
              onClick={() => closeMobileMenu()}
            >
              Доставка и оплата
            </Link>
            <Link
              href="/about"
              className="mobile-simple-link"
              onClick={() => closeMobileMenu()}
            >
              О компании
            </Link>
            <Link
              href="/contacts"
              className="mobile-simple-link"
              onClick={() => closeMobileMenu()}
            >
              Контакты
            </Link>
          </div>
        </div>
      )}
    </>
  );
}