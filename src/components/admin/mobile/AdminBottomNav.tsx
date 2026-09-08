// =========================================================
// FILE: src/components/admin/mobile/AdminBottomNav.tsx
// Нижнее меню мобильной админки (отдельный мобильный компонент —
// десктопная боковая панель при этом не меняется).
//
// Почему снизу, а не в шапке:
// на iPhone X (812px по высоте) большой палец до верхней панели не
// дотягивается, а разделы админки переключают постоянно. В шапке
// остаётся только название раздела, бургер и три индикатора.
//
// Состоит из 4 самых частых разделов + «Ещё» (лист со всеми
// остальными, выходом и переходом на сайт). Список разделов
// comes from AdminShell — там уже отфильтрован по роли.
// =========================================================

"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, LogOut, MoreHorizontal, X } from "lucide-react";
import { useBodyLock } from "@/hooks/use-body-lock";
import styles from "./AdminBottomNav.module.css";

export type MobileNavItem = {
  href: string;
  label: string;
  icon: ReactNode;
};

/** Разделы, которые всегда показываем в нижнем меню (если доступны роли). */
const PRIMARY_PATHS = [
  "", // Панель
  "/orders",
  "/products",
  "/warehouse",
];

function shortLabel(label: string): string {
  // «Товары и категории» → «Товары», «Макулатура (учёт)» → «Макулатура».
  return label.split(/[\s(·—-]/)[0] || label;
}

export function AdminBottomNav({
  items,
  pathname,
  adminPath,
}: {
  items: MobileNavItem[];
  pathname: string;
  adminPath: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);

  // Лист «Ещё» блокирует прокрутку фона (iOS-safe, со счётчиком).
  useBodyLock(moreOpen);

  // После перехода лист закрываем сами — иначе он останется висеть
  // поверх новой страницы.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  if (items.length === 0) return null;

  const isActive = (href: string) =>
    href === `/${adminPath}` ? pathname === href : pathname.startsWith(href);

  const root = `/${adminPath}`;
  const primary = PRIMARY_PATHS.map((suffix) =>
    items.find((item) => item.href === `${root}${suffix}`),
  ).filter((item): item is MobileNavItem => Boolean(item));

  // Если у роли нет доступа к «основным» разделам — берём первые доступные.
  while (primary.length < Math.min(4, items.length)) {
    const next = items.find((item) => !primary.includes(item));
    if (!next) break;
    primary.push(next);
  }

  const rest = items.filter((item) => !primary.includes(item));
  const moreActive = rest.some((item) => isActive(item.href));

  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />

      <nav className={styles.nav} aria-label="Основная навигация админ-панели">
        {primary.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`${styles.item}${active ? ` ${styles.active}` : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {item.icon}
              <span className={styles.label}>{shortLabel(item.label)}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className={`${styles.item}${moreActive ? ` ${styles.active}` : ""}`}
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="admin-bottom-nav-more"
        >
          {moreOpen ? <X size={20} /> : <MoreHorizontal size={20} />}
          <span className={styles.label}>{moreOpen ? "Закрыть" : "Ещё"}</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <button
            type="button"
            className={styles.backdrop}
            onClick={() => setMoreOpen(false)}
            aria-label="Закрыть меню"
          />
          <div
            id="admin-bottom-nav-more"
            className={styles.sheet}
            role="dialog"
            aria-label="Все разделы админ-панели"
          >
            <div className={styles.sheetHead}>
              <span>Все разделы</span>
              <button
                type="button"
                className={styles.close}
                onClick={() => setMoreOpen(false)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.grid}>
              {items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className={`${styles.tile}${active ? ` ${styles.tileActive}` : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.icon}
                    <span className={styles.tileLabel}>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className={styles.actions}>
              <Link
                href="/"
                prefetch={false}
                target="_blank"
                className={styles.action}
                onClick={() => setMoreOpen(false)}
              >
                <ExternalLink size={16} aria-hidden="true" />
                <span>Открыть сайт</span>
              </Link>
              <form action={`/${adminPath}/api/logout`} method="POST">
                <button type="submit" className={styles.action}>
                  <LogOut size={16} aria-hidden="true" />
                  <span>Выйти</span>
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
