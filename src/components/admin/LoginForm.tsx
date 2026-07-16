// =========================================================
// FILE: src/components/admin/LoginForm.tsx
// =========================================================

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, Loader2 } from "lucide-react";

export function LoginForm({ adminPath }: { adminPath: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    try {
      const res = await fetch(`/${adminPath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Ошибка входа");
      }

      router.push(`/${adminPath}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неверный логин или пароль");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
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