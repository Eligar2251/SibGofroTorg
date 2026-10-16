// =========================================================
// FILE: tests/admin-recovery.test.mjs
// Тесты того, что осталось от «восстановления доступа»:
//   • единый путь админки (все файлы читают его из одного модуля);
//   • подпись/проверка JWT сессии админки;
//   • распознавание сбоя базы в ошибках API.
//
// Запуск: npm run test:recovery
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

// Окружение задаём ДО импорта модулей: часть значений читается на уровне модуля.
process.env.SUPABASE_URL = "https://test-project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiJ9.service.role";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-32-symbols-min!!";
delete process.env.ADMIN_SECRET_PATH;
delete process.env.NEXT_PUBLIC_ADMIN_PATH;

const {
  signAdminSession,
  verifyAdminSessionToken,
  adminSessionNeedsRenewal,
  ADMIN_SESSION_TTL_SEC,
} = await import("@/lib/admin-session-token");
const { normalizeAdminPath, ADMIN_PATH, adminPathReport, isAdminPath } =
  await import("@/lib/admin-path");
const { isDbUnavailable } = await import("@/lib/api-errors");

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

test("расхождение ADMIN_SECRET_PATH и NEXT_PUBLIC_ADMIN_PATH видно явно", () => {
  process.env.ADMIN_SECRET_PATH = "panel";
  process.env.NEXT_PUBLIC_ADMIN_PATH = "other";
  const report = adminPathReport();
  assert.equal(report.mismatch, true);
  assert.equal(report.effectivePath, "other"); // приоритет у публичной переменной
  assert.ok(report.notice.includes("различаются"));
  delete process.env.ADMIN_SECRET_PATH;
  delete process.env.NEXT_PUBLIC_ADMIN_PATH;
});

// ── Ошибки API ──────────────────────────────────────────────
test("сетевые сбои распознаются как «база недоступна»", () => {
  assert.equal(isDbUnavailable(new Error("fetch failed")), true);
  assert.equal(isDbUnavailable(new Error("SUPABASE_URL не задан в переменных окружения")), true);
  assert.equal(isDbUnavailable({ code: "PGRST003", message: "Timed out acquiring connection from connection pool." }), true);
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
