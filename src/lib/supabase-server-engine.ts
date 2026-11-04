// =========================================================
// FILE: src/lib/supabase-server-engine.ts
// Серверное ядро маршрутизации БД (только Node.js):
//   • Supabase #1 (Основной / Бегет / из переменных окружения)
//   • Supabase #2 (Облачный / Резервный Supabase, настраивается в админке)
//   • Локальная JSON-БД (.sgt-data/local-db.json — 100% автономная работа)
//   • Автоматическое аварийное переключение (Auto-Failover) при падении БД
//   • Фоновое зеркалирование изменений в локальную JSON-БД
// =========================================================

import { readFullBackupSettings } from "./full-backup-settings";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  clearDbFailoverState,
  getDbFailoverState,
  getDbRuntimeConfig,
  recordDbFailover,
  resolveSupabaseCredentials,
  type DbBackendMode,
} from "./db-runtime-config";
import {
  cacheRowsIntoLocalDb,
  getLocalDbSummary,
  getLocalJsonDbClient,
  replayPendingMutationsToRemoteSupabase,
  type LocalJsonSupabaseClient,
} from "./local-json-db";

const SUPABASE_FETCH_TIMEOUT_MS = Number(
  process.env.SUPABASE_FETCH_TIMEOUT_MS || 8_000
);

/**
 * Окно Circuit Breaker при падении основной БД (20 секунд):
 * чтобы админка открывалась мгновенно без 8-секундных таймаутов на каждом запросе.
 */
const FAILOVER_CIRCUIT_COOLDOWN_MS = 20_000;

function getActiveCircuitFallback(): DbBackendMode | null {
  const st = getDbFailoverState();
  if (!st.activeFallbackBackend || !st.failedAt) return null;
  const elapsed = Date.now() - new Date(st.failedAt).getTime();
  // Never silently switch back from a different remote database: writes made
  // there are not replicated to the original. Local pending writes also need
  // explicit reconciliation before returning to a remote database.
  if (st.activeFallbackBackend !== "local" || getLocalDbSummary().pendingMutationsCount > 0 ||
      (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < FAILOVER_CIRCUIT_COOLDOWN_MS)) {
    return st.activeFallbackBackend;
  }
  return null;
}

function fetchWithTimeout(
  timeoutMs = SUPABASE_FETCH_TIMEOUT_MS
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
  };
}

const clientCache = new Map<string, SupabaseClient>();

