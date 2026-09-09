// =========================================================
// FILE: src/components/admin/mobile/HideOnMobile.tsx
// Условная обёртка: на телефоне/планшете не рендерит детей, на
// десктопе отдаёт их как есть (DOM десктопа не меняется).
//
// Зачем: некоторые блоки страниц админки имеют «мобильного двойника»
// (например, плитки показателей дашборда в DashboardMobileTop).
// Чтобы телефон не показывал одно и то же дважды, десктопный блок
// оборачивается в <HideOnMobile>. Сервер по-прежнему рендерит его
// HTML, на десктопе он виден — поведение не меняется.
// =========================================================

"use client";

import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-is-mobile";

export function HideOnMobile({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  if (isMobile) return null;
  return <>{children}</>;
}
