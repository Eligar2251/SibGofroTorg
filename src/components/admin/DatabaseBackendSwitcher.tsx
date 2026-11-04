// =========================================================
// FILE: src/components/admin/DatabaseBackendSwitcher.tsx
// Панель оперативного управления серверами БД, переключения между
// Supabase #1 / Supabase #2 / Локальной JSON-БД, резервного копирования
// и скачивания полного SQL-скрипта миграции (FULL_DATABASE_MIGRATION.sql).
// =========================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FullBackupPanel } from "./FullBackupPanel";
import { PcScheduledFullBackupPanel } from "./PcScheduledFullBackup";
import { MergeBackupPanel } from "./MergeBackupPanel";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Clock,
  Cloud,
  Copy,
  Database,
  Download,
  FileCode2,
  FolderOpen,
  HardDrive,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  disconnectPcBackupDirectory,
  loadPcBackupSettings,
  loadPcBackupStatus,
  PC_BACKUP_EVENT,
  performPcAutoBackupWrite,
  pickPcBackupDirectory,
  readLatestSnapshotFromPcDirectory,
  refreshPcDirectoryPermission,
  savePcBackupSettings,
  type PcAutoBackupSettings,
  type PcAutoBackupStatus,
} from "@/lib/browser-disk-backup";

type DbBackendMode = "primary" | "secondary" | "local";

interface PublicEndpointView {
  label: string;
  url: string;
  customUrl?: string;
  hasAnonKey: boolean;
  hasServiceRoleKey: boolean;
  anonKeyMasked: string;
  serviceRoleKeyMasked: string;
  configured: boolean;
  usingEnvFallback?: boolean;
}

interface PublicDbConfig {
  activeBackend: DbBackendMode;
  autoFailover: boolean;
  mirrorWritesToLocal: boolean;
  autoBackupEnabled: boolean;
  autoBackupIntervalSec: number;
  customBackupDir: string;
  resolvedBackupDir: string;
  maxBackupSnapshots: number;
  lastEmergencyDbFilePath?: string;
  lastEmergencyLoginAt?: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  failover: {
    activeFallbackBackend: DbBackendMode | null;
    lastError: string | null;
    failedAt: string | null;
  };
  primary: PublicEndpointView;
  secondary: PublicEndpointView;
}

interface DiskSnapshotItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface ServerAutoBackupStatus {
  enabled: boolean;
  intervalSec: number;
  targetDir: string;
  maxSnapshots: number;
  schedulerActive: boolean;
  isRunning: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  lastSavedFilePath: string | null;
  lastTotalRows: number | null;
  lastSource: string | null;
  lastError: string | null;
  nextScheduledAt: string | null;
  snapshotsCount: number;
  recentSnapshots: DiskSnapshotItem[];
}

interface LocalDbSummary {
  filePath: string;
  exists: boolean;
  fileSizeBytes: number;
  updatedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncSource: string | null;
  pendingMutationsCount?: number;
  hasSecretAccessCode?: boolean;
  totalTables: number;
  nonEmptyTables: number;
  totalRows: number;
  tableCounts: Record<string, number>;
}

