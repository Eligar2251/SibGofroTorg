"use client";

// =========================================================
// FILE: src/components/layout/YandexMapEmbed.tsx
// Ленивая Яндекс.Карта: вместо iframe сразу грузится лёгкая
// заглушка, а виджет карты (~0.5 МБ JS) подгружается только
// по клику «Показать карту». Экономит сотни КБ JS и десятки
// запросов на первой загрузке страниц (главная, контакты).
// =========================================================

import { useState } from "react";
import { MapPin } from "lucide-react";

export function YandexMapEmbed({
  src,
  title,
  address,
}: {
  src: string;
  title: string;
  address?: string;
}) {
  const [active, setActive] = useState(false);

  if (active) {
    return (
      <iframe
        src={src}
        title={title}
        className="contacts-map__iframe"
        loading="eager"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      className="map-facade"
      onClick={() => setActive(true)}
      aria-label={`Показать карту: ${title}`}
    >
      <span className="map-facade__icon">
        <MapPin size={32} />
      </span>
      <span className="map-facade__title">Как нас найти</span>
      {address && <span className="map-facade__address">{address}</span>}
      <span className="map-facade__cta">Показать карту</span>
      <span className="map-facade__note">
        Карта загрузится с Яндекс.Карт
      </span>
    </button>
  );
}
