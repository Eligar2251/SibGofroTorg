// =========================================================
// FILE: src/lib/browser-disk-backup.ts
// Клиентский модуль автоматического сохранения локальной копии БД
// прямо на выбранный пользователем диск ПК (например, D:\SibGofroBackup,
// флешку или сетевой диск Windows/macOS) через File System Access API
// (`window.showDirectoryPicker`) + хранение дескриптора папки в IndexedDB.
//
// Работает фоном во время работы в любом разделе админки каждые 2–3 минуты
// (по умолчанию 150 сек = 2,5 мин), использует межвкладочную блокировку,
// ведёт ротацию архивных копий в подпапке `snapshots/`.
// =========================================================

export interface PcAutoBackupSettings {
  enabled: boolean;
  intervalSec: number; // по умолчанию 150 сек (2,5 минуты)
  maxSnapshots: number; // по умолчанию 30 последних копий
  folderName: string | null;
}

export interface PcAutoBackupStatus {
  supported: boolean;
  permission: "granted" | "prompt" | "denied" | "no_folder";
  isWriting: boolean;
  lastSavedAt: string | null;
  lastFilename: string | null;
  lastTotalRows: number | null;
  lastError: string | null;
}

const IDB_NAME = "sgt-pc-backup-db";
const IDB_STORE = "handles";
const IDB_HANDLE_KEY = "target-dir";

const LS_SETTINGS_KEY = "sgt_pc_auto_backup_settings_v1";
const LS_STATUS_KEY = "sgt_pc_auto_backup_status_v1";
const LS_LOCK_KEY = "sgt_pc_auto_backup_lock_v1";

export const PC_BACKUP_EVENT = "sgt:pc-backup-updated";

export const DEFAULT_PC_BACKUP_SETTINGS: PcAutoBackupSettings = {
  enabled: true,
  intervalSec: 150, // 2,5 минуты
  maxSnapshots: 30,
  folderName: null,
};

export function isPcDirectoryPickerSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as any).showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

function emitUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PC_BACKUP_EVENT));
}

export function loadPcBackupSettings(): PcAutoBackupSettings {
  if (typeof window === "undefined") return { ...DEFAULT_PC_BACKUP_SETTINGS };
  try {
    const raw = window.localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_PC_BACKUP_SETTINGS };
    const parsed = JSON.parse(raw);
    const sec = Number(parsed?.intervalSec);
    const maxSnap = Number(parsed?.maxSnapshots);
    return {
      enabled:
        typeof parsed?.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_PC_BACKUP_SETTINGS.enabled,
      intervalSec:
        Number.isFinite(sec) && sec >= 30 && sec <= 86400
          ? Math.round(sec)
          : DEFAULT_PC_BACKUP_SETTINGS.intervalSec,
      maxSnapshots:
        Number.isFinite(maxSnap) && maxSnap >= 3 && maxSnap <= 500
          ? Math.round(maxSnap)
          : DEFAULT_PC_BACKUP_SETTINGS.maxSnapshots,
      folderName: parsed?.folderName ? String(parsed.folderName) : null,
    };
  } catch {
    return { ...DEFAULT_PC_BACKUP_SETTINGS };
  }
}

