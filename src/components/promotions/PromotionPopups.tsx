"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift, X } from "lucide-react";

interface PopupPromotion {
  id: string;
  title: string;
  subtitle: string | null;
  badge: string | null;
  imageUrl: string | null;
  href: string | null;
  popupStartAt: string | null;
  popupDelaySeconds: number;
  popupDurationSeconds: number;
}

const SESSION_PREFIX = "sib-promo-shown:";

function startTime(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function PromotionPopups() {
  const [pending, setPending] = useState<PopupPromotion[]>([]);
  const [current, setCurrent] = useState<PopupPromotion | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/promotions/popups")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.promotions)
          ? (data.promotions as PopupPromotion[])
          : [];
        const unseen = list.filter((promotion) => {
          try {
            return !sessionStorage.getItem(`${SESSION_PREFIX}${promotion.id}`);
          } catch {
            return true;
          }
        });
        setPending(unseen);
      })
      .catch(() => setPending([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Показываем акции по очереди. Для каждой учитываются запланированная дата
  // и задержка после загрузки предыдущего окна.
  useEffect(() => {
    if (current || pending.length === 0) return;
    const next = pending[0];
    const scheduledAt = Math.max(
      Date.now() + Math.max(0, next.popupDelaySeconds || 0) * 1000,
      startTime(next.popupStartAt)
    );
    const wait = Math.max(0, scheduledAt - Date.now());
    const timer = window.setTimeout(() => {
      if (Date.now() + 500 < scheduledAt) {
        setPending((items) => [...items]);
        return;
      }
      setPending((items) => items.slice(1));
      setCurrent(next);
      try {
        sessionStorage.setItem(`${SESSION_PREFIX}${next.id}`, "1");
      } catch {
        // sessionStorage может быть запрещён настройками браузера.
      }
    }, Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [current, pending]);

  useEffect(() => {
    if (!current) return;
    const duration = Math.min(
      300,
      Math.max(3, Number(current.popupDurationSeconds) || 15)
    );
    const timer = window.setTimeout(() => setCurrent(null), duration * 1000);
    return () => window.clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCurrent(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [current]);

  if (!current) return null;

  const isExternal = current.href?.startsWith("https://") === true;
  const cta = current.href ? (
    isExternal ? (
      <a
        className="promo-popup__cta"
        href={current.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setCurrent(null)}
      >
        Подробнее <ArrowRight size={15} />
      </a>
    ) : (
      <Link
        className="promo-popup__cta"
        href={current.href}
        onClick={() => setCurrent(null)}
      >
        Подробнее <ArrowRight size={15} />
      </Link>
    )
  ) : null;

  return (
    <div className="promo-popup-overlay" onClick={() => setCurrent(null)}>
      <section
        className={`promo-popup${current.imageUrl ? " promo-popup--with-image" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`promo-popup-title-${current.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="promo-popup__close"
          onClick={() => setCurrent(null)}
          aria-label="Закрыть акцию"
        >
          <X size={19} />
        </button>

        {current.imageUrl && (
          <div className="promo-popup__media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.imageUrl} alt="" />
          </div>
        )}

        <div className="promo-popup__body">
          <div className="promo-popup__badge">
            <Gift size={14} /> {current.badge || "Акция"}
          </div>
          <h2
            className="promo-popup__title"
            id={`promo-popup-title-${current.id}`}
          >
            {current.title}
          </h2>
          {current.subtitle && (
            <p className="promo-popup__subtitle">{current.subtitle}</p>
          )}
          {cta}
        </div>
      </section>
    </div>
  );
}
