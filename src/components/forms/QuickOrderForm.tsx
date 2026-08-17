"use client";

import { useState } from "react";
import { Send, CheckCircle, Loader2 } from "lucide-react";
import { ymGoal } from "@/lib/ym";
import { formatPhoneMask } from "@/lib/phone-mask";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";

interface QuickOrderFormProps {
  productName?: string;
  /** "dark" — для тёмного фона (секция consult), "light" — для карточки товара */
  variant?: "dark" | "light";
}

export function QuickOrderForm({
  productName,
  variant = "dark",
}: QuickOrderFormProps) {
  const [formState, setFormState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const isLight = variant === "light";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!consent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);
    setFormState("loading");
    setErrorMsg("");

    const form = e.currentTarget;
    const data = new FormData(form);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "inquiry",
          customerName: data.get("name"),
          customerPhone: data.get("phone"),
          productInfo: data.get("product") || productName || "",
          comment: data.get("comment") || "",
          channel: "website",
          communicationChannel: "call",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error || "Ошибка отправки"
        );
      }

      setFormState("success");
      form.reset();
      setPhone("");
      ymGoal("inquiry_submit");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Произошла ошибка");
      setFormState("error");
    }
  }

  if (formState === "success") {
    return (
      <div className={isLight ? "qof-success qof-success--light" : "qof-success"}>
        <CheckCircle size={28} style={{ color: isLight ? "#16a34a" : "#5DCB61" }} />
        <div className="qof-success__title">Заявка отправлена!</div>
        <p className="qof-success__desc">Перезвоним в течение 15 минут</p>
        <button
          type="button"
          onClick={() => setFormState("idle")}
          className="qof-success__repeat"
        >
          Отправить ещё раз
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={isLight ? "qof-form qof-form--light" : "qof-form"}
    >
      <div className={isLight ? "qof-row" : "qof-row"}>
        <div className="qof-field">
          <label className={isLight ? "qof-label qof-label--light" : "qof-label"}>
            Ваше имя *
          </label>
          <input
            id="qof-name"
            name="name"
            type="text"
            required
            placeholder="Иван Иванов"
            autoComplete="name"
            className={isLight ? "qof-input qof-input--light" : "qof-input"}
          />
        </div>
        <div className="qof-field">
          <label className={isLight ? "qof-label qof-label--light" : "qof-label"}>
            Телефон *
          </label>
          <input
            id="qof-phone"
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
            placeholder="+7 (913) 000-00-00"
            autoComplete="tel"
            className={isLight ? "qof-input qof-input--light" : "qof-input"}
          />
        </div>
      </div>

      {!productName && (
        <div className="qof-field">
          <label className={isLight ? "qof-label qof-label--light" : "qof-label"}>
            Какой товар интересует?
          </label>
          <input
            id="qof-product"
            name="product"
            type="text"
            placeholder="Например: коробки 600×400×400"
            autoComplete="off"
            className={isLight ? "qof-input qof-input--light" : "qof-input"}
          />
        </div>
      )}

      {formState === "error" && (
        <div className={isLight ? "qof-error qof-error--light" : "qof-error"}>
          {errorMsg}
        </div>
      )}

      <ConsentCheckbox
        checked={consent}
        onChange={(v) => setConsent(v)}
        error={consentError}
        variant={variant === "dark" ? "dark" : "default"}
      />

      <button
        type="submit"
        disabled={formState === "loading"}
        className="qof-submit"
      >
        {formState === "loading" ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Отправляем...
          </>
        ) : (
          <>
            <Send size={14} /> Купить в один клик
          </>
        )}
      </button>
    </form>
  );
}