export function savePcBackupSettings(
  patch: Partial<PcAutoBackupSettings>
): PcAutoBackupSettings {
  const current = loadPcBackupSettings();
  const next: PcAutoBackupSettings = {
    ...current,
    ...patch,
  };
  if (typeof patch.intervalSec === "number") {
    next.intervalSec = Math.min(86400, Math.max(30, Math.round(patch.intervalSec)));
  }
  if (typeof patch.maxSnapshots === "number") {
    next.maxSnapshots = Math.min(500, Math.max(3, Math.round(patch.maxSnapshots)));
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  emitUpdate();
  return next;
}

export function loadPcBackupStatus(): PcAutoBackupStatus {
  const supported = isPcDirectoryPickerSupported();
  if (typeof window === "undefined") {
    return {
      supported: false,
      permission: "no_folder",
      isWriting: false,
      lastSavedAt: null,
      lastFilename: null,
      lastTotalRows: null,
      lastError: null,
    };
  }
  try {
    const raw = window.localStorage.getItem(LS_STATUS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      supported,
      permission: parsed?.permission || "no_folder",
      isWriting: Boolean(parsed?.isWriting),
      lastSavedAt: parsed?.lastSavedAt || null,
      lastFilename: parsed?.lastFilename || null,
      lastTotalRows:
        typeof parsed?.lastTotalRows === "number" ? parsed.lastTotalRows : null,
      lastError: parsed?.lastError || null,
    };
  } catch {
    return {
      supported,
      permission: "no_folder",
      isWriting: false,
      lastSavedAt: null,
      lastFilename: null,
      lastTotalRows: null,
      lastError: null,
    };
  }
}

function updatePcBackupStatus(patch: Partial<PcAutoBackupStatus>): void {
  if (typeof window === "undefined") return;
  const next = {
    ...loadPcBackupStatus(),
    ...patch,
    supported: isPcDirectoryPickerSupported(),
  };
  try {
    window.localStorage.setItem(LS_STATUS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  emitUpdate();
}

// ── Работа с IndexedDB для хранения FileSystemDirectoryHandle ──

function openHandlesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSavedDirectoryHandle(): Promise<any | null> {
  if (!isPcDirectoryPickerSupported()) return null;
  try {
    const db = await openHandlesDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function saveDirectoryHandle(handle: any | null): Promise<void> {
  if (!isPcDirectoryPickerSupported()) return;
  const db = await openHandlesDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (handle) {
      store.put(handle, IDB_HANDLE_KEY);
    } else {
      store.delete(IDB_HANDLE_KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function refreshPcDirectoryPermission(
  requestIfNeeded = false
): Promise<"granted" | "prompt" | "denied" | "no_folder"> {
  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    updatePcBackupStatus({ permission: "no_folder" });
    return "no_folder";
  }

  try {
    let perm: "granted" | "prompt" | "denied" = await handle.queryPermission({
      mode: "readwrite",
    });
    if (perm !== "granted" && requestIfNeeded) {
      perm = await handle.requestPermission({ mode: "readwrite" });
    }
    savePcBackupSettings({ folderName: handle.name || "Папка на диске" });
    updatePcBackupStatus({
      permission: perm,
      ...(perm === "granted" ? { lastError: null } : {}),
    });
    return perm;
  } catch (err: any) {
    updatePcBackupStatus({
      permission: "denied",
      lastError: err?.message || "Нет доступа к выбранной папке",
    });
    return "denied";
  }
}

/**
 * Открывает системное окно выбора диска / папки на компьютере пользователя
 * и сразу сохраняет первую резервную копию БД.
 */
export async function pickPcBackupDirectory(): Promise<{
  ok: boolean;
  folderName?: string;
  cancelled?: boolean;
  error?: string;
}> {
  if (!isPcDirectoryPickerSupported()) {
    return {
      ok: false,
      error:
        "Ваш браузер не поддерживает прямой выбор папки на диске (рекомендуется Chrome, Edge или Яндекс.Браузер). Используйте серверный путь к диску выше.",
    };
  }

  try {
    const picker = (window as any).showDirectoryPicker;
    const handle = await picker({
      id: "sgt-auto-backup",
      mode: "readwrite",
    });
    await saveDirectoryHandle(handle);
    savePcBackupSettings({
      enabled: true,
      folderName: handle.name || "Выбранный диск",
    });
    updatePcBackupStatus({
      permission: "granted",
      lastError: null,
    });

    // Сразу пишем первую резервную копию на выбранный диск!
    await performPcAutoBackupWrite({ force: true });

    return { ok: true, folderName: handle.name };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, cancelled: true };
    }
    return {
      ok: false,
      error: err?.message || "Не удалось выбрать папку на диске",
    };
  }
}

export async function disconnectPcBackupDirectory(): Promise<void> {
  await saveDirectoryHandle(null);
  savePcBackupSettings({ folderName: null });
  updatePcBackupStatus({
    permission: "no_folder",
    lastError: null,
  });
}

// ── Межвкладочная блокировка, чтобы 5 открытых вкладок админки не писали одновременно ──

function tryAcquireCrossTabLock(tabId: string, ttlMs = 25_000): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const raw = window.localStorage.getItem(LS_LOCK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.owner &&
        parsed.owner !== tabId &&
        typeof parsed.expiresAt === "number" &&
        parsed.expiresAt > now
      ) {
        return false;
      }
    }
    window.localStorage.setItem(
      LS_LOCK_KEY,
      JSON.stringify({ owner: tabId, expiresAt: now + ttlMs })
    );
    return true;
  } catch {
    return true;
  }
}

function releaseCrossTabLock(tabId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LS_LOCK_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.owner === tabId) {
      window.localStorage.removeItem(LS_LOCK_KEY);
    }
  } catch {
    /* ignore */
  }
}

