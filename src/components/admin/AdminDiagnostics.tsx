// =========================================================
// FILE: src/components/admin/AdminDiagnostics.tsx
// Панель диагностики админки: подключение к базе, переменные окружения,
// учётные записи, сессия, путь панели.
//
// Смысл: при сбое («500 на всех /api/admin/*», «Server Components render»)
// администратор сразу видит, что именно сломалось — Supabase на паузе,
// ротированный/отключённый ключ, сеть или потерянные переменные, — и что
// нажать. Раньше всё это приходилось выяснять по логам контейнера.
// =========================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

type EnvCheck = {
  id: string;
  label: string;
  ok: boolean;
  level: "fail" | "warn";
  detail: string;
  hint?: string;
};

type TableCheck = {
  table: string;
  ok: boolean;
  status: string;
  httpStatus?: number;
  message?: string;
};

type Diagnostics = {
  auth: {
    username: string;
    role: string;
    displayName: string;
    sessionSecret: string;
    sessionTtlHours: number;
  };
  adminPath: {
    publicPath: string | null;
    secretPath: string | null;
    effectivePath: string;
    mismatch: boolean;
    notice: string | null;
  };
  db: {
    ok: boolean;
    db: string;
    status: string;
    title: string;
    message: string | null;
    hint: string;
    httpStatus: number | null;
    code: string | null;
    latencyMs: number;
    host: string | null;
    keyFormat: string;
    tables?: TableCheck[];
  };
  adminAccounts: {
    total: number;
    active: number;
    fullAccess: number;
    usernames: string[];
    error?: string;
  } | null;
  counts: Record<string, number | string>;
  runtime: { node: string; uptimeSec: number; env: string; timeoutMs: number };
  envChecks: EnvCheck[];
  ts: string;
};

const DOC_URL =
  "https://github.com/Eligar2251/SibGofroTorg/blob/main/docs/ADMIN-RECOVERY.md";

const card: React.CSSProperties = {
  background: "var(--adm-card)",
  border: "1px solid var(--adm-border)",
  borderRadius: 14,
  padding: "16px 18px",
  marginBottom: 14,
};

const cardTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: "0 0 10px",
  color: "var(--adm-ink)",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "7px 0",
  borderTop: "1px solid var(--adm-border)",
  fontSize: 13,
  lineHeight: 1.5,
};

const muted: React.CSSProperties = { color: "var(--adm-muted)" };

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  color: "var(--adm-ink)",
  wordBreak: "break-word",
};

function StatusIcon({ ok, warn }: { ok: boolean; warn?: boolean }) {
  if (ok) return <CheckCircle2 size={16} color="var(--adm-pine)" aria-hidden />;
  if (warn) return <CircleAlert size={16} color="var(--adm-kraft)" aria-hidden />;
  return <XCircle size={16} color="var(--adm-rust)" aria-hidden />;
}

/** Цвет вердикта: зелёный (всё работает), жёлтый (схема), красный (сбой). */
function dbTone(status: string): "ok" | "warn" | "fail" {
  if (status === "ok") return "ok";
  if (status === "schema") return "warn";
  return "fail";
}

function toneStyles(tone: "ok" | "warn" | "fail") {
  if (tone === "ok") {
    return { bg: "var(--adm-pine-pale)", border: "var(--adm-pine-line)" };
  }
  if (tone === "warn") {
    return { bg: "var(--adm-kraft-pale)", border: "var(--adm-kraft-line)" };
  }
  return { bg: "var(--adm-rust-pale)", border: "var(--adm-rust-line)" };
}

