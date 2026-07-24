// =========================================================
// FILE: src/components/admin/NavigationProgress.tsx
// Тонкая полоска прогресса вверху экрана при навигации.
// Даёт мгновенную визуальную обратную связь при клике на вкладку.
// =========================================================

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  useEffect(() => {
    if (pathname !== prevPath) {
      setPrevPath(pathname);
      // Путь изменился — скрываем полоску
      setVisible(false);
    }
  }, [pathname, prevPath]);

  // Показываем полоску при первых признаках навигации
  // (используем клик на ссылку как триггер)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a[href]");
      if (!target) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#")) return;
      // Внутренняя ссылка — показываем полоску
      setVisible(true);
    }

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "3px",
        zIndex: 9999,
        background: "var(--adm-kraft)",
        animation: "admin-progress-slide 1.5s ease-in-out infinite",
        transformOrigin: "left",
      }}
    />
  );
}
