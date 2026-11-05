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
  initialError = "",
}: {
  adminPath: string;
  expired?: boolean;
  initialError?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState(initialError);
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
    setHydrated(true);
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
      window.location.assign(getAdminLandingPath(role, adminPath));
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

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(`/${adminPath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.code === "db_unavailable" || (res.status === 503 && !data.code)) {
          setDbError({
            message: data.error || "Основная база данных не отвечает",
            detail: data.detail || data.hint,
          });
          setPrimaryUnreachable(true);
          setShowEmergencyPanel(true);
          setLoading(false);
          return;
        }
        throw new Error([data.error || "Ошибка входа", data.hint].filter(Boolean).join(". "));
      }

      const role = parseAdminRole(data.role);
      window.location.assign(getAdminLandingPath(role, adminPath));
    } catch (err) {
      setError(
        controller.signal.aborted
          ? "Сервер не ответил вовремя. Проверьте соединение и состояние базы данных."
          : err instanceof Error ? err.message : "Не удалось связаться с сервером"
      );
      setLoading(false);
    } finally {
      window.clearTimeout(timeout);
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
            Проверьте доступность Supabase. Вход с локальной БД ПК пока не реализован.
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

      <form method="post" action={`/${adminPath}/api/login`} onSubmit={handleSubmit}>
        {!hydrated && (
          <div className="admin-error" role="status" style={{ marginBottom: 16 }}>
            Интерактивный интерфейс ещё не загрузился. Вход по логину и паролю
            доступен через обычную отправку формы, но для переключения базы
            и работы админки необходим JavaScript.
          </div>
        )}
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


    </div>
  );
}
