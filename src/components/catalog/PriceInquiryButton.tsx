// =========================================================
// FILE: src/components/catalog/PriceInquiryButton.tsx
// =========================================================
// Авторизованный клиент отправляет заявку одним нажатием: номер берётся
// сервером из его сессии. Гость видит короткую форму с телефоном и выбором
// удобного канала связи.

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
}: {
  productName: string;
  productSku?: string | null;
  className?: string;
  label?: string;
  /** Используется только в превью компонентов. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [me, setMe] = useState<MeUser | null>(null);
  const [phase, setPhase] = useState<Phase>(defaultOpen ? "loading" : "form");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState<Channel>("call");
  const [comment, setComment] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const productInfo = `Узнать цену: ${productName}${
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

  const identifyAndSend = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    setMe(null);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      const user = (data?.user || null) as MeUser | null;
      setMe(user);
      if (user) {
        // Требуемое поведение «в один клик»: заявка сразу уходит с номером
        // аккаунта. По умолчанию менеджер перезвонит.
        await sendInquiry({
          user,
          communicationChannel: "call",
        });
      } else {
        setPhase("form");
      }
    } catch {
      // Если профиль не удалось получить, не блокируем гостевую заявку.
      setMe(null);
      setPhase("form");
    }
  }, [sendInquiry]);

  useEffect(() => {
    if (defaultOpen) void identifyAndSend();
  }, [defaultOpen, identifyAndSend]);

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
    void identifyAndSend();
  }

  async function handleGuestSubmit(event: React.FormEvent) {
    event.preventDefault();
    await sendInquiry({
      user: null,
      customerPhone: phone,
      communicationChannel: channel,
      customerComment: comment,
    });
  }

  const channelLabel =
    CHANNELS.find((item) => item.value === (me ? "call" : channel))?.label ||
    "телефону";
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

            {!me && (phase === "form" || phase === "error") && (
              <form className="pi-form" onSubmit={handleGuestSubmit}>
                <div className="pi-title" id="price-inquiry-title">
                  Узнать цену
                </div>
                <p className="pi-text">
                  Оставьте номер и выберите удобный способ связи. Менеджер
                  свяжется с вами в течение 15 минут и уточнит цену и сроки.
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
                      value={phone}
                      onChange={(event) =>
                        setPhone(formatPhoneMask(event.target.value))
                      }
                      placeholder="+7 (913) 000-00-00"
                    />
                  </div>
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

            {me && phase === "error" && (
              <div className="pi-auth">
                <div className="pi-title" id="price-inquiry-title">
                  Не удалось отправить заявку
                </div>
                <div className="pi-error" role="alert">
                  {errorMsg}
                </div>
                <button
                  type="button"
                  className="pi-btn pi-btn--primary"
                  onClick={() =>
                    void sendInquiry({ user: me, communicationChannel: "call" })
                  }
                >
                  <Send size={15} /> Повторить
                </button>
              </div>
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
