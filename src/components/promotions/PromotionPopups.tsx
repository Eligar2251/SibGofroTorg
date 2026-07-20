"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, CircleAlert, Gift, X } from "lucide-react";

type CampaignStyle = "info" | "promo" | "important";
type CampaignFrequency = "session" | "day" | "always";

interface PopupCampaign {
  id: string;
  title: string;
  kicker: string | null;
  description: string | null;
  details: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  style: CampaignStyle;
  startAt: string | null;
  endAt: string | null;
  delaySeconds: number;
  durationSeconds: number;
  frequency: CampaignFrequency;
}

const STORAGE_PREFIX = "sib-info-window:";

function asTime(value: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function storageKey(campaign: PopupCampaign): string {
  const base = `${STORAGE_PREFIX}${campaign.id}`;
  if (campaign.frequency === "day") {
    return `${base}:${new Date().toISOString().slice(0, 10)}`;
  }
  return base;
}

function wasShown(campaign: PopupCampaign): boolean {
  if (campaign.frequency === "always") return false;
  try {
    const storage = campaign.frequency === "session" ? sessionStorage : localStorage;
    return storage.getItem(storageKey(campaign)) === "1";
  } catch {
    return false;
  }
}

function markShown(campaign: PopupCampaign) {
  if (campaign.frequency === "always") return;
  try {
    const storage = campaign.frequency === "session" ? sessionStorage : localStorage;
    storage.setItem(storageKey(campaign), "1");
  } catch {
    // Хранилище может быть запрещено браузером.
  }
}

export function PromotionPopups() {
  const [pending, setPending] = useState<PopupCampaign[]>([]);
  const [current, setCurrent] = useState<PopupCampaign | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/popups")
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        const campaigns = Array.isArray(data?.campaigns)
          ? (data.campaigns as PopupCampaign[])
          : [];
        setPending(campaigns.filter((item) => !wasShown(item)));
      })
      .catch(() => setPending([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (current || pending.length === 0) return;
    const next = pending[0];
    const target = Math.max(
      Date.now() + Math.max(0, next.delaySeconds || 0) * 1000,
      asTime(next.startAt)
    );
    const timer = window.setTimeout(() => {
      if (Date.now() + 500 < target) {
        setPending((items) => [...items]);
        return;
      }
      const end = asTime(next.endAt);
      setPending((items) => items.slice(1));
      if (end > 0 && end <= Date.now()) return;
      markShown(next);
      setCurrent(next);
    }, Math.min(Math.max(0, target - Date.now()), 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [current, pending]);

  useEffect(() => {
    if (!current) return;
    const duration = Math.min(
      600,
      Math.max(5, Number(current.durationSeconds) || 20)
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

  const Icon =
    current.style === "promo"
      ? Gift
      : current.style === "important"
        ? CircleAlert
        : BellRing;
  const points = (current.details || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  const external = current.buttonUrl?.startsWith("https://") === true;
  const button = current.buttonUrl ? (
    external ? (
      <a
        href={current.buttonUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="promo-popup__cta"
        onClick={() => setCurrent(null)}
      >
        {current.buttonText || "Подробнее"} <ArrowRight size={15} />
      </a>
    ) : (
      <Link
        href={current.buttonUrl}
        className="promo-popup__cta"
        onClick={() => setCurrent(null)}
      >
        {current.buttonText || "Подробнее"} <ArrowRight size={15} />
      </Link>
    )
  ) : null;

  return (
    <div className="promo-popup-overlay" onClick={() => setCurrent(null)}>
      <section
        className={`promo-popup promo-popup--${current.style}${
          current.imageUrl ? " promo-popup--with-image" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`info-window-${current.id}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="promo-popup__windowbar">
          <span className="promo-popup__window-icon">
            <Icon size={16} />
          </span>
          <span className="promo-popup__window-label">
            {current.kicker || "Информация"}
          </span>
          <button
            type="button"
            className="promo-popup__close"
            onClick={() => setCurrent(null)}
            aria-label="Закрыть информационное окно"
          >
            <X size={18} />
          </button>
        </header>

        <div className="promo-popup__content">
          {current.imageUrl && (
            <div className="promo-popup__media">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.imageUrl} alt="" />
            </div>
          )}

          <div className="promo-popup__body">
            <div className="promo-popup__eyebrow">
              <Icon size={15} /> {current.kicker || "Объявление"}
            </div>
            <h2
              className="promo-popup__title"
              id={`info-window-${current.id}`}
            >
              {current.title}
            </h2>
            {current.description && (
              <p className="promo-popup__subtitle">{current.description}</p>
            )}
            {points.length > 0 && (
              <ul className="promo-popup__details">
                {points.map((point, index) => (
                  <li key={`${point}-${index}`}>{point}</li>
                ))}
              </ul>
            )}
            {button && <div className="promo-popup__actions">{button}</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
