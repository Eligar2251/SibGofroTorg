"use client";

import { useEffect, useState } from "react";
import { Settings, Layout, Sparkles, Check } from "lucide-react";

export type AdminThemeId = "standard" | "light" | "dark" | "superdark" | "forest" | "ocean";
export type AdminLayoutId = "sidebar-left" | "sidebar-right" | "sidebar-top";
export type AdminStyleId = "classic" | "neo" | "retro" | "cyberpunk";

export const ADMIN_THEMES: { id: AdminThemeId; label: string; desc: string; colors: [string, string, string] }[] = [
  { id: "standard", label: "Крафт", desc: "Стандарт — тёплый гофрокартон", colors: ["#1a1a18", "#c8860a", "#f5f3ee"] },
  { id: "light", label: "Бумага", desc: "Светлая — чистая и воздушная", colors: ["#ffffff", "#1a73e8", "#f8f9fa"] },
  { id: "dark", label: "Ночь", desc: "Тёмная — бережёт глаза в темноте", colors: ["#0f1115", "#fdd663", "#1f2328"] },
  { id: "superdark", label: "Космос", desc: "Глубокий чёрный — максимальный отдых для глаз", colors: ["#000000", "#10b981", "#000000"] },
  { id: "forest", label: "Тайга", desc: "Лесная — глубокие зелёные тона", colors: ["#1b2a1e", "#6a8d73", "#f6f7f3"] },
  { id: "ocean", label: "Байкал", desc: "Морская — холодные синие оттенки", colors: ["#0f2040", "#0ea5e9", "#f0f7fa"] },
];

export const ADMIN_LAYOUTS: { id: AdminLayoutId; label: string; desc: string }[] = [
  { id: "sidebar-left", label: "Сайдбар слева", desc: "Классический вариант с меню слева" },
  { id: "sidebar-right", label: "Сайдбар справа", desc: "Для тех, кто предпочитает меню справа" },
  { id: "sidebar-top", label: "Верхнее меню", desc: "Широкий экран: меню превращается в шапку сверху" },
];

export const ADMIN_STYLES: { id: AdminStyleId; label: string; desc: string }[] = [
  { id: "classic", label: "Строгая классика", desc: "Тонкие рамки, плоские карточки" },
  { id: "neo", label: "Мягкий Нео", desc: "Плавные скругления, парящие карточки с тенями" },
  { id: "retro", label: "Ретро-панель", desc: "Чёрные рамки в стиле 90-х, острые углы" },
  { id: "cyberpunk", label: "Киберпанк", desc: "Неоновое свечение, футуристичный моноширинный акцент" },
];

const STORAGE_KEY = "adm-theme";
const LAYOUT_KEY = "adm-layout";
const STYLE_KEY = "adm-style";

function applyTheme(id: AdminThemeId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-theme", id);
  }
}

function applyLayout(id: AdminLayoutId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-layout", id);
  }
}

