// =========================================================
// FILE: src/components/admin/mobile/MobileAdminShell.tsx
// Мобильная оболочка админки — «нативное приложение», а не ужатый
// десктоп.
//
// ЧТО ЭТО
// Полностью отдельная вёрстка для телефонов (useIsPhone, ≤768px):
//   • фиксированная шапка приложения (заголовок раздела + подпись
//     пользователя), без бургера — навигация живёт внизу;
//   • нижняя панель вкладок (MobileTabBar) + лист «Ещё»;
//   • контент страниц рендерится в .admin-main, поэтому весь
//     действующий мобильный CSS-слой страниц продолжает работать.
//
// Десктоп НЕ трогается: AdminShell на широких экранах рендерит
// прежний сайдбар, этот компонент на них просто не создаётся.
//
// КРУЖКИ-ИНДИКАТОРЫ (планы поставок · заявки · уведомления)
// Три компонента сами позиционируются как fixed-элементы по
// переменным --adm-mobile-* (слой admin-mobile.css, ≤768px).
// Оболочка задаёт эти переменные на своём корне — индикаторы
// встают в правую часть НАШЕЙ шапки без единого переопределения
// их собственных стилей. Бургер в правом краю больше не рендерится,
// поэтому крайний правый слот оставлен пустым (воздух под чёлку).
//
// МЕДИАЗАПРОСОВ ЗДЕСЬ НЕТ намеренно: «мобильность» — свойство
// компонента (он рендерится только на телефоне), а не брейкпоинта.
// =========================================================

"use client";

import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useIsPhone } from "@/hooks/use-is-mobile";
import type { AdminRole } from "@/lib/admin-rbac";
import { RealtimeStatusIndicator } from "@/components/admin/RealtimeStatusIndicator";
import { AdminNotifications } from "@/components/admin/AdminNotifications";
import { AdminRequestAlerts } from "@/components/admin/AdminRequestAlerts";
import { AdminSupplyPlans } from "@/components/admin/AdminSupplyPlans";
import { MobileTabBar, type MobileNavItem } from "./MobileTabBar";
import styles from "./MobileAdminShell.module.css";

const ROLE_LABELS: Record<AdminRole, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  lawyer: "Юрист",
  wastepaper: "Макулатурщик",
};

/**
 * Тонкая обёртка: на сервере и на десктопе рендерит детей как есть,
 * на телефоне — оборачивает их в мобильную оболочку.
 * Используется AdminShell'ом (см. ветку isPhone там).
 */
export function MobileAdminShell({
  children,
  adminPath,
  role,
  displayName,
  items,
}: {
  children: ReactNode;
  adminPath: string;
  role: AdminRole | null;
  displayName: string | null;
  /** Доступные разделы (уже отфильтрованы по роли в AdminShell). */
  items: MobileNavItem[];
}) {
  const pathname = usePathname() || "";
  // Двойная проверка: оболочку рендерит только телефон. Хук дешёвый
  // (одно состояние), а страховка полезна, если компонент когда-нибудь
  // начнут использовать вне AdminShell.
  const isPhone = useIsPhone();

  // Определяем текущий раздел по pathname (как в сайдбаре):
  // точное совпадение для корня, префикс с «/» — для вложенных страниц.
  const current =
    items.find(
      (item) => item.href === pathname || pathname.startsWith(`${item.href}/`),
    ) ?? null;

  const roleLabel = role ? ROLE_LABELS[role] : "";

  return (
    <div className={styles.app} data-admin="true">
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{current?.label ?? "Управление"}</h1>
          <p className={styles.subtitle}>
            {displayName || roleLabel || "СибГофроТорг"}
            {displayName && roleLabel ? ` · ${roleLabel}` : ""}
          </p>
        </div>
      </header>

      {/* Индикатор realtime-канала: маленькая точка под шапкой
          (позиционируется своими стилями, как и раньше). */}
      {role && <RealtimeStatusIndicator />}

      {/* Три кружка шапки: планы · новые заявки · уведомления.
          Каждый — самодостаточный fixed-компонент; легаси-слой ставит
          их в правый край шапки по переменным ниже. Макулатурщику и
          юристу они не положены — как и раньше. */}
      {role && role !== "lawyer" && role !== "wastepaper" && (
        <div className={styles.circles}>
          <AdminSupplyPlans adminPath={adminPath} />
          <AdminRequestAlerts adminPath={adminPath} />
          <AdminNotifications adminPath={adminPath} />
        </div>
      )}

      {/* admin-main сохранён нарочно: страницы (склад, аренда, …)
          уже имеют мобильные стили под этот класс, и вся типографика
          (admin-h1, admin-card, …) продолжает работать. */}
      <main className={`admin-main ${styles.main}`}>{children}</main>

      <MobileTabBar items={items} pathname={pathname} adminPath={adminPath} />
    </div>
  );
}
