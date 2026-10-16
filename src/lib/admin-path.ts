// =========================================================
// FILE: src/lib/admin-path.ts
// ЕДИНЫЙ источник истины для секретного пути админки.
//
// ДО ЭТОГО МОДУЛЯ путь считался в 50 файлах по-разному:
// где-то `ADMIN_SECRET_PATH`, где-то `NEXT_PUBLIC_ADMIN_PATH ||
// ADMIN_SECRET_PATH`. Стоило переменным разойтись (или одной из них
// пропасть при пересоздании приложения в панели хостинга), как админка
// начинала «жить по двум адресам»:
//   • proxy защищал /secret-a, а layout рендерился только на /secret-b;
//   • POST /{путь}/api/login отвечал 404 → войти нельзя вообще;
//   • ссылки из клиентских компонентов вели на /admin/... → 404.
// Теперь правило одно на весь проект: приоритет у публичной переменной
// (она попадает в клиентский бандл), затем legacy-переменная, затем «admin».
// =========================================================

/** Убираем слеши и пробелы: в панели хостинга путь вписывают как «/secret/». */
export function normalizeAdminPath(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed || "admin";
}

/**
 * Путь админки. Приоритет: NEXT_PUBLIC_ADMIN_PATH → ADMIN_SECRET_PATH → «admin».
 * Значение вычисляется один раз при загрузке модуля (переменные окружения в
 * рантайме не меняются) и используется всем серверным кодом.
 */
export function resolveAdminPath(): string {
  return normalizeAdminPath(
    process.env.NEXT_PUBLIC_ADMIN_PATH || process.env.ADMIN_SECRET_PATH
  );
}

/** Путь админки, действующий в этом процессе. */
export const ADMIN_PATH = resolveAdminPath();

/** Проверка «этот URL принадлежит админке?». */
export function isAdminPath(pathname: string): boolean {
  return pathname === `/${ADMIN_PATH}` || pathname.startsWith(`/${ADMIN_PATH}/`);
}

/** Путь к странице входа. */
export const ADMIN_LOGIN_PATH = `/${ADMIN_PATH}/login`;

/**
 * Состояние переменных пути — для диагностики. Расхождение переменных
 * (или пропавший NEXT_PUBLIC_ADMIN_PATH на хостинге, где раньше он был)
 * ломает вход в админку, поэтому такие случаи показываем явно.
 */
export function adminPathReport(): {
  publicPath: string | null;
  secretPath: string | null;
  effectivePath: string;
  mismatch: boolean;
  notice: string | null;
} {
  const publicPath = process.env.NEXT_PUBLIC_ADMIN_PATH
    ? normalizeAdminPath(process.env.NEXT_PUBLIC_ADMIN_PATH)
    : null;
  const secretPath = process.env.ADMIN_SECRET_PATH
    ? normalizeAdminPath(process.env.ADMIN_SECRET_PATH)
    : null;
  const mismatch = Boolean(publicPath && secretPath && publicPath !== secretPath);

  let notice: string | null = null;
  const effectivePath = resolveAdminPath();
  if (mismatch) {
    notice =
      `NEXT_PUBLIC_ADMIN_PATH («${publicPath}») и ADMIN_SECRET_PATH («${secretPath}») ` +
      `различаются. Работает «${effectivePath}» — приведите обе переменные к одному значению.`;
  } else if (!publicPath && secretPath) {
    notice =
      "NEXT_PUBLIC_ADMIN_PATH не задан: серверные страницы админки работают по ADMIN_SECRET_PATH, " +
      "но клиентские ссылки внутри панели строятся по публичной переменной. Добавьте " +
      "NEXT_PUBLIC_ADMIN_PATH с тем же значением.";
  }

  return {
    publicPath,
    secretPath,
    effectivePath: resolveAdminPath(),
    mismatch,
    notice,
  };
}
