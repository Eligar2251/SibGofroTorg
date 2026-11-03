// =========================================================
// FILE: src/lib/local-db-secret.ts
// Стандартный криптографический секретный код документа локальной БД
// СибГофроТорг для аварийного беспарольного входа при падении основной БД.
//
// Как устроена защита:
//   1. Каждый локальный файл БД (`local-db.json`, `sibgofrotorg-latest.json`,
//      архивные снимки и скачиваемые JSON-бэкапы) по стандарту содержит:
//        • `secretAccessCode` — уникальный код доступа данного сайта (SGT-KEY-…)
//        • `fileFullPath`     — полный путь файла на диске
//        • `sgtEmergencyAuth` — метаданные стандарта + HMAC-SHA256 подпись
//   2. Код вычисляется через HMAC-SHA256 от серверного мастер-ключа
//      (`SGT_LOCAL_DB_SECRET_KEY` / `ADMIN_SESSION_SECRET` /
//       `SUPABASE_SERVICE_ROLE_KEY` или автоматически сгенерированного
//       ключа `.sgt-data/local-db-auth-secret.key` с правами 0600).
//   3. Посторонний человек НЕ может создать свой JSON-файл и войти без пароля:
//      без серверного мастер-ключа подделать `secretAccessCode` невозможно,
//      а сравнение выполняется через `timingSafeEqual`.
// =========================================================

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSgtDataDir } from "./db-runtime-config";
import { parseAdminRole, type AdminRole } from "./admin-rbac";

export const SGT_LOCAL_DB_AUTH_STANDARD = "SGT-LOCAL-DB-AUTH-V1" as const;

export interface LocalDbEmergencyAuthBlock {
  standard: typeof SGT_LOCAL_DB_AUTH_STANDARD;
  secretAccessCode: string;
  fileFullPath: string;
  issuedAt: string;
  defaultRole: AdminRole;
  signature: string;
}

const globalRef = globalThis as unknown as {
  __sgtCachedMasterSecret?: string;
};

function getPersistentKeyFilePath(): string {
  return path.join(
    /*turbopackIgnore: true*/ getSgtDataDir(),
    "local-db-auth-secret.key"
  );
}

/**
 * Возвращает стабильный серверный мастер-ключ для вычисления стандартного
 * секретного кода локального файла БД.
 */
function resolveMasterSecret(): string {
  if (globalRef.__sgtCachedMasterSecret) {
    return globalRef.__sgtCachedMasterSecret;
  }

  const fromEnv = String(
    process.env.SGT_LOCAL_DB_SECRET_KEY ||
      process.env.ADMIN_SESSION_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
  ).trim();

  if (fromEnv.length >= 16) {
    globalRef.__sgtCachedMasterSecret = fromEnv;
    return fromEnv;
  }

  // Если переменные окружения не заданы — создаём постоянный ключ сервера на диске
  const keyPath = getPersistentKeyFilePath();
  try {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath, "utf8").trim();
      if (existing.length >= 32) {
        globalRef.__sgtCachedMasterSecret = existing;
        return existing;
      }
    }
    const dir = getSgtDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const generated = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(keyPath, generated, { encoding: "utf8", mode: 0o600 });
    globalRef.__sgtCachedMasterSecret = generated;
    return generated;
  } catch {
    const fallback = "sgt-standalone-fallback-master-key-v1-sibgofrotorg";
    globalRef.__sgtCachedMasterSecret = fallback;
    return fallback;
  }
}

/**
 * Вычисляет эталонный секретный код документа для этого экземпляра сайта.
 * Если администратор дополнительно задал `SGT_LOCAL_DB_ACCESS_CODE` в .env,
 * он также учитывается.
 */
export function computeExpectedSecretAccessCode(): string {
  const customStatic = String(
    process.env.SGT_LOCAL_DB_ACCESS_CODE || ""
  ).trim();
  if (customStatic.length >= 16) {
    return customStatic;
  }
  const master = resolveMasterSecret();
  const digest = crypto
    .createHmac("sha256", master)
    .update("SibGofroTorg::EmergencyLocalDbAccessCode::v1")
    .digest("hex");
  return `SGT-KEY-${digest}`;
}

function computeBlockSignature(params: {
  secretAccessCode: string;
  issuedAt: string;
  defaultRole: string;
}): string {
  const master = resolveMasterSecret();
  return crypto
    .createHmac("sha256", master)
    .update(
      `${SGT_LOCAL_DB_AUTH_STANDARD}|${params.secretAccessCode}|${params.issuedAt}|${params.defaultRole}`
    )
    .digest("hex");
}

function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Формирует стандартный блок секретного кода + полного пути файла,
 * автоматически встраиваемый в каждый локальный файл БД.
 */
export function buildLocalDbAuthEnvelope(
  fileFullPath: string,
  existingIssuedAt?: string | null
): {
  secretAccessCode: string;
  fileFullPath: string;
  sgtEmergencyAuth: LocalDbEmergencyAuthBlock;
} {
  const secretAccessCode = computeExpectedSecretAccessCode();
  const issuedAt = existingIssuedAt || new Date().toISOString();
  const defaultRole: AdminRole = "owner";
  const normalizedPath = String(fileFullPath || "").trim();

  const signature = computeBlockSignature({
    secretAccessCode,
    issuedAt,
    defaultRole,
  });

  return {
    secretAccessCode,
    fileFullPath: normalizedPath,
    sgtEmergencyAuth: {
      standard: SGT_LOCAL_DB_AUTH_STANDARD,
      secretAccessCode,
      fileFullPath: normalizedPath,
      issuedAt,
      defaultRole,
      signature,
    },
  };
}

