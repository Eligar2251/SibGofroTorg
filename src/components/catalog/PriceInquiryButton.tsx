// =========================================================
// FILE: src/components/catalog/PriceInquiryButton.tsx
// =========================================================
// Заявка «Узнать цену» / «Уточнить поступление».
// Телефон больше не собираем: предлагаем клиенту написать нам в MAX
// или позвонить. Можно оставить заявку с комментарием — менеджер
// увидит её в админке (номер заявки формируется автоматически).
//
// ВАЖНО про рендер модалки: она уходит в ПОРТАЛ (document.body).
// Кнопка живёт внутри карточки товара (.pcc), у которой
// `will-change: transform`/hover-transform и `overflow: hidden` —
// такой предок становится containing block для position:fixed, и
// без портала оверлей «запирался» внутри плитки.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle,
  Loader2,
  MessageSquareText,
  PackageSearch,
  Phone,
  Send,
  X,
} from "lucide-react";
import { ymGoal } from "@/lib/ym";
import { lockBodyScroll, unlockBodyScroll } from "@/hooks/use-body-lock";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { useSiteSettings } from "@/hooks/use-site-settings";

type Phase = "form" | "sending" | "success" | "error";

function safeUrl(raw: string | undefined): string | null {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function PriceInquiryButton({
  productName,
  productSku,
  productImageUrl = null,
  className,
  label = "Узнать цену",
  defaultOpen = false,
  kind = "price",
}: {
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  className?: string;
  label?: string;
  defaultOpen?: boolean;
  kind?: "price" | "restock";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [comment, setComment] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const { phone, phoneHref, messengerBanner } = useSiteSettings();
  const maxUrl = safeUrl(messengerBanner.max?.url);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isRestock = kind === "restock";
  const topic = isRestock ? "Уточнить поступление" : "Узнать цену";
  const productInfo = `${topic}: ${productName}${
    productSku ? ` (арт. ${productSku})` : ""
  }`;

  const sendInquiry = useCallback(async () => {
    setPhase("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          type: "inquiry",
          customerName: "Клиент",
          productInfo,
          comment: comment.trim() || "",
          communicationChannel: "max",
          channel: "website",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as Record<string, string>).error || "Ошибка отправки заявки"
        );
      }
      setPhase("success");
      ymGoal("inquiry_submit");
    } catch (error) {
      setErrorMsg(
        error instanceof Error ? error.message : "Не удалось отправить заявку"
      );
      setPhase("error");
    }
  }, [productInfo, comment]);

  useEffect(() => {
    if (!open) return;
    // Надёжная блокировка скролла фона (в т.ч. iOS Safari)
    lockBodyScroll();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unlockBodyScroll();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setPhase("form");
    setErrorMsg("");
  }, []);

  function openModal(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!consent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);
    await sendInquiry();
  }

  const modal = (
    <div className="pi-overlay" onClick={close}>
      <div
        className="pi-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-inquiry-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="pi-close"
          onClick={close}
          aria-label="Закрыть"
        >
          <X size={18} />
        </button>

        {/* Карточка товара, о котором спрашивают */}
        <div className="pi-product">
          {productImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pi-product__img"
              src={productImageUrl}
              alt=""
              width={44}
              height={44}
            />
          ) : (
            <span className="pi-product__img pi-product__img--placeholder">
              <PackageSearch size={18} />
            </span>
          )}
          <span className="pi-product__text">
            <span className="pi-product__name">{productName}</span>
            {productSku && (
              <span className="pi-product__sku">арт. {productSku}</span>
            )}
          </span>
        </div>

        {(phase === "sending") && (
          <div className="pi-loading" aria-live="polite">
            <Loader2 size={20} className="animate-spin" />
            Передаём заявку менеджеру…
          </div>
        )}

        {(phase === "form" || phase === "error") && (
          <form className="pi-form" onSubmit={handleSubmit}>
            <div className="pi-title" id="price-inquiry-title">
              {topic}
            </div>
            <p className="pi-text">
              {isRestock
                ? "Товара сейчас нет на складе. Напишите нам или позвоните — сообщим срок поступления и актуальную цену."
                : "Напишите нам или позвоните — менеджер уточнит цену и сроки."}
            </p>

            {/* Связаться напрямую */}
            <div className="pi-contact-actions">
              {maxUrl && (
                <a
                  href={maxUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pi-btn pi-btn--primary"
                >
                  <MessageSquareText size={15} /> Написать в MAX
                </a>
              )}
              <a href={phoneHref} className="pi-btn pi-btn--ghost">
                <Phone size={15} /> Позвонить
              </a>
            </div>

            <div className="pi-contact-divider">
              <span>или оставьте заявку</span>
            </div>

            <label className="pi-field">
              <span className="pi-field__label">Комментарий (необязательно)</span>
              <textarea
                className="pi-textarea"
                rows={2}
                maxLength={1000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Например: нужно 500 шт."
              />
            </label>

            {phase === "error" && errorMsg && (
              <div className="pi-error" role="alert">
                {errorMsg}
              </div>
            )}

            <ConsentCheckbox
              checked={consent}
              onChange={(v) => setConsent(v)}
              error={consentError}
            />

            <button type="submit" className="pi-btn pi-btn--primary pi-submit">
              <Send size={15} /> Отправить заявку
            </button>
          </form>
        )}

        {phase === "success" && (
          <div className="pi-success" aria-live="polite">
            <CheckCircle size={40} />
            <div className="pi-title" id="price-inquiry-title">
              Заявка отправлена!
            </div>
            <p className="pi-text">
              Менеджер увидит ваш запрос. Номер заявки сформирован
              автоматически. Для быстрого ответа напишите нам в MAX или
              позвоните.
            </p>
            <button
              type="button"
              className="pi-btn pi-btn--primary"
              onClick={close}
            >
              <MessageSquareText size={15} /> Понятно
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button type="button" className={className} onClick={openModal}>
        {label}
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  );
}
