#!/usr/bin/env node
// =========================================================
// FILE: scripts/doctor.mjs
// Проверка окружения и связи с базой Supabase из терминала.
//
// Запуск (из корня проекта):
//   node scripts/doctor.mjs
//
// Что проверяет:
//   1. переменные окружения (URL базы, ключи, секрет админки, путь панели);
//   2. реальный запрос к Supabase под service_role — с человеческим диагнозом
//      (проект на паузе / отозванный или ротированный ключ / сеть / таймаут);
//   3. таблицы, без которых админка не поднимется (settings, products, admins, orders);
//   4. сколько в базе администраторов (частая причина «не пускает»).
//
// Скрипт не печатает секреты: только факт наличия, длину и формат ключа.
// Тот же диагноз доступен без терминала: /api/health/db?deep=1
// Логика повторяет src/lib/supabase-diagnostics.ts (скрипт автономный, без сборки).
// =========================================================

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// ── Мини-загрузка .env-файлов (без зависимостей) ───────────
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

for (const file of [".env.local", ".env.production.local", ".env.production", ".env"]) {
  loadEnvFile(path.join(root, file));
}

const ok = (text) => `  ✅ ${text}`;
const warn = (text) => `  ⚠️  ${text}`;
const fail = (text) => `  ❌ ${text}`;

function keyFormat(key) {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("eyJ")) return "legacy_jwt";
  return "unknown";
}

const FORMAT_LABEL = {
  legacy_jwt: "legacy JWT (service_role)",
  publishable: "публичный ключ — для сервера не подходит!",
  secret: "новый Secret key",
  unknown: "нераспознанный",
  missing: "не задан",
};

let problems = 0;

console.log("\n🩺 Диагностика СибГофроТорг\n");

// ── 1. Переменные окружения ───────────────────────────────
console.log("Переменные окружения:");
const url = (process.env.SUPABASE_URL || "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const secret = process.env.ADMIN_SESSION_SECRET || "";
const pubPath = (process.env.NEXT_PUBLIC_ADMIN_PATH || "").trim();
const secPath = (process.env.ADMIN_SECRET_PATH || "").trim();

if (!url) {
  console.log(fail("SUPABASE_URL не задан → база недоступна, админка не откроется"));
  problems += 1;
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url)) {
  console.log(`\u001b[33m? \u001b[0mSUPABASE_URL выглядит нестандартно: ${url}`);
  problems += 1;
} else {
  console.log(ok(`SUPABASE_URL = ${url}`));
}

if (!key) {
  console.log(fail("SUPABASE_SERVICE_ROLE_KEY не задан"));
  problems += 1;
} else if (keyFormat(key) === "publishable") {
  console.log(fail("SUPABASE_SERVICE_ROLE_KEY содержит ПУБЛИЧНЫЙ ключ — серверу нужен Secret key"));
  problems += 1;
} else {
  console.log(ok(`SUPABASE_SERVICE_ROLE_KEY: ${FORMAT_LABEL[keyFormat(key)]}, длина ${key.length}`));
}

if (secret.length >= 32) {
  console.log(ok(`ADMIN_SESSION_SECRET задан (длина ${secret.length})`));
} else if (secret) {
  console.log(fail(`ADMIN_SESSION_SECRET короче 32 символов (${secret.length}) — вход в админку не сработает`));
  problems += 1;
} else {
  console.log(fail("ADMIN_SESSION_SECRET не задан — войти в админку нельзя"));
  problems += 1;
}

if (pubPath && secPath && pubPath !== secPath) {
  console.log(
    fail(
      `Путь админки расходится: NEXT_PUBLIC_ADMIN_PATH="${pubPath}", ADMIN_SECRET_PATH="${secPath}". ` +
        "Приведите обе переменные к одному значению."
    )
  );
  problems += 1;
} else {
  console.log(ok(`Путь админки: «/${pubPath || secPath || "admin"}»`));
}

// ── 2. Связь с базой ──────────────────────────────────────
console.log("\nСвязь с базой (запрос под service_role):");
let baseUp = false;

