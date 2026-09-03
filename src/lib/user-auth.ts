// =========================================================
// FILE: src/lib/user-auth.ts
// Аутентификация пользователей — Supabase (PostgreSQL).
// JWT-сессии, хранение данных в таблице users.
// Поддерживает регистрацию/вход как по телефону, так и по email.
// Переключение метода — настройка в админке registration_contact_field.
// =========================================================

import { createHash, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/supabase";

function getUserSecret(): Uint8Array {
  const fromEnv =
    process.env.USER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    return new TextEncoder().encode(fromEnv);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "USER_SESSION_SECRET (or ADMIN_SESSION_SECRET) must be set (≥32 chars) in production"
    );
  }
  console.warn(
    "[user-auth] USER_SESSION_SECRET не задан — используется dev-секрет"
  );
  return new TextEncoder().encode(
    "dev-only-user-session-secret-min-32-chars!!"
  );
}

const COOKIE = "user-session";

export interface UserSession {
  uid: string;
  phone: string;
  name?: string;
}

export interface AppUser {
  id: string;
  phone: string;
  phoneDigits: string;
  passwordHash: string;
  name?: string | null;
  email?: string | null;
  username?: string | null;
  customerType?: "individual" | "legal" | null;
  companyName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  actualAddress?: string | null;
  deliveryAddress?: string | null;
  createdAt?: unknown;
}

export function normalizePhone(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) digits = "7" + digits;
  if (digits.startsWith("8") && digits.length === 11) {
    digits = "7" + digits.slice(1);
  }
  return digits;
}

export function isValidRussianPhone(raw: string): boolean {
  return /^7\d{10}$/.test(normalizePhone(raw));
}

