"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Layout,
  Sparkles,
  Check,
  RotateCcw,
  Rows3,
  Gauge,
  Zap,
  ZapOff,
  GlassWater,
} from "lucide-react";
import {
  ADMIN_THEME_IDS,
  ADMIN_LAYOUT_IDS,
  ADMIN_STYLE_IDS,
  ADMIN_DENSITY_IDS,
  ADMIN_ANIM_IDS,
  ADMIN_GLASS_IDS,
  THEME_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  STYLE_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  ANIM_STORAGE_KEY,
  GLASS_STORAGE_KEY,
  DEFAULT_ADMIN_THEME,
  DEFAULT_ADMIN_LAYOUT,
  DEFAULT_ADMIN_STYLE,
  DEFAULT_ADMIN_DENSITY,
  DEFAULT_ADMIN_ANIM,
  DEFAULT_ADMIN_GLASS,
} from "@/lib/admin-theme";

export type AdminThemeId = (typeof ADMIN_THEME_IDS)[number];
export type AdminLayoutId = (typeof ADMIN_LAYOUT_IDS)[number];
export type AdminStyleId = (typeof ADMIN_STYLE_IDS)[number];
export type AdminDensityId = (typeof ADMIN_DENSITY_IDS)[number];
export type AdminAnimId = (typeof ADMIN_ANIM_IDS)[number];
export type AdminGlassId = (typeof ADMIN_GLASS_IDS)[number];

export const ADMIN_THEMES: {
  id: AdminThemeId;
  label: string;
  desc: string;
  colors: [string, string, string];
}[] = [
  { id: "standard", label: "Крафт", desc: "Стандарт — тёплый гофрокартон", colors: ["#1a1a18", "#c8860a", "#f5f3ee"] },
  { id: "light", label: "Бумага", desc: "Светлая — чистая и воздушная", colors: ["#202124", "#1a73e8", "#f8f9fa"] },
  { id: "dark", label: "Ночь", desc: "Тёмная — бережёт глаза в темноте", colors: ["#0f1115", "#fdd663", "#1f2328"] },
  { id: "superdark", label: "Космос", desc: "Глубокий чёрный — максимальный отдых для глаз", colors: ["#000000", "#10b981", "#0d0d0d"] },
  { id: "forest", label: "Тайга", desc: "Лесная — глубокие зелёные тона", colors: ["#1b2a1e", "#6a8d73", "#f6f7f3"] },
  { id: "ocean", label: "Байкал", desc: "Морская — холодные синие оттенки", colors: ["#0f2040", "#0ea5e9", "#f0f7fa"] },
  { id: "graphite", label: "Гранит", desc: "Нейтральный тёмно-серый с оранжевым акцентом", colors: ["#141618", "#ff8a3d", "#202429"] },
  { id: "ruby", label: "Рубин", desc: "Тёмный бордовый с розовым акцентом", colors: ["#170f11", "#fb7185", "#251a1d"] },
  { id: "coffee", label: "Эспрессо", desc: "Тёплый кофейный с карамельным акцентом", colors: ["#171310", "#d9a05b", "#241e19"] },
  { id: "lavender", label: "Лаванда", desc: "Светлая и нежная, сиреневый акцент", colors: ["#2a2438", "#7c3aed", "#f8f6fc"] },
  { id: "sunset", label: "Закат", desc: "Тёплый персиковый, терракотовый акцент", colors: ["#33231c", "#ea580c", "#fdf7f2"] },
  { id: "mint", label: "Мята", desc: "Свежая светло-зелёная, изумрудный акцент", colors: ["#122b21", "#059669", "#f4faf7"] },
];