export function AdminDiagnostics({ adminPath }: { adminPath: string }) {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setUnauthorized(false);
    try {
      const res = await fetch("/api/admin/diagnostics", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (!res.ok) {
        throw new Error(
          [body.error, body.detail].filter(Boolean).join(": ") ||
            `Ошибка запроса (${res.status})`
        );
      }
      setData(body as Diagnostics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось получить диагностику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tone = data ? dbTone(data.db.status) : null;
  const toneStyle = tone ? toneStyles(tone) : null;

  return (
    <div style={{ maxWidth: 900 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div style={{ marginRight: "auto" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Диагностика</h1>
          <p style={{ ...muted, margin: "4px 0 0", fontSize: 13 }}>
            Проверка подключения к базе, ключей и переменных окружения.
          </p>
        </div>
        <button type="button" className="admin-btn" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          <span style={{ marginLeft: 6 }}>Проверить снова</span>
        </button>
        <a className="admin-btn" href="/api/health/db?deep=1" target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          <span style={{ marginLeft: 6 }}>Открыть JSON-отчёт</span>
        </a>
      </div>

      {unauthorized ? (
        <div style={{ ...card, background: "var(--adm-kraft-pale)", borderColor: "var(--adm-kraft-line)" }}>
          <b>Сессия истекла.</b>{" "}
          <Link href={`/${adminPath}/login?expired=1`}>Войдите в админку заново</Link> — пароль и
          данные учётной записи не менялись.
        </div>
      ) : null}

      {error ? (
        <div style={{ ...card, background: "var(--adm-rust-pale)", borderColor: "var(--adm-rust-line)" }}>
          <b>Не удалось получить диагностику:</b> {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div style={card}>
          <Loader2 size={18} className="animate-spin" /> Проверяю…
        </div>
      ) : null}

      {data && tone && toneStyle ? (
        <>
          {/* ── Главный вердикт ── */}
          <div style={{ ...card, background: toneStyle.bg, borderColor: toneStyle.border }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 16, fontWeight: 700 }}>
              <StatusIcon ok={tone === "ok"} warn={tone === "warn"} />
              {data.db.title}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>{data.db.hint}</div>
            {data.db.message ? (
              <div style={{ ...mono, marginTop: 8 }}>
                Ответ Supabase: {data.db.message}
                {data.db.httpStatus ? ` (HTTP ${data.db.httpStatus}${data.db.code ? `, код ${data.db.code}` : ""})` : ""}
              </div>
            ) : null}
            <div style={{ ...muted, fontSize: 12, marginTop: 8 }}>
              Хост: {data.db.host || "—"} · ключ: {data.db.keyFormat} · {data.db.latencyMs} мс ·
              проверено {new Date(data.ts).toLocaleString("ru-RU")}
            </div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              Пошаговая инструкция:{" "}
              <a href={DOC_URL} target="_blank" rel="noreferrer">
                docs/ADMIN-RECOVERY.md
              </a>
            </div>
          </div>

          {/* ── Переменные окружения ── */}
          <div style={card}>
            <h2 style={cardTitle}>Переменные окружения</h2>
            {data.envChecks.map((check) => (
              <div key={check.id} style={row}>
                <StatusIcon ok={check.ok} warn={check.level === "warn"} />
                <div>
                  <div style={{ ...mono, fontWeight: 600 }}>{check.label}</div>
                  <div style={muted}>{check.detail}</div>
                  {!check.ok && check.hint ? (
                    <div style={{ color: "var(--adm-rust)", marginTop: 2 }}>{check.hint}</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* ── Таблицы ── */}
          {data.db.tables?.length ? (
            <div style={card}>
              <h2 style={cardTitle}>Базовые таблицы</h2>
              {data.db.tables.map((table) => (
                <div key={table.table} style={row}>
                  <StatusIcon ok={table.ok} warn={!table.ok && table.status === "forbidden"} />
                  <div>
                    <div style={mono}>{table.table}</div>
                    <div style={muted}>
                      {table.ok ? "доступна" : table.message || "нет доступа"}
                      {table.httpStatus ? ` · HTTP ${table.httpStatus}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* ── Учётные записи ── */}
          <div style={card}>
            <h2 style={cardTitle}>Учётные записи админки</h2>
            {data.adminAccounts?.error ? (
              <div style={{ color: "var(--adm-rust)", fontSize: 13 }}>
                Не удалось прочитать таблицу admins: {data.adminAccounts.error}
              </div>
            ) : data.adminAccounts ? (
              <>
                <div style={row}>
                  <StatusIcon ok={data.adminAccounts.fullAccess > 0} />
                  <div>
                    <div>
                      всего записей: <b>{data.adminAccounts.total}</b>, активных:{" "}
                      <b>{data.adminAccounts.active}</b>, с полным доступом (owner/admin):{" "}
                      <b>{data.adminAccounts.fullAccess}</b>
                    </div>
                    <div style={muted}>
                      {data.adminAccounts.usernames.length
                        ? `логины: ${data.adminAccounts.usernames.join(", ")}`
                        : "в таблице admins нет ни одной записи — войти некому"}
                    </div>
                  </div>
                </div>
                {data.adminAccounts.fullAccess === 0 ? (
                  <div style={{ ...mono, color: "var(--adm-rust)", marginTop: 6 }}>
                    Нужен хотя бы один активный аккаунт с ролью owner или admin. Как создать —
                    в docs/ADMIN-RECOVERY.md (шаг 5).
                  </div>
                ) : null}
              </>
            ) : (
              <div style={muted}>Проверка доступна только при работающем подключении к базе.</div>
            )}
          </div>

          {/* ── Данные и сессия ── */}
          <div style={card}>
            <h2 style={cardTitle}>Данные и сессия</h2>
            <div style={row}>
              <div>
                <div style={mono}>Строк в таблицах</div>
                <div style={muted}>
                  {Object.keys(data.counts).length
                    ? Object.entries(data.counts)
                        .map(([table, count]) => `${table}: ${count}`)
                        .join(" · ")
                    : "нет данных (база недоступна)"}
                </div>
              </div>
            </div>
            <div style={row}>
              <div>
                <div style={mono}>Сессия</div>
                <div style={muted}>
                  {data.auth.displayName} ({data.auth.username}), роль {data.auth.role}, срок жизни{" "}
                  {data.auth.sessionTtlHours} ч, продлевается автоматически при работе
                </div>
                {data.auth.sessionSecret !== "ok" ? (
                  <div style={{ color: "var(--adm-rust)" }}>
                    ADMIN_SESSION_SECRET: {data.auth.sessionSecret} — вход в админку невозможен,
                    задайте секрет ≥32 символов
                  </div>
                ) : null}
              </div>
            </div>
            <div style={row}>
              <div>
                <div style={mono}>Путь админки</div>
                <div style={muted}>
                  работает «/{data.adminPath.effectivePath}», NEXT_PUBLIC_ADMIN_PATH:{" "}
                  {data.adminPath.publicPath || "не задан"}, ADMIN_SECRET_PATH:{" "}
                  {data.adminPath.secretPath || "не задан"}
                </div>
                {data.adminPath.notice ? (
                  <div style={{ color: "var(--adm-rust)" }}>{data.adminPath.notice}</div>
                ) : null}
              </div>
            </div>
            <div style={row}>
              <div>
                <div style={mono}>Контейнер</div>
                <div style={muted}>
                  Node {data.runtime.node}, NODE_ENV={data.runtime.env}, uptime{" "}
                  {Math.floor(data.runtime.uptimeSec / 60)} мин, таймаут запросов к базе{" "}
                  {data.runtime.timeoutMs} мс
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
