// =========================================================
// FILE: src/components/auth/RegisterClient.tsx
// Регистрация по номеру телефона (основной способ) или по email —
// метод переключается в админке настройкой registration_contact_field.
// Логин+пароль оставлен как запасной вариант для тех, кто не хочет
// оставлять номер: аккаунты, созданные раньше, продолжают работать.
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { safeNextPath } from "@/lib/safe-next";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { digitsPhone, formatPhoneMask } from "@/lib/phone-mask";
import { useSiteSettings } from "@/hooks/use-site-settings";

export function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"), "/cabinet");

  const { registrationField } = useSiteSettings();
  const byEmail = registrationField === "email";

  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [useLogin, setUseLogin] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (useLogin) {
      if (!username.trim()) {
        setError("Укажите логин");
        return;
      }
    } else if (byEmail) {
      if (!email.trim()) {
        setError("Укажите email");
        return;
      }
    } else if (digitsPhone(phone).length !== 11) {
      setError("Укажите номер телефона в формате +7 (___) ___-__-__");
      return;
    }
    if (password.length < 8) {
      setError("Пароль минимум 8 символов");
      return;
    }
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    if (!consent) {
      setConsentError(true);
      return;
    }
    setConsentError(false);

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Ровно одно поле — сервер по нему и определяет способ регистрации
          ...(useLogin
            ? { username: username.trim() }
            : byEmail
              ? { email: email.trim() }
              : { phone: digitsPhone(phone) }),
          password,
          name: name.trim() || undefined,
        }),
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
              {useLogin
                ? "Логин и пароль — без номера телефона"
                : byEmail
                  ? "По email — на него менеджер пришлёт ответ"
                  : "По номеру телефона — по нему менеджер свяжется с вами"}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            {useLogin ? (
              <div>
                <label className="checkout-label">Логин *</label>
                <input
                  id="reg-username"
                  name="username"
                  type="text"
                  className="form-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Например: ivanov"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                  3–40 символов: латиница/кириллица, цифры, точка, дефис
                </div>
              </div>
            ) : byEmail ? (
              <div>
                <label className="checkout-label">Email *</label>
                <input
                  id="reg-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  className="form-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.ru"
                  autoComplete="email"
                />
              </div>
            ) : (
              <div>
                <label className="checkout-label">Телефон *</label>
                <input
                  id="reg-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  className="form-input"
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneMask(e.target.value))}
                  placeholder="+7 (913) 000-00-00"
                  autoComplete="tel"
                />
                <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                  Это же номер будет логином для входа
                </div>
              </div>
            )}
            <div>
              <label className="checkout-label">Имя (необязательно)</label>
              <input
                id="reg-name"
                name="name"
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Как к вам обращаться"
                autoComplete="name"
              />
            </div>
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

            <ConsentCheckbox
              checked={consent}
              onChange={(v) => setConsent(v)}
              error={consentError}
            />

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
            <button
              type="button"
              onClick={() => {
                setUseLogin((v) => !v);
                setError("");
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--green)",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {useLogin
                ? byEmail
                  ? "Зарегистрироваться по email"
                  : "Зарегистрироваться по номеру телефона"
                : "Не хочу оставлять номер — придумать логин"}
            </button>
            <br />
            <br />
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