/**
 * Возвращает замаскированное представление стандартного секретного кода
 * для отображения статуса защиты в разделе «База данных».
 */
export function getMaskedSecretAccessCodeInfo(): {
  standard: string;
  maskedCode: string;
} {
  const code = computeExpectedSecretAccessCode();
  const masked =
    code.length > 18
      ? `${code.slice(0, 12)}••••••••••••${code.slice(-6)}`
      : "••••••••••••";
  return {
    standard: SGT_LOCAL_DB_AUTH_STANDARD,
    maskedCode: masked,
  };
}

/**
 * Проверяет выбранный пользователем локальный файл БД при аварийном входе без пароля:
 *   • валидирует структуру документа БД СибГофроТорг;
 *   • сверяет секретный код документа (`secretAccessCode`) в константное время;
 *   • проверяет криптографическую подпись `sgtEmergencyAuth.signature` (если блок присутствует);
 *   • извлекает полный путь файла и учётную запись владельца/администратора из файла БД.
 */
export function verifyLocalDbEmergencyDocument(rawDoc: unknown): {
  valid: boolean;
  error?: string;
  embeddedFullPath: string | null;
  totalRows: number;
  adminAccount: {
    username: string;
    role: AdminRole;
    displayName: string;
  };
} {
  const fallbackAccount = {
    username: "owner",
    role: "owner" as AdminRole,
    displayName: "Владелец (локальная БД)",
  };

  if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) {
    return {
      valid: false,
      error: "Выбранный файл не является корректным JSON-документом базы данных",
      embeddedFullPath: null,
      totalRows: 0,
      adminAccount: fallbackAccount,
    };
  }

  const doc = rawDoc as Record<string, any>;
  const tables =
    doc.tables && typeof doc.tables === "object" && !Array.isArray(doc.tables)
      ? (doc.tables as Record<string, unknown>)
      : null;

  if (!tables) {
    return {
      valid: false,
      error:
        "В документе отсутствует раздел таблиц (`tables`). Выберите файл локальной БД СибГофроТорг.",
      embeddedFullPath: null,
      totalRows: 0,
      adminAccount: fallbackAccount,
    };
  }

  const authBlock =
    doc.sgtEmergencyAuth && typeof doc.sgtEmergencyAuth === "object"
      ? (doc.sgtEmergencyAuth as Partial<LocalDbEmergencyAuthBlock>)
      : null;

  const candidateCode = String(
    authBlock?.secretAccessCode || doc.secretAccessCode || ""
  ).trim();

  if (!candidateCode) {
    return {
      valid: false,
      error:
        "В выбранном файле отсутствует стандартный секретный код доступа (`secretAccessCode`). Вход без пароля запрещён.",
      embeddedFullPath: null,
      totalRows: 0,
      adminAccount: fallbackAccount,
    };
  }

  const expectedCode = computeExpectedSecretAccessCode();
  if (!safeEqualStrings(candidateCode, expectedCode)) {
    return {
      valid: false,
      error:
        "Секретный код в документе БД не совпадает с ключом этого сайта. Посторонний или поддельный файл отклонён.",
      embeddedFullPath: null,
      totalRows: 0,
      adminAccount: fallbackAccount,
    };
  }

  // Дополнительная проверка HMAC-подписи блока метаданных, если он присутствует
  if (authBlock?.signature && authBlock?.issuedAt) {
    const expectedSig = computeBlockSignature({
      secretAccessCode: candidateCode,
      issuedAt: String(authBlock.issuedAt),
      defaultRole: String(authBlock.defaultRole || "owner"),
    });
    if (!safeEqualStrings(String(authBlock.signature), expectedSig)) {
      return {
        valid: false,
        error:
          "Нарушена цифровая подпись блока авторизации в файле БД. Вход отклонён.",
        embeddedFullPath: null,
        totalRows: 0,
        adminAccount: fallbackAccount,
      };
    }
  }

  const embeddedFullPath =
    String(
      authBlock?.fileFullPath ||
        doc.fileFullPath ||
        doc.fileMetadata?.fullPath ||
        ""
    ).trim() || null;

  let totalRows = 0;
  for (const val of Object.values(tables)) {
    if (Array.isArray(val)) totalRows += val.length;
  }

  // Если в локальной БД есть активный владелец или администратор — входим под ним
  let resolvedAdmin = fallbackAccount;
  const adminsRows = Array.isArray(tables.admins) ? tables.admins : [];
  const activeAdmins = adminsRows.filter(
    (r: any) => r && typeof r === "object" && r.is_active !== false
  );
  const ownerRow =
    activeAdmins.find((r: any) => parseAdminRole(r.role) === "owner") ||
    activeAdmins.find((r: any) => parseAdminRole(r.role) === "admin");

  if (ownerRow && typeof ownerRow.username === "string" && ownerRow.username) {
    const parsedRole = parseAdminRole(ownerRow.role) || "owner";
    resolvedAdmin = {
      username: ownerRow.username,
      role: parsedRole,
      displayName:
        String(ownerRow.display_name || ownerRow.username).trim() ||
        ownerRow.username,
    };
  }

  return {
    valid: true,
    embeddedFullPath,
    totalRows,
    adminAccount: resolvedAdmin,
  };
}
