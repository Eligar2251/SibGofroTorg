import React from "react";

interface StarsProps {
  /** Рейтинг 0..5, поддерживает дробные значения (частичное заполнение) */
  value: number;
  /** Размер звезды в px */
  size?: number;
  className?: string;
}

/**
 * Статичный звёздный рейтинг (серверный компонент).
 * Отрисовывает 5 серых звёзд и поверх них заполненные с шириной по рейтингу.
 */
export function Stars({ value, size = 15, className }: StarsProps) {
  const clamped = Math.max(0, Math.min(5, Number.isFinite(value) ? value : 0));
  const pct = (clamped / 5) * 100;

  return (
    <span
      className={`stars${className ? ` ${className}` : ""}`}
      style={{ fontSize: size }}
      role="img"
      aria-label={`Рейтинг ${clamped.toFixed(1)} из 5`}
    >
      <span className="stars__base" aria-hidden="true">
        ★★★★★
      </span>
      <span
        className="stars__fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      >
        ★★★★★
      </span>
    </span>
  );
}
