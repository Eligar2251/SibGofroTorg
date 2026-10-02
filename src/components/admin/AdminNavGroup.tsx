// =========================================================
// FILE: src/components/admin/AdminNavGroup.tsx
// Группа разделов в навигации админки — «выпадающий список»:
// заголовок с иконкой, по клику ниже раскрывается нормальный
// интерфейсный список вложенных разделов (анимация высоты +
// поочерёдное появление пунктов).
//
// Состояние раскрытия запоминается в localStorage отдельно для
// каждой группы; группа с активной страницей раскрывается сама.
// =========================================================

"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import {
  getNavIcon,
  isNavHrefActive,
  type NavGroupModel,
} from "@/lib/admin-nav";

const OPEN_PREFIX = "adm-nav-group-open:";

export function AdminNavGroup({
  group,
  pathname,
  adminPath,
  onNavigate,
  variant = "sidebar",
}: {
  group: NavGroupModel;
  pathname: string;
  adminPath: string;
  /** Вызывается после клика по вложенному разделу (меню планшета закрывается). */
  onNavigate?: () => void;
  /** sidebar — тёмная боковая панель; menu — выпадающее меню планшета. */
  variant?: "sidebar" | "menu";
}) {
  const storageKey = `${OPEN_PREFIX}${group.id}`;
  const containsActive = group.items.some((item) =>
    isNavHrefActive(item.href, pathname, adminPath)
  );
  // Начальное состояние одинаково на сервере и клиенте (гидрация):
  // открыта, если внутри есть активный раздел. Сохранённый вручную
  // выбор подтягивается эффектом уже после монтирования.
  const [open, setOpen] = useState(containsActive);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
    } catch {
      /* localStorage недоступен */
    }
  }, [storageKey]);

  // Переход в раздел внутри группы раскрывает её автоматически.
  useEffect(() => {
    if (containsActive) setOpen(true);
  }, [containsActive]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* localStorage недоступен */
      }
      return next;
    });
  }

  const Icon = getNavIcon(group.icon);
  const base =
    variant === "menu" ? "admin-nav-group admin-nav-group--menu" : "admin-nav-group";

  return (
    <div
      className={`${base}${open ? " admin-nav-group--open" : ""}${containsActive ? " admin-nav-group--here" : ""}`}
    >
      <button
        type="button"
        className="admin-nav-group__head"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`nav-group-body-${group.id}`}
        title={group.title}
      >
        <Icon size={variant === "menu" ? 17 : 18} aria-hidden="true" />
        <span className="admin-nav-group__title admin-sidebar__label">
          {group.title}
        </span>
        <span className="admin-nav-group__count admin-sidebar__label">
          {group.items.length}
        </span>
        <ChevronDown size={13} className="admin-nav-group__chevron" aria-hidden="true" />
      </button>

      <div
        id={`nav-group-body-${group.id}`}
        className="admin-nav-group__body"
        inert={!open}
        aria-hidden={!open}
      >
        <div className="admin-nav-group__clip">
          <div className="admin-nav-group__list" role="list">
            {group.items.map((item, index) => {
              const ItemIcon = getNavIcon(item.icon);
              const active = isNavHrefActive(item.href, pathname, adminPath);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  title={item.label}
                  role="listitem"
                  style={{ "--adm-ng-i": index } as CSSProperties}
                  className={`admin-nav-group__link${active ? " admin-nav-group__link--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                >
                  <ItemIcon size={15} aria-hidden="true" />
                  <span className="admin-sidebar__label">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
