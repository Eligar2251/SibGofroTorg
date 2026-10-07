// =========================================================
// FILE: src/components/admin/mobile/MobileTabBar.tsx
// Нижняя панель вкладок мобильной админки + лист «Ещё».
//
// Дизайн — как у нативного приложения:
//   • 4 главных раздела + кнопка «Ещё»;
//   • активная вкладка подсвечена «пилюлей» и цветом (тема);
//   • отклик на нажатие — лёгкое сжатие (transform, 120 Гц);
//   • лист «Ещё» выезжает снизу с пружинным cubic-bezier,
//     затемнение фона — opacity, скролл листа не тянет страницу
//     (overscroll-behavior: contain).
//
// Заменяет прежний AdminBottomNav (тёмная «полоса без воздуха»).
// Старый файл удалён: на планшетах 769–1024px остаётся прежняя
// панель с бургером, телефону она больше не нужна.
// =========================================================

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, Grid2x2, LogOut, SlidersHorizontal, X } from "lucide-react";
import { useBodyLock } from "@/hooks/use-body-lock";
import { useAdminNavOptional } from "@/components/admin/AdminNavProvider";
import { AdminNavIcon } from "@/components/admin/AdminNavIcon";
import type { ResolvedNavEntry } from "@/lib/admin-nav";
import styles from "./MobileTabBar.module.css";

export type MobileNavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

/** Разделы нижней панели (если доступны роли). Порядок = частоте use. */
const PRIMARY_PATHS = [
  "", // Панель
  "/orders", // Заявки
  "/products", // Товары
  "/warehouse", // Учёт СибГофроТорг
];

/** Длительность анимаций листа, мс — синхронизирована с CSS. */
const SHEET_MS = 280;

/** Короткие подписи для нижней панели (ширина плитки ~70 px, одна строка). */
const SHORT_LABELS: Record<string, string> = {
  "Учёт СибГофроТорг": "Учёт",
  "Учёт макулатура": "Макулатура",
};

