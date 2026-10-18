// =========================================================
// FILE: src/app/[adminPath]/layout.tsx
// =========================================================

import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { verifySession } from "@/lib/auth";
import { ADMIN_PATH } from "@/lib/admin-path";
// Стили админки грузятся только здесь, а не на всём сайте (раньше
// admin.css импортировался в globals.css и попадал в бандл каждой страницы).
import "../admin.css";
import "../admin-users.css";
import "../rent.css";
import "../admin-themes.css";
// Экран «Кабинет клиента»: автономная копия клиентской вёрстки карточки
// заказа (стили сайта в админку не импортируются).
import "../admin-cabinet.css";
// Единый финальный слой для телефонов/вертикальных планшетов. Он должен
// идти последним, чтобы старые локальные media-правила не ломали сетку.
import "../admin-mobile.css";
// Современный слой макулатуры и «Доставок»: пилюльные вкладки, крупные
// числа, сетка модалок. Все правила завязаны на .wp-account / .wp-modal /
// .deliv-page, поэтому другие разделы админки он не задевает.
import "../admin-wastepaper.css";
// Мобильная вёрстка обычного учёта (все вкладки → карточки). Правила
// завязаны на .wh-mobile (ставится только при useIsMobile), поэтому
// десктоп не задевают. Идёт последним: при равной специфичности
// мобильные правила побеждают старые телефонные переопределения.
import "../admin-warehouse-mobile.css";
// Владелец: панель денежных счетов и раздел «База Данных». Правила
// завязаны на .owner-money / .db-browser и другие разделы не задевают.
import "../admin-owner.css";
// Новый единый дашборд и адаптивный редактор меню (токены активной темы).
import "../admin-dashboard.css";
// Финальный слой тёмных тем: фон документа, нативные контролы,
// скроллбары, «бумажные» листы предпросмотра и печать. Должен идти
// последним — иначе более поздние разделы перекрывают его правила.
import "../admin-dark.css";
import { AdminThemeProvider } from "@/components/admin/AdminTheme";
import { AdminNavProvider } from "@/components/admin/AdminNavProvider";

// Путь админки читается ЕДИНЫМ модулем @/lib/admin-path. Раньше значение
// собиралось в каждом файле отдельно (где-то брался только ADMIN_SECRET_PATH,
// где-то публичная переменная первой), и при расхождении переменных панель
// открывалась по одному адресу, а проверка сессии/вход — по другому.
// Импорт из "@/lib/admin-path" добавлен ниже.

// generateMetadata вместо статического metadata: любой неизвестный URL
// первого уровня (/something) попадает в этот маршрут и получает notFound().
// Статические metadata «Админ-панель» при этом протекали на саму 404-страницу
// (в выдаче мог появиться заголовок «Админ-панель» у страницы «не найдено»).
// Условная генерация отдаёт для чужих путей нейтральный заголовок + noindex.
// Админка использует отдельный viewport: в установленном приложении
// браузерные панели не должны оставлять странице «вкладочный» режим.
// display-mode=standalone/fullscreen включается манифестом при запуске с
// домашнего экрана, а viewport-fit=cover отдаёт мобильный экран под safe-area.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0e14",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ adminPath: string }>;
}): Promise<Metadata> {
  const { adminPath } = await params;
  if (adminPath !== ADMIN_PATH) {
    return {
      title: "Страница не найдена",
      robots: { index: false, follow: false },
    };
  }
  return {
    title: "Админ-панель — СибГофроТорг",
    applicationName: "СибГофроТорг Админ",
    manifest: "/admin-manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "СибГофроТорг Админ",
      statusBarStyle: "black-translucent",
    },
    // Android и старые WebKit читают этот тег как дополнительный
    // сигнал для запуска с домашнего экрана без вкладочного chrome.
    other: {
      "mobile-web-app-capable": "yes",
      "application-name": "СибГофроТорг Админ",
    },
    robots: { index: false, follow: false },
  };
}

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ adminPath: string }>;
}) {
  const { adminPath } = await params;

  if (adminPath !== ADMIN_PATH) {
    notFound();
  }

  // Сессия читается «мягко»: если токен испорчен, секрет подписи не задан
  // или cookie нечитаема, страница всё равно отрисуется (как гость), а proxy
  // уведёт на форму входа. Раньше исключение здесь валило весь рендер
  // админки сообщением «An error occurred in the Server Components render».
  let session: Awaited<ReturnType<typeof verifySession>> = null;
  try {
    session = await verifySession();
  } catch (error) {
    console.error("[админка] не удалось прочитать сессию:", error);
  }

  return (
    <>
      <AdminThemeProvider>
        <AdminNavProvider
          adminPath={ADMIN_PATH}
          role={session?.role ?? null}
          username={session?.username ?? ""}
        >
          <AdminShell
            adminPath={ADMIN_PATH}
            role={session?.role ?? null}
            displayName={session?.displayName ?? null}
          >
            {children}
          </AdminShell>
        </AdminNavProvider>
      </AdminThemeProvider>
    </>
  );
}