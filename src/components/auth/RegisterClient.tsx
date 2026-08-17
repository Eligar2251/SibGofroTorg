// =========================================================
// FILE: src/components/auth/RegisterClient.tsx
// Регистрация по логину и паролю (без телефона и почты).
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { safeNextPath } from "@/lib/safe-next";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";

export function RegisterClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"), "/cabinet");

  const [username, setUsername] = useState("");
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

    if (!username.trim()) {
      setError("Укажите логин");
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
          username: username.trim(),
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
              Только логин и пароль — без номера телефона и почты
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
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
              />
              <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                3–40 символов: латиница/кириллица, цифры, точка, дефис
              </div>
            </div>
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
