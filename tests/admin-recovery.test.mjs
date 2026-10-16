// =========================================================
// FILE: tests/admin-recovery.test.mjs
// Тесты диагностики сбоев админки:
//   • классификация ответов Supabase (ключ отозван, проект на паузе, сеть, таймаут);
//   • очистка секретов в отчётах;
//   • единый путь админки и предупреждение о расхождении переменных;
//   • подпись/проверка JWT сессии админки.
//
// Запуск: npm run test:recovery
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

// ── Подменяем окружение ДО импорта модулей: часть значений читается
//    на уровне модуля (ADMIN_PATH) ─────────────────────────────
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.service.role";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-32-symbols-min!!";
delete process.env.ADMIN_SECRET_PATH;
delete process.env.NEXT_PUBLIC_ADMIN_PATH;

const { sanitizeReportText, diagnoseSupabase, collectEnvChecks, checkAdminAccounts } =
  await import("@/lib/supabase-diagnostics");
const { normalizeAdminPath, ADMIN_PATH, adminPathReport, isAdminPath } =
  await import("@/lib/admin-path");
const {
  signAdminSession,
  verifyAdminSessionToken,
  adminSessionNeedsRenewal,
  ADMIN_SESSION_TTL_SEC,
} = await import("@/lib/admin-session-token");
const { isDbUnavailable } = await import("@/lib/api-errors");

const originalFetch = globalThis.fetch;

function mockFetch(handler) {
  globalThis.fetch = async (input, init) => handler(String(input), init);
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Очистка секретов ────────────────────────────────────────
test("JWT-ключи и новые ключи Supabase вырезаются из отчётов", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnop";
  const text = sanitizeReportText(`Invalid API key: ${jwt}`);
  assert.ok(text.includes("<JWT-ключ>"));
  assert.ok(!text.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));

  const secret = sanitizeReportText("key sb_secret_AbCdEf123456 rejected");
  assert.ok(secret.includes("<новый ключ Supabase>"));
  assert.ok(!secret.includes("AbCdEf123456"));
});

test("длинные сообщения обрезаются", () => {
  const text = sanitizeReportText("x".repeat(900), 100);
  assert.equal(text.length, 101); // 100 символов + многоточие
});

// ── Единый путь админки ─────────────────────────────────────
test("путь админки нормализуется", () => {
  assert.equal(normalizeAdminPath("/secret/"), "secret");
  assert.equal(normalizeAdminPath("  panel  "), "panel");
  assert.equal(normalizeAdminPath(""), "admin");
  assert.equal(normalizeAdminPath(null), "admin");
});

test("без переменных путь админки — admin", () => {
  assert.equal(ADMIN_PATH, "admin");
  assert.ok(isAdminPath("/admin/orders"));
  assert.ok(!isAdminPath("/admins"));
});

test("расхождение переменных пути показывается предупреждением", () => {
  process.env.ADMIN_SECRET_PATH = "panel";
  process.env.NEXT_PUBLIC_ADMIN_PATH = "other";
  const report = adminPathReport();
  assert.equal(report.mismatch, true);
  assert.equal(report.effectivePath, "other"); // приоритет у публичной переменной
  assert.ok(report.notice.includes("различаются"));
  delete process.env.ADMIN_SECRET_PATH;
  delete process.env.NEXT_PUBLIC_ADMIN_PATH;
});

// ── Классификация сбоев Supabase ────────────────────────────
test("рабочая база → status ok", async () => {
  mockFetch(() => new Response("[]", { status: 200 }));
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "ok");
  assert.equal(diagnosis.db, "up");
  assert.equal(diagnosis.ok, true);
});

test("ответ 401 → invalid_key с подсказкой про ротацию JWT-секрета", async () => {
  mockFetch(
    () =>
      new Response(JSON.stringify({ message: "Invalid API key" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
  );
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "invalid_key");
  assert.equal(diagnosis.httpStatus, 401);
  assert.match(diagnosis.hint, /JWT-секрет|Secret key/);
});

test("ответ 404 с текстом про паузу → project_paused", async () => {
  mockFetch(
    () =>
      new Response(JSON.stringify({ message: "Project is paused" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
  );
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "project_paused");
  assert.match(diagnosis.hint, /Restore|Resume/);
});

test("DNS-сбой → network (ключи ни при чём)", async () => {
  mockFetch(() => {
    const error = new TypeError("fetch failed");
    error.cause = { code: "ENOTFOUND" };
    throw error;
  });
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "network");
  assert.match(diagnosis.hint, /сеть|блокировка/);
});

test("таймаут → timeout", async () => {
  mockFetch(() => {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    throw error;
  });
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "timeout");
});

test("отсутствие переменных → missing_env без запросов в сеть", async () => {
  const url = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  mockFetch(() => {
    throw new Error("сеть не должна вызываться");
  });
  const diagnosis = await diagnoseSupabase();
  assert.equal(diagnosis.status, "missing_env");
  assert.equal(diagnosis.db, "unconfigured");
  process.env.SUPABASE_URL = url;
});

test("публичный ключ в служебной переменной заметен в проверке окружения", () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_abcdefghijklmnop";
  const check = collectEnvChecks().find((item) => item.id === "supabase-service-key");
  assert.equal(check.ok, true);
  assert.match(check.detail, /публичный ключ/);
  assert.match(check.hint, /Secret key/);
  process.env.SUPABASE_SERVICE_ROLE_KEY = key;
});

test("пустая таблица admins определяется отдельно", async () => {
  mockFetch((url) => {
    assert.match(url, /\/rest\/v1\/admins/);
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const report = await checkAdminAccounts();
  assert.equal(report.total, 0);
  assert.equal(report.fullAccess, 0);
});

// ── Ошибки API ──────────────────────────────────────────────
test("сетевые сбои распознаются как «база недоступна»", () => {
  assert.equal(isDbUnavailable(new Error("fetch failed")), true);
  assert.equal(isDbUnavailable(new Error("SUPABASE_URL не задан в переменных окружения")), true);
  assert.equal(isDbUnavailable(new Error("Некорректная раскладка меню")), false);
  assert.equal(isDbUnavailable({ code: "23514", message: "check constraint" }), false);
});

// ── Сессии админки ─────────────────────────────────────────
test("JWT сессии подписывается и проверяется", async () => {
  const token = await signAdminSession({
    username: "owner",
    role: "owner",
    displayName: "Владелец",
  });
  const session = await verifyAdminSessionToken(token);
  assert.equal(session.username, "owner");
  assert.equal(session.role, "owner");
  assert.equal(session.displayName, "Владелец");
  assert.equal(adminSessionNeedsRenewal(session), false);
  assert.equal(ADMIN_SESSION_TTL_SEC, 60 * 60 * 24 * 30);
});

test("подделанный токен не проходит проверку", async () => {
  assert.equal(await verifyAdminSessionToken("не-jwt"), null);
  assert.equal(await verifyAdminSessionToken(null), null);
});

test("токен, подписанный другим секретом, отклоняется", async () => {
  const { SignJWT } = await import("jose");
  const foreign = await new SignJWT({ username: "hacker", role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("another-secret-another-secret-32chars!"));
  assert.equal(await verifyAdminSessionToken(foreign), null);
});

test("истёкший токен отклоняется", async () => {
  const { SignJWT } = await import("jose");
  const expired = await new SignJWT({ username: "owner", role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  assert.equal(await verifyAdminSessionToken(expired), null);
});
