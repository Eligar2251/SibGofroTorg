import "server-only";

export interface OzonProductSnapshot {
  url: string;
  title: string;
  price: number;
  imageUrl: string | null;
  fetchedAt: string;
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

function friendlyOzonError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return new Error("Ozon не ответил вовремя");
    }
    if (error instanceof TypeError || /fetch failed|ECONN|TLS|socket/i.test(error.message)) {
      return new Error("Не удалось подключиться к Ozon");
    }
    return error;
  }
  return new Error("Не удалось подключиться к Ozon");
}

function isOzonHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "ozon.ru" ||
    host.endsWith(".ozon.ru") ||
    host === "ozon.com" ||
    host.endsWith(".ozon.com") ||
    host === "ozon.by" ||
    host.endsWith(".ozon.by") ||
    host === "ozon.kz" ||
    host.endsWith(".ozon.kz") ||
    host === "ozon.onelink.me"
  );
}

function isOzonImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    isOzonHost(host) ||
    host === "ozone.ru" ||
    host.endsWith(".ozone.ru")
  );
}

function firstUrl(value: unknown): string {
  const text = String(value ?? "").trim();
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return (match?.[0] || text).replace(/[),.;]+$/, "");
}

export function normalizeOzonProductUrl(value: unknown): string {
  const raw = firstUrl(value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Вставьте полную ссылку на товар Ozon");
  }
  if (parsed.protocol !== "https:" || !isOzonHost(parsed.hostname)) {
    throw new Error("Разрешены только ссылки Ozon по HTTPS");
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error("Некорректная ссылка Ozon");
  }
  parsed.hash = "";
  return parsed.toString();
}

function safeImageUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim().replace(/\\u002F/gi, "/");
  if (!raw) return null;
  try {
    const parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (parsed.protocol !== "https:" || !isOzonImageHost(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeOzonImageUrl(value: unknown): string | null {
  return safeImageUrl(value);
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 && value < 100_000_000
      ? Math.round(value * 100) / 100
      : null;
  }
  const text = String(value ?? "")
    .replace(/[\u00a0\u2009\u202f\s]/g, "")
    .replace(/руб\.?|₽|rub/gi, "")
    .replace(",", ".");
  const match = text.match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 && number < 100_000_000
    ? Math.round(number * 100) / 100
    : null;
}

function cleanTitle(value: unknown): string {
  return String(value ?? "")
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .replace(/\s*[—|]\s*(?:купить[^|—]*|OZON).*$/i, "")
    .trim()
    .slice(0, 300);
}

async function readLimitedText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Ответ Ozon слишком большой");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Ответ Ozon слишком большой");
    }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

async function fetchOzonText(initialUrl: string): Promise<{
  url: string;
  body: string;
  contentType: string;
}> {
  let url = normalizeOzonProductUrl(initialUrl);
  const cookies = new Map<string, string>();
  // Короткие ссылки Ozon могут пройти через несколько служебных
  // перенаправлений (регион, canonical URL, мобильная ссылка).
  for (let redirect = 0; redirect <= 12; redirect++) {
    const headers: Record<string, string> = {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };
    if (cookies.size > 0) {
      headers.Cookie = [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    }
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers,
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const pair = setCookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      if (separator > 0) {
        cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
      }
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Ozon вернул некорректное перенаправление");
      url = normalizeOzonProductUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(
        response.status === 403 || response.status === 429
          ? "Ozon временно ограничил автоматическую проверку"
          : `Ozon вернул ошибку ${response.status}`
      );
    }
    return {
      url,
      body: await readLimitedText(response),
      contentType: response.headers.get("content-type") || "",
    };
  }
  throw new Error("Слишком много перенаправлений Ozon");
}

function metaContent(html: string, names: string[]): string {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = match[0];
    const attrs = new Map<string, string>();
    for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)) {
      attrs.set(attr[1].toLowerCase(), attr[3]);
    }
    const name = (attrs.get("property") || attrs.get("name") || attrs.get("itemprop") || "").toLowerCase();
    if (wanted.has(name)) return attrs.get("content") || "";
  }
  return "";
}

function findProductJsonLd(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findProductJsonLd(entry);
      if (found) return found;
    }
    return null;
  }
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type || "")];
  if (types.some((entry) => entry.toLowerCase() === "product")) return object;
  for (const key of ["@graph", "mainEntity", "itemListElement"]) {
    const found = findProductJsonLd(object[key]);
    if (found) return found;
  }
  return null;
}

