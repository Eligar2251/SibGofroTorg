// =========================================================
// FILE: src/components/admin/ClientBankExport.tsx
// Кнопка «Выгрузка в Альфа-Банк (1С)» на вкладке «Банк».
// Открывает модалку с выбором периода (по умолчанию — сегодня),
// потом скачивает файл в формате 1CClientBankExchange.
// =========================================================

"use client";

import { useState } from "react";
import { Download, X, Loader2, Upload } from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ClientBankExportButton() {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEscapeClose(() => setOpen(false), open);

  async function handleExport() {
    setError("");
    if (!dateFrom || !dateTo) {
      setError("Укажите период");
      return;
    }
    if (dateTo < dateFrom) {
      setError("Дата конца не может быть раньше даты начала");
      return;
    }
    setLoading(true);
    try {
      const url = `/api/admin/warehouse/payments/export?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`;
      const res = await fetch(url);
      if (!res.ok) {
        let msg = "Не удалось сформировать выгрузку";
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {}
        // Сервер может вернуть ошибку как JSON даже при частичной выгрузке —
        // но если платежей нет вообще — показываем ошибку в модалке.
        setError(msg);
        setLoading(false);
        return;
      }
      const blob = await res.blob();
      // Скачиваем файл.
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `kl_to_1c_${dateFrom}_${dateTo}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setLoading(false);
  }

  return (
    <>
      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        onClick={() => {
          const today = todayIso();
          setDateFrom(today);
          setDateTo(today);
          setError("");
          setOpen(true);
        }}
        title="Сформировать файл платёжек для загрузки в Альфа-Банк (1С Клиент-Банк)"
      >
        <Upload size={14} /> Выгрузка в 1С/Альфа-Банк
      </button>

      {open && (
        <ModalPortal>
          <div className="admin-modal-overlay">
            <div
              className="admin-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 420 }}
            >
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">
                  Выгрузка платежей в Альфа-Банк
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="admin-modal__close"
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="admin-stack" style={{ padding: "16px 20px 20px" }}>
                <p className="admin-muted" style={{ marginTop: 0 }}>
                  В файл попадут <b>проведённые исходящие платежи</b> (платёжки
                  поставщикам) за указанный период. Формат файла —
                  1CClientBankExchange v1.03, кодировка Windows (cp1251), что
                  соответствует импорту из 1С в Альфа-Банк.
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="admin-field" style={{ margin: 0 }}>
                    <label className="admin-label">Дата с</label>
                    <input
                      type="date"
                      className="admin-input"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="admin-field" style={{ margin: 0 }}>
                    <label className="admin-label">Дата по</label>
                    <input
                      type="date"
                      className="admin-input"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </div>

                <div className="admin-hint" style={{ fontSize: 12 }}>
                  Быстрые периоды:{" "}
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--adm-kraft)",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                      fontSize: 12,
                    }}
                    onClick={() => {
                      const t = todayIso();
                      setDateFrom(t);
                      setDateTo(t);
                    }}
                  >
                    сегодня
                  </button>
                  {" · "}
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--adm-kraft)",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration: "underline",
                      fontSize: 12,
                    }}
                    onClick={() => {
                      const t = new Date();
                      const to = t.toISOString().slice(0, 10);
                      t.setDate(t.getDate() - 6);
                      setDateFrom(t.toISOString().slice(0, 10));
                      setDateTo(to);
                    }}
                  >
                    7 дней
                  </button>
                </div>

                {error && (
                  <div
                    className="wh-form-error"
                    style={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: 12,
                    }}
                  >
                    {error}
                  </div>
                )}

                <div className="admin-modal__actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setOpen(false)}
                    disabled={loading}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={handleExport}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    Скачать файл
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
