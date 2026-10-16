// =========================================================
// Тестовый двойник next/cache: в node:test нет контекста запроса
// Next.js, поэтому настоящие revalidateTag/revalidatePath бросают
// «Invariant: static generation store missing». В тестах кеш не нужен —
// подменяем функции на заглушки и запоминаем вызовы.
// См. tests/stubs/db-auth-hooks.mjs, tests/api-bulk-prices.test.mjs
// =========================================================

/** Какие теги/пути просили сбросить — тесты могут это проверить. */
export const REVALIDATED_TAGS: string[] = [];
export const REVALIDATED_PATHS: string[] = [];

/** true → revalidateTag бросает ошибку, как вне контекста запроса Next.js. */
export let STUB_REVALIDATE_THROWS = false;

export function __setRevalidateThrows(value: boolean): void {
  STUB_REVALIDATE_THROWS = value;
}

export function revalidateTag(tag: string): void {
  if (STUB_REVALIDATE_THROWS) {
    throw new Error("Invariant: static generation store missing in revalidateTag");
  }
  REVALIDATED_TAGS.push(tag);
}

export function revalidatePath(path: string): void {
  REVALIDATED_PATHS.push(path);
}

export function unstable_cache<T>(fn: T): T {
  return fn;
}

export function cache<T>(fn: T): T {
  return fn;
}
