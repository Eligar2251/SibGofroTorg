"use client";

// =========================================================
// FILE: src/components/layout/YandexMapEmbed.tsx
// Ленивая Яндекс.Карта: вместо iframe сразу грузится лёгкая
// заглушка, а виджет карты (~0.5 МБ JS) подгружается только
// по клику «Показать карту». Экономит сотни КБ JS и десятки
// запросов на первой загрузке страниц (главная, контакты).
// =========================================================

import { useEffect, useState } from "react";
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
  const [mapLoaded, setMapLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active || mapLoaded) return;
    const timer = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [active, mapLoaded]);

  if (active) {
    return (
      <>
      <iframe
        src={src}
        title={title}
        className="contacts-map__iframe"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        onLoad={() => setMapLoaded(true)}
      />
      {timedOut && !mapLoaded && (
        <p className="map-load-fallback" role="status">
          Карта долго загружается. <a href="https://yandex.ru/maps/" target="_blank" rel="noopener noreferrer">Открыть Яндекс Карты</a>
        </p>
      )}
      </>
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