function offerPrice(value: unknown): number | null {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const data = offer as Record<string, unknown>;
    const price =
      parsePrice(data.price) ||
      parsePrice(data.lowPrice) ||
      parsePrice((data.priceSpecification as Record<string, unknown> | undefined)?.price);
    if (price) return price;
  }
  return null;
}

function productImage(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = productImage(item);
      if (image) return image;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return safeImageUrl(object.url || object.contentUrl);
  }
  return safeImageUrl(value);
}

type PartialSnapshot = {
  title?: string;
  price?: number;
  imageUrl?: string | null;
  url?: string;
};

function parseHtml(html: string): PartialSnapshot {
  if (/abt-challenge|Похоже, нет соединения|captcha|access denied/i.test(html)) {
    return {};
  }
  let fromJsonLd: Record<string, unknown> | null = null;
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      fromJsonLd = findProductJsonLd(JSON.parse(match[1]));
      if (fromJsonLd) break;
    } catch {
      // Ozon иногда отдаёт несколько служебных JSON-LD; пропускаем битый.
    }
  }

  const title = cleanTitle(
    fromJsonLd?.name ||
      metaContent(html, ["og:title", "twitter:title"]) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  );
  const price =
    offerPrice(fromJsonLd?.offers) ||
    parsePrice(metaContent(html, ["product:price:amount", "og:price:amount"]));
  const imageUrl =
    productImage(fromJsonLd?.image) ||
    safeImageUrl(metaContent(html, ["og:image", "twitter:image"]));
  const url = metaContent(html, ["og:url"]);
  let canonicalUrl: string | undefined;
  if (url) {
    try {
      canonicalUrl = normalizeOzonProductUrl(url);
    } catch {
      canonicalUrl = undefined;
    }
  }
  return {
    title: title || undefined,
    price: price || undefined,
    imageUrl,
    url: canonicalUrl,
  };
}

function collectComposerCandidates(value: unknown, context = "", depth = 0): {
  titles: Array<{ score: number; value: string }>;
  prices: Array<{ score: number; value: number }>;
  images: Array<{ score: number; value: string }>;
} {
  const output = {
    titles: [] as Array<{ score: number; value: string }>,
    prices: [] as Array<{ score: number; value: number }>,
    images: [] as Array<{ score: number; value: string }>,
  };
  if (depth > 14 || value == null) return output;

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) {
      const nested = collectComposerCandidates(item, context, depth + 1);
      output.titles.push(...nested.titles);
      output.prices.push(...nested.prices);
      output.images.push(...nested.images);
    }
    return output;
  }
  if (typeof value !== "object") return output;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    const fullContext = `${context}.${normalizedKey}`;
    const contextBoost = /webprice|webproduct|gallery|pdp|product/.test(fullContext) ? 40 : 0;

    if (typeof raw === "string") {
      if (/^(?:title|producttitle|name)$/.test(normalizedKey)) {
        const title = cleanTitle(raw);
        if (title.length >= 4) {
          output.titles.push({
            score: contextBoost + (/producttitle/.test(normalizedKey) ? 100 : normalizedKey === "title" ? 70 : 30),
            value: title,
          });
        }
      }
      if (
        /^(?:price|currentprice|finalprice|saleprice|pricewithdiscount|cardprice)$/.test(normalizedKey)
      ) {
        const price = parsePrice(raw);
        if (price) {
          const keyScore = /current|final|sale|discount/.test(normalizedKey)
            ? 110
            : normalizedKey === "price"
              ? 100
              : 70;
          output.prices.push({ score: contextBoost + keyScore, value: price });
        }
      }
      if (/^(?:image|imageurl|coverimage|primaryimage|src)$/.test(normalizedKey)) {
        const image = safeImageUrl(raw);
        if (image) output.images.push({ score: contextBoost + 80, value: image });
      }
    } else if (typeof raw === "number" && /price/.test(normalizedKey) && !/old|original/.test(normalizedKey)) {
      const price = parsePrice(raw);
      if (price) output.prices.push({ score: contextBoost + 90, value: price });
    }

    const nested = collectComposerCandidates(raw, fullContext, depth + 1);
    output.titles.push(...nested.titles);
    output.prices.push(...nested.prices);
    output.images.push(...nested.images);
  }
  return output;
}