export const ADMIN_LAYOUTS: { id: AdminLayoutId; label: string; desc: string }[] = [
  { id: "sidebar-left", label: "Сайдбар слева", desc: "Классический вариант с меню слева" },
  { id: "sidebar-right", label: "Сайдбар справа", desc: "Для тех, кто предпочитает меню справа" },
  { id: "sidebar-top", label: "Верхнее меню", desc: "Широкий экран: меню превращается в шапку сверху" },
  { id: "compact", label: "Компактный сайдбар", desc: "Только иконки — максимум места для контента" },
];

export const ADMIN_STYLES: { id: AdminStyleId; label: string; desc: string }[] = [
  { id: "classic", label: "Строгая классика", desc: "Тонкие рамки, плоские карточки" },
  { id: "neo", label: "Мягкий Нео", desc: "Плавные скругления, парящие карточки с тенями" },
  { id: "retro", label: "Ретро-панель", desc: "Чёрные рамки в стиле 90-х, острые углы" },
  { id: "cyberpunk", label: "Киберпанк", desc: "Неоновое свечение, футуристичный моноширинный акцент" },
  { id: "minimal", label: "Минимализм", desc: "Без теней и лишнего — только тонкие линии" },
  { id: "contrast", label: "Контраст", desc: "Жирные рамки и заметный фокус — максимальная читаемость" },
];

export const ADMIN_DENSITIES: { id: AdminDensityId; label: string; desc: string }[] = [
  { id: "comfortable", label: "Обычная", desc: "Просторные отступы, размеры по умолчанию" },
  { id: "compact", label: "Компактная", desc: "Меньше отступов — больше данных на экране" },
];

export const ADMIN_ANIMS: { id: AdminAnimId; label: string; desc: string }[] = [
  { id: "full", label: "Полные анимации", desc: "Плавные переходы и эффекты" },
  { id: "reduced", label: "Уменьшить анимации", desc: "Статичный интерфейс без движения" },
];

export const ADMIN_GLASS: { id: AdminGlassId; label: string; desc: string }[] = [
  { id: "off", label: "Классические поверхности", desc: "Плотные карточки без размытия — максимальный FPS" },
  { id: "on", label: "Эффект стекла", desc: "Полупрозрачные карточки с размытием фона (glassmorphism)" },
];

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

function applyDensity(id: AdminDensityId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-density", id);
  }
}

function applyAnim(id: AdminAnimId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-anim", id);
  }
}

function applyGlass(id: AdminGlassId) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-admin-glass", id);
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage недоступен — настройка применится только визуально */
  }
}

export function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const savedTheme = safeGet(THEME_STORAGE_KEY) as AdminThemeId | null;
    applyTheme(
      savedTheme && (ADMIN_THEME_IDS as readonly string[]).includes(savedTheme)
        ? savedTheme
        : DEFAULT_ADMIN_THEME
    );

    const savedLayout = safeGet(LAYOUT_STORAGE_KEY) as AdminLayoutId | null;
    applyLayout(
      savedLayout && (ADMIN_LAYOUT_IDS as readonly string[]).includes(savedLayout)
        ? savedLayout
        : DEFAULT_ADMIN_LAYOUT
    );

    const savedStyle = safeGet(STYLE_STORAGE_KEY) as AdminStyleId | null;
    applyStyle(
      savedStyle && (ADMIN_STYLE_IDS as readonly string[]).includes(savedStyle)
        ? savedStyle
        : DEFAULT_ADMIN_STYLE
    );

    const savedDensity = safeGet(DENSITY_STORAGE_KEY) as AdminDensityId | null;
    applyDensity(
      savedDensity && (ADMIN_DENSITY_IDS as readonly string[]).includes(savedDensity)
        ? savedDensity
        : DEFAULT_ADMIN_DENSITY
    );

    const savedAnim = safeGet(ANIM_STORAGE_KEY) as AdminAnimId | null;
    applyAnim(
      savedAnim && (ADMIN_ANIM_IDS as readonly string[]).includes(savedAnim)
        ? savedAnim
        : DEFAULT_ADMIN_ANIM
    );

    const savedGlass = safeGet(GLASS_STORAGE_KEY) as AdminGlassId | null;
    applyGlass(
      savedGlass && (ADMIN_GLASS_IDS as readonly string[]).includes(savedGlass)
        ? savedGlass
        : DEFAULT_ADMIN_GLASS
    );

    // Синхронизация между вкладками.
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminThemeId;
        if ((ADMIN_THEME_IDS as readonly string[]).includes(v)) applyTheme(v);
      }
      if (e.key === LAYOUT_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminLayoutId;
        if ((ADMIN_LAYOUT_IDS as readonly string[]).includes(v)) applyLayout(v);
      }
      if (e.key === STYLE_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminStyleId;
        if ((ADMIN_STYLE_IDS as readonly string[]).includes(v)) applyStyle(v);
      }
      if (e.key === DENSITY_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminDensityId;
        if ((ADMIN_DENSITY_IDS as readonly string[]).includes(v)) applyDensity(v);
      }
      if (e.key === ANIM_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminAnimId;
        if ((ADMIN_ANIM_IDS as readonly string[]).includes(v)) applyAnim(v);
      }
      if (e.key === GLASS_STORAGE_KEY && e.newValue) {
        const v = e.newValue as AdminGlassId;
        if ((ADMIN_GLASS_IDS as readonly string[]).includes(v)) applyGlass(v);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <>{children}</>;
}

