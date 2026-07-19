"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Star, Send, Loader2, X, CheckCircle2, MessageSquare } from "lucide-react";

interface ReviewFormProps {
  productId: string;
}

/**
 * Форма «Оставить отзыв» на странице товара.
 * Отправляет POST /api/products/[id]/reviews.
 * Отзыв попадает на модерацию (API это подтверждает).
 */
export function ReviewForm({ productId }: ReviewFormProps) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [error, setError] = useState("");
  const [needAuth, setNeedAuth] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const title = String(fd.get("title") || "").trim();
    const text = String(fd.get("text") || "").trim();
    const pros = String(fd.get("pros") || "").trim();
    const cons = String(fd.get("cons") || "").trim();

    setState("loading");
    setError("");
    setNeedAuth(false);

    try {
      const res = await fetch(`/api/products/${productId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          title: title || undefined,
          text,
          pros: pros || undefined,
          cons: cons || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        string
      >;

      if (res.status === 401) {
        setNeedAuth(true);
        setError("");
        setState("error");
        return;
      }
      if (!res.ok) {
        throw new Error(body.error || "Не удалось отправить отзыв");
      }

      setState("success");
      form.reset();
      setRating(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="review-form-success">
        <CheckCircle2 size={30} />
        <div className="review-form-success__title">Спасибо за отзыв!</div>
        <p>Он появится на странице после проверки модератором.</p>
        <button
          type="button"
          className="review-form-toggle"
          onClick={() => {
            setState("idle");
            setOpen(false);
          }}
        >
          Готово
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="review-form-toggle"
        onClick={() => setOpen(true)}
      >
        <MessageSquare size={15} />
        Оставить отзыв
      </button>
    );
  }

  return (
    <form className="review-form" onSubmit={handleSubmit}>
      <div className="review-form__head">
        <span className="review-form__title">Ваш отзыв</span>
        <button
          type="button"
          className="review-form__close"
          onClick={() => setOpen(false)}
          aria-label="Закрыть форму"
        >
          <X size={16} />
        </button>
      </div>

      <div
        className="review-form__rating"
        onMouseLeave={() => setHover(0)}
        aria-label="Оценка товара"
      >
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            className={`review-form__star${
              (hover || rating) >= s ? " review-form__star--active" : ""
            }`}
            onMouseEnter={() => setHover(s)}
            onFocus={() => setHover(s)}
            onClick={() => setRating(s)}
            aria-label={`Оценка ${s} из 5`}
          >
            <Star size={24} fill="currentColor" strokeWidth={0} />
          </button>
        ))}
      </div>

      <input
        name="title"
        type="text"
        placeholder="Заголовок (необязательно)"
        className="review-form__input"
        maxLength={120}
      />
      <textarea
        name="text"
        required
        minLength={10}
        rows={4}
        placeholder="Расскажите о товаре: качество, доставка, впечатления *"
        className="review-form__input review-form__textarea"
      />
      <input
        name="pros"
        type="text"
        placeholder="Достоинства (необязательно)"
        className="review-form__input"
        maxLength={300}
      />
      <input
        name="cons"
        type="text"
        placeholder="Недостатки (необязательно)"
        className="review-form__input"
        maxLength={300}
      />

      {state === "error" && (
        <div className="review-form__error">
          {needAuth ? (
            <>
              Чтобы оставить отзыв,{" "}
              <Link href="/login" className="review-form__error-link">
                войдите в аккаунт
              </Link>{" "}
              или зарегистрируйтесь.
            </>
          ) : (
            error
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={state === "loading"}
        className="review-form__submit"
      >
        {state === "loading" ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Отправляем…
          </>
        ) : (
          <>
            <Send size={14} /> Отправить отзыв
          </>
        )}
      </button>
      <p className="review-form__note">
        Отзыв можно оставить после покупки. Публикуется после модерации.
      </p>
    </form>
  );
}