export function formatPhoneDisplay(digits: string): string {
  const d = normalizePhone(digits);
  if (d.length !== 11) return digits;
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

export function normalizeEmail(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

function userIdForPhone(phoneDigits: string): string {
  return `phone_${createHash("sha256").update(phoneDigits).digest("hex").slice(0, 40)}`;
}

function userIdForEmail(email: string): string {
  const norm = normalizeEmail(email);
  return `email_${createHash("sha256").update(norm).digest("hex").slice(0, 40)}`;
}

function userIdForUsername(username: string): string {
  const norm = normalizeUsername(username);
  return `user_${createHash("sha256").update(norm).digest("hex").slice(0, 40)}`;
}

/** Нормализует логин: нижний регистр, без пробелов по краям. */
export function normalizeUsername(raw: string): string {
  return String(raw || "").trim().toLowerCase();
}

/** Логин: 3–40 символов, латиница/кириллица, цифры, точка, дефис, подчёркивание. */
export function isValidUsername(raw: string): boolean {
  const u = normalizeUsername(raw);
  return /^[a-zа-яё0-9._-]{3,40}$/i.test(u) && !u.includes(" ");
}

function phoneDigitsForEmail(email: string): string {
  const norm = normalizeEmail(email);
  return `email_${createHash("sha256").update(norm).digest("hex").slice(0, 32)}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const hashBuf = Buffer.from(hash, "hex");
    const test = scryptSync(password, salt, 64);
    if (hashBuf.length !== test.length) return false;
    return timingSafeEqual(hashBuf, test);
  } catch {
    return false;
  }
}

export async function createUserSession(user: UserSession) {
  const token = await new SignJWT({
    uid: user.uid,
    phone: user.phone,
    name: user.name || "",
    role: "user",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getUserSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function verifyUserSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getUserSecret());
    if (payload.role && payload.role !== "user") return null;
    if (!payload.uid || !payload.phone) return null;
    return {
      uid: payload.uid as string,
      phone: payload.phone as string,
      name: (payload.name as string) || undefined,
    };
  } catch {
    return null;
  }
}

export async function deleteUserSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

export async function requireUserApi(): Promise<UserSession | NextResponse> {
  const session = await verifyUserSession();
  if (!session) {
    return NextResponse.json({ error: "Требуется вход" }, { status: 401 });
  }
  return session;
}

function mapUserRow(row: any): AppUser {
  return {
    id: row.id,
    phone: row.phone,
    phoneDigits: row.phone_digits,
    passwordHash: row.password_hash,
    name: row.name || null,
    email: row.email || null,
    username: row.username || null,
    customerType: row.customer_type || null,
    companyName: row.company_name || null,
    inn: row.inn || null,
    kpp: row.kpp || null,
    ogrn: row.ogrn || null,
    legalAddress: row.legal_address || null,
    actualAddress: row.actual_address || null,
    deliveryAddress: row.delivery_address || null,
    createdAt: row.created_at,
  };
}

export async function findUserByPhone(phoneDigits: string): Promise<AppUser | null> {
  const db = getAdminDb();
  const normalized = normalizePhone(phoneDigits);
  if (!/^7\d{10}$/.test(normalized)) return null;
  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("phone_digits", normalized)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapUserRow(data);
}

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const db = getAdminDb();
  const norm = normalizeEmail(email);
  if (!isValidEmail(norm)) return null;
  const { data, error } = await db
    .from("users")
    .select("*")
    .ilike("email", norm)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapUserRow(data);
}

export async function findUserByUsername(username: string): Promise<AppUser | null> {
  const db = getAdminDb();
  const norm = normalizeUsername(username);
  if (!norm) return null;
  const { data, error } = await db
    .from("users")
    .select("*")
    .ilike("username", norm)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapUserRow(data);
}

export async function findUserByPhoneOrEmail(identifier: string): Promise<AppUser | null> {
  const raw = String(identifier || "").trim();
  if (!raw) return null;
  // Приоритет — логин (username), затем email, затем телефон.
  if (!raw.includes("@") && !/^7?\d{10,11}$/.test(raw.replace(/\D/g, ""))) {
    const byUsername = await findUserByUsername(raw).catch(() => null);
    if (byUsername) return byUsername;
  }
  if (raw.includes("@")) {
    return findUserByEmail(raw);
  }
  const byPhone = await findUserByPhone(raw).catch(() => null);
  if (byPhone) return byPhone;
  // Если по телефону не нашли, а это не похоже на email — пробуем логин.
  if (!raw.includes("@")) {
    return findUserByUsername(raw).catch(() => null);
  }
  return null;
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const db = getAdminDb();
  const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapUserRow(data);
}

export async function createUser(data: {
  phone: string;
  password: string;
  name?: string;
}): Promise<{ id: string; name: string | null } | { error: string }> {
  const phoneDigits = normalizePhone(data.phone);
  if (!isValidRussianPhone(phoneDigits)) {
    return { error: "Некорректный номер телефона" };
  }
  if (!data.password || data.password.length < 8) {
    return { error: "Пароль минимум 8 символов" };
  }

  try {
    const existing = await findUserByPhone(phoneDigits);
    if (existing) {
      return { error: "Пользователь с таким телефоном уже зарегистрирован" };
    }
  } catch (e) {
    console.error("findUserByPhone error:", e);
    return { error: "Не удалось проверить номер телефона. Попробуйте ещё раз." };
  }

  const passwordHash = hashPassword(data.password);
  const name = data.name?.trim().slice(0, 120) || null;
  const id = userIdForPhone(phoneDigits);
  const db = getAdminDb();

  try {
    const { error } = await db.from("users").insert({
      id,
      phone: formatPhoneDisplay(phoneDigits),
      phone_digits: phoneDigits,
      password_hash: passwordHash,
      name,
    });

    if (error) {
      if (error.code === "23505") {
        return { error: "Пользователь с таким телефоном уже зарегистрирован" };
      }
      throw error;
    }
    return { id, name };
  } catch (e: unknown) {
    console.error("createUser Supabase error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Не удалось создать пользователя: ${msg}` };
  }
}

