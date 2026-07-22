// =========================================================
// FILE: src/components/admin/SearchPicker.tsx
// Переиспользуемые контролы выбора с поиском для форм учёта.
//
//  • SearchCombobox  — строка ввода с выпадающим списком
//    найденного. Разрешает ручной ввод (можно вписать нового
//    контрагента, которого ещё нет в базе). Заменяет нативный
//    <input list="…"> / <datalist>, который неудобен на мобильных
//    и не показывает реквизиты. Используется для выбора
//    контрагента (поставщика / покупателя / плательщика).
//
//  • SearchMultiSelect — поиск + список с галочками и чипсами
//    выбранного. Заменяет «простыню» чипов без поиска. Используется
//    для привязки заказов, поступлений и платежей.
//
// Оба контрола принимают единый формат PickerOption, поэтому любой
// список (заказы, поступления, платежи, контрагенты) подключается
// одним и тем же компонентом.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

export interface PickerOption {
  id: string;
  /** Основная строка (жирная): «ЗК-12 · Иванов» */
  title: string;
  /** Вторая строка: дата, сумма, статус */
  meta?: string;
  /** Третья мелкая строка: состав позиций и т.п. */
  hint?: string;
  /** Текст справа (обычно сумма) */
  right?: string;
  /** Дополнительные слова для поиска (например, названия товаров) */
  keywords?: string;
}

function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

function matches(option: PickerOption, q: string): boolean {
  if (!q) return true;
  const hay = [option.title, option.meta, option.hint, option.keywords]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru-RU");
  return hay.includes(q);
}

/**
 * Комбобокс: ввод + выпадающий список. Значение — произвольная строка,
 * поэтому можно выбрать существующий вариант ИЛИ вписать новый.
 */
export function SearchCombobox({
  options,
  value,
  onChange,
  placeholder,
  emptyText = "Ничего не найдено",
  required,
}: {
  options: PickerOption[];
  value: string;
  /** Вызывается при вводе и при выборе варианта из списка */
  onChange: (value: string, option?: PickerOption) => void;
  placeholder?: string;
  emptyText?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const q = value.trim().toLocaleLowerCase("ru-RU");
  const results = useMemo(
    () => options.filter((o) => matches(o, q)).slice(0, 50),
    [options, q]
  );

  return (
    <div className="spicker" ref={ref}>
      <div className="spicker__input-wrap">
        <Search size={13} className="spicker__icon" />
        <input
          type="text"
          className="admin-input spicker__input"
          value={value}
          placeholder={placeholder}
          required={required}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {value && (
          <button
            type="button"
            className="spicker__clear"
            onClick={() => onChange("")}
            aria-label="Очистить"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div className="spicker__list">
          {results.length === 0 ? (
            <div className="spicker__empty">{emptyText}</div>
          ) : (
            results.map((o) => (
              <button
                key={o.id}
                type="button"
                className="spicker__opt"
                onClick={() => {
                  onChange(o.title, o);
                  setOpen(false);
                }}
              >
                <span className="spicker__opt-text">
                  <span className="spicker__opt-title">{o.title}</span>
                  {o.meta && <span className="spicker__opt-meta">{o.meta}</span>}
                </span>
                {o.right && <span className="spicker__opt-right">{o.right}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Мультивыбор с поиском: строка поиска, чипсы выбранного и список
 * с галочками. Список встроен в форму (не всплывает), поэтому не
 * обрезается краями модалки.
 */
export function SearchMultiSelect({
  options,
  selectedIds,
  onToggle,
  placeholder = "Поиск…",
  emptyText = "Ничего не найдено",
  maxHeight = 210,
}: {
  options: PickerOption[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  placeholder?: string;
  emptyText?: string;
  maxHeight?: number;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase("ru-RU");

  const results = useMemo(
    () => options.filter((o) => matches(o, q)),
    [options, q]
  );

  const selectedOptions = useMemo(
    () =>
      selectedIds
        .map((id) => options.find((o) => o.id === id))
        .filter((o): o is PickerOption => Boolean(o)),
    [options, selectedIds]
  );

  return (
    <div className="spicker spicker--multi">
      <div className="spicker__input-wrap">
        <Search size={13} className="spicker__icon" />
        <input
          type="text"
          className="admin-input spicker__input"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="spicker__clear"
            onClick={() => setQuery("")}
            aria-label="Очистить поиск"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {selectedOptions.length > 0 && (
        <div className="spicker__chips">
          {selectedOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              className="spicker__chip"
              onClick={() => onToggle(o.id)}
              title="Убрать"
            >
              <span>{o.title}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      )}

      <div className="spicker__list spicker__list--inline" style={{ maxHeight }}>
        {results.length === 0 ? (
          <div className="spicker__empty">{emptyText}</div>
        ) : (
          results.map((o) => {
            const active = selectedIds.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                className={`spicker__opt${active ? " spicker__opt--active" : ""}`}
                onClick={() => onToggle(o.id)}
              >
                <span
                  className={`spicker__check${active ? " spicker__check--on" : ""}`}
                >
                  {active && <Check size={11} />}
                </span>
                <span className="spicker__opt-text">
                  <span className="spicker__opt-title">{o.title}</span>
                  {o.meta && <span className="spicker__opt-meta">{o.meta}</span>}
                  {o.hint && <span className="spicker__opt-hint">{o.hint}</span>}
                </span>
                {o.right && <span className="spicker__opt-right">{o.right}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
