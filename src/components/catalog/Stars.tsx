import React from "react";
import { Star } from "lucide-react";

interface StarsProps {
  /** Рейтинг 0..5, поддерживает дробные значения (частичное заполнение) */
  value: number;
  /** Размер звезды в px */
  size?: number;
  className?: string;
}

/**
 * Статичный звёздный рейтинг (серверный компонент, SVG-иконки).
 * Отрисовывает 5 серых звёзд и поверх них заполненные с шириной по рейтингу.
 */
export function Stars({ value, size = 15, className }: StarsProps) {
  const clamped = Math.max(0, Math.min(5, Number.isFinite(value) ? value : 0));
  const pct = (clamped / 5) * 100;

  const row = (filled: boolean) =>
    Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        size={size}
        strokeWidth={filled ? 0 : 1.6}
        fill={filled ? "currentColor" : "#dde2df"}
        color={filled ? "currentColor" : "#dde2df"}
        aria-hidden="true"
      />
    ));

  return (
    <span
      className={`stars${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={`Рейтинг ${clamped.toFixed(1)} из 5`}
    >
      <span className="stars__row" aria-hidden="true">
        {row(false)}
      </span>
      <span
        className="stars__fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        <span className="stars__row">{row(true)}</span>
      </span>
    </span>
  );
}
