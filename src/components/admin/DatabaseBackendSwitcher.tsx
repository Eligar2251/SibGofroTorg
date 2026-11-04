// =========================================================
// FILE: src/components/admin/DatabaseBackendSwitcher.tsx
// Панель оперативного управления серверами БД, переключения между
// Supabase #1 / Supabase #2 / Локальной JSON-БД, резервного копирования
// и скачивания полного SQL-скрипта миграции (FULL_DATABASE_MIGRATION.sql).
// =========================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
}: {
  onSwitched?: () => void;
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
    if (!window.confirm("Переключение не копирует данные между базами. Убедитесь, что выбранная база актуальна и нужные изменения синхронизированы. Продолжить?")) return;
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
            Проверка состояния серверов БД и локального JSON-резерва…
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
              Источник базы данных, переключение Supabase и локальный JSON-резерв
            </h2>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--adm-muted, #666)",
              marginTop: 3,
            }}
          >
            Переключайтесь между серверами Supabase или автономной локальной
            JSON-базой в 1 клик без остановки админки и сайта.
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
            Основной источник перестал отвечать (
            {config.failover.lastError || "нет ответа"}), поэтому запросы
            автоматически обслуживаются через{" "}
            <b>
              {config.failover.activeFallbackBackend === "local"
                ? "Локальную JSON-БД"
                : config.failover.activeFallbackBackend === "secondary"
                  ? config.secondary.label
                  : config.primary.label}
            </b>
            . Вы можете закрепить локальный режим или переключиться на облачный
            Supabase #2 ниже.
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

                {config.primary.configured && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => syncFromSupabaseToLocal("primary")}
                    disabled={Boolean(busyAction)}
                    title="Скачать все таблицы из Supabase #1 в локальную JSON-БД"
                  >
                    {busyAction === "sync_primary" ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    В JSON
                  </button>
                )}
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

                {config.secondary.configured && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => syncFromSupabaseToLocal("secondary")}
                    disabled={Boolean(busyAction)}
                    title="Скачать все таблицы из Supabase #2 в локальную JSON-БД"
                  >
                    {busyAction === "sync_secondary" ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    В JSON
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {/* 3. ЛОКАЛЬНАЯ JSON-БД (АВТОНОМНАЯ РАБОТА БЕЗ SUPABASE) */}
        {(() => {
          const isActive = config.activeBackend === "local" && !config.failover.activeFallbackBackend;
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
                    <HardDrive size={16} />
                    <strong style={{ fontSize: 14 }}>
                      Локальная JSON-БД (автономно)
                    </strong>
                  </div>
                  <span className="admin-badge admin-badge--green">
                    Всегда готова
                  </span>
                </div>

                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: "var(--adm-muted, #666)",
                  }}
                >
                  <div>
                    Записей в локальной БД:{" "}
                    <b>
                      {(localSummary?.totalRows ?? 0).toLocaleString("ru-RU")}
                    </b>{" "}
                    (в {localSummary?.nonEmptyTables ?? 0} из{" "}
                    {localSummary?.totalTables ?? 57} табл.,{" "}
                    {formatBytes(localSummary?.fileSizeBytes ?? 0)})
                  </div>
                  <div>
                    Обновлена: <b>{formatDateTime(localSummary?.updatedAt)}</b>
                  </div>
                  {localSummary?.lastSyncedAt && (
                    <div>
                      Снимок: {formatDateTime(localSummary.lastSyncedAt)} (
                      {localSummary.lastSyncSource || "резерв"})
                    </div>
                  )}
                  {(localSummary?.pendingMutationsCount ?? 0) > 0 && (
                    <div
                      style={{
                        marginTop: 4,
                        color: "#b45309",
                        fontWeight: 600,
                      }}
                    >
                      Ожидают отправки в Supabase:{" "}
                      {localSummary?.pendingMutationsCount} изм.
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {isActive ? (
                  <span className="admin-badge admin-badge--green">
                    ✓ Работает автономно
                  </span>
                ) : (
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary admin-btn--sm"
                    onClick={() => switchBackend("local")}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === "switch_local" && (
                      <Loader2 size={13} className="spin" />
                    )}
                    Работать через JSON-БД
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Панель синхронизации Supabase ↔ Локалка + защита аварийного входа по файлу БД */}
      <div
        style={{
          padding: 14,
          borderRadius: 12,
          border: "1px solid var(--adm-border, rgba(0,0,0,0.12))",
          background: "rgba(37, 99, 235, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 13.5,
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <ArrowLeftRight size={16} style={{ color: "#2563eb" }} />
              Синхронизация Supabase ↔ Локальная БД (экспорт и импорт без простоев)
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--adm-text-muted, #667085)",
                marginTop: 2,
              }}
            >
              При падении основной БД все операции админки сохраняются в локальной
              базе и очереди изменений, а при восстановлении синхронизируются с
              Supabase без потери данных.
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              disabled={
                Boolean(busyAction) ||
                (!config.primary.configured && !config.secondary.configured)
              }
              onClick={() =>
                runBidirectionalSync(
                  config.activeBackend === "secondary" ? "secondary" : "primary"
                )
              }
              title="Отправить все офлайн-правки из локалки в Supabase и скачать свежую базу в локалку"
            >
              {busyAction === "sync_bidirectional" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ArrowLeftRight size={14} />
              )}
              Синхронизировать Supabase ↔ Локалку
            </button>

            <button
              type="button"
              className="admin-btn admin-btn--outline admin-btn--sm"
              disabled={
                Boolean(busyAction) ||
                (!config.primary.configured && !config.secondary.configured)
              }
              onClick={() =>
                syncFromSupabaseToLocal(
                  config.activeBackend === "secondary" ? "secondary" : "primary"
                )
              }
              title="Экспорт всех таблиц из активного Supabase в локальную JSON-БД"
            >
              {busyAction.startsWith("sync_") &&
              busyAction !== "sync_bidirectional" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Download size={14} />
              )}
              Экспорт из Supabase → в локалку
            </button>

            <button
              type="button"
              className="admin-btn admin-btn--outline admin-btn--sm"
              disabled={
                Boolean(busyAction) ||
                (!config.primary.configured && !config.secondary.configured)
              }
              onClick={() =>
                pushLocalToSupabase(
                  config.activeBackend === "secondary" ||
                    (!config.primary.configured && config.secondary.configured)
                    ? "secondary"
                    : "primary"
                )
              }
              title="Импортировать все данные из локальной JSON-БД в Supabase"
            >
              {busyAction.startsWith("push_") ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Upload size={14} />
              )}
              Импорт из локалки → в Supabase
            </button>

            {(localSummary?.pendingMutationsCount ?? 0) > 0 && (
              <button
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm"
                style={{ borderColor: "#f59e0b", color: "#b45309" }}
                disabled={Boolean(busyAction)}
                onClick={() => flushPendingOfflineMutations()}
              >
                {busyAction === "replay_pending" ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Дослать офлайн-правки ({localSummary?.pendingMutationsCount})
              </button>
            )}
          </div>
        </div>

        {/* Статус встроенного секретного кода локального файла для аварийного входа без пароля */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--adm-surface, #fff)",
            border: "1px solid var(--adm-border, rgba(0,0,0,0.08))",
            fontSize: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <KeyRound size={14} style={{ color: "#059669" }} />
            <span>
              Секретный код беспарольного входа в локальном файле БД (по стандарту):{" "}
              <code>{secretCodeInfo?.maskedCode || "SGT-KEY-••••••••"}</code>
            </span>
          </div>
          <div style={{ opacity: 0.82, wordBreak: "break-all" }}>
            Файл локальной БД: <code>{localSummary?.filePath || "—"}</code>
            {config.lastEmergencyDbFilePath && (
              <span>
                {" "}
                · Последний аварийный вход с пути:{" "}
                <code>{config.lastEmergencyDbFilePath}</code>
              </span>
            )}
          </div>
        </div>
      </div>

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
                placeholder="Напр. Supabase Cloud (Основной)"
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

      {/* Автоматическое резервное копирование каждые 2–3 минуты на выбранный диск */}
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          border: "1px solid var(--adm-border, rgba(0,0,0,0.1))",
          background: "rgba(16, 185, 129, 0.04)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Clock size={16} style={{ color: "#10b981" }} />
              Автоматическая локальная копия БД (каждые 2–3 минуты) на указанный диск
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--adm-text-muted, #667085)",
                marginTop: 2,
              }}
            >
              Система автоматически снимает актуальную копию базы и записывает её
              на выбранный вами диск (на вашем ПК через браузер и/или по пути на
              сервере 24/7) с ротацией архива.
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: 12,
          }}
        >
          {/* Блок 1: Диск на компьютере администратора (выбор папки в проводнике) */}
          <div
            style={{
              padding: 13,
              borderRadius: 10,
              background: "var(--adm-surface, #fff)",
              border: "1px solid var(--adm-border, rgba(0,0,0,0.09))",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <FolderOpen size={15} />
                Диск этого компьютера (проводник)
              </div>
              {pcSettings?.folderName && pcStatus?.permission === "granted" ? (
                <span className="admin-badge admin-badge--green">
                  Пишется автоматически
                </span>
              ) : pcSettings?.folderName && pcStatus?.permission === "prompt" ? (
                <span className="admin-badge admin-badge--amber">
                  Нужно подтверждение
                </span>
              ) : (
                <span className="admin-badge admin-badge--muted">
                  Диск не выбран
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--adm-text-muted, #667085)",
                lineHeight: 1.45,
              }}
            >
              Выберите любой диск или папку на вашем компьютере (например,{" "}
              <code>D:\SibGofroBackup</code> или флешку). Пока открыта любая
              страница админки, копии сохраняются автоматически в фоновом режиме.
            </div>

            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.025)",
              }}
            >
              <div>
                Папка на ПК:{" "}
                <strong>
                  {pcSettings?.folderName
                    ? `📁 ${pcSettings.folderName}`
                    : "не выбрана"}
                </strong>
              </div>
              <div>
                Последняя запись:{" "}
                <strong>{formatDateTime(pcStatus?.lastSavedAt)}</strong>
                {pcStatus?.lastTotalRows !== null &&
                pcStatus?.lastTotalRows !== undefined
                  ? ` (${pcStatus.lastTotalRows} зап.)`
                  : ""}
              </div>
              {pcStatus?.lastError && (
                <div style={{ color: "#b91c1c", marginTop: 3 }}>
                  {pcStatus.lastError}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={pcSettings?.enabled ?? true}
                  onChange={(e) => {
                    savePcBackupSettings({ enabled: e.target.checked });
                  }}
                />
                Автозапись каждые:
              </label>

              <select
                className="admin-input"
                style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                value={pcSettings?.intervalSec ?? 150}
                onChange={(e) =>
                  savePcBackupSettings({ intervalSec: Number(e.target.value) })
                }
              >
                <option value={120}>2 минуты</option>
                <option value={150}>2,5 минуты (реком.)</option>
                <option value={180}>3 минуты</option>
                <option value={300}>5 минут</option>
                <option value={600}>10 минут</option>
              </select>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: "auto",
              }}
            >
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                onClick={handlePickPcFolder}
                disabled={Boolean(busyAction)}
              >
                {busyAction === "pc_pick_dir" ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <FolderOpen size={14} />
                )}
                {pcSettings?.folderName
                  ? "Сменить диск / папку…"
                  : "Выбрать диск / папку на ПК…"}
              </button>

              {pcSettings?.folderName && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn--outline admin-btn--sm"
                    onClick={handlePcBackupNow}
                    disabled={Boolean(busyAction)}
                  >
                    {busyAction === "pc_backup_now" || pcStatus?.isWriting ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <HardDrive size={14} />
                    )}
                    Сохранить сейчас
                  </button>

                  <button
                    type="button"
                    className="admin-btn admin-btn--outline admin-btn--sm"
                    onClick={handleRestoreFromPcFolder}
                    disabled={Boolean(busyAction)}
                    title="Восстановить БД из sibgofrotorg-latest.json с выбранного диска ПК"
                  >
                    {busyAction === "pc_restore" ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    Восстановить с диска ПК
                  </button>

                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={async () => {
                      await disconnectPcBackupDirectory();
                      setNotice("Автосохранение на папку ПК отключено.");
                    }}
                    disabled={Boolean(busyAction)}
                    title="Отвязать выбранную папку на ПК"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Блок 2: Серверный диск / папка 24/7 (работает даже при закрытом браузере) */}
          <div
            style={{
              padding: 13,
              borderRadius: 10,
              background: "var(--adm-surface, #fff)",
              border: "1px solid var(--adm-border, rgba(0,0,0,0.09))",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <HardDrive size={15} />
                Диск / папка на сервере 24/7
              </div>
              {config.autoBackupEnabled ? (
                <span className="admin-badge admin-badge--green">
                  Активен 24/7 ({autoBackupStatus?.snapshotsCount ?? 0} коп.)
                </span>
              ) : (
                <span className="admin-badge admin-badge--muted">
                  Приостановлен
                </span>
              )}
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--adm-text-muted, #667085)",
                lineHeight: 1.45,
              }}
            >
              Работает на сервере круглосуточно (даже когда браузер закрыт).
              Укажите путь к подключённому диску (например,{" "}
              <code>D:\Backups\SibGofro</code> или <code>/mnt/disk2/sgt</code>).
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input
                type="text"
                className="admin-input"
                style={{ flex: "1 1 210px", fontSize: 12.5 }}
                placeholder={`По умолчанию: ${config.resolvedBackupDir}`}
                value={serverBackupDirInput}
                onChange={(e) => {
                  setServerBackupDirInput(e.target.value);
                  setServerDirDirty(true);
                }}
              />
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                disabled={Boolean(busyAction)}
                onClick={() =>
                  saveServerAutoBackupConfig(
                    {
                      customBackupDir: serverBackupDirInput.trim(),
                      autoBackupEnabled: true,
                      runBackupNow: true,
                    },
                    serverBackupDirInput.trim()
                      ? `Путь к диску сохранён (${serverBackupDirInput.trim()}) и создана первая копия!`
                      : "Установлена папка по умолчанию и создана свежая копия!"
                  )
                }
              >
                {busyAction === "save_autobackup" ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                Применить диск
              </button>
            </div>

            <div
              style={{
                fontSize: 12,
                lineHeight: 1.5,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.025)",
              }}
            >
              <div style={{ wordBreak: "break-all" }}>
                Активный путь:{" "}
                <strong>
                  {autoBackupStatus?.targetDir || config.resolvedBackupDir}
                </strong>
              </div>
              <div>
                Последняя копия:{" "}
                <strong>
                  {formatDateTime(autoBackupStatus?.lastSuccessAt)}
                </strong>
                {autoBackupStatus?.lastTotalRows !== null &&
                autoBackupStatus?.lastTotalRows !== undefined
                  ? ` (${autoBackupStatus.lastTotalRows} зап.)`
                  : ""}
              </div>
              {autoBackupStatus?.lastError && (
                <div style={{ color: "#b45309", marginTop: 3 }}>
                  {autoBackupStatus.lastError}
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={config.autoBackupEnabled}
                  disabled={Boolean(busyAction)}
                  onChange={(e) =>
                    saveServerAutoBackupConfig({
                      autoBackupEnabled: e.target.checked,
                    })
                  }
                />
                Каждые:
              </label>

              <select
                className="admin-input"
                style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                value={config.autoBackupIntervalSec}
                disabled={Boolean(busyAction)}
                onChange={(e) =>
                  saveServerAutoBackupConfig({
                    autoBackupIntervalSec: Number(e.target.value),
                  })
                }
              >
                <option value={120}>2 минуты</option>
                <option value={150}>2,5 минуты (реком.)</option>
                <option value={180}>3 минуты</option>
                <option value={300}>5 минут</option>
                <option value={600}>10 минут</option>
              </select>

              <select
                className="admin-input"
                style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
                value={config.maxBackupSnapshots}
                disabled={Boolean(busyAction)}
                onChange={(e) =>
                  saveServerAutoBackupConfig({
                    maxBackupSnapshots: Number(e.target.value),
                  })
                }
                title="Сколько последних архивных снимков хранить на диске"
              >
                <option value={15}>Хранить 15 копий</option>
                <option value={30}>Хранить 30 копий</option>
                <option value={60}>Хранить 60 копий</option>
                <option value={120}>Хранить 120 копий</option>
              </select>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: "auto",
              }}
            >
              <button
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm"
                onClick={triggerServerBackupNow}
                disabled={Boolean(busyAction)}
              >
                {busyAction === "server_backup_now" ||
                autoBackupStatus?.isRunning ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                Записать на диск сейчас
              </button>

              {(autoBackupStatus?.recentSnapshots?.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => setShowSnapshotsList((v) => !v)}
                >
                  <History size={14} />
                  Архив копий ({autoBackupStatus?.snapshotsCount ?? 0})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Раскрывающийся список архивных снимков на серверном диске с восстановлением в 1 клик */}
        {showSnapshotsList &&
          autoBackupStatus?.recentSnapshots &&
          autoBackupStatus.recentSnapshots.length > 0 && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "var(--adm-surface, #fff)",
                border: "1px solid var(--adm-border, rgba(0,0,0,0.09))",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                Последние автоматические снимки на диске (
                {autoBackupStatus.targetDir}/snapshots):
              </div>
              <div
                style={{
                  maxHeight: 210,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {autoBackupStatus.recentSnapshots.map((snap) => (
                  <div
                    key={snap.filename}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "6px 8px",
                      borderRadius: 7,
                      background: "rgba(0,0,0,0.025)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      <code style={{ fontWeight: 600 }}>{snap.filename}</code>
                      <span style={{ opacity: 0.72 }}>
                        {formatDateTime(snap.createdAt)} ·{" "}
                        {formatBytes(snap.sizeBytes)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="admin-btn admin-btn--outline admin-btn--sm"
                      style={{ padding: "3px 8px", fontSize: 11.5 }}
                      disabled={Boolean(busyAction)}
                      onClick={() => handleRestoreDiskSnapshot(snap.filename)}
                    >
                      {busyAction === `restore_snap_${snap.filename}` ? (
                        <Loader2 size={12} className="spin" />
                      ) : (
                        <RotateCcw size={12} />
                      )}
                      Восстановить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>

      {/* Настройки отказоустойчивости + Экспорт/Импорт JSON и перенос в облачный Supabase */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 10,
          borderTop: "1px solid var(--adm-border, rgba(0,0,0,0.08))",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={config.autoFailover}
              disabled={busyAction === "autoFailover"}
              onChange={(e) => toggleOption("autoFailover", e.target.checked)}
            />
            <ShieldCheck size={14} />
            Автопереход на резерв / JSON-БД при падении сервера
          </label>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={config.mirrorWritesToLocal}
              disabled={busyAction === "mirrorWritesToLocal"}
              onChange={(e) =>
                toggleOption("mirrorWritesToLocal", e.target.checked)
              }
            />
            Автоматически зеркалировать новые записи в локальную JSON-БД
          </label>
        </div>

        {/* Резервное копирование файла JSON и выгрузка в новый Supabase */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          <a
            href="/api/admin/database/backup?format=json"
            className="admin-btn admin-btn--outline admin-btn--sm"
            style={{ textDecoration: "none" }}
            title="Скачать полную резервную копию базы данных на компьютер (.json)"
          >
            <Download size={14} />
            Скачать JSON-бэкап
          </a>

          <select
            className="admin-input"
            style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
            value={importMode}
            onChange={(e) =>
              setImportMode(e.target.value === "merge" ? "merge" : "replace")
            }
            title="Режим восстановления при загрузке JSON-файла"
          >
            <option value="replace">Импорт: полная замена</option>
            <option value="merge">Импорт: объединить записи</option>
          </select>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={handleImportJsonFile}
          />
          <button
            type="button"
            className="admin-btn admin-btn--outline admin-btn--sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busyAction)}
          >
            {busyAction === "import_json" ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Upload size={14} />
            )}
            Загрузить JSON-бэкап
          </button>

          {config.secondary.configured && (
            <button
              type="button"
              className="admin-btn admin-btn--outline admin-btn--sm"
              onClick={() => pushLocalToSupabase("secondary")}
              disabled={Boolean(busyAction)}
              title="Перенести все записи из локальной JSON-БД в Supabase #2 (после запуска FULL_DATABASE_MIGRATION.sql)"
            >
              {busyAction === "push_secondary" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Cloud size={14} />
              )}
              Выгрузить JSON → в Supabase #2
            </button>
          )}

          {config.primary.configured && (
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => pushLocalToSupabase("primary")}
              disabled={Boolean(busyAction)}
              title="Перенести все записи из локальной JSON-БД в Supabase #1"
            >
              {busyAction === "push_primary" ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Server size={14} />
              )}
              JSON → в #1
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
