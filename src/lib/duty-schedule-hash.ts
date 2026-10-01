// =========================================================
// FILE: src/lib/duty-schedule-hash.ts
// Отпечаток снимка табеля охраны.
//
// Зачем: снимок табеля хранится в Postgres как JSONB, а JSONB не
// сохраняет порядок ключей объектов (база сортирует их сама). Поэтому
// сравнивать снимки через JSON.stringify нельзя — одинаковые данные
// дадут разные строки. Здесь ключи приводятся к каноническому виду
// (сортировка на всех уровнях), а отпечаток считается быстрым
// необратимым хешем.
//
// Модуль намеренно без серверных зависимостей: его используют и
// серверное хранилище (сравнение версий в БД), и браузер (проверка,
// остались ли в localStorage более свежие несохранённые правки).
// =========================================================

/** Стабильная сериализация: ключи объектов сортируются на всех уровнях. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    return json === undefined ? "null" : json;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** Быстрый 53-битный хеш строки (cyrb53) — короткий и без коллизий на практике. */
export function hashString(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Отпечаток содержимого снимка: одинаковые данные → одинаковый хеш. */
export function dutyScheduleHash(value: unknown): string {
  return hashString(stableStringify(value));
}
