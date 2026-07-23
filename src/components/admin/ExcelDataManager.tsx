// src/components/admin/ExcelDataManager.tsx
"use client";

import { useRef, useState } from "react";
import {
  Download,
  Upload,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";

type SheetStat = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

type ImportReport = {
  success: boolean;
  sheets: Record<string, SheetStat>;
  warnings: string[];
  message: string;
  error?: string;
};

export function ExcelDataManager() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<"full" | "template" | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function download(mode: "full" | "template") {
    setExporting(mode);
    setError(null);
    try {
      const res = await fetch(`/api/admin/excel/export?mode=${mode}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Не удалось скачать файл");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        mode === "template"
          ? "shablon-sibgofrotorg.xlsx"
          : "export-sibgofrotorg.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта");
    }
    setExporting(null);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setImporting(true);
    setError(null);
    setReport(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/excel/import", {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Ошибка импорта");
      }
      setReport(data as ImportReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка импорта");
    }
    setImporting(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="admin-card">
      <div className="admin-card__pad">
        <h2 className="admin-h2" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileSpreadsheet size={18} />
          Excel: импорт и экспорт
        </h2>
        <p className="admin-hint" style={{ marginBottom: 16 }}>
          Скачайте шаблон или полный снимок данных, заполните таблицы словами
          (категория «Гофроящик», товар «Ящик 670», заказ «ЗК-12») и загрузите
          файл обратно — связи подтянутся автоматически.
        </p>

        <div className="excel-io-grid">
          <div className="excel-io-block">
            <div className="excel-io-block__title">Скачать</div>
            <div className="excel-io-actions">
              <button
                type="button"
                className="admin-btn admin-btn--navy"
                disabled={!!exporting}
                onClick={() => download("template")}
              >
                {exporting === "template" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Шаблон (с примерами)
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--outline"
                disabled={!!exporting}
                onClick={() => download("full")}
              >
                {exporting === "full" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Полный экспорт
              </button>
            </div>
          </div>

          <div className="excel-io-block">
            <div className="excel-io-block__title">Загрузить в базу</div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={importing}
              onClick={() => inputRef.current?.click()}
            >
              {importing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {importing ? "Импорт…" : "Выбрать Excel-файл"}
            </button>
            {fileName && (
              <div className="admin-muted" style={{ marginTop: 8, fontSize: 12 }}>
                Файл: {fileName}
              </div>
            )}
          </div>
        </div>

        <div className="excel-io-help">
          <Info size={14} />
          <div>
            <strong>Связи пишите словами, не UUID:</strong>
            <ul>
              <li>
                Товар → категория: в колонке «Категория» напишите{" "}
                <em>Гофроящик</em> (найдёт и «гофроящик», и «Гофро Ящик»).
              </li>
              <li>
                Позиции поступлений/заказов: лист «…_позиции» — «Номер
                документа» + «Товар» (название или артикул).
              </li>
              <li>
                Платежи: «Связанные заказы» = <em>ЗК-12, ЗК-15</em>; «Связанные
                поступления» = <em>ПО-3</em>.
              </li>
              <li>
                Зарплата: «Сотрудник» = ФИО как в листе «Сотрудники».
              </li>
            </ul>
          </div>
        </div>

        {error && (
          <div className="admin-error" style={{ marginTop: 14 }}>
            <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
            {error}
          </div>
        )}

        {report && (
          <div className="excel-io-report">
            <div
              className={`excel-io-report__head${
                report.success ? " excel-io-report__head--ok" : " excel-io-report__head--warn"
              }`}
            >
              {report.success ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              {report.message}
            </div>

            <div className="excel-io-report__sheets">
              {Object.entries(report.sheets).map(([name, st]) => (
                <div key={name} className="excel-io-report__sheet">
                  <strong>{name}</strong>
                  <span>
                    +{st.created} / ✎{st.updated} / skip {st.skipped}
                    {st.errors.length > 0 ? ` / ошибок ${st.errors.length}` : ""}
                  </span>
                  {st.errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="excel-io-report__err">
                      {err}
                    </div>
                  ))}
                  {st.errors.length > 5 && (
                    <div className="excel-io-report__err">
                      …и ещё {st.errors.length - 5}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {report.warnings.length > 0 && (
              <div className="excel-io-report__warns">
                <strong>Предупреждения ({report.warnings.length})</strong>
                {report.warnings.slice(0, 12).map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
                {report.warnings.length > 12 && (
                  <div>…и ещё {report.warnings.length - 12}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