export function createDirectSupabaseClient(
  url: string,
  key: string,
  timeoutMs = SUPABASE_FETCH_TIMEOUT_MS
): SupabaseClient {
  const cleanUrl = url.trim().replace(/\/+$/, "");
  const cleanKey = key.trim();
  const cacheKey = `${cleanUrl}::${cleanKey}::${timeoutMs}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const client = createClient(cleanUrl, cleanKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: fetchWithTimeout(timeoutMs),
    },
  });
  clientCache.set(cacheKey, client);
  return client;
}

export function isRemoteServerFailure(errorOrThrown: any): boolean {
  if (!errorOrThrown) return false;
  const code = String(errorOrThrown.code || "");
  if (
    /^(PGRST116|PGRST204|PGRST205|23505|23503|23502|22P02|42P01|42703)$/.test(
      code
    )
  ) {
    return false;
  }

  const msg = String(
    errorOrThrown.message ||
      errorOrThrown.details ||
      errorOrThrown.hint ||
      errorOrThrown
  );

  return (
    /fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|UND_ERR|AbortError|aborted|socket hang up/i.test(
      msg
    ) ||
    /<!DOCTYPE html|<html|502 Bad Gateway|503 Service|504 Gateway|521 |522 |523 |524 /i.test(
      msg
    ) ||
    /connection to server|database system is (starting|shutting|in recovery)|remaining connection slots|too many clients|upstream connect error|Bad gateway|Service Unavailable|Gateway Timeout/i.test(
      msg
    )
  );
}

interface RecordedCall {
  method: string;
  args: any[];
}

class SmartQueryProxy implements PromiseLike<any> {
  private table: string;
  private calls: RecordedCall[] = [];
  private mutationOp: "insert" | "update" | "upsert" | "delete" | null = null;
  private mutationPayload: any = null;
  private hasExplicitSelect = false;

  constructor(table: string) {
    this.table = table;
  }

  private record(method: string, args: any[]): this {
    if (
      method === "insert" ||
      method === "update" ||
      method === "upsert" ||
      method === "delete"
    ) {
      this.mutationOp = method;
      this.mutationPayload = args[0];
    }
    if (method === "select") {
      this.hasExplicitSelect = true;
    }
    this.calls.push({ method, args });
    return this;
  }

  select(...args: any[]) {
    return this.record("select", args);
  }
  insert(...args: any[]) {
    return this.record("insert", args);
  }
  update(...args: any[]) {
    return this.record("update", args);
  }
  upsert(...args: any[]) {
    return this.record("upsert", args);
  }
  delete(...args: any[]) {
    return this.record("delete", args);
  }
  eq(...args: any[]) {
    return this.record("eq", args);
  }
  neq(...args: any[]) {
    return this.record("neq", args);
  }
  gt(...args: any[]) {
    return this.record("gt", args);
  }
  gte(...args: any[]) {
    return this.record("gte", args);
  }
  lt(...args: any[]) {
    return this.record("lt", args);
  }
  lte(...args: any[]) {
    return this.record("lte", args);
  }
  in(...args: any[]) {
    return this.record("in", args);
  }
  is(...args: any[]) {
    return this.record("is", args);
  }
  not(...args: any[]) {
    return this.record("not", args);
  }
  like(...args: any[]) {
    return this.record("like", args);
  }
  ilike(...args: any[]) {
    return this.record("ilike", args);
  }
  contains(...args: any[]) {
    return this.record("contains", args);
  }
  or(...args: any[]) {
    return this.record("or", args);
  }
  order(...args: any[]) {
    return this.record("order", args);
  }
  limit(...args: any[]) {
    return this.record("limit", args);
  }
  range(...args: any[]) {
    return this.record("range", args);
  }
  single(...args: any[]) {
    return this.record("single", args);
  }
  maybeSingle(...args: any[]) {
    return this.record("maybeSingle", args);
  }

  private replayOn(
    targetClient: SupabaseClient | LocalJsonSupabaseClient,
    forceSelectForMirror = false
  ): any {
    let q: any = (targetClient as any).from(this.table);
    for (const call of this.calls) {
      if (typeof q[call.method] === "function") {
        q = q[call.method](...call.args);
      }
    }
    if (
      forceSelectForMirror &&
      (this.mutationOp === "insert" || this.mutationOp === "upsert") &&
      !this.hasExplicitSelect &&
      typeof q.select === "function"
    ) {
      q = q.select("*");
    }
    return q;
  }

  private mirrorToLocal(remoteResult: any): void {
    try {
      const localClient = getLocalJsonDbClient();

      if (!this.mutationOp) {
        if (this.table === "admins" && remoteResult?.data) {
          const rows = Array.isArray(remoteResult.data)
            ? remoteResult.data
            : [remoteResult.data];
          cacheRowsIntoLocalDb("admins", rows);
        }
        return;
      }

      if (this.mutationOp === "insert" || this.mutationOp === "upsert") {
        const payloadArr = Array.isArray(this.mutationPayload)
          ? this.mutationPayload
          : this.mutationPayload
            ? [this.mutationPayload]
            : [];
        const returnedArr = Array.isArray(remoteResult?.data)
          ? remoteResult.data
          : remoteResult?.data && typeof remoteResult.data === "object"
            ? [remoteResult.data]
            : [];

        if (returnedArr.length > 0) {
          const merged = returnedArr.map((retRow: any, idx: number) => ({
            ...(payloadArr[idx] || {}),
            ...retRow,
          }));
          cacheRowsIntoLocalDb(this.table, merged);
          return;
        }
      }

      const localQuery = this.replayOn(localClient, false);
      if (localQuery && typeof localQuery.executeSync === "function") {
        if (typeof localQuery.markMirrorReplay === "function") {
          localQuery.markMirrorReplay();
        }
        localQuery.executeSync();
      }
    } catch {
      /* ignore mirror errors */
    }
  }

  private async execute(): Promise<any> {
    const cfg = getDbRuntimeConfig();

    if (cfg.activeBackend === "local") {
      return await this.replayOn(getLocalJsonDbClient(), false);
    }

    // Если основная БД недавно упала — в течение 20 сек мгновенно направляем
    // запросы в резерв (без задержек и зависаний страниц админки!)
    if (cfg.autoFailover) {
      const fastFallback = getActiveCircuitFallback();
      if (fastFallback === "local") {
        return await this.replayOn(getLocalJsonDbClient(), false);
      }
      if (fastFallback === "primary" || fastFallback === "secondary") {
        const fbCreds = resolveSupabaseCredentials(fastFallback);
        if (fbCreds.configured) {
          try {
            const fbClient = createDirectSupabaseClient(
              fbCreds.url,
              fbCreds.serviceRoleKey
            );
            const fbRes = await this.replayOn(fbClient, cfg.mirrorWritesToLocal);
            if (!fbRes?.error) {
              if (!fbRes?.error && cfg.mirrorWritesToLocal) {
                this.mirrorToLocal(fbRes);
              }
              return fbRes;
            }
          } catch {
            /* fallback to local */
          }
        }
        recordDbFailover("local", "Резервный сервер БД недоступен");
        return await this.replayOn(getLocalJsonDbClient(), false);
      }
    }

    const activeTarget = cfg.activeBackend;
    const creds = resolveSupabaseCredentials(activeTarget);

    if (creds.configured) {
      try {
        const client = createDirectSupabaseClient(
          creds.url,
          creds.serviceRoleKey
        );

        // Если после падения основной сервер снова ответил, но в локалке накопились
        // офлайн-правки — сначала досылаем их в Supabase, чтобы ничего не пропало!
        if (
          getDbFailoverState().activeFallbackBackend === "local" &&
          getLocalDbSummary().pendingMutationsCount > 0
        ) {
          await replayPendingMutationsToRemoteSupabase(client);
        }

        const res = await this.replayOn(client, cfg.mirrorWritesToLocal);
        if (res?.error && isRemoteServerFailure(res.error)) {
          throw new Error(res.error.message || "Supabase server unavailable");
        }
        if (!res?.error) {
          if (getDbFailoverState().activeFallbackBackend) {
            clearDbFailoverState();
          }
          if (cfg.mirrorWritesToLocal || this.table === "admins") {
            this.mirrorToLocal(res);
          }
        }
        return res;
      } catch (primaryErr: any) {
        if (!cfg.autoFailover || !isRemoteServerFailure(primaryErr)) {
          return {
            data: null,
            error: {
              code: "DB_UNAVAILABLE",
              message: primaryErr?.message || String(primaryErr),
            },
          };
        }

        const errMsg = primaryErr?.message || String(primaryErr);

        const altTarget: "primary" | "secondary" =
          activeTarget === "primary" ? "secondary" : "primary";
        const altCreds = resolveSupabaseCredentials(altTarget);
        if (!readFullBackupSettings().enabled && altCreds.configured && altCreds.url !== creds.url) {
          try {
            const altClient = createDirectSupabaseClient(
              altCreds.url,
              altCreds.serviceRoleKey
            );
            const altRes = await this.replayOn(
              altClient,
              cfg.mirrorWritesToLocal
            );
            if (!altRes?.error) {
              recordDbFailover(altTarget, errMsg);
              if (!altRes?.error && cfg.mirrorWritesToLocal) {
                this.mirrorToLocal(altRes);
              }
              return altRes;
            }
          } catch {
            /* fallback to local */
          }
        }

        recordDbFailover("local", errMsg);
        return await this.replayOn(getLocalJsonDbClient(), false);
      }
    }

    if (cfg.autoFailover) {
      const altTarget: "primary" | "secondary" =
        activeTarget === "primary" ? "secondary" : "primary";
      const altCreds = resolveSupabaseCredentials(altTarget);
      if (!readFullBackupSettings().enabled && altCreds.configured) {
        try {
          const altClient = createDirectSupabaseClient(
            altCreds.url,
            altCreds.serviceRoleKey
          );
          const altRes = await this.replayOn(altClient, cfg.mirrorWritesToLocal);
          if (!altRes?.error) {
            recordDbFailover(
              altTarget,
              `${creds.label}: не указаны URL или service_role ключ`
            );
            return altRes;
          }
        } catch {
          /* fallback to local */
        }
      }
      recordDbFailover(
        "local",
        `${creds.label}: не заданы параметры подключения`
      );
      return await this.replayOn(getLocalJsonDbClient(), false);
    }

    return {
      data: null,
      error: {
        code: "DB_NOT_CONFIGURED",
        message: `${creds.label}: укажите SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY или переключитесь на локальную JSON-БД`,
      },
    };
  }

  then<TResult1 = any, TResult2 = never>(
    onFulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onFulfilled, onRejected);
  }
}

class SmartAdminSupabaseClient {
  from(table: string): any {
    return new SmartQueryProxy(table);
  }

  async rpc(fnName: string, args?: Record<string, any>): Promise<any> {
    const cfg = getDbRuntimeConfig();
    if (cfg.activeBackend === "local") {
      return getLocalJsonDbClient().rpc(fnName, args);
    }

    if (cfg.autoFailover) {
      const fallback = getActiveCircuitFallback();
      if (fallback === "local") return getLocalJsonDbClient().rpc(fnName, args);
      if (fallback === "primary" || fallback === "secondary") {
        const fb = resolveSupabaseCredentials(fallback);
        if (fb.configured) {
          try {
            const res = await createDirectSupabaseClient(fb.url, fb.serviceRoleKey).rpc(fnName, args);
            if (!res?.error) return res;
          } catch { /* fallback to local */ }
        }
        recordDbFailover("local", "Резервный сервер БД недоступен");
        return getLocalJsonDbClient().rpc(fnName, args);
      }
    }

    const activeTarget = cfg.activeBackend;
    const creds = resolveSupabaseCredentials(activeTarget);

    if (creds.configured) {
      try {
        const client = createDirectSupabaseClient(
          creds.url,
          creds.serviceRoleKey
        );
        const res = await client.rpc(fnName, args);
        if (res?.error && isRemoteServerFailure(res.error)) {
          throw new Error(res.error.message || "RPC unavailable");
        }
        if (
          !res?.error &&
          cfg.mirrorWritesToLocal &&
          fnName === "fn_next_counter" &&
          args?.p_key &&
          Number.isFinite(Number(res.data))
        ) {
          cacheRowsIntoLocalDb("doc_counters", [
            { key: String(args.p_key), value: Number(res.data) },
          ]);
        }
        return res;
      } catch (err: any) {
        if (!cfg.autoFailover || !isRemoteServerFailure(err)) {
          return {
            data: null,
            error: {
              code: "DB_UNAVAILABLE",
              message: err?.message || String(err),
            },
          };
        }
        const altTarget: "primary" | "secondary" =
          activeTarget === "primary" ? "secondary" : "primary";
        const altCreds = resolveSupabaseCredentials(altTarget);
        if (!readFullBackupSettings().enabled && altCreds.configured && altCreds.url !== creds.url) {
          try {
            const altClient = createDirectSupabaseClient(
              altCreds.url,
              altCreds.serviceRoleKey
            );
            const altRes = await altClient.rpc(fnName, args);
            if (!altRes?.error) {
              recordDbFailover(altTarget, err?.message || String(err));
              return altRes;
            }
          } catch {
            /* fallback to local */
          }
        }
        recordDbFailover("local", err?.message || String(err));
        return getLocalJsonDbClient().rpc(fnName, args);
      }
    }

    if (cfg.autoFailover) {
      recordDbFailover(
        "local",
        `${creds.label}: не заданы параметры подключения`
      );
      return getLocalJsonDbClient().rpc(fnName, args);
    }

    return {
      data: null,
      error: {
        code: "DB_NOT_CONFIGURED",
        message: `${creds.label}: не заданы параметры подключения`,
      },
    };
  }
}

const smartAdminClient = new SmartAdminSupabaseClient();

export function getAdminDb(): SupabaseClient {
  return smartAdminClient as unknown as SupabaseClient;
}

export function getPublicDb(): SupabaseClient {
  const cfg = getDbRuntimeConfig();
  if (cfg.activeBackend === "local") {
    return getLocalJsonDbClient() as unknown as SupabaseClient;
  }
  if (cfg.autoFailover) {
    return smartAdminClient as unknown as SupabaseClient;
  }
  const creds = resolveSupabaseCredentials(cfg.activeBackend);
  if (creds.url && (creds.anonKey || creds.serviceRoleKey)) {
    return createDirectSupabaseClient(
      creds.url,
      creds.anonKey || creds.serviceRoleKey
    );
  }
  return getLocalJsonDbClient() as unknown as SupabaseClient;
}

export function getSupabaseUrl_pub(): string {
  const cfg = getDbRuntimeConfig();
  if (cfg.activeBackend === "secondary") {
    const sec = resolveSupabaseCredentials("secondary");
    if (sec.url) return sec.url;
  }
  const pri = resolveSupabaseCredentials("primary");
  return pri.url;
}

export function getSupabaseAnonKey_pub(): string {
  const cfg = getDbRuntimeConfig();
  if (cfg.activeBackend === "secondary") {
    const sec = resolveSupabaseCredentials("secondary");
    if (sec.anonKey) return sec.anonKey;
  }
  const pri = resolveSupabaseCredentials("primary");
  return pri.anonKey;
}

export function getActiveDatabaseConnectionInfo(): {
  configuredMode: DbBackendMode;
  effectiveMode: DbBackendMode;
  label: string;
  url: string;
  serviceRoleKey: string;
} {
  const cfg = getDbRuntimeConfig();
  const failover = getDbFailoverState();
  const effectiveMode = failover.activeFallbackBackend || cfg.activeBackend;

  if (effectiveMode === "local") {
    return {
      configuredMode: cfg.activeBackend,
      effectiveMode: "local",
      label: "Локальная JSON-БД",
      url: "",
      serviceRoleKey: "",
    };
  }

  const creds = resolveSupabaseCredentials(effectiveMode);
  return {
    configuredMode: cfg.activeBackend,
    effectiveMode,
    label: creds.label,
    url: creds.url,
    serviceRoleKey: creds.serviceRoleKey,
  };
}

export async function probeDatabaseBackend(
  target: DbBackendMode
): Promise<{
  target: DbBackendMode;
  label: string;
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  productsCount: number | null;
  error: string | null;
}> {
  const started = Date.now();

  if (target === "local") {
    try {
      const res = await getLocalJsonDbClient()
        .from("products")
        .select("id", { count: "exact", head: true });
      return {
        target: "local",
        label: "Локальная JSON-БД (.sgt-data/local-db.json)",
        configured: true,
        reachable: !res.error,
        latencyMs: Date.now() - started,
        productsCount: res.count ?? 0,
        error: res.error?.message || null,
      };
    } catch (e: any) {
      return {
        target: "local",
        label: "Локальная JSON-БД",
        configured: true,
        reachable: false,
        latencyMs: Date.now() - started,
        productsCount: null,
        error: e?.message || String(e),
      };
    }
  }

  const creds = resolveSupabaseCredentials(target);
  if (!creds.configured) {
    return {
      target,
      label: creds.label,
      configured: false,
      reachable: false,
      latencyMs: null,
      productsCount: null,
      error: "Не указаны URL или service_role ключ",
    };
  }

  try {
    const client = createDirectSupabaseClient(
      creds.url,
      creds.serviceRoleKey,
      4_500
    );
    const { count, error } = await client
      .from("products")
      .select("id", { count: "exact", head: true });

    if (error) {
      return {
        target,
        label: creds.label,
        configured: true,
        reachable: false,
        latencyMs: Date.now() - started,
        productsCount: null,
        error: error.message || String(error.code || "Ошибка ответа БД"),
      };
    }

    return {
      target,
      label: creds.label,
      configured: true,
      reachable: true,
      latencyMs: Date.now() - started,
      productsCount: count ?? 0,
      error: null,
    };
  } catch (e: any) {
    return {
      target,
      label: creds.label,
      configured: true,
      reachable: false,
      latencyMs: Date.now() - started,
      productsCount: null,
      error: e?.message || String(e),
    };
  }
}
