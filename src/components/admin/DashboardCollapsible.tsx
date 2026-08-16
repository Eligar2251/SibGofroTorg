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
  // Первый клиентский рендер обязан совпадать с SSR. localStorage читаем
  // только после гидрации — иначе сохранённое «скрыто» даёт на клиенте
  // другую разметку, чем defaultOpen на сервере.
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const readStoredState = () => {
      let next = defaultOpen;
      try {
        const value = localStorage.getItem(storageKey);
        if (value === "0") next = false;
        if (value === "1") next = true;
      } catch {}
      setOpen(next);
    };

    readStoredState();
    window.addEventListener("storage", readStoredState);
    window.addEventListener("dash-visibility-changed", readStoredState);
    return () => {
      window.removeEventListener("storage", readStoredState);
      window.removeEventListener("dash-visibility-changed", readStoredState);
    };
  }, [defaultOpen, storageKey]);

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {}
    // Обновляем счётчик и checkbox панели в этой же вкладке. Нативный
    // storage-event браузер отправляет только другим вкладкам.
    window.dispatchEvent(new CustomEvent("dash-visibility-changed"));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // Управление с клавиатуры: заголовок — не <button>, потому что
    // внутри него бывают интерактивные элементы (ссылки sideContent),
    // а вкладывать интерактив в <button> нельзя по спецификации.
    if (e.key === "Enter" || e.key === " ") {
      const target = e.target as HTMLElement;
      if (target.closest("a,button")) return;
      e.preventDefault();
      toggleOpen();
    }
  }

  return (
    <section className={`dash-section${open ? " dash-section--open" : ""}`}>
      <div
        className="dash-section__head"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
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
      </div>
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
  // Как и сами секции, начинаем с детерминированного SSR-состояния.
  // Сохранённые настройки применятся эффектом сразу после гидрации.
  const [visible, setVisible] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const section of sections) out[section.id] = true;
    return out;
  });

  function setAll(v: boolean) {
    const next: Record<string, boolean> = {};
    for (const s of sections) next[s.id] = v;
    setVisible(next);
    for (const s of sections) {
      try { localStorage.setItem(`dash_section_${s.id}`, v ? "1" : "0"); } catch {}
    }
    // Нативный storage-event приходит только в другие вкладки, поэтому
    // текущую вкладку синхронизируем отдельным событием.
    window.dispatchEvent(new CustomEvent("dash-visibility-changed"));
  }
  function toggle(id: string) {
    const v = !visible[id];
    setVisible((p) => ({ ...p, [id]: v }));
    try { localStorage.setItem(`dash_section_${id}`, v ? "1" : "0"); } catch {}
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
    refresh();
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
