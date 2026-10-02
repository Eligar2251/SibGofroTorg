// =========================================================
// FILE: src/components/admin/NavCustomizerLauncher.tsx
// Кнопка на странице «Настройки», открывающая модалку настройки
// меню. Сама модалка и её состояние живут в оболочке (AdminShell),
// поэтому открытие — через событие окна, которое оболочка слушает.
// =========================================================

"use client";

import { SlidersHorizontal } from "lucide-react";

export function NavCustomizerLauncher() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("admin-open-nav-customizer"))}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 14px",
        font: "inherit",
        fontSize: 13,
        fontWeight: 650,
        color: "var(--adm-kraft, #c8860a)",
        background: "var(--adm-kraft-pale, rgba(200,134,10,0.1))",
        border: "1px solid color-mix(in srgb, var(--adm-kraft, #c8860a) 45%, transparent)",
        borderRadius: "var(--adm-r-sm, 6px)",
        cursor: "pointer",
      }}
    >
      <SlidersHorizontal size={15} aria-hidden="true" />
      Открыть настройку меню
    </button>
  );
}
