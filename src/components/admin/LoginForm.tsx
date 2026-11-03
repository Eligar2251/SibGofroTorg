// =========================================================
// FILE: src/components/admin/LoginForm.tsx
// Форма входа в админ-панель СибГофроТорг:
//   • Штатный вход по логину и паролю;
//   • Автоматическая проверка доступности основной БД (Supabase):
//     если основная БД не отвечает, открывается блок аварийного входа
//     БЕЗ ПАРОЛЯ через выбор локального файла БД (.json) с проверкой
//     стандартного секретного кода документа и считыванием полного пути файла.
// =========================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  HardDrive,
  KeyRound,
  Loader2,
  LogIn,
  RefreshCw,
} from "lucide-react";
import { getAdminLandingPath, parseAdminRole } from "@/lib/admin-rbac";

export function LoginForm({
  adminPath,
  expired = false,
}: {
  adminPath: string;
  expired?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dbError, setDbError] = useState<{
    message: string;
    detail?: string;
  } | null>(null);

  // Состояние аварийного беспарольного входа по локальному файлу БД
  const [checkingPrimaryDb, setCheckingPrimaryDb] = useState(true);
  const [primaryUnreachable, setPrimaryUnreachable] = useState(false);
  const [showEmergencyPanel, setShowEmergencyPanel] = useState(false);

  const [selectedFileContent, setSelectedFileContent] = useState<string>("");
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [fileFullPath, setFileFullPath] = useState<string>("");
  const [fileSecretPreview, setFileSecretPreview] = useState<{
    hasSecret: boolean;
    standard: string | null;
    rowsCount: number;
  } | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyError, setEmergencyError] = useState("");

  const checkPrimaryStatus = useCallback(
    async (openPanelIfDown = true) => {
      setCheckingPrimaryDb(true);
      try {
        const res = await fetch(`/${adminPath}/api/login/local-file`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        const isDown = data.primaryReachable === false;
        setPrimaryUnreachable(isDown);
        if (isDown && openPanelIfDown) {
          setShowEmergencyPanel(true);
          if (data.primaryError) {
            setDbError((prev) =>
              prev || {
                message: "Основная база данных не отвечает",
                detail: data.primaryError,
              }
            );
          }
        }
      } catch {
        /* ignore */
      } finally {
        setCheckingPrimaryDb(false);
      }
    },
    [adminPath]
  );

  useEffect(() => {
    checkPrimaryStatus(true);
  }, [checkPrimaryStatus]);

  async function processPickedFile(file: File, rawInputPath?: string) {
    setEmergencyError("");
    setSelectedFileName(file.name);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setSelectedFileContent(text);

      // Считываем полный путь файла из всех доступных источников:
      // 1) нативный путь дескриптора ОС (Electron / локальное окружение),
      // 2) относительный путь папки webkitRelativePath,
      // 3) полный путь, записанный по стандарту внутрь самого документа БД (`fileFullPath`),
      // 4) путь из input (если браузер не заменил его на C:\fakepath\).
      const nativePath = String((file as any).path || "").trim();
      const relPath = String((file as any).webkitRelativePath || "").trim();
      const cleanInputPath =
        rawInputPath && !/^[A-Za-z]:\\fakepath\\/i.test(rawInputPath)
          ? rawInputPath.trim()
          : "";
      const embeddedPath = String(
        parsed?.sgtEmergencyAuth?.fileFullPath ||
          parsed?.fileFullPath ||
          parsed?.fileMetadata?.fullPath ||
          ""
      ).trim();

      const detectedFullPath =
        nativePath || embeddedPath || cleanInputPath || relPath || file.name;
      setFileFullPath(detectedFullPath);

      const hasSecret = Boolean(
        parsed?.sgtEmergencyAuth?.secretAccessCode || parsed?.secretAccessCode
      );
      let rowsCount = Number(parsed?.totalRows || 0);
      if (!rowsCount && parsed?.tables && typeof parsed.tables === "object") {
        for (const arr of Object.values(parsed.tables)) {
          if (Array.isArray(arr)) rowsCount += arr.length;
        }
      }

      setFileSecretPreview({
        hasSecret,
        standard: parsed?.sgtEmergencyAuth?.standard || null,
        rowsCount,
      });

      if (!hasSecret) {
        setEmergencyError(
          "Внимание: в выбранном файле не найден стандартный секретный код СибГофроТорг (`secretAccessCode`). Выберите официальный файл локальной БД."
        );
      }
    } catch {
      setSelectedFileContent("");
      setFileSecretPreview(null);
      setEmergencyError(
        "Выбранный файл не удалось прочитать как JSON-документ базы данных."
      );
    }
  }

  async function handleOpenFileDialog() {
    setEmergencyError("");
    // Используем современный диалог выбора файла ОС, если браузер поддерживает
    const anyWin = window as any;
    if (typeof anyWin.showOpenFilePicker === "function") {
      try {
        const [fileHandle] = await anyWin.showOpenFilePicker({
          id: "sgt-emergency-db-login",
          multiple: false,
          types: [
            {
              description: "Локальный файл БД СибГофроТорг (.json)",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        if (fileHandle) {
          const file: File = await fileHandle.getFile();
          await processPickedFile(file);
        }
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") return;
      }
    }
    fileInputRef.current?.click();
  }

  async function handleEmergencyFileLogin() {
    setEmergencyLoading(true);
    setEmergencyError("");

    try {
      const res = await fetch(`/${adminPath}/api/login/local-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent: selectedFileContent || undefined,
          fileFullPath: fileFullPath.trim(),
          fileName: selectedFileName,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || "Не удалось выполнить вход по файлу локальной БД"
        );
      }

      const role = parseAdminRole(data.role);
      router.push(getAdminLandingPath(role, adminPath));
      router.refresh();
    } catch (err) {
      setEmergencyError(
        err instanceof Error
          ? err.message
          : "Ошибка проверки локального файла БД"
      );
      setEmergencyLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setDbError(null);

    const formData = new FormData(e.currentTarget);
    const username = formData.get("username") as string;
    const password = formData.get("password") as string;

    try {
      const res = await fetch(`/${adminPath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 503 || data.code === "db_unavailable") {
          setDbError({
            message: data.error || "Основная база данных не отвечает",
            detail: data.detail || data.hint,
          });
          setPrimaryUnreachable(true);
          setShowEmergencyPanel(true);
          setLoading(false);
          return;
        }
        throw new Error(data.error || "Ошибка входа");
      }

      const role = parseAdminRole(data.role);
      router.push(getAdminLandingPath(role, adminPath));
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Неверный логин или пароль"
      );
      setLoading(false);
    }
  }

  return (
    <div>
      {expired && !dbError ? (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.5,
            background: "var(--adm-kraft-pale)",
            border: "1px solid var(--adm-kraft-line)",
            color: "var(--adm-ink)",
          }}
        >
          <b>Сессия истекла.</b> Войдите заново — заявки, товары и настройки не
          потеряны, пароль прежний.
        </div>
      ) : null}

      {dbError ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.55,
            background: "var(--adm-rust-pale)",
            border: "1px solid var(--adm-rust-line)",
            color: "var(--adm-ink)",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontWeight: 700,
            }}
          >
            <CircleAlert size={16} color="var(--adm-rust)" aria-hidden />
            {dbError.message}
          </div>
          <div style={{ marginTop: 6 }}>
            Основная БД не отвечает — вы можете войти <b>без пароля</b>, выбрав
            локальный файл БД ниже (сайт проверит встроенный секретный код и
            полный путь файла, после чего админка продолжит спокойно работать на
            локальной базе).
          </div>
          {dbError.detail ? (
            <div
              style={{
                marginTop: 6,
                opacity: 0.85,
                fontSize: 12,
                wordBreak: "break-word",
              }}
            >
              {dbError.detail}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Аварийный вход без пароля по локальному файлу БД (активен, когда не отвечает основная БД) */}
      {(showEmergencyPanel || primaryUnreachable) && (
        <div
          style={{
            marginBottom: 20,
            padding: 14,
            borderRadius: 12,
            border: "1.5px solid rgba(16, 185, 129, 0.45)",
            background: "rgba(16, 185, 129, 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: 11,
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
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              <HardDrive size={17} style={{ color: "#059669", flexShrink: 0 }} />
              Вход по локальному файлу БД (без пароля)
            </div>
            <button
              type="button"
              onClick={() => checkPrimaryStatus(false)}
              disabled={checkingPrimaryDb}
              title="Повторно проверить доступность основной БД"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                opacity: 0.75,
              }}
            >
              <RefreshCw
                size={14}
                className={checkingPrimaryDb ? "animate-spin" : ""}
              />
            </button>
          </div>

          <div style={{ fontSize: 12.5, lineHeight: 1.45, opacity: 0.88 }}>
            Выберите сохранённый локальный файл БД (
            <code>sibgofrotorg-latest.json</code> или{" "}
            <code>local-db.json</code>). Сайт считает секретный код документа и
            полный путь файла.
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const rawVal = e.target.value;
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) processPickedFile(f, rawVal);
            }}
          />

          <button
            type="button"
            onClick={handleOpenFileDialog}
            disabled={emergencyLoading}
            className="admin-btn admin-btn--outline"
            style={{
              width: "100%",
              justifyContent: "center",
              gap: 8,
              padding: "10px 14px",
              fontWeight: 600,
            }}
          >
            <FolderOpen size={16} />
            {selectedFileName
              ? `Выбран файл: ${selectedFileName}`
              : "Выбрать локальный файл БД (.json)…"}
          </button>

          <div className="admin-field" style={{ marginBottom: 0 }}>
            <label
              htmlFor="emergency-file-path"
              className="admin-label"
              style={{ fontSize: 12 }}
            >
              Полный путь локального файла БД
            </label>
            <input
              id="emergency-file-path"
              type="text"
              className="admin-input"
              style={{ fontSize: 12.5 }}
              placeholder="Например: D:\SibGofroBackup\sibgofrotorg-latest.json"
              value={fileFullPath}
              onChange={(e) => setFileFullPath(e.target.value)}
            />
          </div>

          {fileSecretPreview && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12,
                padding: "7px 10px",
                borderRadius: 8,
                background: fileSecretPreview.hasSecret
                  ? "rgba(16, 185, 129, 0.12)"
                  : "rgba(239, 68, 68, 0.12)",
                color: fileSecretPreview.hasSecret ? "#065f46" : "#991b1b",
                fontWeight: 600,
              }}
            >
              {fileSecretPreview.hasSecret ? (
                <>
                  <CheckCircle2 size={15} />
                  <span>
                    Секретный код найден ({fileSecretPreview.rowsCount} записей в
                    файле)
                  </span>
                </>
              ) : (
                <>
                  <CircleAlert size={15} />
                  <span>В файле отсутствует стандартный секретный код</span>
                </>
              )}
            </div>
          )}

          {emergencyError && (
            <div className="admin-error" style={{ margin: 0, fontSize: 12.5 }}>
              {emergencyError}
            </div>
          )}

          <button
            type="button"
            onClick={handleEmergencyFileLogin}
            disabled={
              emergencyLoading ||
              (!selectedFileContent && !fileFullPath.trim()) ||
              (fileSecretPreview !== null && !fileSecretPreview.hasSecret)
            }
            className="admin-btn admin-btn--primary"
            style={{
              width: "100%",
              justifyContent: "center",
              gap: 8,
              padding: "12px 18px",
              fontWeight: 700,
            }}
          >
            {emergencyLoading ? (
              <>
                <Loader2 size={17} className="animate-spin" /> Проверка кода и
                вход…
              </>
            ) : (
              <>
                <KeyRound size={17} /> Войти в админку без пароля по файлу БД
              </>
            )}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="admin-field" style={{ marginBottom: 16 }}>
          <label htmlFor="username" className="admin-label">
            Логин
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            autoComplete="username"
            className="admin-input"
            placeholder="admin"
          />
        </div>

        <div className="admin-field" style={{ marginBottom: 16 }}>
          <label htmlFor="password" className="admin-label">
            Пароль
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="admin-input"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="admin-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="admin-btn admin-btn--navy"
          style={{ width: "100%", padding: "14px 24px", fontWeight: 700 }}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Вход...
            </>
          ) : (
            <>
              <LogIn size={18} /> Войти
            </>
          )}
        </button>
      </form>

      {!showEmergencyPanel && !primaryUnreachable && (
        <div style={{ marginTop: 14, textAlign: "center" }}>
          <button
            type="button"
            onClick={async () => {
              await checkPrimaryStatus(true);
              setShowEmergencyPanel(true);
            }}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 12,
              opacity: 0.72,
              textDecoration: "underline",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            Не отвечает основная БД? Войти по локальному файлу БД
          </button>
        </div>
      )}
    </div>
  );
}
