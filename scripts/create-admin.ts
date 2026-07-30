#!/usr/bin/env node
// =========================================================
// Скрипт: создание/обновление администраторов с хэшированными паролями
// Использование:
//   npx tsx scripts/create-admin.ts <username> <password> [role] [display_name]
//
// Примеры:
//   npx tsx scripts/create-admin.ts admin mypassword admin "Иван Иванов"
//   npx tsx scripts/create-admin.ts manager1 pass123 manager "Менеджер Оля"
//   npx tsx scripts/create-admin.ts lawyer1 pass12345 lawyer "Юрист"
// =========================================================

import { createClient } from "@supabase/supabase-js";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Использование: npx tsx scripts/create-admin.ts <username> <password> [role] [display_name]");
    console.log("  role: admin (по умолчанию) | manager | lawyer");
    console.log("Примеры:");
    console.log('  npx tsx scripts/create-admin.ts admin mypass123 admin "Иван Иванов"');
    console.log('  npx tsx scripts/create-admin.ts manager1 pass123 manager "Оля Менеджер"');
    process.exit(1);
  }

  const username = args[0];
  const password = args[1];
  const role = args[2] || "admin";
  const displayName = args[3] || username;
  if (!["admin", "manager", "lawyer"].includes(role)) {
    console.error("ОШИБКА: роль должна быть admin, manager или lawyer");
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("ОШИБКА: Задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в переменных окружения");
    process.exit(1);
  }

  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Хэширование пароля для "${username}"...`);
  const passwordHash = await hashPassword(password);

  // Проверяем, существует ли уже такой пользователь
  const { data: existing } = await db
    .from("admins")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existing) {
    // Обновляем существующего
    const { error } = await db
      .from("admins")
      .update({
        password_hash: passwordHash,
        role,
        display_name: displayName,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (error) {
      console.error("Ошибка обновления:", error.message);
      process.exit(1);
    }
    console.log(`✅ Администратор "${username}" обновлён (роль: ${role}, имя: ${displayName})`);
  } else {
    // Создаём нового
    const { error } = await db.from("admins").insert({
      username,
      password_hash: passwordHash,
      role,
      display_name: displayName,
      is_active: true,
    });

    if (error) {
      console.error("Ошибка создания:", error.message);
      process.exit(1);
    }
    console.log(`✅ Администратор "${username}" создан (роль: ${role}, имя: ${displayName})`);
  }

  console.log(`\nДанные для входа:`);
  console.log(`  Логин: ${username}`);
  console.log(`  Роль: ${role}`);
  console.log("  Пароль не выводится в целях безопасности.");
}

main().catch(console.error);
