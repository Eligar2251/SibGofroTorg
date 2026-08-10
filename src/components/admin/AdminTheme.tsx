"use client";

import { useEffect, useState } from "react";

export type AdminThemeId = "standard" | "light" | "dark" | "forest" | "ocean";

export const ADMIN_THEMES: { id: AdminThemeId; label: string; desc: string; colors: [string, string, string] }[] = [
  { id: "standard", label: "Крафт", desc: "Стандарт — тёплый гофрокартон", colors: ["#1a1a18", "#c8860a", "#f5f3ee"] },
  { id: "light", label: "Бумага", desc: "Светлая — чистая и воздушная", colors: ["#ffffff", "#1a73e8", "#f8f9fa"] },
  { id: "dark", label: "Ночь", desc: "Тёмная — для вечера, бережёт глаза", colors: ["#0f1115", "#fdd663", "#1f2328"] },
  { id: "forest", label: "Тайга", desc: "Лесная — глубокие зелёные", colors: ["#1b2a1e", "#6a8d73", "#f6f7f3"] },
  { id: "ocean", label: "Байкал", desc: "Морская — холодные синие", colors: ["#0f2040", "#0ea5e9", "#f0f7fa"] },
];

const STORAGE_KEY = "adm-theme";

function applyTheme(id: AdminThemeId) {
  const root = document.documentElement;
  root.setAttribute("data-admin-theme", id);
  // также на data-admin контейнер для скоупа, если он есть
  const admin = document.querySelector("[data-admin=\"true\"]");
  if (admin) admin.setAttribute("data-admin-theme", id);
}

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY) as AdminThemeId | null) || "standard";
      const valid = ADMIN_THEMES.some((t) => t.id === saved) ? saved : "standard";
      applyTheme(valid);
    } catch {
      applyTheme("standard");
    }
    // слушаем изменения из других вкладок
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminThemeId;
        if (ADMIN_THEMES.some((t) => t.id === v)) applyTheme(v);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return <>{children}</>;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<AdminThemeId>("standard");

  useEffect(() => {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY) as AdminThemeId | null) || "standard";
      if (ADMIN_THEMES.some((t) => t.id === saved)) setTheme(saved);
    } catch {}
  }, []);

  function set(newId: AdminThemeId) {
    setTheme(newId);
    try {
      localStorage.setItem(STORAGE_KEY, newId);
    } catch {}
    applyTheme(newId);
  }

  if (compact) {
    return (
      <select
        value={theme}
        onChange={(e) => set(e.target.value as AdminThemeId)}
        className="admin-theme-select"
        aria-label="Тема оформления"
        title="Тема оформления — меняется мгновенно"
      >
        {ADMIN_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="admin-theme-switcher" role="group" aria-label="Тема оформления">
      {ADMIN_THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => set(t.id)}
          className={`admin-theme-btn${theme === t.id ? " admin-theme-btn--active" : ""}`}
          title={`${t.label} — ${t.desc}`}
          aria-pressed={theme === t.id}
        >
          <span className="admin-theme-dot" style={{ background: t.colors[1], borderColor: t.colors[0] }} aria-hidden />
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Inline script для мгновенного применения без FOUC — вставляется в layout <head>
export function adminThemeInitScript() {
  return `try{var k="${STORAGE_KEY}",v=localStorage.getItem(k)||"standard";var ok=["standard","light","dark","forest","ocean"].indexOf(v)>=0?v:"standard";document.documentElement.setAttribute("data-admin-theme",ok);var a=document.querySelector('[data-admin=\"true\"]');if(a)a.setAttribute("data-admin-theme",ok);}catch(e){}`;
}
