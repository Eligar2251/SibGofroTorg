// =========================================================
// FILE: src/components/auth/RegisterClient.tsx
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { safeNextPath } from "@/lib/safe-next";
import { formatPhoneMask } from "@/lib/phone-mask";
import { useSiteSettings } from "@/hooks/use-site-settings";

export function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"), "/cabinet");
  const { registrationField, ready } = useSiteSettings();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEmailMode = ready ? registrationField === "email" : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Пароль минимум 8 символов");
      return;
    }
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);
    try {
      const payload: any = { name, password };
      if (isEmailMode) payload.email = email;
      else payload.phone = phone;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка регистрации");

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: "var(--bg-main)",
        minHeight: "70vh",
        padding: "48px 16px",
      }}
    >
      <div
        className="container-wide"
        style={{ maxWidth: 440, margin: "0 auto" }}
      >
        <div className="card-base" style={{ padding: 32 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: "var(--green-light)",
                color: "var(--green)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 22,
                marginBottom: 12,
              }}
            >
              С
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)" }}>
              Регистрация
            </h1>
            <p
              style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 6 }}
            >
              {isEmailMode ? "Корпоративная почта + пароль — без телефона" : "Только телефон и пароль — без SMS"}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div>
              <label className="checkout-label">Имя</label>
              <input
                id="reg-name"
                name="name"
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иван Петров"
                autoComplete="name"
              />
            </div>
            {isEmailMode ? (
              <div>
                <label className="checkout-label">Email (корпоративный) *</label>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="info@company.ru"
                  autoComplete="email"
                />
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                  Рекомендуем обезличенную корпоративную почту: info@, zakaz@ — не считается ПД
                </div>
              </div>
            ) : (
              <div>
                <label className="checkout-label">Телефон *</label>
                <input
                  id="reg-phone"
                  name="phone"
                  type="tel"
                  className="form-input"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                  placeholder="+7 (913) 000-00-00"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={18}
                />
              </div>
            )}
            <div>
              <label className="checkout-label">Пароль *</label>
              <input
                id="reg-password"
                name="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Минимум 8 символов"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="checkout-label">Повторите пароль *</label>
              <input
                id="reg-password2"
                name="password2"
                type="password"
                className="form-input"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>

            {error && <div className="checkout-error">{error}</div>}

            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{ width: "100%", height: 48 }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Создаём...
                </>
              ) : (
                <>
                  <UserPlus size={16} /> Зарегистрироваться
                </>
              )}
            </button>
          </form>

          <p
            style={{
              marginTop: 18,
              fontSize: 13,
              color: "var(--ink-muted)",
              textAlign: "center",
            }}
          >
            Уже есть аккаунт?{" "}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              style={{ color: "var(--green)", fontWeight: 700 }}
            >
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
