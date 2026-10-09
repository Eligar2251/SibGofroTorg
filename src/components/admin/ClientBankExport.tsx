// =========================================================
// FILE: src/components/admin/ClientBankExport.tsx
// Кнопка «Выгрузка в Альфа-Банк (1С)» на вкладке «Банк».
//
// Как работает:
//   1. Открываем модалку — она показывает ВСЕ исходящие платежи поставщикам
//      за выбранный день (по умолчанию сегодня), включая НЕ проведённые:
//      платёжку можно отправить в банк до проведения платежа в учёте.
//   2. «Показать все платежи» снимает фильтр по дате — не нужно листать
//      день за днём в поисках нужной платёжки.
//   3. В файл попадают ТОЛЬКО отмеченные галочками платежи (POST ids).
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, X, Loader2, Upload, CheckSquare, Square, CalendarRange, Search, AlertTriangle } from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const fmt = (n: number) => (Number(n) || 0).toLocaleString("ru-RU");

/** Дата в человекочитаемом виде: 09.10.2026. */
function shortDate(iso: string): string {
  if (!iso || iso.length < 10) return iso;
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Строка платежа из API выгрузки. */
interface ExportRow {
  id: string;
  number: number;
  date: string;
  counterparty: string;
  amount: number;
  isPaid: boolean;
  exportedAt: string | null;
  receiptNumber: number | string | null;
  invoiceNumber: string | null;
  partLabel: string;
  partTotal: number;
  purpose: string;
  issue: string | null;
  comment: string;
}

export function ClientBankExportButton() {
  const [open, setOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  /** «Показать все платежи» — фильтр по дате выключен. */
  const [allDates, setAllDates] = useState(false);
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [totals, setTotals] = useState<{ count: number; total: number; unexported: number } | null>(null);
  const [limit, setLimit] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState("");
  /** Отменяем ответ устаревшего запроса, если параметры успели поменяться. */
  const requestSeq = useRef(0);
  /** Галочки, которые пользователь расставил руками — не перетираем. */
  const touched = useRef(false);

  useEscapeClose(() => setOpen(false), open);

  const load = useCallback(
    async (params: { from: string; to: string; all: boolean }) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ list: "1" });
        if (params.all) {
          query.set("all", "1");
        } else {
          query.set("from", params.from);
          query.set("to", params.to);
        }
        const res = await fetch(`/api/admin/warehouse/payments/export?${query.toString()}`);
        const body = await res.json().catch(() => null);
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          setRows([]);
          setError(body?.error || "Не удалось загрузить список платежей");
          return;
        }
        const list: ExportRow[] = Array.isArray(body?.rows) ? body.rows : [];
        setRows(list);
        setTotals(body?.totals || null);
        setLimit(Number(body?.limit) || 1000);
        // Автовыбор: всё, что ещё не выгружено и готово к выгрузке.
        // Ручные галочки не перетираем (иначе сбрасывались бы при смене даты).
        if (!touched.current) {
          setSelected(
            new Set(list.filter((row) => !row.exportedAt && !row.issue).map((row) => row.id))
          );
        } else {
          const visible = new Set(list.map((row) => row.id));
          setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))));
        }
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    []
  );

  function openModal() {
    const today = todayIso();
    touched.current = false;
    setAllDates(false);
    setDateFrom(today);
    setDateTo(today);
    setSearch("");
    setError("");
    setDone("");
    setRows([]);
    setSelected(new Set());
    setOpen(true);
    void load({ from: today, to: today, all: false });
  }

  function changeRange(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
    if (allDates) setAllDates(false);
    void load({ from, to, all: false });
  }

  function showAll() {
    setAllDates(true);
    void load({ from: dateFrom, to: dateTo, all: true });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [
        `пл-${row.number}`,
        String(row.number),
        row.counterparty,
        row.purpose,
        row.comment,
        row.receiptNumber ? `по-${row.receiptNumber}` : "",
        row.invoiceNumber ? `счёт ${row.invoiceNumber}` : "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const selectableIds = useMemo(
    () => filtered.filter((row) => !row.issue).map((row) => row.id),
    [filtered]
  );
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const selectedSum = selectedRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  function toggle(id: string) {
    touched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    touched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function handleExport() {
    setError("");
    setDone("");
    const ids = [...selected];
    if (ids.length === 0) {
      setError("Отметьте галочками платежи, которые нужно выгрузить");
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/admin/warehouse/payments/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        let msg = "Не удалось сформировать выгрузку";
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {}
        setError(msg);
        return;
      }
      const count = Number(res.headers.get("X-Export-Count")) || ids.length;
      const from = res.headers.get("X-Export-From") || dateFrom;
      const to = res.headers.get("X-Export-To") || dateTo;
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `kl_to_1c_${from}_${to}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(downloadUrl);

      setDone(`Файл на ${count} платёж${count === 1 ? "у" : count < 5 ? "и" : "ей"} сформирован`);
      // Убираем выгруженные из выбора и помечаем их в списке.
      touched.current = true;
      const stamp = todayIso();
      setRows((prev) =>
        prev.map((row) => (selected.has(row.id) ? { ...row, exportedAt: row.exportedAt || stamp } : row))
      );
      setSelected(new Set());
      // Обновляем список, чтобы счётчики «не выгружено» были актуальны.
      void load({ from: dateFrom, to: dateTo, all: allDates });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setExporting(false);
    }
  }

  // Закрытие модалки — сбрасываем «ручные» галочки для следующего открытия.
  useEffect(() => {
    if (!open) touched.current = false;
  }, [open]);

  const periodLabel = allDates
    ? "все даты"
    : dateFrom === dateTo
      ? shortDate(dateFrom)
      : `${shortDate(dateFrom)} — ${shortDate(dateTo)}`;

  return (
    <>
      <button type="button" className="admin-btn admin-btn--ghost" onClick={openModal}
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
              style={{ maxWidth: 780, width: "100%" }}
            >
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">Выгрузка платежей в Альфа-Банк</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="admin-modal__close"
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="admin-stack" style={{ padding: "8px 0 0" }}>
                <p className="admin-muted" style={{ marginTop: 0, fontSize: 12 }}>
                  В списке — исходящие платежи поставщикам, <b>в том числе не
                  проведённые</b>. В файл попадут только отмеченные галочками.
                  Формат — 1CClientBankExchange v1.03, кодировка Windows (cp1251).
                </p>

                {/* ── Период ── */}
                <div className="bankx-bar">
                  <div className="bankx-dates">
                    <div className="admin-field" style={{ margin: 0 }}>
                      <label className="admin-label">Дата с</label>
                      <input
                        type="date"
                        className="admin-input"
                        value={dateFrom}
                        disabled={loading}
                        onChange={(e) => changeRange(e.target.value, dateTo)}
                      />
                    </div>
                    <div className="admin-field" style={{ margin: 0 }}>
                      <label className="admin-label">Дата по</label>
                      <input
                        type="date"
                        className="admin-input"
                        value={dateTo}
                        disabled={loading}
                        onChange={(e) => changeRange(dateFrom, e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="bankx-quick">
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={loading}
                      onClick={() => {
                        const t = todayIso();
                        changeRange(t, t);
                      }}
                    >
                      Сегодня
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      disabled={loading}
                      onClick={() => {
                        const t = new Date();
                        const to = t.toISOString().slice(0, 10);
                        t.setDate(t.getDate() - 6);
                        changeRange(t.toISOString().slice(0, 10), to);
                      }}
                    >
                      7 дней
                    </button>
                    <button
                      type="button"
                      className={`admin-btn admin-btn--sm${allDates ? " admin-btn--primary" : " admin-btn--outline"}`}
                      disabled={loading}
                      onClick={showAll}
                      title="Показать платежи за все даты — чтобы не листать день за днём"
                    >
                      <CalendarRange size={14} /> Показать все платежи
                    </button>
                  </div>
                </div>

                {/* ── Поиск и массовые действия ── */}
                <div className="bankx-bar">
                  <div className="bankx-search">
                    <Search size={14} />
                    <input
                      className="admin-input"
                      placeholder="Поиск: поставщик, номер, ПО, счёт…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button type="button" className="bankx-search__clear" onClick={() => setSearch("")} aria-label="Очистить">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <div className="bankx-quick">
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={toggleAll}
                      disabled={loading || selectableIds.length === 0}
                    >
                      {allChecked ? <CheckSquare size={14} /> : <Square size={14} />}
                      {allChecked ? "Снять выделение" : "Выделить все"}
                    </button>
                  </div>
                </div>

                {/* ── Список ── */}
                <div className="bankx-list">
                  {loading ? (
                    <div className="bankx-empty">
                      <Loader2 size={16} className="animate-spin" /> Загружаем платежи…
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="bankx-empty">
                      За {periodLabel} исходящих платежей поставщикам нет.
                      {totals && totals.count > 0
                        ? ` Всего не выгружено за всё время: ${totals.unexported} из ${totals.count}.`
                        : ""}
                    </div>
                  ) : (
                    filtered.map((row) => {
                      const checked = selected.has(row.id);
                      return (
                        <label
                          key={row.id}
                          className={`bankx-row${checked ? " bankx-row--on" : ""}${row.issue ? " bankx-row--warn" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!!row.issue}
                            onChange={() => toggle(row.id)}
                          />
                          <span className="bankx-row__main">
                            <span className="bankx-row__title">
                              ПЛ-{row.number}
                              <span className="bankx-row__date">{shortDate(row.date)}</span>
                              {row.partTotal > 1 && (
                                <span className="admin-badge admin-badge--indigo">
                                  {row.partLabel} из {row.partTotal}
                                </span>
                              )}
                              {row.receiptNumber ? (
                                <span className="admin-badge admin-badge--muted">ПО-{row.receiptNumber}</span>
                              ) : null}
                              {row.isPaid ? (
                                <span className="admin-badge admin-badge--green">проведён</span>
                              ) : (
                                <span className="admin-badge admin-badge--amber">не проведён</span>
                              )}
                              {row.exportedAt && (
                                <span className="admin-badge admin-badge--blue">
                                  выгружен {shortDate(row.exportedAt)}
                                </span>
                              )}
                            </span>
                            <span className="bankx-row__cp">{row.counterparty}</span>
                            {row.purpose && <span className="bankx-row__purpose">{row.purpose}</span>}
                            {row.issue && (
                              <span className="bankx-row__issue">
                                <AlertTriangle size={12} /> {row.issue}
                              </span>
                            )}
                          </span>
                          <span className="bankx-row__sum">{fmt(row.amount)} ₽</span>
                        </label>
                      );
                    })
                  )}
                </div>

                <div className="bankx-note">
                  Показано {filtered.length}
                  {rows.length !== filtered.length ? ` из ${rows.length}` : ""} за {periodLabel}
                  {totals && allDates ? ` · всего платежей поставщикам: ${totals.count}` : ""}
                  {rows.length >= limit ? ` (лимит списка — ${limit})` : ""}
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
                {done && <div className="bankx-done">{done}</div>}

                <div className="admin-modal__actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setOpen(false)}
                    disabled={exporting}
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    onClick={handleExport}
                    disabled={exporting || selected.size === 0}
                  >
                    {exporting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    Выгрузить выбранное
                    {selected.size > 0 ? ` (${selected.size} · ${fmt(selectedSum)} ₽)` : ""}
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
