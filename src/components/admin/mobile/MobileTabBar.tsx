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
// Навигация приходит уже с пользовательской настройкой (порядок,
// скрытые разделы, группы). В листе «Ещё» группы — раскрывающиеся
// секции: заголовок с иконкой, ниже плитками вложенные разделы.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ExternalLink,
  Grid2x2,
  LogOut,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useBodyLock } from "@/hooks/use-body-lock";
import {
  flattenNavModel,
  getNavIcon,
  isNavHrefActive,
  type NavGroupModel,
  type NavItemModel,
  type NavModelEntry,
} from "@/lib/admin-nav";
import styles from "./MobileTabBar.module.css";

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
  entries,
  pathname,
  adminPath,
  onCustomizeNav,
}: {
  /** Навигация с пользовательской настройкой (порядок/скрытие/группы). */
  entries: NavModelEntry[];
  pathname: string;
  adminPath: string;
  /** Открыть модалку «Настройка меню». */
  onCustomizeNav?: () => void;
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

  // Плоский список (порядок и скрытие пользователя учтены) — для
  // нижних плиток; группы в нижнюю панель не раскрываются.
  const items = useMemo(() => flattenNavModel(entries), [entries]);

  if (items.length === 0) return null;

  // Корень админки активен ТОЛЬКО при точном совпадении — иначе
  // префикс «/admin/» подсвечивал бы «Панель» на всех страницах.
  const isActive = (href: string) => isNavHrefActive(href, pathname, adminPath);

  const root = `/${adminPath}`;
  const primary = PRIMARY_PATHS.map((suffix) =>
    items.find((item) => item.href === `${root}${suffix}`),
  ).filter((item): item is NavItemModel => Boolean(item));

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
          const Icon = getNavIcon(item.icon);
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`${styles.tab}${active ? ` ${styles.tabActive}` : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className={styles.tabIcon}>
                <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
              </span>
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
            entries={entries}
            isActive={isActive}
            adminPath={adminPath}
            onCustomizeNav={onCustomizeNav}
          />,
          document.body,
        )}
    </>
  );
}

/* ── Группа в листе «Ещё»: заголовок + раскрывающиеся плитки ── */

const GROUP_OPEN_PREFIX = "adm-nav-group-open:";

function SheetGroup({
  group,
  isActive,
  onClose,
}: {
  group: NavGroupModel;
  isActive: (href: string) => boolean;
  onClose: () => void;
}) {
  const containsActive = group.items.some((item) => isActive(item.href));
  const [open, setOpen] = useState(containsActive);

  // Тот же ключ раскрытия, что у сайдбара: выбор пользователя един.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${GROUP_OPEN_PREFIX}${group.id}`);
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
    } catch {
      /* localStorage недоступен */
    }
  }, [group.id]);

  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(`${GROUP_OPEN_PREFIX}${group.id}`, next ? "1" : "0");
      } catch {
        /* localStorage недоступен */
      }
      return next;
    });
  }

  const Icon = getNavIcon(group.icon);
  return (
    <div
      className={`${styles.sheetGroup}${open ? ` ${styles.sheetGroupOpen}` : ""}`}
    >
      <button
        type="button"
        className={styles.sheetGroupHead}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className={styles.sheetGroupIcon}>
          <Icon size={16} aria-hidden="true" />
        </span>
        <span className={styles.sheetGroupTitle}>{group.title}</span>
        <span className={styles.sheetGroupCount}>{group.items.length}</span>
        <ChevronDown size={15} className={styles.sheetGroupChevron} aria-hidden="true" />
      </button>
      <div className={styles.sheetGroupBody} inert={!open} aria-hidden={!open}>
        <div className={styles.sheetGroupClip}>
          <div className={styles.grid}>
            {group.items.map((item) => {
              const ItemIcon = getNavIcon(item.icon);
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  prefetch={false}
                  className={`${styles.tile}${active ? ` ${styles.tileActive}` : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onClose}
                >
                  <span className={styles.tileIcon}>
                    <ItemIcon size={20} aria-hidden="true" />
                  </span>
                  <span className={styles.tileLabel}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Лист «Ещё»: все разделы сеткой + служебные действия ── */

function MoreSheet({
  open,
  onClose,
  entries,
  isActive,
  adminPath,
  onCustomizeNav,
}: {
  open: boolean;
  onClose: () => void;
  entries: NavModelEntry[];
  isActive: (href: string) => boolean;
  adminPath: string;
  onCustomizeNav?: () => void;
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

        <div className={styles.sheetEntries}>
          {entries.map((entry) => {
            if (entry.kind === "group") {
              return (
                <SheetGroup
                  key={`sheet-group-${entry.id}`}
                  group={entry}
                  isActive={isActive}
                  onClose={onClose}
                />
              );
            }
            const Icon = getNavIcon(entry.icon);
            const active = isActive(entry.href);
            return (
              <Link
                key={entry.key}
                href={entry.href}
                prefetch={false}
                className={`${styles.tile}${active ? ` ${styles.tileActive}` : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
              >
                <span className={styles.tileIcon}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className={styles.tileLabel}>{entry.label}</span>
              </Link>
            );
          })}
        </div>

        <div className={styles.sheetActions}>
          {onCustomizeNav && (
            <button
              type="button"
              className={styles.sheetAction}
              onClick={() => {
                onClose();
                onCustomizeNav();
              }}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>Настроить меню</span>
            </button>
          )}
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
