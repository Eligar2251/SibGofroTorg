"use client";

import Link from "next/link";

/**
 * Обязательный чекбокс согласия на обработку персональных данных (152-ФЗ).
 * Используется на всех формах с полями «Имя» / «Телефон».
 *
 * Управляется родителем: он хранит состояние `checked` и передаёт сюда,
 * а при попытке отправки без согласия выставляет `error = true`.
 */
export function ConsentCheckbox({
  checked,
  onChange,
  error = false,
  variant = "default",
  name = "consent",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: boolean;
  variant?: "default" | "light" | "dark";
  name?: string;
}) {
  const isDark = variant === "dark";
  const isLight = variant === "light";

  return (
    <div className="consent">
      <label
        className={`consent__label${isDark ? " consent__label--dark" : ""}${
          isLight ? " consent__label--light" : ""
        }`}
      >
        <input
          type="checkbox"
          name={name}
          className="consent__input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-required="true"
        />
        <span className="consent__text">
          Я согласен(на) на{" "}
          <Link href="/privacy" target="_blank" className="consent__link">
            обработку персональных данных
          </Link>
          <span className="consent__req">*</span>
        </span>
      </label>
      {error && (
        <div className="consent__error">
          Необходимо согласиться на обработку персональных данных
        </div>
      )}
    </div>
  );
}
