// =========================================================
// FILE: src/lib/safe-next.ts
// =========================================================

/** Разрешаем только относительные пути внутри сайта */
export function safeNextPath(
  raw: string | null | undefined,
  fallback = "/cabinet"
): string {
  if (!raw) return fallback;
  const s = String(raw).trim();
  // только path начинающийся с одного /
  if (!s.startsWith("/") || s.startsWith("//")) return fallback;
  // запрет protocol-relative и backslash tricks
  if (s.includes("://") || s.includes("\\")) return fallback;
  return s;
}