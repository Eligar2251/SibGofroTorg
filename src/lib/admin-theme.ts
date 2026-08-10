// =========================================================
// FILE: src/lib/admin-theme.ts
// Кастомизация админ-панели: единый источник истины.
// Эти списки читает инлайн-скрипт в <head> (анти-FOUC),
// AdminThemeProvider и ThemeCustomizer на странице настроек.
// =========================================================

export const ADMIN_THEME_IDS = [
  "standard",
  "light",
  "dark",
  "superdark",
  "forest",
  "ocean",
  "graphite",
  "ruby",
  "coffee",
  "lavender",
  "sunset",
  "mint",
] as const;

export const ADMIN_LAYOUT_IDS = [
  "sidebar-left",
  "sidebar-right",
  "sidebar-top",
  "compact",
] as const;

export const ADMIN_STYLE_IDS = [
  "classic",
  "neo",
  "retro",
  "cyberpunk",
  "minimal",
  "contrast",
] as const;

// Плотность интерфейса: обычная или компактная (меньше отступов).
export const ADMIN_DENSITY_IDS = ["comfortable", "compact"] as const;

// Анимации: полные или уменьшенные (для чувствительных к движению).
export const ADMIN_ANIM_IDS = ["full", "reduced"] as const;

export const THEME_STORAGE_KEY = "adm-theme";
export const LAYOUT_STORAGE_KEY = "adm-layout";
export const STYLE_STORAGE_KEY = "adm-style";
export const DENSITY_STORAGE_KEY = "adm-density";
export const ANIM_STORAGE_KEY = "adm-anim";

export const DEFAULT_ADMIN_THEME = "standard";
export const DEFAULT_ADMIN_LAYOUT = "sidebar-left";
export const DEFAULT_ADMIN_STYLE = "classic";
export const DEFAULT_ADMIN_DENSITY = "comfortable";
export const DEFAULT_ADMIN_ANIM = "full";

/**
 * Инлайн-скрипт для <head>: применяет сохранённые настройки
 * кастомизации до первой отрисовки, чтобы не было «мигания»
 * стандартной темы. Работает синхронно с localStorage.
 */
export function adminThemeInitScript(): string {
  return `try{
    var d=document.documentElement;
    var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"${DEFAULT_ADMIN_THEME}";
    d.setAttribute("data-admin-theme",${JSON.stringify([...ADMIN_THEME_IDS])}.indexOf(t)>=0?t:"${DEFAULT_ADMIN_THEME}");
    var l=localStorage.getItem("${LAYOUT_STORAGE_KEY}")||"${DEFAULT_ADMIN_LAYOUT}";
    d.setAttribute("data-admin-layout",${JSON.stringify([...ADMIN_LAYOUT_IDS])}.indexOf(l)>=0?l:"${DEFAULT_ADMIN_LAYOUT}");
    var s=localStorage.getItem("${STYLE_STORAGE_KEY}")||"${DEFAULT_ADMIN_STYLE}";
    d.setAttribute("data-admin-style",${JSON.stringify([...ADMIN_STYLE_IDS])}.indexOf(s)>=0?s:"${DEFAULT_ADMIN_STYLE}");
    var dn=localStorage.getItem("${DENSITY_STORAGE_KEY}")||"${DEFAULT_ADMIN_DENSITY}";
    d.setAttribute("data-admin-density",${JSON.stringify([...ADMIN_DENSITY_IDS])}.indexOf(dn)>=0?dn:"${DEFAULT_ADMIN_DENSITY}");
    var an=localStorage.getItem("${ANIM_STORAGE_KEY}")||"${DEFAULT_ADMIN_ANIM}";
    d.setAttribute("data-admin-anim",${JSON.stringify([...ADMIN_ANIM_IDS])}.indexOf(an)>=0?an:"${DEFAULT_ADMIN_ANIM}");
  }catch(e){}`;
}
