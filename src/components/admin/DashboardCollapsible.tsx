"use client";

import { useState, useEffect, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: string | number;
  defaultOpen?: boolean;
  accent?: "green" | "red" | "blue" | "amber" | "gray";
  children: ReactNode;
  sideContent?: ReactNode;
}

// Акценты секций — пары/тройки из темных переменных, чтобы
     // цвет оставался контрастным в любой теме.
const accentMap = {
  green: { fg: "var(--adm-pine)", bg: "var(--adm-pine-pale)", line: "var(--adm-pine-line)" },
  red: { fg: "var(--adm-rust)", bg: "var(--adm-rust-pale)", line: "var(--adm-rust-line)" },
  blue: { fg: "var(--adm-steel)", bg: "var(--adm-steel-pale)", line: "var(--adm-steel-line)" },
  amber: { fg: "var(--adm-kraft)", bg: "var(--adm-kraft-pale)", line: "var(--adm-kraft-line)" },
  gray: { fg: "var(--adm-sand)", bg: "var(--adm-sand-pale)", line: "var(--adm-border-mid)" },
};

export function CollapsibleSection({
  id,
  title,
  subtitle,
  icon,
  badge,
  defaultOpen = true,
  accent = "blue",
  children,
  sideContent,
}: CollapsibleSectionProps) {
  const storageKey = `dash_section_${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultOpen;
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "0") return false;
      if (v === "1") return true;
    } catch {}
    return defaultOpen;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? "1" : "0");
    } catch {}
  }, [open, storageKey]);

  return (
    <section className={`dash-section${open ? " dash-section--open" : ""}`}>
      <button
        type="button"
        className="dash-section__head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span
          className="dash-section__chevron"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        >
          <ChevronRight size={18} />
        </span>
        {icon && <span className="dash-section__icon" style={{ color: accentMap[accent].fg }}>{icon}</span>}
        <span className="dash-section__title">
          <span className="dash-section__title-text">{title}</span>
          {subtitle && <span className="dash-section__subtitle">{subtitle}</span>}
        </span>
        {badge !== undefined && badge !== "" && (
          <span
            className="dash-section__badge"
            style={{ background: accentMap[accent].bg, color: accentMap[accent].fg, borderColor: accentMap[accent].line }}
          >
            {typeof badge === "number" ? badge.toLocaleString("ru-RU") : badge}
          </span>
        )}
        {sideContent && (
          <span className="dash-section__side" onClick={(e) => e.stopPropagation()}>
            {sideContent}
          </span>
        )}
      </button>
      {open && <div className="dash-section__body">{children}</div>}
    </section>
  );
}

/** Панель «быстрых видимостей» — скрыть/показать все блоки одним кликом. */
// Статический список секций дашборда. Вынесен на уровень модуля,
// чтобы не пересоздаваться на каждый рендер и не попадать в
// зависимости хуков.
const VISIBILITY_SECTIONS = [
  { id: "stats", label: "Главные показатели" },
  { id: "finance", label: "Финансовая отчётность (банк/касса)" },
  { id: "deliveries", label: "Перевозки и доставки" },
  { id: "wastepaper", label: "Макулатура" },
  { id: "statuses", label: "Статусы заявок" },
  { id: "recent", label: "Последние заявки / склад / действия" },
];

export function DashboardVisibilityToggle() {
  const sections = VISIBILITY_SECTIONS;
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const s of sections) out[s.id] = true;
    if (typeof window === "undefined") return out;
    try {
      for (const s of sections) {
        const v = localStorage.getItem(`dash_section_${s.id}`);
        out[s.id] = v === "0" ? false : true;
      }
    } catch {}
    return out;
  });

  function setAll(v: boolean) {
    const next: Record<string, boolean> = {};
    for (const s of sections) next[s.id] = v;
    setVisible(next);
    for (const s of sections) {
      try { localStorage.setItem(`dash_section_${s.id}`, v ? "1" : "0"); } catch {}
    }
    // Сообщить всем раскрывашкам, что надо перечитать localStorage
    window.dispatchEvent(new Event("storage"));
    // не все слушают storage — вышлем кастомное событие
    window.dispatchEvent(new CustomEvent("dash-visibility-changed"));
  }
  function toggle(id: string) {
    const v = !visible[id];
    setVisible((p) => ({ ...p, [id]: v }));
    try { localStorage.setItem(`dash_section_${id}`, v ? "1" : "0"); } catch {}
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("dash-visibility-changed"));
  }
  // синхронизация с изменениями из других компонентов
  useEffect(() => {
    const refresh = () => {
      const out: Record<string, boolean> = {};
      for (const s of sections) {
        try {
          out[s.id] = localStorage.getItem(`dash_section_${s.id}`) !== "0";
        } catch { out[s.id] = true; }
      }
      setVisible(out);
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("dash-visibility-changed", refresh as EventListener);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("dash-visibility-changed", refresh as EventListener);
    };
  }, [sections]);

  const shownCount = Object.values(visible).filter(Boolean).length;
  return (
    <div className="dash-visibility">
      <details>
        <summary>
          <span className="dash-visibility__toggle">
            Настроить видимость блоков <span className="dash-visibility__count">({shownCount}/{sections.length})</span>
          </span>
        </summary>
        <div className="dash-visibility__panel">
          <div className="dash-visibility__actions">
            <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setAll(true)}>
              Показать все
            </button>
            <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setAll(false)}>
              Скрыть все
            </button>
          </div>
          <div className="dash-visibility__list">
            {sections.map((s) => (
              <label key={s.id} className="dash-visibility__item">
                <input
                  type="checkbox"
                  checked={visible[s.id]}
                  onChange={() => toggle(s.id)}
                />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <div className="dash-visibility__hint">
            Настройки сохраняются на этом компьютере. Можно скрыть редко используемые
            блоки (например макулатуру или отчёты), чтобы экран был проще.
          </div>
        </div>
      </details>
    </div>
  );
}
