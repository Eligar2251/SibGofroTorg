#!/usr/bin/env node
// Генерирует SQL для создания или обновления пользователя админ-панели.
// Пароль хэшируется тем же scrypt-алгоритмом, который использует сайт.

import { randomBytes, scryptSync } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import process from "node:process";

const ROLES = new Set(["owner", "admin", "manager", "lawyer", "wastepaper"]);

function printHelp() {
  console.log(`
Генератор SQL-пользователя админ-панели

Использование:
  node scripts/generate-admin-sql.mjs --username <логин> --role <роль> [--name <имя>] [--password <пароль>]
  node scripts/generate-admin-sql.mjs <логин> [роль] [имя] [пароль]

Параметры:
  --username, -u   Логин: латиница, цифры, точка, _ или -
  --role, -r       owner | admin | manager | lawyer | wastepaper (по умолчанию owner)
  --name, -n       Отображаемое имя (по умолчанию равно логину)
  --password, -p   Пароль (если не передан — запрашивается скрытым вводом в терминале)
  --output, -o     Записать SQL в файл вместо вывода в терминал
  --help, -h       Показать справку

Пароль безопасно запрашивается в терминале и не отображается.
Для запуска без терминала также можно передать переменную ADMIN_PASSWORD.
`);
}

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  const positionals = [];
  const aliases = {
    "--username": "username",
    "-u": "username",
    "--role": "role",
    "-r": "role",
    "--name": "name",
    "-n": "name",
    "--password": "password",
    "-p": "password",
    "--output": "output",
    "-o": "output",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument.startsWith("-")) {
      // Поддержка формата --key=value
      const eqIdx = argument.indexOf("=");
      if (eqIdx > 0) {
        const flagPart = argument.slice(0, eqIdx);
        const valPart = argument.slice(eqIdx + 1);
        const key = aliases[flagPart];
        if (!key) fail(`неизвестный параметр «${flagPart}»`);
        result[key] = valPart;
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
      continue;
    }
    positionals.push(argument);
  }

  // Поддержка позиционных аргументов (особенно удобно в Windows PowerShell,
  // где `npm run admin:sql -- ...` съедает `--` и флаги `--username`):
  //   node scripts/generate-admin-sql.mjs <username> [role] [name] [password]
  if (!result.username && positionals[0]) result.username = positionals[0];
  if (!result.role && positionals[1]) result.role = positionals[1];
  if (!result.name && positionals[2]) result.name = positionals[2];
  if (!result.password && positionals[3]) result.password = positionals[3];

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

async function getPassword(explicitPassword) {
  if (explicitPassword) return String(explicitPassword);
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
  const role = String(options.role || "owner").trim();
  const displayName = String(options.name || username).trim();

  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
    fail("логин должен содержать 3–64 символа: латиницу, цифры, точку, _ или -");
  }
  if (!ROLES.has(role)) {
    fail("роль должна быть owner, admin, manager, lawyer или wastepaper");
  }
  if (!displayName || displayName.length > 100) {
    fail("отображаемое имя должно содержать от 1 до 100 символов");
  }

  const password = await getPassword(options.password);
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