function parseComposer(body: string): PartialSnapshot {
  let root: unknown;
  try {
    root = JSON.parse(body);
  } catch {
    return {};
  }

  const candidates = collectComposerCandidates(root, "root");
  const widgetStates = (root as Record<string, unknown>)?.widgetStates;
  if (widgetStates && typeof widgetStates === "object") {
    for (const [widget, raw] of Object.entries(widgetStates as Record<string, unknown>)) {
      if (typeof raw !== "string") continue;
      try {
        const nested = collectComposerCandidates(JSON.parse(raw), widget.toLowerCase());
        candidates.titles.push(...nested.titles);
        candidates.prices.push(...nested.prices);
        candidates.images.push(...nested.images);
      } catch {
        // Не все widgetStates обязаны быть JSON.
      }
    }
  }

  candidates.titles.sort((a, b) => b.score - a.score);
  candidates.prices.sort((a, b) => b.score - a.score);
  candidates.images.sort((a, b) => b.score - a.score);
  return {
    title: candidates.titles[0]?.value,
    price: candidates.prices[0]?.value,
    imageUrl: candidates.images[0]?.value || null,
  };
}

function titleFromUrl(url: string): string {
  try {
    const segment = new URL(url).pathname.split("/").filter(Boolean).find((part) => part !== "product");
    return cleanTitle(decodeURIComponent(segment || "Товар Ozon").replace(/-\d+\/?$/, "").replace(/-/g, " "));
  } catch {
    return "Товар Ozon";
  }
}

export async function fetchOzonProduct(value: unknown): Promise<OzonProductSnapshot> {
  const initialUrl = normalizeOzonProductUrl(value);
  const parsedInitial = new URL(initialUrl);
  const initialPath = `${parsedInitial.pathname}${parsedInitial.search}`;
  const encodedPath = encodeURIComponent(initialPath);
  const urls = [...new Set([
    initialUrl,
    `${parsedInitial.origin}/api/composer-api.bx/page/json/v2?url=${encodedPath}`,
    `${parsedInitial.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodedPath}`,
    `https://api.ozon.ru/composer-api.bx/page/json/v2?url=${encodedPath}`,
  ])];

  const results = await Promise.allSettled(urls.map(fetchOzonText));
  let snapshot: PartialSnapshot = {};
  let resolvedUrl = initialUrl;
  let firstError: Error | null = null;

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      if (!firstError) firstError = friendlyOzonError(result.reason);
      return;
    }
    const response = result.value;
    const parsed = response.contentType.includes("json") || index > 0
      ? parseComposer(response.body)
      : parseHtml(response.body);
    if (index === 0) resolvedUrl = parsed.url || response.url || resolvedUrl;
    snapshot = {
      title: snapshot.title || parsed.title,
      price: snapshot.price || parsed.price,
      imageUrl: snapshot.imageUrl || parsed.imageUrl,
      url: snapshot.url || parsed.url,
    };
  });

  // Короткая ссылка /t/ могла перенаправиться на карточку. Для неё
  // повторяем только JSON-endpoint уже с окончательным product path.
  if (!snapshot.price && resolvedUrl !== initialUrl) {
    try {
      const parsed = new URL(resolvedUrl);
      const path = encodeURIComponent(`${parsed.pathname}${parsed.search}`);
      const composer = await fetchOzonText(
        `https://api.ozon.ru/composer-api.bx/page/json/v2?url=${path}`
      );
      const extra = parseComposer(composer.body);
      snapshot = {
        title: snapshot.title || extra.title,
        price: snapshot.price || extra.price,
        imageUrl: snapshot.imageUrl || extra.imageUrl,
        url: snapshot.url || resolvedUrl,
      };
    } catch (error) {
      if (!firstError) firstError = friendlyOzonError(error);
    }
  }

  if (!snapshot.price) {
    throw firstError || new Error("Ozon не отдал актуальную цену товара");
  }

  return {
    url: normalizeOzonProductUrl(snapshot.url || resolvedUrl),
    title: snapshot.title || titleFromUrl(resolvedUrl),
    price: snapshot.price,
    imageUrl: snapshot.imageUrl || null,
    fetchedAt: new Date().toISOString(),
  };
}