if (url && key && keyFormat(key) !== "publishable") {
  const started = Date.now();
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/settings?select=key&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const ms = Date.now() - started;
    const body = await response.text().catch(() => "");

    if (response.ok) {
      baseUp = true;
      console.log(ok(`База отвечает (${ms} мс)`));
    } else if (response.status === 401 || response.status === 403) {
      problems += 1;
      console.log(fail(`Ключ отклонён (HTTP ${response.status}) — Supabase не принимает service_role:`));
      console.log("     Причины: в проекте ротировали JWT-секрет, отключили legacy-ключи или");
      console.log("     в переменную попал публичный ключ. Возьмите НОВЫЙ ключ:");
      console.log("     Supabase → Project Settings → API Keys → Secret key (или legacy service_role).");
      console.log(`     Ответ Supabase: ${body.slice(0, 200)}`);
    } else if (response.status === 404 || /paused|inactive|suspend/i.test(body)) {
      problems += 1;
      console.log(fail(`Проект недоступен (HTTP ${response.status}): возможно, он на паузе.`));
      console.log("     Supabase Dashboard → выберите проект → Restore / Resume project.");
      console.log(`     Ответ Supabase: ${body.slice(0, 200)}`);
    } else {
      problems += 1;
      console.log(fail(`Неожиданный ответ (HTTP ${response.status}): ${body.slice(0, 200)}`));
    }
  } catch (error) {
    problems += 1;
    const cause = error?.cause?.code || error?.cause?.message || "";
    const text = `${error?.name || ""} ${error?.message || ""} ${cause}`;
    if (/Timeout|Abort/i.test(text)) {
      console.log(fail("Таймаут запроса к Supabase (нет ответа за 10 секунд)."));
      console.log("     Проверьте, не перегружен ли проект, и повторите позже.");
    } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
      console.log(fail(`DNS не разрешает адрес Supabase (${cause || "ENOTFOUND"}).`));
      console.log("     Похоже на сетевые ограничения хостинга из РФ — ключи тут не помогут.");
    } else {
      console.log(fail(`Нет соединения: ${error?.message} ${cause}`.trim()));
      console.log("     Частая причина — фильтрация трафика к *.supabase.co из РФ.");
    }
  }
} else {
  console.log(warn("Проверка связи пропущена: не заданы URL/ключ."));
}

// ── 3. Таблицы и администраторы ───────────────────────────
if (baseUp) {
  console.log("\nТаблицы:");
  const tables = ["settings", "products", "admins", "orders"];
  for (const table of tables) {
    try {
      const response = await fetch(
        `${url.replace(/\/+$/, "")}/rest/v1/${table}?select=*&limit=1`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (response.ok) {
        console.log(ok(`${table} — доступна`));
      } else {
        problems += 1;
        console.log(fail(`${table} — ошибка HTTP ${response.status} (возможно, нет таблицы: примените supabase/schema.sql)`));
      }
    } catch (error) {
      problems += 1;
      console.log(fail(`${table} — ${error?.message}`));
    }
  }

  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/admins?select=username,role,is_active&limit=100`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (response.ok) {
      const rows = await response.json();
      const active = rows.filter((row) => row.is_active !== false);
      const full = active.filter((row) => row.role === "owner" || row.role === "admin");
      if (rows.length === 0) {
        problems += 1;
        console.log(fail("В таблице admins нет записей — войти в админку некому (см. docs/ADMIN-RECOVERY.md)"));
      } else if (full.length === 0) {
        problems += 1;
        console.log(fail(`Администраторы есть (${rows.length}), но ни одного активного с ролью owner/admin`));
      } else {
        console.log(
          ok(
            `Администраторов: ${rows.length}, активных: ${active.length}, с полным доступом: ${full.length} ` +
              `(${rows.map((row) => row.username).join(", ")})`
          )
        );
      }
    }
  } catch (error) {
    console.log(warn(`Не удалось посмотреть администраторов: ${error?.message}`));
  }
}

// ── Итог ─────────────────────────────────────────────────
console.log("");
if (problems === 0) {
  console.log("Итог: критичных проблем не найдено. Если админка всё ещё не открывается —");
  console.log("нажмите «выйти» и войдите заново (сессия могла истечь либо сменился ADMIN_SESSION_SECRET).\n");
  process.exit(0);
}

console.log(`Итог: найдено проблем — ${problems}. Что делать — по пунктам выше,`);
console.log("подробная инструкция: docs/ADMIN-RECOVERY.md\n");
process.exit(1);
