"use client";

// =========================================================
// FILE: src/components/admin/DatabaseBrowser.tsx
// Раздел «База Данных»: все таблицы в одном месте.
//
// Просмотр уже существующих данных, правка значений прямо в таблице
// и удаление строки кнопкой с подтверждением (параллельно DELETE в
// Supabase). Без SQL и без выдачи прав.
// =========================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type {
  DatabaseColumn,
  DatabaseTableMeta,
} from "@/lib/admin-database";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";

type CellValue = unknown;

type TableData = {
  table: string;
  label: string;
  group: string;
  editable: boolean;
  ownerOnly: boolean;
  primaryKey: string | null;
  columns: DatabaseColumn[];
  rows: Record<string, CellValue>[];
  total: number;
  limit: number;
  offset: number;
};

type EditingCell = {
  rowKey: string;
  column: string;
  value: string;
  /** Исходное значение — чтобы не писать в базу, если ничего не изменилось. */
  original: string;
  type: DatabaseColumn["type"];
};

/** Значение для отправки на сервер: пустая строка ≠ «ничего не меняем». */
function cellPayload(cell: EditingCell): unknown {
  if (cell.type === "boolean") {
    if (cell.value === "true") return true;
    if (cell.value === "false") return false;
    return null;
  }
  return cell.value;
}

const PAGE_SIZES = [25, 50, 100, 200];

function keyOf(row: Record<string, CellValue>, primaryKey: string | null): string {
  if (!primaryKey) return "";
  return String(row?.[primaryKey] ?? "");
}

function isNull(value: CellValue): boolean {
  return value === null || value === undefined;
}

