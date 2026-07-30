#!/usr/bin/env node
// Генерирует SQL для создания или обновления пользователя админ-панели.
// Пароль хэшируется тем же scrypt-алгоритмом, который использует сайт.

import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import process from "node:process";

const ROLES = new Set(["admin", "manager", "lawyer"]);

function printHelp() {
  console.log(`
Генератор SQL-пользователя админ-панели

Использование:
  npm run admin:sql -- --username <логин> --role <роль> --name <имя>

Параметры:
  --username, -u   Логин: латиница, цифры, точка, _ или -
  --role, -r       admin | manager | lawyer
  --name, -n       Отображаемое имя (по умолчанию равно логину)
  --output, -o     Записать SQL в файл вместо вывода в терминал
  --help, -h       Показать справку

Пароль безопасно запрашивается в терминале и не отображается.
Для запуска без терминала передайте пароль через переменную ADMIN_PASSWORD.
`);
}

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  const aliases = {
    "--username": "username",
    "-u": "username",
    "--role": "role",
    "-r": "role",
    "--name": "name",
    "-n": "name",
    "--output": "output",
    "-o": "output",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    const key = aliases[argument];
    if (!key) fail(`неизвестный параметр «${argument}»`);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) {
      fail(`после ${argument} необходимо указать значение`);
    }
    result[key] = value;
    index += 1;
  }

  return result;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function removeLastCharacter(value) {
  const characters = Array.from(value);
  characters.pop();
  return characters.join("");
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    fail("нет интерактивного терминала; задайте пароль через ADMIN_PASSWORD");
  }

  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Ввод отменён"));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = removeLastCharacter(value);
          continue;
        }
        if (character >= " ") value += character;
      }
    };

    process.stdin.on("data", onData);
  });
}

async function getPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;

  const first = await readHidden("Пароль: ");
  const second = await readHidden("Повторите пароль: ");
  if (first !== second) fail("пароли не совпадают");
  return first;
}

function generateSql({ username, role, displayName, passwordHash }) {
  return `-- Сгенерировано scripts/generate-admin-sql.mjs
-- Пароль в открытом виде в SQL не сохраняется.
-- Роли: admin — всё; manager — без настроек и логов;
--        lawyer — ограниченный финансовый дашборд.

INSERT INTO public.admins (
  username,
  password_hash,
  role,
  display_name,
  is_active
)
VALUES (
  ${sqlString(username)},
  ${sqlString(passwordHash)},
  ${sqlString(role)},
  ${sqlString(displayName)},
  TRUE
)
ON CONFLICT (username) DO UPDATE
SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  is_active = TRUE,
  updated_at = NOW();
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const username = String(options.username || "").trim();
  const role = String(options.role || "").trim();
  const displayName = String(options.name || username).trim();

  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    fail("логин должен содержать 3–64 символа: латиницу, цифры, точку, _ или -");
  }
  if (!ROLES.has(role)) {
    fail("роль должна быть admin, manager или lawyer");
  }
  if (!displayName || displayName.length > 100) {
    fail("отображаемое имя должно содержать от 1 до 100 символов");
  }

  const password = await getPassword();
  if (password.length < 8) fail("пароль должен содержать не менее 8 символов");

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const sql = generateSql({
    username,
    role,
    displayName,
    passwordHash: `${salt}:${hash}`,
  });

  if (options.output) {
    writeFileSync(options.output, sql, { encoding: "utf8", mode: 0o600 });
    chmodSync(options.output, 0o600);
    console.error(`SQL записан в ${options.output}`);
    return;
  }

  process.stdout.write(sql);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
