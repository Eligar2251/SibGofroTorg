// =========================================================
// FILE: src/lib/admin-path-client.ts
// Путь админки ДЛЯ КЛИЕНТСКИХ КОМПОНЕНТОВ.
//
// В браузерный бандл попадают только переменные NEXT_PUBLIC_*: приватный
// ADMIN_SECRET_PATH там всегда undefined. Из-за этого клиентские компоненты
// строили ссылки на «/admin/...», хотя реальный путь другой → 404 внутри
// панели. Здесь единственное публичное значение, и рядом — предупреждение
// для диагностики, если переменная не задана при заполненном ADMIN_SECRET_PATH.
// =========================================================

export const CLIENT_ADMIN_PATH = String(
  process.env.NEXT_PUBLIC_ADMIN_PATH || ""
)
  .trim()
  .replace(/^\/+|\/+$/g, "") || "admin";

/** Задан ли NEXT_PUBLIC_ADMIN_PATH (для страницы диагностики). */
export const CLIENT_ADMIN_PATH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_ADMIN_PATH
);
