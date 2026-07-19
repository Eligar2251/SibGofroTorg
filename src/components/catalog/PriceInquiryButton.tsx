// =========================================================
// FILE: src/components/catalog/PriceInquiryButton.tsx
// =========================================================
// Кнопка «Узнать цену» — для товаров без цены / под заказ /
// не в наличии. Открывает модальное окно: авторизованный
// пользователь выбирает способ связи, заявка уходит автоматически
// с его телефоном и данными профиля (POST /api/orders, type=inquiry).
// Неавторизованному предлагается войти или зарегистрироваться.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  Send,
  Loader2,
  CheckCircle,
  MessageSquareText,
  LogIn,
  UserPlus,
  Phone,
  PackageSearch,
} from "lucide-react";
import { ymGoal } from "@/lib/ym";

interface MeUser {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  customerType?: string;
  companyName?: string | null;
}

const CHANNELS: { value: string; label: string }[] = [
  { value: "call", label: "Телефонный звонок" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "max", label: "MAX" },
  { value: "email", label: "Электронная почта" },
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
  /** Только для превью/моков — открыть модалку сразу */
  defaultOpen?: boolean;
}) {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(defaultOpen);
  const [me, setMe] = useState<MeUser | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [channel, setChannel] = useState("call");
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "success" | "error">(
    "form"
  );
  const [errorMsg, setErrorMsg] = useState("");

  /* Загружаем профиль при первом открытии */
  useEffect(() => {
    if (!open || meLoaded) return;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setMe(data?.user || null))
      .catch(() => setMe(null))
      .finally(() => setMeLoaded(true));
  }, [open, meLoaded]);

  /* Блокировка прокрутки фона + закрытие по Esc */
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setErrorMsg("");
    if (phase !== "sending") setPhase("form");
  }, [phase]);

  function openModal(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setPhase("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "inquiry",
          customerName: me.name || "Клиент",
          customerPhone: me.phone,
          customerEmail: me.email || null,
          communicationChannel: channel,
          productInfo: `Узнать цену: ${productName}${
            productSku ? ` (арт. ${productSku})` : ""
          }`,
          comment: comment.trim() || "",
          channel: "website",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error || "Ошибка отправки"
        );
      }
      setPhase("success");
      ymGoal("inquiry_submit");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Произошла ошибка");
      setPhase("error");
    }
  }

  const channelLabel =
    CHANNELS.find((c) => c.value === channel)?.label || "Звонок";
  const nextUrl = encodeURIComponent(pathname);

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
            aria-label="Заявка на уточнение цены"
            onClick={(e) => e.stopPropagation()}
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

            {/* ── Профиль ещё грузится ── */}
            {!meLoaded && (
              <div className="pi-loading">
                <Loader2 size={20} className="animate-spin" />
                Загрузка профиля…
              </div>
            )}

            {/* ── Не авторизован: предлагаем войти/зарегистрироваться ── */}
            {meLoaded && !me && (
              <div className="pi-auth">
                <div className="pi-auth__icon">
                  <LogIn size={22} />
                </div>
                <div className="pi-title">Нужно войти в аккаунт</div>
                <p className="pi-text">
                  Заявка отправляется автоматически с номером телефона и
                  данными вашего профиля, поэтому сначала войдите или
                  зарегистрируйтесь — это займёт минуту.
                </p>
                <div className="pi-auth__actions">
                  <Link
                    href={`/login?next=${nextUrl}`}
                    className="pi-btn pi-btn--primary"
                  >
                    <LogIn size={15} /> Войти
                  </Link>
                  <Link
                    href={`/register?next=${nextUrl}`}
                    className="pi-btn pi-btn--ghost"
                  >
                    <UserPlus size={15} /> Регистрация
                  </Link>
                </div>
              </div>
            )}

            {/* ── Авторизован: форма заявки ── */}
            {meLoaded && me && phase !== "success" && (
              <form className="pi-form" onSubmit={handleSubmit}>
                <div className="pi-title">Узнать цену</div>
                <p className="pi-text">
                  Заявка уйдёт менеджеру с вашими контактами — ответим в
                  выбранный мессенджер или перезвоним.
                </p>

                <div className="pi-me">
                  <div className="pi-me__row">
                    <span className="pi-me__label">От кого</span>
                    <span className="pi-me__val">
                      {me.name || "Клиент"}
                      {me.customerType === "legal" && me.companyName
                        ? ` · ${me.companyName}`
                        : ""}
                    </span>
                  </div>
                  <div className="pi-me__row">
                    <span className="pi-me__label">Телефон</span>
                    <span className="pi-me__val">
                      <Phone size={12} /> {me.phone}
                    </span>
                  </div>
                  {me.email && (
                    <div className="pi-me__row">
                      <span className="pi-me__label">Email</span>
                      <span className="pi-me__val">{me.email}</span>
                    </div>
                  )}
                </div>

                <label className="pi-field">
                  <span className="pi-field__label">
                    Удобный способ связи *
                  </span>
                  <select
                    className="pi-select"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  >
                    {CHANNELS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                {channel === "email" && !me.email && (
                  <div className="pi-hint">
                    Email не указан в профиле — добавьте его в личном кабинете
                    или выберите другой способ связи.
                  </div>
                )}
                {(channel === "whatsapp" ||
                  channel === "telegram" ||
                  channel === "max") && (
                  <div className="pi-hint">
                    Напишем на номер {me.phone} — убедитесь, что в мессенджере
                    привязан именно он.
                  </div>
                )}

                <label className="pi-field">
                  <span className="pi-field__label">
                    Комментарий (количество, вопрос)
                  </span>
                  <textarea
                    className="pi-textarea"
                    rows={3}
                    maxLength={1000}
                    placeholder="Например: нужно 500 шт., подскажите сроки и оптовую цену"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                </label>

                {phase === "error" && errorMsg && (
                  <div className="pi-error">{errorMsg}</div>
                )}

                <button
                  type="submit"
                  className="pi-btn pi-btn--primary pi-submit"
                  disabled={phase === "sending"}
                >
                  {phase === "sending" ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />{" "}
                      Отправляем…
                    </>
                  ) : (
                    <>
                      <Send size={15} /> Отправить заявку
                    </>
                  )}
                </button>
              </form>
            )}

            {/* ── Успех ── */}
            {meLoaded && me && phase === "success" && (
              <div className="pi-success">
                <CheckCircle size={40} />
                <div className="pi-title">Заявка отправлена!</div>
                <p className="pi-text">
                  Менеджер свяжется с вами ({channelLabel.toLowerCase()},{" "}
                  {me.phone}) и уточнит цену и сроки по товару.
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
