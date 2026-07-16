// =========================================================
// FILE: src/lib/rate-limit.ts
// In-memory rate limit (1 инстанс Node). Для multi-region — позже Upstash.
// =========================================================

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Простая очистка, чтобы Map не рос бесконечно */
function gc(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

/**
 * @returns ok=false → лимит превышен
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  gc(now);

  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: Math.ceil(windowMs / 1000) };
  }

  if (b.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }

  b.count += 1;
  return {
    ok: true,
    remaining: limit - b.count,
    retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

export function clientIp(request: Request): string {
  const h = request.headers;
  const xf = h.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || "unknown";
  return h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown";
}