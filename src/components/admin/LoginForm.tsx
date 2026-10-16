// =========================================================
// FILE: src/components/admin/LoginForm.tsx
//
// Изменения:
//   • при `?expired=1` (сессия истекла или её отозвали) показываем
//     понятное объявление — раньше администратор видел пустую форму и
//     думал, что сломались логин/пароль;
//   • ошибку базы (503 db_unavailable) показываем отдельно, с объяснением:
//     «пароль тут ни при чём, база недоступна» + ссылка на отчёт о базе.
//     Раньше при недоступной базе маршрут входа отвечал «Неверный логин
//     или пароль», и настоящую причину приходилось искать вслепую.
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2, CircleAlert } from "lucide-react";
import { getAdminLandingPath, parseAdminRole } from "@/lib/admin-rbac";

export function LoginForm({
  adminPath,
  expired = false,
}: {
  adminPath: string;
  expired?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dbError, setDbError] = useState<{ message: string; detail?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setDbError(null);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    try {
      const res = await fetch(`/${adminPath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 503 || data.code === "db_unavailable") {
          setDbError({
            message: data.error || "База данных недоступна",
            detail: data.detail || data.hint,
          });
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Ошибка входа");
      }

      // Стартовая страница зависит от роли: макулатурщик попадает сразу
      // в отдельный учёт макулатуры, остальные — на дашборд.
      const role = parseAdminRole(data.role);
      router.push(getAdminLandingPath(role, adminPath));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный логин или пароль");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {expired && !dbError ? (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.5,
            background: "var(--adm-kraft-pale)",
            border: "1px solid var(--adm-kraft-line)",
            color: "var(--adm-ink)",
          }}
        >
          <b>Сессия истекла.</b> Войдите заново — заявки, товары и настройки не
          потеряны, пароль прежний.
        </div>
      ) : null}

      {dbError ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.55,
            background: "var(--adm-rust-pale)",
            border: "1px solid var(--adm-rust-line)",
            color: "var(--adm-ink)",
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
            <CircleAlert size={16} color="var(--adm-rust)" aria-hidden />
            {dbError.message}
          </div>
          <div style={{ marginTop: 6 }}>
            Логин и пароль здесь ни при чём: приложение не может подключиться к
            базе. Откройте{" "}
            <a href="/api/health/db?deep=1" target="_blank" rel="noreferrer">
              отчёт о базе
            </a>{" "}
            — там указана причина (проект Supabase на паузе, отозванный ключ,
            сеть) и что делать.
          </div>
          {dbError.detail ? (
            <div style={{ marginTop: 6, opacity: 0.85, wordBreak: "break-word" }}>
              {dbError.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="admin-field" style={{ marginBottom: 16 }}>
        <label htmlFor="username" className="admin-label">
          Логин
        </label>
        <input
          id="username"
          name="username"
          type="text"
          required
          autoComplete="username"
          className="admin-input"
          placeholder="admin"
        />
      </div>

      <div className="admin-field" style={{ marginBottom: 16 }}>
        <label htmlFor="password" className="admin-label">
          Пароль
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="admin-input"
          placeholder="••••••••"
        />
      </div>

      {error && (
        <div className="admin-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="admin-btn admin-btn--navy"
        style={{ width: "100%", padding: "14px 24px", fontWeight: 700 }}
      >
        {loading ? (
          <>
            <Loader2 size={18} className="animate-spin" /> Вход...
          </>
        ) : (
          <>
            <LogIn size={18} /> Войти
          </>
        )}
      </button>
    </form>
  );
}