function applyStyle(id: AdminStyleId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-style", id);
  }
}

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    try {
      const savedTheme = (localStorage.getItem(STORAGE_KEY) as AdminThemeId | null) || "standard";
      const validTheme = ADMIN_THEMES.some((t) => t.id === savedTheme) ? savedTheme : "standard";
      applyTheme(validTheme);

      const savedLayout = (localStorage.getItem(LAYOUT_KEY) as AdminLayoutId | null) || "sidebar-left";
      const validLayout = ADMIN_LAYOUTS.some((l) => l.id === savedLayout) ? savedLayout : "sidebar-left";
      applyLayout(validLayout);

      const savedStyle = (localStorage.getItem(STYLE_KEY) as AdminStyleId | null) || "classic";
      const validStyle = ADMIN_STYLES.some((s) => s.id === savedStyle) ? savedStyle : "classic";
      applyStyle(validStyle);
    } catch {
      applyTheme("standard");
      applyLayout("sidebar-left");
      applyStyle("classic");
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminThemeId;
        if (ADMIN_THEMES.some((t) => t.id === v)) applyTheme(v);
      }
      if (e.key === LAYOUT_KEY && e.newValue) {
        const v = e.newValue as AdminLayoutId;
        if (ADMIN_LAYOUTS.some((l) => l.id === v)) applyLayout(v);
      }
      if (e.key === STYLE_KEY && e.newValue) {
        const v = e.newValue as AdminStyleId;
        if (ADMIN_STYLES.some((s) => s.id === v)) applyStyle(v);
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

export function ThemeCustomizer() {
  const [theme, setTheme] = useState<AdminThemeId>("standard");
  const [layout, setLayout] = useState<AdminLayoutId>("sidebar-left");
  const [style, setStyle] = useState<AdminStyleId>("classic");

  useEffect(() => {
    try {
      const savedTheme = (localStorage.getItem(STORAGE_KEY) as AdminThemeId | null) || "standard";
      if (ADMIN_THEMES.some((t) => t.id === savedTheme)) setTheme(savedTheme);

      const savedLayout = (localStorage.getItem(LAYOUT_KEY) as AdminLayoutId | null) || "sidebar-left";
      if (ADMIN_LAYOUTS.some((l) => l.id === savedLayout)) setLayout(savedLayout);

      const savedStyle = (localStorage.getItem(STYLE_KEY) as AdminStyleId | null) || "classic";
      if (ADMIN_STYLES.some((s) => s.id === savedStyle)) setStyle(savedStyle);
    } catch {}
  }, []);

  function handleThemeChange(id: AdminThemeId) {
    setTheme(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    applyTheme(id);
  }

  function handleLayoutChange(id: AdminLayoutId) {
    setLayout(id);
    try {
      localStorage.setItem(LAYOUT_KEY, id);
    } catch {}
    applyLayout(id);
  }

  function handleStyleChange(id: AdminStyleId) {
    setStyle(id);
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {}
    applyStyle(id);
  }

  return (
    <div className="theme-customizer-panel">
      {/* 1. Выбор цвета */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <Sparkles size={16} /> Цветовая схема
        </h3>
        <div className="customizer-grid text-theme-grid">
          {ADMIN_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`customizer-card theme-color-card ${theme === t.id ? "active" : ""}`}
              onClick={() => handleThemeChange(t.id)}
            >
              <div className="theme-preview-dots">
                <span className="dot" style={{ background: t.colors[0] }} />
                <span className="dot" style={{ background: t.colors[1] }} />
                <span className="dot" style={{ background: t.colors[2] }} />
              </div>
              <div className="card-info">
                <div className="card-label">{t.label}</div>
                <div className="card-desc">{t.desc}</div>
              </div>
              {theme === t.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Расположение элементов */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <Layout size={16} /> Расположение элементов
        </h3>
        <div className="customizer-grid text-layout-grid">
          {ADMIN_LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`customizer-card ${layout === l.id ? "active" : ""}`}
              onClick={() => handleLayoutChange(l.id)}
            >
              <div className="layout-thumbnail">
                {l.id === "sidebar-left" && (
                  <div className="thumb-split">
                    <div className="thumb-bar" />
                    <div className="thumb-content" />
                  </div>
                )}
                {l.id === "sidebar-right" && (
                  <div className="thumb-split reverse">
                    <div className="thumb-bar" />
                    <div className="thumb-content" />
                  </div>
                )}
                {l.id === "sidebar-top" && (
                  <div className="thumb-vertical">
                    <div className="thumb-header" />
                    <div className="thumb-content" />
                  </div>
                )}
              </div>
              <div className="card-info">
                <div className="card-label">{l.label}</div>
                <div className="card-desc">{l.desc}</div>
              </div>
              {layout === l.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Оформление элементов */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <Settings size={16} /> Стиль оформления элементов
        </h3>
        <div className="customizer-grid text-style-grid">
          {ADMIN_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`customizer-card style-${s.id}-preview ${style === s.id ? "active" : ""}`}
              onClick={() => handleStyleChange(s.id)}
            >
              <div className="style-preview-box">
                {s.id === "classic" && <div className="p-classic">Классика</div>}
                {s.id === "neo" && <div className="p-neo">Объём и Скругление</div>}
                {s.id === "retro" && <div className="p-retro">90-х Стиль</div>}
                {s.id === "cyberpunk" && <div className="p-cyber">Cyberpunk_</div>}
              </div>
              <div className="card-info">
                <div className="card-label">{s.label}</div>
                <div className="card-desc">{s.desc}</div>
              </div>
              {style === s.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .theme-customizer-panel {
          display: flex;
          flex-direction: column;
          gap: 24px;
          width: 100%;
          margin-top: 12px;
        }
        .customizer-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .customizer-title {
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--adm-ink);
          margin: 0;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .customizer-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }
        .customizer-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--adm-card);
          border: 1px solid var(--adm-border);
          border-radius: var(--adm-r-md, 8px);
          text-align: left;
          cursor: pointer;
          position: relative;
          transition: all 0.2s ease;
          width: 100%;
          color: var(--adm-ink-soft);
        }
        .customizer-card:hover {
          border-color: var(--adm-kraft);
          background: var(--adm-paper-warm);
        }
        .customizer-card.active {
          border-color: var(--adm-kraft);
          background: var(--adm-kraft-pale);
          box-shadow: 0 0 0 1px var(--adm-kraft);
          color: var(--adm-ink);
        }
        .theme-preview-dots {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
          padding: 4px;
          background: rgba(0,0,0,0.05);
          border-radius: 6px;
        }
        [data-admin-theme="dark"] .theme-preview-dots,
        [data-admin-theme="superdark"] .theme-preview-dots {
          background: rgba(255,255,255,0.08);
        }
        .theme-preview-dots .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.15);
        }
        .card-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex-grow: 1;
          min-width: 0;
        }
        .card-label {
          font-weight: 700;
          font-size: 13px;
        }
        .card-desc {
          font-size: 11px;
          color: var(--adm-ink-muted);
          white-space: normal;
          line-height: 1.3;
        }
        .check-icon {
          color: var(--adm-kraft);
          flex-shrink: 0;
        }
        
        /* Layout Thumbnails */
        .layout-thumbnail {
          width: 44px;
          height: 36px;
          border: 1.5px solid var(--adm-border-mid);
          border-radius: 4px;
          overflow: hidden;
          background: var(--adm-paper);
          flex-shrink: 0;
        }
        .thumb-split {
          display: flex;
          height: 100%;
        }
        .thumb-split.reverse {
          flex-direction: row-reverse;
        }
        .thumb-bar {
          width: 12px;
          height: 100%;
          background: var(--adm-ink);
          border-right: 1px solid var(--adm-border);
        }
        .thumb-split.reverse .thumb-bar {
          border-right: none;
          border-left: 1px solid var(--adm-border);
        }
        .thumb-content {
          flex-grow: 1;
          height: 100%;
          background: var(--adm-card);
        }
        .thumb-vertical {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .thumb-header {
          height: 10px;
          width: 100%;
          background: var(--adm-ink);
          border-bottom: 1px solid var(--adm-border);
        }

        /* Style Previews */
        .style-preview-box {
          width: 44px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 8px;
          font-weight: 800;
          text-transform: uppercase;
          background: var(--adm-paper-warm);
          border: 1px solid var(--adm-border-mid);
          border-radius: 4px;
          flex-shrink: 0;
          overflow: hidden;
          text-align: center;
        }
        .p-classic {
          border: 1px solid var(--adm-ink-muted);
          padding: 2px;
          border-radius: 1px;
        }
        .p-neo {
          border-radius: 12px;
          background: var(--adm-card);
          box-shadow: 2px 2px 5px rgba(0,0,0,0.1);
          padding: 2px 4px;
          font-size: 7px;
        }
        .p-retro {
          border: 2px solid #000;
          border-radius: 0px;
          padding: 1px;
          background: #fff;
          color: #000;
        }
        .p-cyber {
          border: 1px solid #10b981;
          color: #10b981;
          background: #000;
          text-shadow: 0 0 2px #10b981;
          font-family: monospace;
          padding: 2px;
        }
      `}</style>
    </div>
  );
}

// Inline script для мгновенного применения без FOUC — вставляется в layout <head>
export function adminThemeInitScript() {
  return `try{
    var k="${STORAGE_KEY}",v=localStorage.getItem(k)||"standard";
    var ok=["standard","light","dark","superdark","forest","ocean"].indexOf(v)>=0?v:"standard";
    
    var kl="${LAYOUT_KEY}",vl=localStorage.getItem(kl)||"sidebar-left";
    var okl=["sidebar-left","sidebar-right","sidebar-top"].indexOf(vl)>=0?vl:"sidebar-left";

    var ks="${STYLE_KEY}",vs=localStorage.getItem(ks)||"classic";
    var oks=["classic","neo","retro","cyberpunk"].indexOf(vs)>=0?vs:"classic";

    document.documentElement.setAttribute("data-admin-theme",ok);
    document.documentElement.setAttribute("data-admin-layout",okl);
    document.documentElement.setAttribute("data-admin-style",oks);
  }catch(e){}`;
}
