"use client";

import { useEffect, useState } from "react";

interface EditableQuantityInputProps {
  value: number;
  min?: number;
  max?: number | null;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  onCommit: (qty: number) => void;
}

function clampNumber(value: number, min: number, max: number | null): number {
  let next = Math.max(min, Math.round(value));
  if (max != null) next = Math.min(max, next);
  return next;
}

/**
 * Клик/тап по центральному полю степпера → можно ввести своё число.
 * +/- остаются отдельными кнопками. Число фиксируется на blur и Enter,
 * чтобы при наборе многозначного количества корзина не «дёргалась» на
 * каждом символе.
 */
export function EditableQuantityInput({
  value,
  min = 1,
  max = null,
  className = "",
  ariaLabel = "Количество",
  disabled = false,
  onCommit,
}: EditableQuantityInputProps) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Если количество изменили кнопками +/- или из другого места,
  // а поле сейчас не редактируется — показываем актуальное значение.
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  function applyValue(raw: string, commit: boolean) {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      if (raw.trim() === "") {
        setText("");
        return;
      }
      if (commit) {
        const fallback = clampNumber(value, min, max);
        setText(String(fallback));
        if (fallback !== value) onCommit(fallback);
      }
      return;
    }

    const next = clampNumber(parsed, min, max);
    setText(String(next));
    if (commit && next !== value) onCommit(next);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Пока пользователь печатает — держим сырой ввод, чтобы не рушить
    // набор «100» из-за промежуточного «1». Запускаем обновление корзины
    // сразу для валидных целых чисел (например, ввели 25 и ушли из поля —
    // сумма уже актуальна).
    setText(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const next = clampNumber(parsed, min, max);
      setText(String(next));
      if (next !== value) onCommit(next);
    }
  }

  function handleBlur() {
    setFocused(false);
    applyValue(text, true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      setText(String(value));
      e.currentTarget.blur();
    }
  }

  return (
    <input
      type="number"
      inputMode="numeric"
      step={1}
      min={min}
      max={max ?? undefined}
      className={className}
      value={text}
      disabled={disabled && !focused}
      aria-label={ariaLabel}
      onFocus={() => setFocused(true)}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}