function displayValue(value: CellValue): string {
  if (isNull(value)) return "—";
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function DatabaseBrowser() {
  const [tables, setTables] = useState<DatabaseTableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tableSearch, setTableSearch] = useState("");
  const [activeTable, setActiveTable] = useState<string | null>(null);

  const [data, setData] = useState<TableData | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pageSize, setPageSize] = useState(50);
  const [offset, setOffset] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [saving, setSaving] = useState<{ rowKey: string; column: string } | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Список таблиц
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTablesLoading(true);
      try {
        const response = await fetch("/api/admin/database", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить таблицы");
        if (cancelled) return;
        setTables(Array.isArray(body.tables) ? body.tables : []);
        setActiveTable((current) => current || body.tables?.[0]?.name || null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить таблицы");
        }
      } finally {
        if (!cancelled) setTablesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Поиск по строкам — с небольшой задержкой, чтобы не долбить базу
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setOffset(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const loadRows = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!activeTable) return;
      if (!options?.silent) setRowsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset),
        });
        if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
        if (sortColumn) {
          params.set("sort", sortColumn);
          params.set("dir", sortDir);
        }
        const response = await fetch(
          `/api/admin/database/${encodeURIComponent(activeTable)}?${params}`,
          { cache: "no-store" }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Не удалось прочитать таблицу");
        setData(body as TableData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось прочитать таблицу");
        setData(null);
      } finally {
        setRowsLoading(false);
      }
    },
    [activeTable, pageSize, offset, debouncedSearch, sortColumn, sortDir]
  );

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = setTimeout(() => setSavedFlash(null), 1600);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  const groupedTables = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    const filtered = tables.filter((table) => {
      if (!query) return true;
      return (
        table.label.toLowerCase().includes(query) ||
        table.name.toLowerCase().includes(query)
      );
    });
    const groups = new Map<string, DatabaseTableMeta[]>();
    for (const table of filtered) {
      const list = groups.get(table.group) || [];
      list.push(table);
      groups.set(table.group, list);
    }
    return [...groups.entries()];
  }, [tables, tableSearch]);

  function selectTable(name: string) {
    if (name === activeTable) return;
    setActiveTable(name);
    setOffset(0);
    setSortColumn(null);
    setSortDir("desc");
    setSearch("");
    setEditing(null);
    setSuccess("");
    setError("");
  }

  function toggleSort(column: string) {
    if (sortColumn === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDir("asc");
    }
    setOffset(0);
  }

  function beginEdit(row: Record<string, CellValue>, column: DatabaseColumn) {
    if (!data?.editable || !column.editable) return;
    const rowKey = keyOf(row, data.primaryKey);
    if (!rowKey) return;
    const value = row[column.name];
    const asText = isNull(value)
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
    setEditing({
      rowKey,
      column: column.name,
      value: asText,
      original: asText,
      type: column.type,
    });
    setError("");
  }

  async function saveCell() {
    if (!editing || !data) return;
    const cell = editing;
    if (cell.value === cell.original) {
      setEditing(null);
      return;
    }
    setSaving({ rowKey: cell.rowKey, column: cell.column });
    setError("");
    try {
      const response = await fetch(
        `/api/admin/database/${encodeURIComponent(data.table)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: cell.rowKey,
            column: cell.column,
            value: cellPayload(cell),
          }),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить значение");
      setSavedFlash(`${cell.rowKey}:${cell.column}`);
      setEditing(null);
      // Подменяем строку на месте: без перезагрузки всей таблицы.
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((row) =>
                keyOf(row, prev.primaryKey) === cell.rowKey ? { ...row, ...body.row } : row
              ),
            }
          : prev
      );
      setSuccess("Значение сохранено");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить значение");
    } finally {
      setSaving(null);
    }
  }

  const pk = data?.primaryKey || null;
  const total = data?.total || 0;
  const page = Math.floor(offset / pageSize) + 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const canEditTable = Boolean(data?.editable && pk);
  const canDelete = Boolean(pk);

  // Удаление строки с подтверждением
  const [deleteTarget, setDeleteTarget] = useState<{ rowKey: string; row: Record<string, CellValue> } | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEscapeClose(() => setDeleteTarget(null), !!deleteTarget);

  async function confirmDelete() {
    if (!deleteTarget || !data) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/database/${encodeURIComponent(data.table)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: deleteTarget.rowKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Не удалось удалить запись");
      // Убираем строку из локального состояния без перезагрузки
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.filter((r) => keyOf(r, prev.primaryKey) !== deleteTarget.rowKey),
              total: Math.max(0, prev.total - 1),
            }
          : prev
      );
      setDeleteTarget(null);
      setSuccess("Запись удалена из базы и Supabase");
      setTimeout(() => setSuccess(""), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить запись");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="db-browser">
      {/* ── Таблицы ── */}
      <aside className="db-browser__sidebar">
        <div className="db-browser__search">
          <Search size={14} />
          <input
            className="admin-input"
            placeholder="Найти таблицу…"
            value={tableSearch}
            onChange={(event) => setTableSearch(event.target.value)}
          />
        </div>
        <div className="db-browser__list">
          {tablesLoading ? (
            <div className="db-browser__empty">
              <Loader2 size={16} className="animate-spin" /> Загружаем таблицы…
            </div>
          ) : groupedTables.length === 0 ? (
            <div className="db-browser__empty">Таблицы не найдены</div>
          ) : (
            groupedTables.map(([group, items]) => (
              <div key={group}>
                <div className="db-browser__group">{group}</div>
                {items.map((table) => (
                  <button
                    key={table.name}
                    type="button"
                    className={`db-browser__item${
                      table.name === activeTable ? " db-browser__item--active" : ""
                    }`}
                    onClick={() => selectTable(table.name)}
                    title={table.name}
                  >
                    <span className="db-browser__item-name">{table.label}</span>
                    <code>{table.name}</code>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Данные ── */}
      <section className="db-browser__main">
        <div className="db-browser__toolbar">
          <div className="db-browser__search" style={{ flex: "0 1 260px" }}>
            <Search size={14} />
            <input
              className="admin-input"
              placeholder={activeTable ? "Поиск по таблице…" : "Выберите таблицу"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!activeTable}
            />
          </div>
          <select
            className="admin-input"
            style={{ maxWidth: 130 }}
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setOffset(0);
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} строк
              </option>
            ))}
          </select>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => void loadRows()}
            disabled={!activeTable || rowsLoading}
          >
            {rowsLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Обновить
          </button>
          <span className="db-browser__spacer" />
          {data?.ownerOnly && (
            <span className="db-browser__badge db-browser__badge--owner">
              <ShieldCheck size={12} /> только владелец
            </span>
          )}
          {data && (
            <span className="db-browser__meta">
              {data.label} · {total.toLocaleString("ru-RU")} строк
            </span>
          )}
        </div>

        {error && (
          <p className="admin-error" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <AlertTriangle size={14} /> {error}
          </p>
        )}
        {success && !error && (
          <p className="db-browser__legend" style={{ color: "var(--adm-pine)", fontWeight: 600 }}>
            {success} · {savedFlash ? "строка обновлена" : ""}
          </p>
        )}

        {!activeTable ? (
          <div className="admin-card db-browser__empty">
            <Database size={22} style={{ marginBottom: 8 }} />
            <div>Выберите таблицу слева — данные появятся здесь.</div>
          </div>
        ) : rowsLoading && !data ? (
          <div className="admin-card db-browser__empty">
            <Loader2 size={18} className="animate-spin" /> Читаем данные…
          </div>
        ) : !data || data.columns.length === 0 ? (
          <div className="admin-card db-browser__empty">В таблице пока нет данных</div>
        ) : (
          <div className="db-browser__table-wrap">
            <table className="db-browser__table">
              <thead>
                <tr>
                  <th className="db-browser__row-num">#</th>
                  {data.columns.map((column) => (
                    <th key={column.name}>
                      <button type="button" onClick={() => toggleSort(column.name)}>
                        {sortColumn === column.name ? (
                          sortDir === "asc" ? (
                            <ArrowUp size={11} />
                          ) : (
                            <ArrowDown size={11} />
                          )
                        ) : null}
                        {column.name}
                        {column.primaryKey ? " · id" : ""}
                      </button>
                    </th>
                  ))}
                  {canDelete && <th style={{ width: 46, textAlign: "center" }}>⋯</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td
                      className="db-browser__empty"
                      colSpan={data.columns.length + (canDelete ? 2 : 1)}
                    >
                      Ничего не найдено
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row, index) => {
                    const rowKey = keyOf(row, pk);
                    return (
                      <tr
                        key={rowKey || index}
                        className={rowKey && pk === "id" ? "db-browser__row--primary" : ""}
                      >
                        <td className="db-browser__row-num">{offset + index + 1}</td>
                        {data.columns.map((column) => {
                          const isEditing =
                            editing &&
                            editing.rowKey === rowKey &&
                            editing.column === column.name;
                          const isSaving =
                            saving &&
                            saving.rowKey === rowKey &&
                            saving.column === column.name;
                          const value = row[column.name];
                          const editable = canEditTable && column.editable && rowKey;

                          return (
                            <td
                              key={column.name}
                              className={[
                                "db-browser__cell",
                                typeof value === "number" ? "db-browser__cell--number" : "",
                                typeof value === "boolean" ? "db-browser__cell--bool" : "",
                                value === true ? "db-browser__cell--bool-true" : "",
                                value === false ? "db-browser__cell--bool-false" : "",
                                isNull(value) ? "db-browser__cell--null" : "",
                                isSaving ? "db-browser__cell--saving" : "",
                                editable
                                  ? "db-browser__cell--editable"
                                  : "db-browser__cell--readonly",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              onDoubleClick={() => beginEdit(row, column)}
                              onClick={() => {
                                if (!editable) return;
                                if (isEditing) return;
                                beginEdit(row, column);
                              }}
                              title={
                                editable
                                  ? "Нажмите, чтобы изменить значение"
                                  : displayValue(value)
                              }
                            >
                              {isEditing ? (
                                column.type === "boolean" ? (
                                  <select
                                    className="db-browser__cell-select"
                                    value={editing!.value}
                                    autoFocus
                                    onChange={(event) =>
                                      setEditing({ ...editing!, value: event.target.value })
                                    }
                                    onBlur={() => setEditing(null)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveCell();
                                      }
                                      if (event.key === "Escape") setEditing(null);
                                    }}
                                  >
                                    <option value="true">да</option>
                                    <option value="false">нет</option>
                                    <option value="">пусто</option>
                                  </select>
                                ) : (
                                  <input
                                    ref={inputRef}
                                    className="db-browser__cell-input"
                                    value={editing!.value}
                                    onChange={(event) =>
                                      setEditing({ ...editing!, value: event.target.value })
                                    }
                                    onBlur={() => void saveCell()}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveCell();
                                      }
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        setEditing(null);
                                      }
                                    }}
                                  />
                                )
                              ) : (
                                <span className="db-browser__cell-text">
                                  {displayValue(value)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        {canDelete && (
                          <td className="db-browser__cell db-browser__cell--action" style={{ padding: "4px 6px", textAlign: "center", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              className="admin-btn admin-btn--icon admin-btn--ghost"
                              style={{ width: 28, height: 28, borderRadius: 7 }}
                              title={rowKey ? `Удалить запись ${rowKey}` : "Удалить"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!rowKey) return;
                                setDeleteTarget({ rowKey, row });
                              }}
                              disabled={!rowKey}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="db-browser__footer">
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
            disabled={offset === 0 || rowsLoading}
          >
            <ChevronLeft size={13} /> Назад
          </button>
          <span className="db-browser__meta">
            Страница {page} из {pages}
          </span>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setOffset(offset + pageSize)}
            disabled={offset + pageSize >= total || rowsLoading}
          >
            Вперёд <ChevronRight size={13} />
          </button>
          <span className="db-browser__spacer" />
          <span className="db-browser__legend" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {canDelete ? (
              <>
                <Trash2 size={12} /> Удаление — кнопкой <Trash2 size={10} style={{ verticalAlign: "-1px" }} /> справа от строки с подтверждением. Данные удаляются из Supabase параллельно.
              </>
            ) : canEditTable ? (
              <>
                <Pencil size={12} /> Нажмите на ячейку, чтобы отредактировать.
              </>
            ) : (
              <>
                <Table2 size={12} /> Таблица открыта только для просмотра.
              </>
            )}
          </span>
        </div>
      </section>

      {deleteTarget && (
        <ModalPortal>
          <div className="admin-modal-overlay" data-admin="true" onClick={() => !deleting && setDeleteTarget(null)}>
            <div className="admin-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal__head">
                <h3 className="admin-modal__title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Trash2 size={16} style={{ color: "var(--adm-rust)" }} />
                  Удалить запись?
                </h3>
                <button className="admin-modal__close" onClick={() => !deleting && setDeleteTarget(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="admin-modal__desc" style={{ lineHeight: 1.5 }}>
                Таблица <b style={{ color: "var(--adm-ink)" }}>{data?.label || data?.table}</b>
                {pk ? (
                  <>
                    {" "}
                    · ключ <code>{pk} = {deleteTarget.rowKey}</code>
                  </>
                ) : null}
                <br />
                Запись будет <b style={{ color: "var(--adm-rust)" }}>удалена навсегда</b> из Supabase. Действие необратимо — при ошибке со связями
                база вернёт ошибку (например, арендатор с начислениями).
              </div>
              <div style={{ background: "var(--adm-paper)", border: "1px solid var(--adm-border)", borderRadius: 8, padding: 10, margin: "0 20px", maxHeight: 160, overflow: "auto" }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--adm-muted)", marginBottom: 6 }}>Содержимое строки</div>
                <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, monospace", color: "var(--adm-ink-soft)" }}>
                  {JSON.stringify(deleteTarget.row, null, 2).slice(0, 900)}
                  {JSON.stringify(deleteTarget.row, null, 2).length > 900 ? "\n… (обрезано)" : ""}
                </pre>
              </div>
              <div className="admin-modal__actions">
                <button className="admin-btn admin-btn--ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                  Отмена
                </button>
                <button className="admin-btn admin-btn--danger" onClick={confirmDelete} disabled={deleting} style={{ minWidth: 140 }}>
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {deleting ? "Удаляем…" : "Удалить навсегда"}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