export function ThemeCustomizer() {
  const [theme, setTheme] = useState<AdminThemeId>(DEFAULT_ADMIN_THEME);
  const [layout, setLayout] = useState<AdminLayoutId>(DEFAULT_ADMIN_LAYOUT);
  const [style, setStyle] = useState<AdminStyleId>(DEFAULT_ADMIN_STYLE);
  const [density, setDensity] = useState<AdminDensityId>(DEFAULT_ADMIN_DENSITY);
  const [anim, setAnim] = useState<AdminAnimId>(DEFAULT_ADMIN_ANIM);
  const [glass, setGlass] = useState<AdminGlassId>(DEFAULT_ADMIN_GLASS);

  useEffect(() => {
    const savedTheme = safeGet(THEME_STORAGE_KEY) as AdminThemeId | null;
    if (savedTheme && (ADMIN_THEME_IDS as readonly string[]).includes(savedTheme)) setTheme(savedTheme);

    const savedLayout = safeGet(LAYOUT_STORAGE_KEY) as AdminLayoutId | null;
    if (savedLayout && (ADMIN_LAYOUT_IDS as readonly string[]).includes(savedLayout)) setLayout(savedLayout);

    const savedStyle = safeGet(STYLE_STORAGE_KEY) as AdminStyleId | null;
    if (savedStyle && (ADMIN_STYLE_IDS as readonly string[]).includes(savedStyle)) setStyle(savedStyle);

    const savedDensity = safeGet(DENSITY_STORAGE_KEY) as AdminDensityId | null;
    if (savedDensity && (ADMIN_DENSITY_IDS as readonly string[]).includes(savedDensity)) setDensity(savedDensity);

    const savedAnim = safeGet(ANIM_STORAGE_KEY) as AdminAnimId | null;
    if (savedAnim && (ADMIN_ANIM_IDS as readonly string[]).includes(savedAnim)) setAnim(savedAnim);

    const savedGlass = safeGet(GLASS_STORAGE_KEY) as AdminGlassId | null;
    if (savedGlass && (ADMIN_GLASS_IDS as readonly string[]).includes(savedGlass)) setGlass(savedGlass);
  }, []);

  function handleThemeChange(id: AdminThemeId) {
    setTheme(id);
    safeSet(THEME_STORAGE_KEY, id);
    applyTheme(id);
  }

  function handleLayoutChange(id: AdminLayoutId) {
    setLayout(id);
    safeSet(LAYOUT_STORAGE_KEY, id);
    applyLayout(id);
  }

  function handleStyleChange(id: AdminStyleId) {
    setStyle(id);
    safeSet(STYLE_STORAGE_KEY, id);
    applyStyle(id);
  }

  function handleDensityChange(id: AdminDensityId) {
    setDensity(id);
    safeSet(DENSITY_STORAGE_KEY, id);
    applyDensity(id);
  }

  function handleAnimChange(id: AdminAnimId) {
    setAnim(id);
    safeSet(ANIM_STORAGE_KEY, id);
    applyAnim(id);
  }

  function handleGlassChange(id: AdminGlassId) {
    setGlass(id);
    safeSet(GLASS_STORAGE_KEY, id);
    applyGlass(id);
  }

  function handleReset() {
    setTheme(DEFAULT_ADMIN_THEME);
    setLayout(DEFAULT_ADMIN_LAYOUT);
    setStyle(DEFAULT_ADMIN_STYLE);
    setDensity(DEFAULT_ADMIN_DENSITY);
    setAnim(DEFAULT_ADMIN_ANIM);
    setGlass(DEFAULT_ADMIN_GLASS);
    safeSet(THEME_STORAGE_KEY, DEFAULT_ADMIN_THEME);
    safeSet(LAYOUT_STORAGE_KEY, DEFAULT_ADMIN_LAYOUT);
    safeSet(STYLE_STORAGE_KEY, DEFAULT_ADMIN_STYLE);
    safeSet(DENSITY_STORAGE_KEY, DEFAULT_ADMIN_DENSITY);
    safeSet(ANIM_STORAGE_KEY, DEFAULT_ADMIN_ANIM);
    safeSet(GLASS_STORAGE_KEY, DEFAULT_ADMIN_GLASS);
    applyTheme(DEFAULT_ADMIN_THEME);
    applyLayout(DEFAULT_ADMIN_LAYOUT);
    applyStyle(DEFAULT_ADMIN_STYLE);
    applyDensity(DEFAULT_ADMIN_DENSITY);
    applyAnim(DEFAULT_ADMIN_ANIM);
    applyGlass(DEFAULT_ADMIN_GLASS);
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
                {l.id === "compact" && (
                  <div className="thumb-split">
                    <div className="thumb-bar thumb-bar--icons">
                      <i /><i /><i />
                    </div>
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
                {s.id === "neo" && <div className="p-neo">Объём</div>}
                {s.id === "retro" && <div className="p-retro">90-е</div>}
                {s.id === "cyberpunk" && <div className="p-cyber">Cyber_</div>}
                {s.id === "minimal" && <div className="p-minimal">Плоский</div>}
                {s.id === "contrast" && <div className="p-contrast">Контраст</div>}
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

      {/* 4. Плотность интерфейса */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <Rows3 size={16} /> Плотность интерфейса
        </h3>
        <div className="customizer-grid text-density-grid">
          {ADMIN_DENSITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`customizer-card ${density === d.id ? "active" : ""}`}
              onClick={() => handleDensityChange(d.id)}
            >
              <div className="option-icon-badge">
                <Gauge size={18} />
              </div>
              <div className="card-info">
                <div className="card-label">{d.label}</div>
                <div className="card-desc">{d.desc}</div>
              </div>
              {density === d.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      {/* 5. Анимации */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <Zap size={16} /> Анимации
        </h3>
        <div className="customizer-grid text-anim-grid">
          {ADMIN_ANIMS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`customizer-card ${anim === a.id ? "active" : ""}`}
              onClick={() => handleAnimChange(a.id)}
            >
              <div className="option-icon-badge">
                {a.id === "full" ? <Zap size={18} /> : <ZapOff size={18} />}
              </div>
              <div className="card-info">
                <div className="card-label">{a.label}</div>
                <div className="card-desc">{a.desc}</div>
              </div>
              {anim === a.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      {/* 6. Эффект стекла */}
      <div className="customizer-section">
        <h3 className="customizer-title">
          <GlassWater size={16} /> Эффект стекла
        </h3>
        <div className="customizer-grid text-glass-grid">
          {ADMIN_GLASS.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`customizer-card glass-option${g.id === "on" ? " glass-option--preview" : ""} ${glass === g.id ? "active" : ""}`}
              onClick={() => handleGlassChange(g.id)}
            >
              <div className="option-icon-badge">
                <GlassWater size={18} />
              </div>
              <div className="card-info">
                <div className="card-label">{g.label}</div>
                <div className="card-desc">{g.desc}</div>
              </div>
              {glass === g.id && <Check className="check-icon" size={16} />}
            </button>
          ))}
        </div>
      </div>

      <div className="customizer-reset-row">
        <button type="button" className="customizer-reset-btn" onClick={handleReset}>
          <RotateCcw size={14} /> Сбросить всё к стандартным настройкам
        </button>
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
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 12px;
        }
        .customizer-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--adm-card);
          border: 1px solid var(--adm-border);
          border-radius: var(--adm-r, 8px);
          text-align: left;
          cursor: pointer;
          position: relative;
          transition: all 0.2s ease;
          width: 100%;
          color: var(--adm-ink-soft);
          font-family: inherit;
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
          background: rgba(127,127,127,0.12);
          border-radius: 6px;
        }
        .theme-preview-dots .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1px solid rgba(127,127,127,0.35);
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
          background: var(--adm-ink-deep);
          border-right: 1px solid var(--adm-border);
        }
        .thumb-split.reverse .thumb-bar {
          border-right: none;
          border-left: 1px solid var(--adm-border);
        }
        .thumb-bar--icons {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 3px;
          width: 9px;
        }
        .thumb-bar--icons i {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: rgba(255,255,255,0.65);
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
          background: var(--adm-ink-deep);
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
          color: var(--adm-ink-soft);
        }
        .p-classic {
          border: 1px solid var(--adm-ink-muted);
          padding: 2px;
          border-radius: 1px;
        }
        .p-neo {
          border-radius: 12px;
          background: var(--adm-card);
          box-shadow: 2px 2px 5px rgba(0,0,0,0.15);
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
        .p-minimal {
          border: 1px solid var(--adm-border-soft);
          background: var(--adm-card);
          padding: 2px 4px;
          font-size: 7px;
          font-weight: 600;
        }
        .p-contrast {
          border: 2.5px solid var(--adm-ink);
          padding: 1px 3px;
          font-weight: 900;
          color: var(--adm-ink);
        }

        /* Icon badges for density/animation cards */
        .option-icon-badge {
          width: 44px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--adm-paper-warm);
          border: 1px solid var(--adm-border-mid);
          border-radius: 4px;
          flex-shrink: 0;
          color: var(--adm-ink-muted);
        }

        /* Карточка-превью стекла: полупрозрачность + блик */
        .glass-option--preview .option-icon-badge {
          background: linear-gradient(135deg, color-mix(in srgb, var(--adm-card) 55%, transparent), color-mix(in srgb, var(--adm-steel) 18%, transparent));
          -webkit-backdrop-filter: blur(4px);
          backdrop-filter: blur(4px);
          border-color: color-mix(in srgb, var(--adm-border-mid) 70%, transparent);
          color: var(--adm-steel);
        }

        .customizer-reset-row {
          display: flex;
          justify-content: flex-end;
          padding-top: 4px;
          border-top: 1px solid var(--adm-border);
        }
        .customizer-reset-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 8px 14px;
          border-radius: var(--adm-r-sm, 6px);
          border: 1px solid var(--adm-border-mid);
          background: var(--adm-card);
          color: var(--adm-ink-soft);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          font-family: inherit;
        }
        .customizer-reset-btn:hover {
          border-color: var(--adm-rust);
          color: var(--adm-rust);
          background: var(--adm-rust-pale);
        }
      `}</style>
    </div>
  );
}
