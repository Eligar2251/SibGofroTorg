// =========================================================
// FILE: src/components/catalog/PriceInquiryButton.tsx
// =========================================================
// Для любого клиента сначала показывается выбор удобного способа связи.
// У авторизованного пользователя телефон берётся из аккаунта, гость вводит его сам.

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle,
  Loader2,
  MessageSquareText,
  PackageSearch,
  Phone,
  Send,
  X,
} from "lucide-react";
import { formatPhoneMask } from "@/lib/phone-mask";
import { ymGoal } from "@/lib/ym";

interface MeUser {
  id: string;
  phone: string;
  name: string | null;
}

type Channel = "call" | "telegram" | "whatsapp" | "max";
type Phase = "loading" | "form" | "sending" | "success" | "error";

const CHANNELS: { value: Channel; label: string }[] = [
  { value: "call", label: "Телефонный звонок" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "max", label: "MAX" },
];

export function PriceInquiryButton({
  productName,
  productSku,
  className,
  label = "Узнать цену",
  defaultOpen = false,
  kind = "price",
}: {
  productName: string;
  productSku?: string | null;
  className?: string;
  label?: string;
  /** Используется только в превью компонентов. */
  defaultOpen?: boolean;
  /**
   * Что уточняет клиент:
   *  - "price" — цену (товар без цены / под заказ);
   *  - "restock" — сроки поступления (товара нет на складе).
   * Обе ветки создают одну и ту же автозаявку с номером — разница лишь
   * в тексте, который увидит менеджер.
   */
  kind?: "price" | "restock";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [me, setMe] = useState<MeUser | null>(null);
  const [phase, setPhase] = useState<Phase>(defaultOpen ? "loading" : "form");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<Channel>("call");
  const [comment, setComment] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const isRestock = kind === "restock";
  const topic = isRestock ? "Уточнить поступление" : "Узнать цену";
  const productInfo = `${topic}: ${productName}${
    productSku ? ` (арт. ${productSku})` : ""
  }`;

  const sendInquiry = useCallback(
    async (params: {
      user: MeUser | null;
      customerPhone?: string;
      communicationChannel: Channel;
      customerComment?: string;
    }) => {
      setPhase("sending");
      setErrorMsg("");
      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            type: "inquiry",
            // Для вошедшего клиента сервер всё равно возьмёт имя и телефон
            // из сессии. Эти значения нужны лишь для обратной совместимости.
            customerName: params.user?.name || "Клиент",
            customerPhone: params.user?.phone || params.customerPhone || "",
            communicationChannel: params.communicationChannel,
            productInfo,
            comment: params.customerComment?.trim() || "",
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
    },
    [productInfo]
  );

  const identifyClient = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    setMe(null);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      const user = (data?.user || null) as MeUser | null;
      setMe(user);
      if (user?.phone) setPhone(user.phone);
      setPhase("form");
    } catch {
      // Если профиль не удалось получить, не блокируем гостевую заявку.
      setMe(null);
      setPhase("form");
    }
  }, []);

  useEffect(() => {
    if (defaultOpen) void identifyClient();
  }, [defaultOpen, identifyClient]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
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
    void identifyClient();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await sendInquiry({
      user: me,
      customerPhone: me?.phone || phone,
      communicationChannel: channel,
      customerComment: comment,
    });
  }

  const channelLabel =
    CHANNELS.find((item) => item.value === channel)?.label || "телефону";
  const shownPhone = me?.phone || phone;

  return (
    <>
      <button type="button" className={className} onClick={openModal}>
        {label}
      </button>

      {open && (
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

            <div className="pi-product">
              <PackageSearch size={15} />
              <span>{productName}</span>
            </div>

            {(phase === "loading" || phase === "sending") && (
              <div className="pi-loading" aria-live="polite">
                <Loader2 size={20} className="animate-spin" />
                {phase === "loading"
                  ? "Проверяем данные клиента…"
                  : "Передаём заявку менеджеру…"}
              </div>
            )}

            {(phase === "form" || phase === "error") && (
              <form className="pi-form" onSubmit={handleSubmit}>
                <div className="pi-title" id="price-inquiry-title">
                  {topic}
                </div>
                <p className="pi-text">
                  {isRestock
                    ? "Товара сейчас нет на складе. Выберите, где вам удобнее получить ответ — менеджер сообщит срок поступления и актуальную цену."
                    : "Выберите, где вам удобнее получить ответ. Менеджер свяжется с вами в течение 15 минут и уточнит цену и сроки."}
                </p>

                <label className="pi-field">
                  <span className="pi-field__label">Номер телефона *</span>
                  <div className="pi-phone-wrap">
                    <Phone size={15} />
                    <input
                      className="pi-input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={18}
                      required
                      readOnly={!!me}
                      value={me?.phone || phone}
                      onChange={(event) =>
                        setPhone(formatPhoneMask(event.target.value))
                      }
                      placeholder="+7 (913) 000-00-00"
                    />
                  </div>
                  {me && (
                    <span className="pi-account-hint">
                      Номер автоматически взят из вашего аккаунта
                    </span>
                  )}
                </label>

                <label className="pi-field">
                  <span className="pi-field__label">
                    Где вам удобно ответить? *
                  </span>
                  <select
                    className="pi-select"
                    value={channel}
                    onChange={(event) =>
                      setChannel(event.target.value as Channel)
                    }
                  >
                    {CHANNELS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>

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
                  Свяжемся с вами в течение 15 минут: {channelLabel.toLowerCase()}
                  {shownPhone ? `, ${shownPhone}` : ""}.
                </p>
                <button
                  type="button"
                  className="pi-btn pi-btn--primary"
                  onClick={close}
                >
                  <MessageSquareText size={15} /> Понятно, жду
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
