// =========================================================
// FILE: src/lib/user-auth.ts
// =========================================================

import { createHash, scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase-admin";

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

/**
 * Новые аккаунты получают стабильный id, зависящий только от
 * нормализованного телефона. Поэтому два параллельных запроса регистрации
 * одного номера не смогут создать две разные записи Firestore.
 */
function userIdForPhone(phoneDigits: string): string {
  return `phone_${createHash("sha256").update(phoneDigits).digest("hex").slice(0, 40)}`;
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

export async function findUserByPhone(
  phoneDigits: string
): Promise<AppUser | null> {
  const db = getAdminDb();
  const normalized = normalizePhone(phoneDigits);
  const snap = await db
    .collection("users")
    .where("phoneDigits", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<AppUser, "id">) };
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const db = getAdminDb();
  const snap = await db.collection("users").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<AppUser, "id">) };
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

  // Сначала учитываем старые аккаунты со случайными id. Ошибка чтения БД
  // должна останавливать регистрацию, иначе можно создать дубль номера.
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
  const db = getAdminDb();
  const docRef = db.collection("users").doc(userIdForPhone(phoneDigits));

  try {
    const created = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (snap.exists) return false;
      tx.set(docRef, {
        phone: formatPhoneDisplay(phoneDigits),
        phoneDigits,
        passwordHash,
        name,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!created) {
      return { error: "Пользователь с таким телефоном уже зарегистрирован" };
    }
    return { id: docRef.id, name };
  } catch (e: unknown) {
    console.error("createUser Firestore error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Не удалось создать пользователя: ${msg}` };
  }
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
  const payload: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) payload[k] = v;
  }
  await db.collection("users").doc(uid).update(payload);
}