export async function createUserByEmail(data: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ id: string; name: string | null } | { error: string }> {
  const email = normalizeEmail(data.email);
  if (!isValidEmail(email)) {
    return { error: "Некорректный email" };
  }
  if (!data.password || data.password.length < 8) {
    return { error: "Пароль минимум 8 символов" };
  }

  try {
    const existing = await findUserByEmail(email);
    if (existing) {
      return { error: "Пользователь с таким email уже зарегистрирован" };
    }
  } catch (e) {
    console.error("findUserByEmail error:", e);
    return { error: "Не удалось проверить email. Попробуйте ещё раз." };
  }

  const passwordHash = hashPassword(data.password);
  const name = data.name?.trim().slice(0, 120) || null;
  const id = userIdForEmail(email);
  const db = getAdminDb();

  try {
    const { error } = await db.from("users").insert({
      id,
      phone: email,
      phone_digits: phoneDigitsForEmail(email),
      password_hash: passwordHash,
      name,
      email,
    });

    if (error) {
      if (error.code === "23505") {
        return { error: "Пользователь с таким email уже зарегистрирован" };
      }
      throw error;
    }
    return { id, name };
  } catch (e: unknown) {
    console.error("createUserByEmail Supabase error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Не удалось создать пользователя: ${msg}` };
  }
}

export async function createUserByUsername(data: {
  username: string;
  password: string;
  name?: string;
  email?: string | null;
}): Promise<{ id: string; name: string | null; username: string } | { error: string }> {
  const username = normalizeUsername(data.username);
  if (!isValidUsername(username)) {
    return {
      error:
        "Логин: 3–40 символов (латиница/кириллица, цифры, точка, дефис, подчёркивание)",
    };
  }
  if (!data.password || data.password.length < 8) {
    return { error: "Пароль минимум 8 символов" };
  }

  try {
    const existing = await findUserByUsername(username);
    if (existing) {
      return { error: "Этот логин уже занят. Выберите другой." };
    }
  } catch (e) {
    console.error("findUserByUsername error:", e);
    return { error: "Не удалось проверить логин. Попробуйте ещё раз." };
  }

  const passwordHash = hashPassword(data.password);
  const name = data.name?.trim().slice(0, 120) || null;
  const email = data.email ? normalizeEmail(data.email) : null;
  const id = userIdForUsername(username);
  // phone/phone_digits в БД NOT NULL — для логин-аккаунтов храним в них
  // сам логин и служебный сентинел (уникальность обеспечивает idx_users_username).
  const db = getAdminDb();

  try {
    const { error } = await db.from("users").insert({
      id,
      phone: username,
      phone_digits: `user_${createHash("sha256").update(username).digest("hex").slice(0, 32)}`,
      password_hash: passwordHash,
      name,
      email,
      username,
    });

    if (error) {
      if (error.code === "23505") {
        return { error: "Этот логин уже занят. Выберите другой." };
      }
      throw error;
    }
    return { id, name, username };
  } catch (e: unknown) {
    console.error("createUserByUsername Supabase error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Не удалось создать пользователя: ${msg}` };
  }
}

/**
 * Привязывает гостевые заказы к аккаунту по тому же номеру телефона.
 * Вызывается после регистрации/входа: если клиент оформил заказ без ЛК,
 * а потом создал/восстановил кабинет по этому номеру — заказ появляется у
 * него в «Моих заказах». Чужой аккаунт не перезаписываем: обновляются
 * только строки без user_id.
 */
export async function claimGuestOrdersByPhone(
  uid: string,
  phoneDigits: string
): Promise<number> {
  const normalized = normalizePhone(phoneDigits);
  if (!/^7\d{10}$/.test(normalized)) return 0;

  const db = getAdminDb();
  let count = 0;

  try {
    const { data, error } = await db
      .from("orders")
      .update({ user_id: uid })
      .eq("customer_phone_digits", normalized)
      .is("user_id", null)
      .select("id");
    if (error) throw error;
    count += Array.isArray(data) ? data.length : 0;
  } catch (e) {
    console.error("Не удалось привязать заказы по phone_digits:", e);
  }

  try {
    const display = formatPhoneDisplay(normalized);
    const { data, error } = await db
      .from("orders")
      .update({ user_id: uid })
      .eq("customer_phone", display)
      .is("user_id", null)
      .select("id");
    if (error) throw error;
    count += Array.isArray(data) ? data.length : 0;
  } catch (e) {
    console.error("Не удалось привязать заказы по display phone:", e);
  }

  return count;
}

export async function updateUserProfile(
  uid: string,
  data: Partial<{
    name: string | null;
    email: string | null;
    customerType: "individual" | "legal" | null;
    companyName: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    legalAddress: string | null;
    actualAddress: string | null;
    deliveryAddress: string | null;
  }>
) {
  const db = getAdminDb();
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fieldMap: Record<string, string> = {
    name: "name", email: "email", customerType: "customer_type",
    companyName: "company_name", inn: "inn", kpp: "kpp", ogrn: "ogrn",
    legalAddress: "legal_address", actualAddress: "actual_address",
    deliveryAddress: "delivery_address",
  };
  for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
    if (data[jsKey as keyof typeof data] !== undefined) {
      payload[dbKey] = data[jsKey as keyof typeof data];
    }
  }
  const { error } = await db.from("users").update(payload).eq("id", uid);
  if (error) throw error;
}
