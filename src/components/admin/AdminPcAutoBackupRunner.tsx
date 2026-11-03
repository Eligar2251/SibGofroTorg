// =========================================================
// FILE: src/components/admin/AdminPcAutoBackupRunner.tsx
// Фоновый раннер автоматической резервной копии на локальный диск
// компьютера администратора (каждые 2–3 минуты).
// Монтируется в AdminShell для ролей owner / admin и работает на
// всех вкладках админки (Склад, Заказы, Товары и т.д.).
// =========================================================

"use client";

import { useEffect, useState } from "react";
import { FolderCheck, HardDrive, X } from "lucide-react";
import {
  loadPcBackupSettings,
  loadPcBackupStatus,
  PC_BACKUP_EVENT,
  performPcAutoBackupWrite,
  refreshPcDirectoryPermission,
  type PcAutoBackupSettings,
  type PcAutoBackupStatus,
} from "@/lib/browser-disk-backup";

export function AdminPcAutoBackupRunner() {
  const [settings, setSettings] = useState<PcAutoBackupSettings | null>(null);
  const [status, setStatus] = useState<PcAutoBackupStatus | null>(null);
  const [dismissedPrompt, setDismissedPrompt] = useState(false);

  // Первичная проверка сохранённого дескриптора папки в IndexedDB
  useEffect(() => {
    const syncState = () => {
      setSettings(loadPcBackupSettings());
      setStatus(loadPcBackupStatus());
    };
    syncState();
    refreshPcDirectoryPermission(false).then(() => syncState());

    window.addEventListener(PC_BACKUP_EVENT, syncState);
    window.addEventListener("storage", syncState);
    return () => {
      window.removeEventListener(PC_BACKUP_EVENT, syncState);
      window.removeEventListener("storage", syncState);
    };
  }, []);

  // Таймер автоматической записи каждые N секунд (по умолчанию 150 сек = 2,5 мин)
  useEffect(() => {
    if (!settings?.enabled || !settings.folderName) return;

    // Проверяем каждые 15 секунд, не подошло ли время очередного сохранения
    // (с учётом межвкладочного интервала settings.intervalSec)
    const tick = () => {
      performPcAutoBackupWrite().catch(() => {});
    };

    const initialTimer = setTimeout(tick, 4_000);
    const interval = setInterval(tick, 15_000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [settings?.enabled, settings?.folderName, settings?.intervalSec]);

  // Если папка на ПК была выбрана ранее, но после перезапуска браузера требуется 1 клик
  // для подтверждения записи на диск — показываем аккуратную плашку
  if (
    settings?.enabled &&
    settings.folderName &&
    status?.permission === "prompt" &&
    !dismissedPrompt
  ) {
    return (
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 12,
          background: "#1b2430",
          color: "#f9fafb",
          border: "1px solid rgba(52, 211, 153, 0.4)",
          boxShadow: "0 12px 32px rgba(0, 0, 0, 0.28)",
          fontSize: 12.5,
          maxWidth: 420,
        }}
      >
        <HardDrive size={18} style={{ color: "#34d399", flexShrink: 0 }} />
        <div style={{ lineHeight: 1.35 }}>
          <div style={{ fontWeight: 700 }}>
            Автокопия БД на диск «{settings.folderName}»
          </div>
          <div style={{ opacity: 0.82, fontSize: 11.5 }}>
            Подтвердите доступ после перезапуска браузера (каждые{" "}
            {Math.round((settings.intervalSec / 60) * 10) / 10} мин)
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            const perm = await refreshPcDirectoryPermission(true);
            if (perm === "granted") {
              await performPcAutoBackupWrite({ force: true });
            }
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 10px",
            borderRadius: 8,
            border: "none",
            background: "#10b981",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <FolderCheck size={14} /> Включить
        </button>
        <button
          type="button"
          onClick={() => setDismissedPrompt(true)}
          aria-label="Скрыть напоминание"
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return null;
}