function shortLabel(label: string): string {
  // «Товары и категории» → «Товары», «Учёт макулатура» → «Макулатура»,
  // «Учёт СибГофроТорг» → «Учёт» (полное имя в плитку не помещается).
  if (SHORT_LABELS[label]) return SHORT_LABELS[label];
  const parts = label.split(/[\s(·—-]+/).filter(Boolean);
  if (parts.length === 2 && /^[А-ЯЁA-Z]{2,4}$/.test(parts[1])) return label;
  return parts[0] || label;
}

export function MobileTabBar({
  items,
  pathname,
  adminPath,
}: {
  items: MobileNavItem[];
  pathname: string;
  adminPath: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Портал для листа монтируем только на клиенте (иначе SSR/гидрация
  // разойдутся) — лист поверх всего, включая fixed-шапку.
  useEffect(() => setMounted(true), []);

  useBodyLock(moreOpen);

  // Переход по ссылке — лист закрывается.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const moreRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMoreOpen(false);
      moreRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  if (items.length === 0) return null;

  // Корень админки активен ТОЛЬКО при точном совпадении — иначе
  // префикс «/admin/» подсвечивал бы «Панель» на всех страницах.
  const root = `/${adminPath}`;
  const isActive = (href: string) =>
    href === root
      ? pathname === href
      : href === pathname || pathname.startsWith(`${href}/`);

  const primary = PRIMARY_PATHS.map((suffix) =>
    items.find((item) => item.href === `${root}${suffix}`),
  ).filter((item): item is MobileNavItem => Boolean(item));

  // Роли без «полного» доступа: добираем первые доступные разделы.
  const seen = new Set(primary);
  for (const item of items) {
    if (primary.length >= 4) break;
    if (!seen.has(item)) {
      primary.push(item);
      seen.add(item);
    }
  }

  const rest = items.filter((item) => !primary.includes(item));
  const moreActive = rest.some((item) => isActive(item.href));

  return (
    <>
      {/* Прокладка в потоке: чтобы последний блок страницы не прятался
          под фиксированной панелью (высота = панель + safe-area). */}
      <div className={styles.spacer} aria-hidden="true" />

      <nav className={styles.bar} aria-label="Основная навигация админ-панели">
        {primary.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.tabIcon}>{item.icon}</span>
              <span className={styles.tabLabel}>{shortLabel(item.label)}</span>
              {active && <span className={styles.tabIndicator} aria-hidden="true" />}
            </Link>
          );
        })}

        <button
          type="button"
          ref={(node) => {
            moreRef.current = node;
          }}
          className={`${styles.tab}${moreActive || moreOpen ? ` ${styles.tabActive}` : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-label="Все разделы"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
        >
          <span className={styles.tabIcon}>
            {moreOpen ? <X size={22} strokeWidth={1.9} /> : <Grid2x2 size={22} strokeWidth={1.9} />}
          </span>
          <span className={styles.tabLabel}>Ещё</span>
          {(moreActive || moreOpen) && (
            <span className={styles.tabIndicator} aria-hidden="true" />
          )}
        </button>
      </nav>

      {mounted &&
        createPortal(
          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            items={items}
            isActive={isActive}
            adminPath={adminPath}
          />,
          document.body,
        )}
    </>
  );
}

function SheetCustomize({ onClose }: { onClose: () => void }) {
  const nav = useAdminNavOptional();
  if (!nav) return null;
  return (
    <button
      type="button"
      className={`${styles.sheetAction} ${styles.sheetCustomize}`}
      onClick={() => {
        onClose();
        nav.openCustomizer();
      }}
    >
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span>Настроить меню</span>
    </button>
  );
}

function SheetSections({
  items,
  isActive,
  onClose,
}: {
  items: MobileNavItem[];
  isActive: (href: string) => boolean;
  onClose: () => void;
}) {
  const nav = useAdminNavOptional();
  const tree = nav?.tree;
  const hasGroups = Boolean(tree?.some((entry) => entry.type === "group"));
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!tree) return;
    const active = tree.find(
      (entry) =>
        entry.type === "group" && entry.items.some((child) => isActive(child.item.href)),
    );
    if (!active || active.type !== "group") return;
    setOpen((prev) => (prev[active.id] ? prev : { ...prev, [active.id]: true }));
  }, [tree, isActive]);

  if (!hasGroups || !tree) {
    return (
      <div className={styles.grid}>
        {items.map((item) => (
          <SheetTile key={item.href} item={item} active={isActive(item.href)} onClose={onClose} />
        ))}
      </div>
    );
  }

  const blocks: React.ReactNode[] = [];
  let loose: ResolvedNavEntry[] = [];
  const flush = () => {
    if (!loose.length) return;
    const chunk = loose;
    loose = [];
    blocks.push(
      <div className={styles.grid} key={`loose-${blocks.length}`}>
        {chunk.map((entry) => {
          if (entry.type !== "item") return null;
          return (
            <SheetTile
              key={entry.item.href}
              item={{
                href: entry.item.href,
                label: entry.label,
                icon: <AdminNavIcon id={entry.icon} size={20} />,
              }}
              active={isActive(entry.item.href)}
              onClose={onClose}
            />
          );
        })}
      </div>,
    );
  };

  for (const entry of tree) {
    if (entry.type === "item") {
      loose.push(entry);
      continue;
    }
    flush();
    const expanded = Boolean(open[entry.id]);
    blocks.push(
      <section
        key={entry.id}
        className={`${styles.group}${expanded ? ` ${styles.groupOpen}` : ""}`}
      >
        <button
          type="button"
          className={styles.groupHead}
          aria-expanded={expanded}
          onClick={() => setOpen((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))}
        >
          <span className={styles.groupHeadIcon}>
            <AdminNavIcon id={entry.icon} size={18} />
          </span>
          <span className={styles.groupHeadLabel}>{entry.label}</span>
          <ChevronDown size={16} className={styles.groupChevron} aria-hidden="true" />
        </button>
        <div className={styles.groupPanel}>
          <div className={styles.groupPanelInner}>
            <div className={styles.grid}>
              {entry.items.map((child) => (
                <SheetTile
                  key={child.item.href}
                  item={{
                    href: child.item.href,
                    label: child.label,
                    icon: <AdminNavIcon id={child.icon} size={20} />,
                  }}
                  active={isActive(child.item.href)}
                  onClose={onClose}
                />
              ))}
            </div>
          </div>
        </div>
      </section>,
    );
  }
  flush();
  return <div className={styles.sections}>{blocks}</div>;
}

function SheetTile({
  item,
  active,
  onClose,
}: {
  item: MobileNavItem;
  active: boolean;
  onClose: () => void;
}) {
  return (
    <Link
      href={item.href}
      prefetch={false}
      className={`${styles.tile}${active ? ` ${styles.tileActive}` : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClose}
    >
      <span className={styles.tileIcon}>{item.icon}</span>
      <span className={styles.tileLabel}>{item.label}</span>
    </Link>
  );
}

/* ── Лист «Ещё»: все разделы сеткой + служебные действия ── */

function MoreSheet({
  open,
  onClose,
  items,
  isActive,
  adminPath,
}: {
  open: boolean;
  onClose: () => void;
  items: MobileNavItem[];
  isActive: (href: string) => boolean;
  adminPath: string;
}) {
  // Лист живёт в DOM, пока идёт анимация закрытия (state «closing»).
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      if (timer.current) clearTimeout(timer.current);
      setRender(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      setRender(false);
      setClosing(false);
    }, SHEET_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);

  if (!render) return null;

  return (
    <div className={styles.sheetRoot} role="presentation">
      <button
        type="button"
        className={`${styles.backdrop}${closing ? ` ${styles.backdropOut}` : ""}`}
        onClick={onClose}
        aria-label="Закрыть меню разделов"
        tabIndex={open ? 0 : -1}
      />
      <div
        className={`${styles.sheet}${closing ? ` ${styles.sheetOut}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Все разделы админ-панели"
      >
        <span className={styles.handle} aria-hidden="true" />

        <div className={styles.sheetHead}>
          <span className={styles.sheetTitle}>Все разделы</span>
          <button
            type="button"
            className={styles.sheetClose}
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>

        <SheetSections items={items} isActive={isActive} onClose={onClose} />

        <div className={styles.sheetActions}>
          <SheetCustomize onClose={onClose} />
          <Link
            href="/"
            prefetch={false}
            target="_blank"
            className={styles.sheetAction}
            onClick={onClose}
          >
            <ExternalLink size={16} aria-hidden="true" />
            <span>Открыть сайт</span>
          </Link>
          <form action={`/${adminPath}/api/logout`} method="POST">
            <button type="submit" className={`${styles.sheetAction} ${styles.sheetActionDanger}`}>
              <LogOut size={16} aria-hidden="true" />
              <span>Выйти</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
