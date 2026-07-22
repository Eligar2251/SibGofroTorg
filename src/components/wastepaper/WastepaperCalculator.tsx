// src/components/calculator/WastepaperCalculator.tsx
"use client";

import { useState } from "react";
import { Recycle, Loader2, CheckCircle } from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { ymGoal } from "@/lib/ym";
import { formatPhoneMask } from "@/lib/phone-mask";
import {
  withDefaultRates,
  formatRate,
  WASTEPAPER_SELF_BONUS,
  WASTEPAPER_PICKUP_MIN_KG,
  type WastepaperRates,
} from "@/lib/wastepaper";

/** Метаданные видов сырья; цены берутся из настроек (prop rates) */
const RATE_META = [
  { id: "cardboard",    label: "Гофрокартон",     token: "box" },
  { id: "office_paper", label: "Белая бумага А4", token: "file" },
  { id: "books",        label: "Книги и журналы", token: "books" },
  { id: "mix",          label: "Смешанная",       token: "trash" },
] as const;

export function WastepaperCalculator({
  rates,
}: {
  /** Цены ₽/кг из настроек; пустые значения дополняются дефолтами */
  rates?: Partial<WastepaperRates>;
}) {
  const effectiveRates = withDefaultRates(rates);
  const [type, setType] = useState("cardboard");
  const [weight, setWeight] = useState(100);
  const [weightInput, setWeightInput] = useState("100");
  const [delivery, setDelivery] = useState<"self" | "pickup">("self");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [err, setErr] = useState("");
  const [phone, setPhone] = useState("");

  const currentRateObj = RATE_META.find(r => r.id === type) || RATE_META[0];
  const baseRate = effectiveRates[currentRateObj.id];
  const rate = baseRate + (delivery === "self" ? WASTEPAPER_SELF_BONUS : 0);
  const payout = weight * rate;
  const isPickupValid = delivery === "pickup" ? weight >= WASTEPAPER_PICKUP_MIN_KG : true;

  function handleWeightChange(val: string) {
    setWeightInput(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) setWeight(n);
  }

  function handleWeightBlur() {
    const n = parseInt(weightInput, 10);
    if (isNaN(n) || n < 1) {
      setWeight(1);
      setWeightInput("1");
    } else {
      setWeight(n);
      setWeightInput(String(n));
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isPickupValid) {
      setErr(`Минимум ${WASTEPAPER_PICKUP_MIN_KG} кг для бесплатного вывоза`);
      setState("error");
      return;
    }
    setState("loading");
    setErr("");
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/wastepaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: fd.get("name"),
          customerPhone: fd.get("phone"),
          wastepaperType: currentRateObj.label,
          weight,
          deliveryMethod: delivery,
          estimatedPayout: payout,
          comment: fd.get("comment") || "",
        }),
      });
      if (!res.ok) throw new Error();
      setState("success");
      ymGoal("wastepaper_submit");
      (e.target as HTMLFormElement).reset();
      setPhone("");
    } catch {
      setErr("Не удалось отправить заявку. Попробуйте ещё раз.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="wpcalc-success">
        <CheckCircle size={40} style={{ color: "var(--green)" }} />
        <div className="wpcalc-success__title">Заявка отправлена!</div>
        <p className="wpcalc-success__desc">
          Перезвоним в течение 10–15 минут для подтверждения
        </p>
        <button onClick={() => setState("idle")} className="wpcalc-success__btn">
          Рассчитать новую партию
        </button>
      </div>
    );
  }

  return (
    <div className="wpcalc">
      {/* Тип сырья */}
      <div className="wpcalc__section">
        <div className="wpcalc__label">Тип сырья</div>
        <div className="wpcalc__type-grid">
          {RATE_META.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setType(r.id)}
              className={`wpcalc__type-btn${type === r.id ? " wpcalc__type-btn--active" : ""}`}
            >
              <span className="wpcalc__type-name"><GlyphIcon value={r.token} size={14} /> {r.label}</span>
              <span className="wpcalc__type-rate">{formatRate(effectiveRates[r.id])} ₽/кг</span>
            </button>
          ))}
        </div>
      </div>

      {/* Вес и доставка */}
      <div className="wpcalc__row">
        <div className="wpcalc__section" style={{ flex: 1 }}>
          <div className="wpcalc__label">Вес (кг)</div>
          <input
            type="number"
            min={1}
            value={weightInput}
            onChange={e => handleWeightChange(e.target.value)}
            onBlur={handleWeightBlur}
            className="wpcalc__weight-input"
          />
        </div>
        <div className="wpcalc__section" style={{ flex: 1.5 }}>
          <div className="wpcalc__label">Доставка</div>
          <div className="wpcalc__delivery">
            <button
              type="button"
              onClick={() => setDelivery("self")}
              className={`wpcalc__del-btn${delivery === "self" ? " wpcalc__del-btn--active" : ""}`}
            >
              <span><GlyphIcon value="factory" size={20} /></span>
              <div>
                <div className="wpcalc__del-name">Привезу сам</div>
                <div className="wpcalc__del-sub">+{WASTEPAPER_SELF_BONUS} ₽/кг бонус</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setDelivery("pickup")}
              className={`wpcalc__del-btn${delivery === "pickup" ? " wpcalc__del-btn--active" : ""}`}
            >
              <span><GlyphIcon value="truck" size={20} /></span>
              <div>
                <div className="wpcalc__del-name">Вывоз</div>
                <div className="wpcalc__del-sub">от {WASTEPAPER_PICKUP_MIN_KG} кг</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Предупреждение вывоза */}
      {delivery === "pickup" && weight < WASTEPAPER_PICKUP_MIN_KG && (
        <div className="wpcalc__warn">
          <GlyphIcon value="warning" size={14} /> Бесплатный вывоз — от{" "}
          {WASTEPAPER_PICKUP_MIN_KG} кг. Сейчас: {weight} кг
        </div>
      )}

      {/* Итог */}
      <div className="wpcalc__result">
        <div className="wpcalc__result-label">Ориентировочная выплата</div>
        <div className="wpcalc__result-sum">{payout.toLocaleString("ru-RU")} ₽</div>
        <div className="wpcalc__result-rate">тариф: {formatRate(rate)} ₽/кг · {weight} кг</div>
      </div>

      {/* Форма */}
      <form onSubmit={handleSubmit} className="wpcalc__form">
        <div className="wpcalc__form-row">
          <input
            name="name"
            type="text"
            required
            placeholder="Ваше имя *"
            className="form-input"
          />
          <input
            name="phone"
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
            placeholder="+7 (913) 000-00-00 *"
            className="form-input"
          />
        </div>
        <textarea
          name="comment"
          rows={2}
          placeholder="Адрес для вывоза (если нужен)"
          className="form-input"
          style={{ resize: "none" }}
        />

        {state === "error" && (
          <div className="wpcalc__error">{err}</div>
        )}

        <button
          type="submit"
          disabled={state === "loading" || !isPickupValid}
          className="wpcalc__submit"
        >
          {state === "loading" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <><Recycle size={16} /> Оформить приём макулатуры</>
          )}
        </button>
      </form>
    </div>
  );
}