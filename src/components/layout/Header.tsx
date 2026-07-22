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
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { SearchBar } from "./SearchBar";
import { SiteLogo } from "./SiteLogo";
import {
  SITE_ADDRESS,
  SITE_PHONE,
  SITE_PHONE_HREF,
  SITE_HOURS_WEEKDAY,
  SITE_HOURS_SATURDAY,
} from "@/lib/site-config";

interface Category {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

export function Header() {
  const pathname = usePathname();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { totalItems } = useCart();

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

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setCategories(data);
      })
      .catch(console.error);
  }, []);

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

  return (
    <>
      <div className="topbar">
        <div className="container-wide topbar-inner">
          <div className="topbar-left">
            <span className="topbar-item">
              <MapPin size={12} />
              <span className="hide-mobile">{SITE_ADDRESS}</span>
            </span>
            <span className="topbar-item hide-mobile">
              <Clock size={12} />
              Пн–Пт {SITE_HOURS_WEEKDAY} · Сб {SITE_HOURS_SATURDAY}
            </span>
          </div>
          <div className="topbar-right">
            <Link href="/about" className="hide-mobile">
              О компании
            </Link>
            <Link href="/delivery" className="hide-mobile">
              Доставка
            </Link>
            <Link href="/contacts" className="hide-mobile">
              Контакты
            </Link>
            <a href={SITE_PHONE_HREF} className="topbar-phone">
              {SITE_PHONE}
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
              className="mobile-burger"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="mobile-menu-panel">
          <SearchBar variant="compact" placeholder="Поиск товаров..." />

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
              onClick={() => setIsMobileMenuOpen(false)}
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
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <User size={15} /> Мои заказы
              </Link>
            ) : (
              <Link
                href="/login?next=/cabinet"
                className="mobile-simple-link"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <LogIn size={15} /> Войти / Регистрация
              </Link>
            )}
            <Link
              href="/wastepaper"
              className="mobile-simple-link"
              style={{ color: "var(--green)", fontWeight: 600 }}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              <Recycle size={15} /> Приём макулатуры
            </Link>
            <Link
              href="/delivery"
              className="mobile-simple-link"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Доставка и оплата
            </Link>
            <Link
              href="/about"
              className="mobile-simple-link"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              О компании
            </Link>
            <Link
              href="/contacts"
              className="mobile-simple-link"
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Контакты
            </Link>
          </div>
        </div>
      )}
    </>
  );
}