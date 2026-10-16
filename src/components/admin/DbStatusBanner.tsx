// =========================================================
// FILE: src/components/admin/DbStatusBanner.tsx
// Полоса «База данных недоступна» над содержимым админки.
//
// Когда Supabase перестаёт отвечать (проект на паузе, отозванный ключ, сеть),
// все разделы панели показывают разные ошибки — «Не удалось загрузить меню»,
// «Ошибка уведомлений», пустые таблицы, а часть страниц вообще падает в
// «Server Components render». Один раз в минуту проверяем подключение и
// выводим ОДНУ понятную причину с кнопками «Проверить снова» и
// «Диагностика». Публичный сайт при этом продолжает работать из кэша —
// именно поэтому полоса нужна только в админке.
// =========================================================

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, X } from "lucide-react";

type DbReport = {
  ok?: boolean;
  status?: string;
  title?: string;
  hint?: string;
  message?: string | null;
};

const CHECK_INTERVAL_MS = 60_000;

export function DbStatusBanner({ adminPath }: { adminPath: string }) {
  const [report, setReport] = useState<DbReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [hidden, setHidden] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/health/db", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as DbReport;
      // 503 — база недоступна; тело всё равно разбираем.
      if (!res.ok || body.ok === false) {
        setReport(body);
        setHidden(false);
      } else {
        setReport(null);
      }
    } catch {
      // Сеть до собственного сервера — молчим, индикатор realtime покажет.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void check();
    }, CHECK_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  if (!report || hidden) return null;

  const title = report.title || "База данных недоступна";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        margin: "0 0 14px",
        padding: "12px 14px",
        borderRadius: 12,
        background: "var(--adm-rust-pale)",
        border: "1px solid var(--adm-rust-line)",
        color: "var(--adm-ink)",
        fontSize: 13,
        lineHeight: 1.55,
      }}
      role="alert"
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--adm-rust)",
              display: "inline-block",
            }}
          />
          {title}
        </div>
        {report.hint ? <div style={{ marginTop: 4 }}>{report.hint}</div> : null}
        {report.message ? (
          <div style={{ marginTop: 4, opacity: 0.8, wordBreak: "break-word" }}>
            {report.message}
          </div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              font: "inherit",
            }}
          >
            <RefreshCw size={13} />
            Проверить снова
          </button>
          <Link
            href={`/${adminPath}/diagnostics`}
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            Диагностика
          </Link>
          <a
            href="/api/health/db?deep=1"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "inherit",
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ExternalLink size={13} />
            Отчёт о базе
          </a>
        </div>
      </div>
      <button
        type="button"
        aria-label="Скрыть"
        title="Скрыть до следующей проверки"
        onClick={() => setHidden(true)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          opacity: 0.7,
          padding: 0,
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
