"use client";

import Link from "next/link";

/**
 * Текст согласия рядом с чекбоксом (152-ФЗ, ст. 9).
 *
 * Требования, которые здесь закрыты:
 *  • отдельный документ согласия — ссылка на /consent (согласие нельзя
 *    «прятать» в политику конфиденциальности);
 *  • ссылка на политику обработки персональных данных — /privacy;
 *  • указание оператора, перечня данных и цели обработки — в самом тексте;
 *  • чекбокс пустой по умолчанию и обязательный (см. required ниже),
 *    отправка формы без согласия заблокирована (проверка в формах).
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
  purpose,
  dataList = "имя, номер телефона, адрес электронной почты",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: boolean;
  variant?: "default" | "light" | "dark";
  name?: string;
  /** Цель обработки для конкретной формы (заявка, заказ, регистрация…). */
  purpose?: string;
  /** Перечень данных, которые собирает конкретная форма. */
  dataList?: string;
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
          required
          aria-required="true"
        />
        <span className="consent__text">
          Я даю согласие ООО «СибГофроТорг» на обработку моих персональных
          данных ({dataList}) в целях {purpose || "обработки моей заявки и обратной связи со мной"} на
          условиях{" "}
          <Link href="/consent" target="_blank" className="consent__link">
            Согласия на обработку персональных данных
          </Link>{" "}
          и подтверждаю, что ознакомлен(а) с{" "}
          <Link href="/privacy" target="_blank" className="consent__link">
            Политикой конфиденциальности
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

/**
 * Короткая строка под формой — для случаев, когда чекбокса нет
 * (вход в личный кабинет, отзывы). Дублирует намерение и даёт ссылки
 * на отдельный документ согласия и политику.
 */
export function ConsentNote({
  variant = "default",
  children,
}: {
  variant?: "default" | "light" | "dark";
  children?: React.ReactNode;
}) {
  const isDark = variant === "dark";
  const isLight = variant === "light";
  return (
    <p
      className={`consent-note${isDark ? " consent-note--dark" : ""}${
        isLight ? " consent-note--light" : ""
      }`}
    >
      {children || "Нажимая кнопку, вы подтверждаете, что ознакомлены и согласны"}{" "}
      с{" "}
      <Link href="/consent" target="_blank" className="consent__link">
        Согласием на обработку персональных данных
      </Link>{" "}
      и{" "}
      <Link href="/privacy" target="_blank" className="consent__link">
        Политикой конфиденциальности
      </Link>
      .
    </p>
  );
}
