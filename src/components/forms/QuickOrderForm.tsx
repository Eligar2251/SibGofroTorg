"use client";

import { useState } from "react";
import { Send, CheckCircle, Loader2, MessageSquareText, Phone } from "lucide-react";
import { ymGoal } from "@/lib/ym";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { useSiteSettings } from "@/hooks/use-site-settings";

interface QuickOrderFormProps {
  productName?: string;
  /** "dark" — для тёмного фона (секция consult), "light" — для карточки товара */
  variant?: "dark" | "light";
}

function safeUrl(raw: string | undefined): string | null {
  const value = String(raw || "").trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function QuickOrderForm({
  productName,
  variant = "dark",
}: QuickOrderFormProps) {
  const [formState, setFormState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);

  const { phone, phoneHref, messengerBanner } = useSiteSettings();
  const maxUrl = safeUrl(messengerBanner.max?.url);

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
          customerName: data.get("name") || "Клиент",
          productInfo: data.get("product") || productName || "",
          comment: data.get("comment") || "",
          channel: "website",
          communicationChannel: "max",
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
        <p className="qof-success__desc">
          Менеджер увидит ваш запрос. Для быстрого ответа напишите нам в MAX
          или позвоните.
        </p>
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
            Ваше имя
          </label>
          <input
            id="qof-name"
            name="name"
            type="text"
            placeholder="Иван Иванов"
            autoComplete="name"
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
            <Send size={14} /> Отправить заявку
          </>
        )}
      </button>

      {/* Быстрая связь напрямую */}
      <div
        className="qof-contacts"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 4,
        }}
      >
        {maxUrl && (
          <a
            href={maxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="qof-contact-link"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: isLight ? "var(--green)" : "var(--green-lime)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            <MessageSquareText size={14} /> Написать в MAX
          </a>
        )}
        <a
          href={phoneHref}
          className="qof-contact-link"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: isLight ? "var(--green)" : "var(--green-lime)",
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          <Phone size={14} /> Позвонить {phone}
        </a>
      </div>
    </form>
  );
}