interface ProbeResult {
  target: DbBackendMode;
  label: string;
  configured: boolean;
  reachable: boolean;
  latencyMs: number | null;
  productsCount: number | null;
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 Б";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function DatabaseBackendSwitcher({
  onSwitched,
  ownerUsername,
}: {
  onSwitched?: () => void;
  ownerUsername?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [config, setConfig] = useState<PublicDbConfig | null>(null);
  const [localSummary, setLocalSummary] = useState<LocalDbSummary | null>(null);
  const [probes, setProbes] = useState<Record<DbBackendMode, ProbeResult> | null>(
    null
  );

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Редактор параметров подключения Supabase #1 / #2
  const [editingTarget, setEditingTarget] = useState<
    "primary" | "secondary" | null
  >(null);
  const [formLabel, setFormLabel] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formServiceKey, setFormServiceKey] = useState("");
  const [formAnonKey, setFormAnonKey] = useState("");

  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");

  // Серверный автобэкап 24/7 на указанный диск / путь
  const [autoBackupStatus, setAutoBackupStatus] =
    useState<ServerAutoBackupStatus | null>(null);
  const [secretCodeInfo, setSecretCodeInfo] = useState<{
    standard: string;
    maskedCode: string;
  } | null>(null);
  const [serverBackupDirInput, setServerBackupDirInput] = useState("");
  const [serverDirDirty, setServerDirDirty] = useState(false);
  const [showSnapshotsList, setShowSnapshotsList] = useState(false);

  // Локальный диск ПК администратора (через окно выбора папки браузера)
  const [pcSettings, setPcSettings] = useState<PcAutoBackupSettings | null>(
    null
  );
  const [pcStatus, setPcStatus] = useState<PcAutoBackupStatus | null>(null);

  const loadState = useCallback(async (withProbe = false) => {
    try {
      const res = await fetch(
        `/api/admin/database/backend${withProbe ? "?probe=1" : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        setServerBackupDirInput((prev) =>
          serverDirDirty ? prev : data.config.customBackupDir || ""
        );
      }
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      if (data.secretCodeInfo) setSecretCodeInfo(data.secretCodeInfo);
      if (data.probes) setProbes(data.probes);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [serverDirDirty]);

  useEffect(() => {
    loadState(true);
    const poll = setInterval(() => loadState(false), 30_000);
    return () => clearInterval(poll);
  }, [loadState]);

  useEffect(() => {
    const syncPc = () => {
      setPcSettings(loadPcBackupSettings());
      setPcStatus(loadPcBackupStatus());
    };
    syncPc();
    refreshPcDirectoryPermission(false).then(() => syncPc());
    window.addEventListener(PC_BACKUP_EVENT, syncPc);
    window.addEventListener("storage", syncPc);
    return () => {
      window.removeEventListener(PC_BACKUP_EVENT, syncPc);
      window.removeEventListener("storage", syncPc);
    };
  }, []);

  function openEndpointEditor(target: "primary" | "secondary") {
    if (!config) return;
    if (config[target].usingEnvFallback) {
      setError("Подключение задано в .env: URL и ключи меняются в окружении сервера, а не в этой форме.");
      return;
    }
    const ep = config[target];
    setEditingTarget(target);
    setFormLabel(ep.label);
    setFormUrl(target === "primary" ? ep.customUrl || ep.url : ep.url);
    setFormServiceKey("");
    setFormAnonKey("");
    setError("");
  }

  async function switchBackend(nextMode: DbBackendMode) {
    if (!window.confirm("Переключение не копирует данные между базами. Изменения после последнего снимка могут отсутствовать. Перед переключением завершите синхронизацию и убедитесь, что никто не вносит новые изменения. Продолжить?")) return;
    setBusyAction(`switch_${nextMode}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeBackend: nextMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Не удалось переключить БД");
      }
      setConfig(data.config);
      setLocalSummary(data.localSummary);
      const label =
        nextMode === "local"
          ? "Локальная JSON-БД (автономный режим)"
          : nextMode === "secondary"
            ? data.config.secondary.label
            : data.config.primary.label;
      setNotice(`Активный источник БД переключён: ${label}`);
      window.dispatchEvent(new CustomEvent("sgt-db-backend-changed"));
      onSwitched?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Ошибка переключения");
    } finally {
      setBusyAction("");
    }
  }

  async function toggleOption(
    field: "autoFailover" | "mirrorWritesToLocal",
    value: boolean
  ) {
    setBusyAction(field);
    setError("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");
      setConfig(data.config);
      window.dispatchEvent(new CustomEvent("sgt-db-backend-changed"));
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить настройку");
    } finally {
      setBusyAction("");
    }
  }

  async function saveEndpointSettings(andActivate: boolean) {
    if (!editingTarget) return;
    setBusyAction("save_endpoint");
    setError("");
    setNotice("");
    try {
      const patch: Record<string, string> = {
        label: formLabel.trim(),
        url: formUrl.trim(),
      };
      if (formServiceKey.trim()) {
        patch.serviceRoleKey = formServiceKey.trim();
      }
      if (formAnonKey.trim()) {
        patch.anonKey = formAnonKey.trim();
      }

      const body: Record<string, any> = {
        [editingTarget]: patch,
      };
      if (andActivate) {
        body.activeBackend = editingTarget;
      }

      const res = await fetch("/api/admin/database/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");

      setConfig(data.config);
      setLocalSummary(data.localSummary);
      setEditingTarget(null);
      setNotice(
        andActivate
          ? `Параметры сохранены, выполнен переход на «${
              data.config[editingTarget].label
            }»`
          : "Параметры подключения к серверу Supabase сохранены"
      );
      window.dispatchEvent(new CustomEvent("sgt-db-backend-changed"));
      loadState(true);
      if (andActivate) {
        onSwitched?.();
        router.refresh();
      }
    } catch (e: any) {
      setError(e?.message || "Ошибка сохранения параметров");
    } finally {
      setBusyAction("");
    }
  }

  async function runProbeAll() {
    setBusyAction("probe");
    setError("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка проверки связи");
      if (data.probes) setProbes(data.probes);
      if (data.config) setConfig(data.config);
      if (data.localSummary) setLocalSummary(data.localSummary);
    } catch (e: any) {
      setError(e?.message || "Ошибка проверки связи");
    } finally {
      setBusyAction("");
    }
  }

  async function syncFromSupabaseToLocal(source: "primary" | "secondary") {
    setBusyAction(`sync_${source}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_to_local", source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось снять копию БД");
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      setNotice(
        `Экспорт из Supabase в локальную БД завершён: ${data.totalRows} записей из ${data.syncedTables} таблиц.`
      );
      onSwitched?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Ошибка экспорта из Supabase в локалку");
    } finally {
      setBusyAction("");
    }
  }

  async function runBidirectionalSync(target?: "primary" | "secondary") {
    setBusyAction("sync_bidirectional");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_bidirectional", target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || "Ошибка двусторонней синхронизации");
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      const sentCount =
        Number(data.replayedUpserts || 0) + Number(data.replayedDeletes || 0);
      setNotice(
        `Двусторонняя синхронизация с «${data.targetLabel}» выполнена! Отправлено локальных изменений в Supabase: ${sentCount}, скачано актуальных записей в локалку: ${data.totalRows}.`
      );
      onSwitched?.();
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Ошибка двусторонней синхронизации");
    } finally {
      setBusyAction("");
    }
  }

  async function flushPendingOfflineMutations(target?: "primary" | "secondary") {
    setBusyAction("replay_pending");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "replay_pending", target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.error || "Ошибка отправки офлайн-изменений");
      if (data.localSummary) setLocalSummary(data.localSummary);
      setNotice(
        `Офлайн-изменения из локалки выгружены в «${data.targetLabel}»: вставок/правок — ${data.replayedUpserts}, удалений — ${data.replayedDeletes}.`
      );
    } catch (e: any) {
      setError(e?.message || "Ошибка отправки офлайн-изменений");
    } finally {
      setBusyAction("");
    }
  }

  async function pushLocalToSupabase(target: "primary" | "secondary") {
    const targetName =
      target === "secondary"
        ? config?.secondary.label || "Supabase #2"
        : config?.primary.label || "Supabase #1";
    if (
      !confirm(
        `Выгрузить все данные из локальной JSON-БД (${
          localSummary?.totalRows ?? 0
        } записей) в «${targetName}»?\n\nВажно: на новом сервере Supabase сначала должен быть выполнен скрипт FULL_DATABASE_MIGRATION.sql.`
      )
    ) {
      return;
    }

    setBusyAction(`push_${target}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push_to_remote", target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка выгрузки данных");
      const warnSuffix =
        Array.isArray(data.failedTables) && data.failedTables.length > 0
          ? ` (ошибки в ${data.failedTables.length} табл.: ${data.failedTables
              .slice(0, 3)
              .map((f: any) => `${f.table}: ${f.error}`)
              .join("; ")})`
          : "";
      setNotice(
        `Выгружено в «${data.targetLabel}»: ${data.pushedRows} записей в ${data.pushedTables} таблицах${warnSuffix}.`
      );
      loadState(true);
    } catch (e: any) {
      setError(e?.message || "Ошибка выгрузки в Supabase");
    } finally {
      setBusyAction("");
    }
  }

  async function handleCopySqlMigration() {
    setBusyAction("copy_sql");
    setError("");
    try {
      const res = await fetch(
        "/api/admin/database/backup?format=sql&inline=1",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Не удалось загрузить SQL-скрипт");
      const sqlText = await res.text();
      await navigator.clipboard.writeText(sqlText);
      setNotice(
        "Полный SQL-код миграции скопирован в буфер обмена! Вставьте его в Supabase → SQL Editor → Run."
      );
    } catch (e: any) {
      setError(e?.message || "Не удалось скопировать SQL");
    } finally {
      setBusyAction("");
    }
  }

  async function handleImportJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusyAction("import_json");
    setError("");
    setNotice("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch("/api/admin/database/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: parsed, mode: importMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка импорта JSON");
      if (data.localSummary) setLocalSummary(data.localSummary);
      setNotice(
        `Резервная копия «${file.name}» загружена в локальную JSON-БД (${
          data.localSummary?.totalRows ?? 0
        } записей).`
      );
      onSwitched?.();
      router.refresh();
    } catch (err: any) {
      setError(
        err?.message || "Файл повреждён или не является JSON-бэкапом БД"
      );
    } finally {
      setBusyAction("");
    }
  }

  // ── Автоматическое резервное копирование каждые 2–3 минуты на диск ──

  async function saveServerAutoBackupConfig(
    patch: {
      autoBackupEnabled?: boolean;
      autoBackupIntervalSec?: number;
      customBackupDir?: string;
      maxBackupSnapshots?: number;
      runBackupNow?: boolean;
    },
    successMessage?: string
  ) {
    setBusyAction("save_autobackup");
    setError("");
    if (successMessage) setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения автобэкапа");
      if (data.config) {
        setConfig(data.config);
        setServerBackupDirInput(data.config.customBackupDir || "");
        setServerDirDirty(false);
      }
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      if (successMessage) setNotice(successMessage);
    } catch (err: any) {
      setError(err?.message || "Не удалось применить настройки диска автобэкапа");
    } finally {
      setBusyAction("");
    }
  }

  async function triggerServerBackupNow() {
    setBusyAction("server_backup_now");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_backup_now" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения на диск");
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      setNotice(
        `Копия успешно записана на диск: ${
          data.result?.savedFilePath || data.autoBackupStatus?.targetDir || ""
        } (${data.result?.totalRows ?? 0} записей)`
      );
    } catch (err: any) {
      setError(err?.message || "Ошибка записи резервной копии на диск");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRestoreDiskSnapshot(filename: string) {
    if (
      !confirm(
        `Восстановить локальную JSON-БД из архивной копии на диске «${filename}»?`
      )
    ) {
      return;
    }
    setBusyAction(`restore_snap_${filename}`);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/database/backend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore_disk_snapshot",
          filename,
          mode: importMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка восстановления снимка");
      if (data.localSummary) setLocalSummary(data.localSummary);
      if (data.autoBackupStatus) setAutoBackupStatus(data.autoBackupStatus);
      setNotice(
        `База данных восстановлена из копии «${filename}» (${
          data.localSummary?.totalRows ?? 0
        } записей).`
      );
      onSwitched?.();
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Ошибка восстановления из снимка");
    } finally {
      setBusyAction("");
    }
  }

  async function handlePickPcFolder() {
    setBusyAction("pc_pick_dir");
    setError("");
    setNotice("");
    try {
      const res = await pickPcBackupDirectory();
      if (res.cancelled) return;
      if (!res.ok) {
        setError(res.error || "Не удалось выбрать папку на диске ПК");
        return;
      }
      setNotice(
        `Подключена папка на диске ПК «${res.folderName}»! Первая резервная копия сохранена, далее копия будет обновляться автоматически каждые ${
          Math.round(((pcSettings?.intervalSec || 150) / 60) * 10) / 10
        } мин.`
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handlePcBackupNow() {
    setBusyAction("pc_backup_now");
    setError("");
    setNotice("");
    try {
      const res = await performPcAutoBackupWrite({ force: true });
      if (!res.ok) {
        setError(res.error || "Не удалось записать копию на диск ПК");
        return;
      }
      setNotice(
        `Свежая копия записана в папку «${pcSettings?.folderName}» (${
          res.filename || "sibgofrotorg-latest.json"
        }, ${res.totalRows ?? 0} записей).`
      );
    } finally {
      setBusyAction("");
    }
  }

  async function handleRestoreFromPcFolder() {
    if (
      !confirm(
        `Восстановить локальную БД из файла sibgofrotorg-latest.json в папке «${pcSettings?.folderName}» на вашем ПК?`
      )
    ) {
      return;
    }
    setBusyAction("pc_restore");
    setError("");
    setNotice("");
    try {
      const readRes = await readLatestSnapshotFromPcDirectory();
      if (!readRes.ok || !readRes.snapshot) {
        throw new Error(readRes.error || "Не удалось прочитать файл с диска ПК");
      }
      const res = await fetch("/api/admin/database/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: readRes.snapshot, mode: importMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка восстановления");
      if (data.localSummary) setLocalSummary(data.localSummary);
      setNotice(
        `База данных восстановлена с вашего диска ПК «${pcSettings?.folderName}» (${
          data.localSummary?.totalRows ?? 0
        } записей).`
      );
      onSwitched?.();
      router.refresh();
    } catch (err: any) {
      setError(err?.message || "Ошибка восстановления с диска ПК");
    } finally {
      setBusyAction("");
    }
  }

  function renderProbeBadge(target: DbBackendMode) {
    const p = probes?.[target];
    if (!p) {
      return (
        <span className="admin-badge admin-badge--muted">Не проверен</span>
      );
    }
    if (!p.configured) {
      return (
        <span className="admin-badge admin-badge--muted">Не настроен</span>
      );
    }
    if (p.reachable) {
      return (
        <span className="admin-badge admin-badge--green">
          Онлайн{p.latencyMs != null ? ` · ${p.latencyMs} мс` : ""}
        </span>
      );
    }
    return (
      <span
        className="admin-badge admin-badge--amber"
        title={p.error || "Сервер не отвечает"}
      >
        Недоступен
      </span>
    );
  }

  if (loading && !config) {
    return (
      <div className="admin-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Loader2 size={16} className="spin" />
          <span className="admin-muted">
            Проверка состояния серверов БД…
          </span>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div
      className="admin-card"
      style={{
        padding: 18,
        marginBottom: 18,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Заголовок и быстрые действия миграции / проверки связи */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Database size={18} />
            <h2 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>
              Источник базы данных и переключение Supabase
            </h2>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--adm-muted, #666)",
              marginTop: 3,
            }}
          >
            Выбирайте рабочий Supabase для сервера сайта. Отдельный выбор источника на каждом ПК пока не реализован.
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="admin-btn admin-btn--outline admin-btn--sm"
            onClick={runProbeAll}
            disabled={Boolean(busyAction)}
          >
            {busyAction === "probe" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Activity size={14} />
            )}
            Проверить связь
          </button>

          <button
            type="button"
            className="admin-btn admin-btn--outline admin-btn--sm"
            onClick={handleCopySqlMigration}
            disabled={Boolean(busyAction)}
            title="Скопировать единый SQL-скрипт всех 57 таблиц и миграций для вставки в Supabase SQL Editor"
          >
            {busyAction === "copy_sql" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Copy size={14} />
            )}
            Скопировать весь SQL миграции
          </button>

          <a
            href="/api/admin/database/backup?format=sql"
            className="admin-btn admin-btn--outline admin-btn--sm"
            style={{ textDecoration: "none" }}
            title="Скачать единый файл supabase/FULL_DATABASE_MIGRATION.sql"
          >
            <FileCode2 size={14} />
            Скачать FULL_DATABASE_MIGRATION.sql
          </a>
        </div>
      </div>

      {/* Предупреждение, если сработал автоматический аварийный переход */}
      {config.failover.activeFallbackBackend && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(217, 119, 6, 0.12)",
            border: "1px solid rgba(217, 119, 6, 0.35)",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 13,
          }}
        >
          <AlertTriangle
            size={18}
            style={{ flexShrink: 0, marginTop: 1, color: "#b45309" }}
          />
          <div>
            <strong>
              Сработала автоматическая защита от падения сервера БД!
            </strong>{" "}
            Автоматически выбранный резерв доступен только для чтения. Перед записью проверьте его актуальность и явно выберите его рабочей базой. Причина: {config.failover.lastError || "нет ответа"}. Текущее записанное состояние: {" "}
            <b>
              {config.failover.activeFallbackBackend === "local"
                ? "старый серверный JSON (только чтение; автоматический переход на него отключён)"
                : config.failover.activeFallbackBackend === "secondary"
                  ? config.secondary.label
                  : config.primary.label}
            </b>
            . Проверьте данные перед переключением источника ниже.
          </div>
        </div>
      )}

      {notice && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(44, 94, 79, 0.1)",
            color: "var(--adm-pine-dark, #1f4b3e)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Check size={16} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(184, 58, 36, 0.1)",
            color: "var(--adm-rust-dark, #7c2214)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <FullBackupPanel />
      {ownerUsername && <PcScheduledFullBackupPanel username={ownerUsername} />}
      {ownerUsername && <MergeBackupPanel />}

      {/* Три карточки выбора источника БД */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(275px, 1fr))",
          gap: 12,
        }}
      >
        {/* 1. SUPABASE #1 (ОСНОВНОЙ / БЕГЕТ / .ENV) */}
        {(() => {
          const isActive = config.activeBackend === "primary" && !config.failover.activeFallbackBackend;
          return (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                border: isActive
                  ? "2px solid var(--adm-pine, #2c5e4f)"
                  : "1px solid var(--adm-border, rgba(0,0,0,0.14))",
                background: isActive
                  ? "rgba(44, 94, 79, 0.05)"
                  : "var(--adm-surface, #fff)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Server size={16} />
                    <strong style={{ fontSize: 14 }}>
                      {config.primary.label}
                    </strong>
                  </div>
                  {renderProbeBadge("primary")}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--adm-muted, #666)",
                    wordBreak: "break-all",
                  }}
                >
                  <div>
                    URL:{" "}
                    <b>{config.primary.url || "не задан в .env / настройках"}</b>
                  </div>
                  <div>
                    Ключ Secret / service_role:{" "}
                    {config.primary.hasServiceRoleKey
                      ? config.primary.serviceRoleKeyMasked
                      : "не задан"}
                    {config.primary.usingEnvFallback ? " (из .env)" : ""}
                  </div>
                  {probes?.primary?.productsCount != null && (
                    <div>
                      Товаров в базе: <b>{probes.primary.productsCount}</b>
                    </div>
                  )}
                  {probes?.primary?.error && !probes.primary.reachable && (
                    <div
                      style={{
                        color: "var(--adm-rust, #b83a24)",
                        marginTop: 3,
                      }}
                    >
                      Причина: {probes.primary.error}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {isActive ? (
                  <span className="admin-badge admin-badge--green">
                    ✓ Выбран активным
                  </span>
                ) : (
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary admin-btn--sm"
                    onClick={() => switchBackend("primary")}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === "switch_primary" && (
                      <Loader2 size={13} className="spin" />
                    )}
                    Переключить на #1
                  </button>
                )}

                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => openEndpointEditor("primary")}
                >
                  <Settings2 size={13} /> Настроить
                </button>


              </div>
            </div>
          );
        })()}

        {/* 2. SUPABASE #2 (ОБЛАЧНЫЙ / РЕЗЕРВНЫЙ SUPABASE) */}
        {(() => {
          const isActive = config.activeBackend === "secondary" && !config.failover.activeFallbackBackend;
          return (
            <div
              style={{
                padding: 14,
                borderRadius: 12,
                border: isActive
                  ? "2px solid var(--adm-pine, #2c5e4f)"
                  : "1px solid var(--adm-border, rgba(0,0,0,0.14))",
                background: isActive
                  ? "rgba(44, 94, 79, 0.05)"
                  : "var(--adm-surface, #fff)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Cloud size={16} />
                    <strong style={{ fontSize: 14 }}>
                      {config.secondary.label}
                    </strong>
                  </div>
                  {renderProbeBadge("secondary")}
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--adm-muted, #666)",
                    wordBreak: "break-all",
                  }}
                >
                  <div>
                    URL:{" "}
                    <b>
                      {config.secondary.url ||
                        "нажмите «Указать URL и ключи»"}
                    </b>
                  </div>
                  <div>
                    Ключ Secret / service_role:{" "}
                    {config.secondary.hasServiceRoleKey
                      ? config.secondary.serviceRoleKeyMasked
                      : "не задан"}
                  </div>
                  {probes?.secondary?.productsCount != null && (
                    <div>
                      Товаров в базе: <b>{probes.secondary.productsCount}</b>
                    </div>
                  )}
                  {probes?.secondary?.error &&
                    config.secondary.configured &&
                    !probes.secondary.reachable && (
                      <div
                        style={{
                          color: "var(--adm-rust, #b83a24)",
                          marginTop: 3,
                        }}
                      >
                        Причина: {probes.secondary.error}
                      </div>
                    )}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {isActive ? (
                  <span className="admin-badge admin-badge--green">
                    ✓ Выбран активным
                  </span>
                ) : (
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary admin-btn--sm"
                    onClick={() =>
                      config.secondary.configured
                        ? switchBackend("secondary")
                        : openEndpointEditor("secondary")
                    }
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === "switch_secondary" && (
                      <Loader2 size={13} className="spin" />
                    )}
                    {config.secondary.configured
                      ? "Переключить на #2"
                      : "Подключить Supabase #2"}
                  </button>
                )}

                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => openEndpointEditor("secondary")}
                >
                  <Settings2 size={13} />{" "}
                  {config.secondary.configured ? "Настроить" : "URL и ключи"}
                </button>


              </div>
            </div>
          );
        })()}

      </div>

      <div className="admin-muted" style={{ fontSize: 12 }}>Рабочая JSON-БД на ПК ещё не подключена. Прежний серверный JSON не удалён и доступен только для скачивания владельцем.</div>

      {/* Форма ввода URL и ключей для выбранного сервера Supabase */}
      {editingTarget && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: "rgba(44, 94, 79, 0.05)",
            border: "1px solid rgba(44, 94, 79, 0.22)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <strong style={{ fontSize: 13.5 }}>
              Параметры подключения:{" "}
              {editingTarget === "secondary"
                ? "Supabase #2 (например, облачный Supabase Cloud)"
                : "Supabase #1 (переопределение .env)"}
            </strong>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => setEditingTarget(null)}
            >
              Закрыть
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Название в админке
              </span>
              <input
                type="text"
                className="admin-input"
                placeholder="Напр. Supabase Beget (Основной)"
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Project URL (https://xxx.supabase.co)
              </span>
              <input
                type="url"
                className="admin-input"
                placeholder="https://your-project.supabase.co"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Secret Key (sb_secret_… или классический service_role)
              </span>
              <input
                type="password"
                className="admin-input"
                placeholder={
                  config[editingTarget].hasServiceRoleKey
                    ? `Оставьте пустым, чтобы сохранить (${config[editingTarget].serviceRoleKeyMasked})`
                    : "sb_secret_... или eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                }
                value={formServiceKey}
                onChange={(e) => setFormServiceKey(e.target.value)}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Publishable Key (sb_publishable_… или классический anon, необязательно)
              </span>
              <input
                type="password"
                className="admin-input"
                placeholder={
                  config[editingTarget].hasAnonKey
                    ? `Оставьте пустым, чтобы сохранить (${config[editingTarget].anonKeyMasked})`
                    : "sb_publishable_... или eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                }
                value={formAnonKey}
                onChange={(e) => setFormAnonKey(e.target.value)}
              />
            </label>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="admin-btn admin-btn--outline admin-btn--sm"
              onClick={() => saveEndpointSettings(false)}
              disabled={busyAction === "save_endpoint"}
            >
              Сохранить без переключения
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              onClick={() => saveEndpointSettings(true)}
              disabled={busyAction === "save_endpoint"}
            >
              {busyAction === "save_endpoint" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              Сохранить и переключить сюда
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <label><input type="checkbox" checked={config.autoFailover} disabled={busyAction === "autoFailover"} onChange={e => toggleOption("autoFailover", e.target.checked)} /> Автопереход на другой Supabase (может быть устаревшим)</label>
        {ownerUsername && <a href="/api/admin/database/backup?format=json" className="admin-btn admin-btn--outline admin-btn--sm">Скачать старый серверный JSON для восстановления</a>}
      </div>
    </div>
  );
}
