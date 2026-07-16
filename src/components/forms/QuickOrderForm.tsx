// src/components/forms/QuickOrderForm.tsx
"use client";

import { useState } from "react";
import { Send, CheckCircle, Loader2 } from "lucide-react";
import { ymGoal } from "@/lib/ym";

export function QuickOrderForm({ productName }: { productName?: string }) {
  const [formState, setFormState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
        throw new Error((body as Record<string, string>).error || "Ошибка отправки");
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
      <div className="qof-success">
        <CheckCircle size={32} style={{ color: "#5DCB61" }} />
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
    <form onSubmit={handleSubmit} className="qof-form">
      <div className="qof-row">
        <div className="qof-field">
          <label className="qof-label">Ваше имя *</label>
          <input
            name="name"
            type="text"
            required
            placeholder="Иван Иванов"
            className="qof-input"
          />
        </div>
        <div className="qof-field">
          <label className="qof-label">Телефон *</label>
          <input
            name="phone"
            type="tel"
            required
            placeholder="+7 (913) 000-00-00"
            className="qof-input"
          />
        </div>
      </div>

      {!productName && (
        <div className="qof-field">
          <label className="qof-label">Какой товар интересует?</label>
          <input
            name="product"
            type="text"
            placeholder="Например: коробки 600×400×400"
            className="qof-input"
          />
        </div>
      )}

      <div className="qof-field">
        <label className="qof-label">Комментарий</label>
        <textarea
          name="comment"
          rows={3}
          placeholder="Нужное количество, размеры, особые пожелания..."
          className="qof-input qof-textarea"
        />
      </div>

      {formState === "error" && (
        <div className="qof-error">{errorMsg}</div>
      )}

      <button
        type="submit"
        disabled={formState === "loading"}
        className="qof-submit"
      >
        {formState === "loading" ? (
          <><Loader2 size={15} className="animate-spin" /> Отправляем...</>
        ) : (
          <><Send size={14} /> Отправить заявку</>
        )}
      </button>
    </form>
  );
}