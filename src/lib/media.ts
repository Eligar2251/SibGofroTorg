// =========================================================
// FILE: src/lib/media.ts — изображения отдаются с нашего домена
// =========================================================
//
// ЗАЧЕМ
// Товарные фото лежат в Cloudinary (CDN вне РФ), а фото на странице
// «Приём макулатуры» — на Unsplash. Раньше браузер посетителя обращался
// к этим серверам напрямую: `<link rel="preconnect">` в layout и src
// картинок с чужим хостом. Проверки соответствия 152-ФЗ (SaitScan и
// аналоги) видели это как «сайт передаёт данные посетителей на серверы
// за рубежом» — по факту соединения браузера с иностранным сервером.
//
// Персональные данные посетителей мы туда не отправляем, но сам факт
// обращения браузера к иностранному хосту устраняем полностью: все
// изображения отдаются с нашего домена через /media/..., а к CDN
// обращается сервер Оператора (см. src/app/media/[...path]/route.ts).
//
// Файл изоморфный: используется и в серверных компонентах, и в лоадере
// next/image, который выполняется в браузере.

/** Префикс собственного пути для проксируемых изображений. */
export const MEDIA_PREFIX = "/media";

/** Хосты, которые разрешено проксировать через /media. */
export const MEDIA_HOSTS = {
  cloudinary: "res.cloudinary.com",
  unsplash: "images.unsplash.com",
} as const;

export type MediaSource = keyof typeof MEDIA_HOSTS;

const SOURCE_SEGMENTS: Record<string, MediaSource> = {
  cloudinary: "cloudinary",
  unsplash: "unsplash",
};

/** Разбирает первый сегмент пути /media/<source>/... */
export function parseMediaSource(segment: string): MediaSource | null {
  return SOURCE_SEGMENTS[segment] ?? null;
}

/**
 * Переводит ссылку на изображение во внутренний путь /media/<host>/...
 * Всё, что не относится к известным внешним CDN (локальные файлы, data:,
 * blob:, ссылки из админки на другие хосты), возвращается без изменений.
 */
export function toSameOriginMediaUrl(
  url: string | null | undefined
): string {
  const value = (url || "").trim();
  if (!value) return "";
  // Уже локальная ссылка (в том числе уже /media/...) или data:/blob:.
  if (value.startsWith("/") || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return value;

  const source = (Object.entries(MEDIA_HOSTS) as [MediaSource, string][]).find(
    ([, host]) => parsed.hostname === host
  )?.[0];
  if (!source) return value;

  // Для Unsplash сохраняем query (w/q/fit) — он уходит в апстрим как есть.
  const search = source === "unsplash" ? parsed.search : "";
  return `${MEDIA_PREFIX}/${source}${parsed.pathname}${search}`;
}

/**
 * Абсолютный адрес картинки для метаданных (og:image, JSON-LD): наш путь
 * дополняем доменом сайта, а незнакомые внешние ссылки отдаём как есть.
 */
export function toAbsoluteMediaUrl(
  url: string | null | undefined,
  siteUrl: string
): string | undefined {
  const mapped = toSameOriginMediaUrl(url);
  if (!mapped) return undefined;
  if (mapped.startsWith("http")) return mapped;
  if (mapped.startsWith("/")) return `${siteUrl.replace(/\/$/, "")}${mapped}`;
  return undefined;
}

/** Поля, в которых лежат ссылки на изображения. */
const MEDIA_KEY_RE =
  /^(url|image|images|imageurl|image_url|icon|iconurl|avatarurl|photourl|cover|src)$/i;

/**
 * Рекурсивно переводит ссылки на изображения в собственные /media/... —
 * применяется к данным, которые серверные страницы отдают в клиентские
 * компоненты. Иначе исходные адреса Cloudinary попадают в HTML внутри
 * RSC-payload, и проверки соответствия 152-ФЗ снова видят зарубежный хост.
 *
 * Значения, не относящиеся к известным CDN (обычные ссылки, локальные
 * файлы, data:), не меняются, поэтому функция безопасна для любых данных.
 */
export function localizeMediaDeep<T>(input: T, depth = 0): T {
  if (depth > 12 || input == null) return input;

  if (typeof input === "string") {
    return toSameOriginMediaUrl(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => localizeMediaDeep(item, depth + 1)) as unknown as T;
  }

  if (typeof input !== "object") return input;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && MEDIA_KEY_RE.test(key)) {
      result[key] = toSameOriginMediaUrl(value);
    } else {
      result[key] = localizeMediaDeep(value, depth + 1);
    }
  }
  return result as unknown as T;
}
