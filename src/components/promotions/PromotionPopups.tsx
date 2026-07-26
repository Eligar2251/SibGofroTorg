"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BellRing, CircleAlert, Gift, X } from "lucide-react";
import type { PopupCampaign } from "@/lib/types";

const STORAGE_PREFIX = "sib-info-window:";

function asTime(value: string | null | undefined): number {
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
    // Storage might be blocked
  }
}

export function PromotionPopups() {
  const [pending, setPending] = useState<PopupCampaign[]>([]);
  const [current, setCurrent] = useState<PopupCampaign | null>(null);
  const [isClosing, setIsClosing] = useState(false);

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

  const closePopup = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setCurrent(null);
      setIsClosing(false);
    }, 300);
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
    const duration = Math.min(600, Math.max(5, Number(current.durationSeconds) || 20));
    const timer = window.setTimeout(() => closePopup(), duration * 1000);
    return () => window.clearTimeout(timer);
  }, [current, closePopup]);

  useEffect(() => {
    if (!current) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePopup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [current, closePopup]);

  if (!current) return null;

  if (current.type === "story" && current.imageUrl) {
    return (
      <div className={`popup-root-overlay${isClosing ? " closing" : ""}`} onClick={closePopup}>
        <div className="story-v2" onClick={(e) => e.stopPropagation()}>
          {current.buttonUrl ? (
            <Link href={current.buttonUrl} className="story-v2__link" onClick={closePopup}>
              <Image
                src={current.imageUrl}
                alt={current.title}
                fill
                priority
                sizes="min(460px, 92vw, calc(90vh * 9 / 16))"
                className="story-v2__img"
              />
            </Link>
          ) : (
            <Image
              src={current.imageUrl}
              alt={current.title}
              fill
              priority
              sizes="min(460px, 92vw, calc(90vh * 9 / 16))"
              className="story-v2__img"
            />
          )}
          <button type="button" className="story-v2__close" onClick={closePopup} aria-label="Закрыть">
            <X size={24} />
          </button>
        </div>
      </div>
    );
  }

  // Banner type (standard modal without photo)
  const Icon = current.style === "promo" ? Gift : current.style === "important" ? CircleAlert : BellRing;
  const points = (current.details || "").split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <div className={`popup-root-overlay${isClosing ? " closing" : ""}`} onClick={closePopup}>
      <div className={`banner-v2 banner-v2--${current.style || "info"}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="banner-v2__close" onClick={closePopup} aria-label="Закрыть">
          <X size={20} />
        </button>

        <div className="banner-v2__body">
          {current.kicker && (
            <div className="banner-v2__kicker">
              <Icon size={14} /> {current.kicker}
            </div>
          )}
          <h2 className="banner-v2__title">{current.title}</h2>
          {current.description && <p className="banner-v2__desc">{current.description}</p>}

          {points.length > 0 && (
            <ul className="banner-v2__list">
              {points.map((p, idx) => (
                <li key={idx}>{p}</li>
              ))}
            </ul>
          )}

          {current.buttonUrl && (
            <div className="banner-v2__actions">
              <Link href={current.buttonUrl} className="banner-v2__cta" onClick={closePopup}>
                {current.buttonText || "Подробнее"} <ArrowRight size={18} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
