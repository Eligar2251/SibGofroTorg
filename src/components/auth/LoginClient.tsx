// =========================================================
// FILE: src/components/auth/LoginClient.tsx — вход по логину и паролю
// (совместимость с прежними аккаунтами по телефону/email сохранена)
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";
import { safeNextPath } from "@/lib/safe-next";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"), "/cabinet");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка входа");

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
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
              Вход в кабинет
            </h1>
            <p
              style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 6 }}
            >
              Логин и пароль
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <div>
              <label className="checkout-label">Логин *</label>
              <input
                id="login-identifier"
                name="identifier"
                type="text"
                className="form-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Ваш логин"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <div style={{ fontSize: 11, color: "var(--ink-muted)", marginTop: 4 }}>
                Можно войти и по старому телефону или email — поддерживаются оба варианта
              </div>
            </div>
            <div>
              <label className="checkout-label">Пароль *</label>
              <input
                id="login-password"
                name="password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                minLength={8}
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
                  <Loader2 size={16} className="animate-spin" /> Вход...
                </>
              ) : (
                <>
                  <LogIn size={16} /> Войти
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
            Нет аккаунта?{" "}
            <Link
              href={`/register?next=${encodeURIComponent(next)}`}
              style={{ color: "var(--green)", fontWeight: 700 }}
            >
              Зарегистрироваться
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