function formatPcSnapshotName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds()
  )}`;
  return `sibgofrotorg-${stamp}.json`;
}

async function writeTextToHandle(
  dirHandle: any,
  filename: string,
  content: string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function rotatePcSnapshots(
  snapshotsDirHandle: any,
  maxKeep: number
): Promise<void> {
  try {
    const names: string[] = [];
    for await (const [name, entry] of snapshotsDirHandle.entries()) {
      if (
        entry.kind === "file" &&
        name.startsWith("sibgofrotorg-") &&
        name.endsWith(".json")
      ) {
        names.push(name);
      }
    }
    // Имена формата sibgofrotorg-YYYY-MM-DD_HH-mm-ss.json лексикографически отсортированы по времени
    names.sort().reverse();
    for (let i = maxKeep; i < names.length; i++) {
      try {
        await snapshotsDirHandle.removeEntry(names[i]);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

const TAB_INSTANCE_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

/**
 * Скачивает свежий снимок БД с сервера и записывает его на выбранный диск ПК.
 */
export async function performPcAutoBackupWrite(options?: {
  force?: boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  filename?: string;
  totalRows?: number;
  error?: string;
}> {
  const settings = loadPcBackupSettings();
  if (!options?.force && !settings.enabled) {
    return { ok: true, skipped: true };
  }

  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    updatePcBackupStatus({ permission: "no_folder" });
    return { ok: true, skipped: true };
  }

  // Если другая вкладка уже только что сохранила копию — не дублируем!
  if (!options?.force) {
    const currentStatus = loadPcBackupStatus();
    if (currentStatus.lastSavedAt) {
      const elapsedSec =
        (Date.now() - new Date(currentStatus.lastSavedAt).getTime()) / 1000;
      if (elapsedSec < Math.max(20, settings.intervalSec - 5)) {
        return { ok: true, skipped: true };
      }
    }
  }

  if (!tryAcquireCrossTabLock(TAB_INSTANCE_ID)) {
    return { ok: true, skipped: true };
  }

  try {
    const perm = await refreshPcDirectoryPermission(Boolean(options?.force));
    if (perm !== "granted") {
      return {
        ok: false,
        skipped: true,
        error:
          perm === "prompt"
            ? "Требуется подтвердить доступ браузера к папке на диске"
            : "Доступ к папке на диске отклонён",
      };
    }

    updatePcBackupStatus({ isWriting: true });

    const res = await fetch(
      "/api/admin/database/backup?format=json&inline=1&sync=auto",
      { cache: "no-store" }
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }

    const jsonText = await res.text();
    const headerRows = Number(res.headers.get("X-Sgt-Total-Rows"));
    let totalRows = Number.isFinite(headerRows) ? headerRows : 0;
    let parsedObj: any = null;
    try {
      parsedObj = JSON.parse(jsonText);
      if (!totalRows) totalRows = Number(parsedObj?.totalRows || 0);
    } catch {
      /* ignore */
    }

    const folderRoot = handle.name || settings.folderName || "LocalBackupDisk";
    const snapshotFilename = formatPcSnapshotName();

    const buildPayloadWithPath = (relFilePath: string): string => {
      if (!parsedObj || typeof parsedObj !== "object") return jsonText;
      const stamped = {
        ...parsedObj,
        fileFullPath: relFilePath,
        sgtEmergencyAuth: parsedObj.sgtEmergencyAuth
          ? {
              ...parsedObj.sgtEmergencyAuth,
              fileFullPath: relFilePath,
            }
          : undefined,
      };
      return JSON.stringify(stamped, null, 2);
    };

    // 1. Записываем свежий файл `sibgofrotorg-latest.json` в корень выбранной папки
    await writeTextToHandle(
      handle,
      "sibgofrotorg-latest.json",
      buildPayloadWithPath(`${folderRoot}/sibgofrotorg-latest.json`)
    );

    // 2. Записываем архивную копию с меткой времени в подпапку `snapshots/`
    const snapshotsDir = await handle.getDirectoryHandle("snapshots", {
      create: true,
    });
    await writeTextToHandle(
      snapshotsDir,
      snapshotFilename,
      buildPayloadWithPath(`${folderRoot}/snapshots/${snapshotFilename}`)
    );

    // 3. Оставляем последние N копий
    await rotatePcSnapshots(snapshotsDir, settings.maxSnapshots);

    const nowIso = new Date().toISOString();
    updatePcBackupStatus({
      isWriting: false,
      permission: "granted",
      lastSavedAt: nowIso,
      lastFilename: snapshotFilename,
      lastTotalRows: totalRows,
      lastError: null,
    });

    return {
      ok: true,
      filename: snapshotFilename,
      totalRows,
    };
  } catch (err: any) {
    const msg = err?.message || "Ошибка записи на локальный диск ПК";
    updatePcBackupStatus({
      isWriting: false,
      lastError: msg,
    });
    return {
      ok: false,
      error: msg,
    };
  } finally {
    releaseCrossTabLock(TAB_INSTANCE_ID);
  }
}

/**
 * Читает `sibgofrotorg-latest.json` прямо из выбранной пользователем папки на ПК
 * и отправляет его на восстановление в локальную БД.
 */
export async function readLatestSnapshotFromPcDirectory(): Promise<{
  ok: boolean;
  snapshot?: any;
  filename?: string;
  error?: string;
}> {
  const handle = await getSavedDirectoryHandle();
  if (!handle) {
    return { ok: false, error: "Папка на диске ПК ещё не выбрана" };
  }
  const perm = await refreshPcDirectoryPermission(true);
  if (perm !== "granted") {
    return { ok: false, error: "Нет разрешения на чтение из выбранной папки" };
  }
  try {
    const fileHandle = await handle.getFileHandle("sibgofrotorg-latest.json");
    const file = await fileHandle.getFile();
    const text = await file.text();
    return {
      ok: true,
      snapshot: JSON.parse(text),
      filename: "sibgofrotorg-latest.json",
    };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err?.message ||
        "Файл sibgofrotorg-latest.json не найден в выбранной папке",
    };
  }
}
