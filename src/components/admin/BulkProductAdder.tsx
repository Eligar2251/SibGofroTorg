// =========================================================
// FILE: src/components/admin/BulkProductAdder.tsx
// Массовое добавление НОВЫХ товаров: таблица-грид с основным
// набором полей (название, артикул, цена, размеры Д×Ш×В,
// количество). Вставка из Excel/таблицы поддерживается:
// скопируйте диапазон ячеек и вставьте в нужную ячейку —
// данные разложатся вправо и вниз. Всё остальное админ
// доредактирует в «Массовом редактировании».
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  ClipboardPaste,
  Eraser,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

interface Row {
  name: string;
  sku: string;
  price: string;
  length: string;
  width: string;
  height: string;
  stock: string;
}

const EMPTY_ROW = (): Row => ({
  name: "",
  sku: "",
  price: "",
  length: "",
  width: "",
  height: "",
  stock: "",
});

const COLS: { key: keyof Row; label: string; placeholder: string; width: number }[] = [
  { key: "name", label: "Название *", placeholder: "Короб гофрокартон…", width: 260 },
  { key: "sku", label: "Артикул", placeholder: "АРТ-001", width: 110 },
  { key: "price", label: "Цена, ₽", placeholder: "0", width: 90 },
  { key: "length", label: "Длина, мм", placeholder: "", width: 90 },
  { key: "width", label: "Ширина, мм", placeholder: "", width: 90 },
  { key: "height", label: "Высота, мм", placeholder: "", width: 90 },
  { key: "stock", label: "Кол-во", placeholder: "0", width: 80 },
];

export function BulkProductAdder({ adminPath }: { adminPath: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: 10 }, EMPTY_ROW)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<null | {
    created: number;
    total: number;
    errors: { row: number; name: string; error: string }[];
  }>(null);

  const filledCount = useMemo(
    () => rows.filter((r) => r.name.trim()).length,
    [rows]
  );

  function setCell(rowIdx: number, key: keyof Row, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r))
    );
  }

  /** Вставка из Excel: TSV/CSV-матрица раскладывается от ячейки вправо и вниз. */
  function handlePaste(rowIdx: number, colIdx: number, e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text");
    if (!text || !text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const matrix = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line, idx, arr) => line.trim() !== "" || idx < arr.length - 1)
      .map((line) => line.split("\t"));

    setRows((prev) => {
      const next = [...prev];
      // Добавляем строки, если матрица не влезает.
      while (next.length < rowIdx + matrix.length) next.push(EMPTY_ROW());
      matrix.forEach((cells, r) => {
        const target = { ...next[rowIdx + r] };
        cells.forEach((value, c) => {
          const col = COLS[colIdx + c];
          if (!col) return;
          target[col.key] = value.trim();
        });
        next[rowIdx + r] = target;
      });
      return next;
    });
  }

  function addRows(count: number) {
    setRows((prev) => [...prev, ...Array.from({ length: count }, EMPTY_ROW)]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearAll() {
    if (!confirm("Очистить все строки?")) return;
    setRows(Array.from({ length: 10 }, EMPTY_ROW));
    setResult(null);
    setError("");
  }

  async function create() {
    const products = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        sku: r.sku.trim() || null,
        price: r.price.trim() || null,
        dimensionLength: r.length.trim() || null,
        dimensionWidth: r.width.trim() || null,
        dimensionHeight: r.height.trim() || null,
        stockQty: r.stock.trim() || null,
      }));
    if (products.length === 0) {
      setError("Заполните хотя бы одно название товара");
      return;
    }
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/admin/products/bulk-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      setResult(data);
      // Созданные строки убираем: оставляем только те, что с ошибками.
      if (data.errors?.length) {
        const failedRows = new Set(data.errors.map((e: any) => e.row - 1));
        setRows(
          rows.filter((r, i) => !r.name.trim() || failedRows.has(i))
        );
      } else {
        setRows(Array.from({ length: 10 }, EMPTY_ROW));
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-card">
        <div className="admin-card__head">
          <h3 className="admin-card__title">
            Новые товары · заполнено строк: {filledCount}
          </h3>
          <span className="admin-muted" style={{ fontSize: 13 }}>
            <ClipboardPaste size={13} style={{ verticalAlign: "-2px" }} /> Можно
            вставлять прямо из Excel: скопируйте ячейки (название, артикул, цена,
            Д, Ш, В, кол-во) и нажмите Ctrl+V в нужной ячейке
          </span>
        </div>
        <div className="admin-card__pad" style={{ overflowX: "auto" }}>
          <table className="admin-table bulk-add-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>№</th>
                {COLS.map((c) => (
                  <th key={c.key} style={{ minWidth: c.width }}>
                    {c.label}
                  </th>
                ))}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="admin-muted">{ri + 1}</td>
                  {COLS.map((c, ci) => (
                    <td key={c.key} style={{ padding: 2 }}>
                      <input
                        className="admin-input"
                        style={{ minWidth: c.width - 16 }}
                        value={row[c.key]}
                        placeholder={c.placeholder}
                        onChange={(e) => setCell(ri, c.key, e.target.value)}
                        onPaste={(e) => handlePaste(ri, ci, e)}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="admin-btn admin-btn--icon admin-btn--ghost"
                      title="Удалить строку"
                      onClick={() => removeRow(ri)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-filters">
        <button
          type="button"
          className="admin-btn admin-btn--outline"
          onClick={() => addRows(1)}
        >
          <Plus size={14} /> Строка
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--outline"
          onClick={() => addRows(10)}
        >
          <Plus size={14} /> 10 строк
        </button>
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={clearAll}
        >
          <Eraser size={14} /> Очистить
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={saving || filledCount === 0}
          onClick={create}
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          Создать товары ({filledCount})
        </button>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {result && (
        <div className="admin-card">
          <div className="admin-card__pad">
            {result.errors.length === 0 ? (
              <div className="admin-success">
                <CheckCircle size={16} /> Создано товаров: {result.created} из{" "}
                {result.total}. Штрихкоды сгенерированы автоматически. Остальные
                поля (фото, описание, опт и т.д.) — в «Массовом редактировании».
              </div>
            ) : (
              <>
                <div className="admin-success" style={{ marginBottom: 8 }}>
                  <CheckCircle size={16} /> Создано: {result.created} из{" "}
                  {result.total}
                </div>
                <div className="admin-error" style={{ marginBottom: 6 }}>
                  Не создано: {result.errors.length}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {result.errors.map((e) => (
                    <li key={`${e.row}-${e.name}`}>
                      Строка {e.row} «{e.name}»: {e.error}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div style={{ marginTop: 10 }}>
              <a
                className="admin-btn admin-btn--outline"
                href={`/${adminPath}/products/bulk`}
                style={{ textDecoration: "none" }}
              >
                Перейти к массовому редактированию
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
