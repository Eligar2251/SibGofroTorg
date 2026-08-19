// =========================================================
// FILE: src/components/admin/BulkDealImporter.tsx
// Массовая загрузка старых проведённых заказов контрагентов.
//
// Логика:
//  - выбираем или вписываем контрагента (создастся автоматически);
//  - заполняем таблицу: дата · товар · количество · цена → сумма строки;
//  - строки группируются по дате: одна дата = один архивный заказ;
//  - заказы создаются проведёнными (completed) и помечаются is_archive:
//    склад и банк не затрагиваются, суммы видны в отчётах и прогнозе.
// =========================================================

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  CalendarRange,
  UserRound,
  Info,
} from "lucide-react";
import type { PickerProduct } from "@/components/admin/ProductPicker";
import { SearchCombobox, type PickerOption } from "@/components/admin/SearchPicker";
import type { CounterpartyOption } from "@/components/admin/WarehouseCounterparties";

interface ImportRow {
  id: string;
  date: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: string;
  price: string;
}

const fmt = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `imp-${Date.now()}-${rowSeq}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function lineTotal(row: ImportRow): number {
  return (Number(row.quantity) || 0) * (Number(row.price) || 0);
}

export function BulkDealImporter({
  products,
  counterparties,
  adminPath,
}: {
  products: PickerProduct[];
  counterparties: CounterpartyOption[];
  adminPath: string;
}) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [defaultDate, setDefaultDate] = useState(todayIso());
  const [comment, setComment] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    created: number;
    totalSum: number;
    firstNumber: number;
    lastNumber: number;
  } | null>(null);

  const customerOptions: PickerOption[] = useMemo(
    () =>
      counterparties
        .filter((c) => c.roles.includes("customer"))
        .map((c) => ({
          id: c.id,
          title: c.name,
          meta: c.inn ? `ИНН ${c.inn}` : c.phone || undefined,
          right: c.address || undefined,
        })),
    [counterparties]
  );

  const productOptions: PickerOption[] = useMemo(
    () =>
      products.map((p) => ({
        id: p.id,
        title: p.name,
        meta: p.sku ? `Артикул ${p.sku}` : undefined,
        right: p.priceWholesale ? `${fmt(p.priceWholesale)} ₽` : undefined,
        keywords: p.sku || undefined,
      })),
    [products]
  );

  function addRow(date = defaultDate) {
    setRows((prev) => [
      ...prev,
      {
        id: nextRowId(),
        date,
        productId: null,
        name: "",
        sku: null,
        quantity: "1",
        price: "",
      },
    ]);
  }

  function updateRow(id: string, patch: Partial<ImportRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function pickProduct(rowId: string, value: string, option?: PickerOption) {
    if (option) {
      const product = products.find((p) => p.id === option.id);
      updateRow(rowId, {
        productId: product?.id ?? null,
        name: option.title,
        sku: product?.sku ?? null,
        // Подставляем оптовую цену (если есть), иначе обычную — её можно поправить
        price: product
          ? String(product.priceWholesale ?? product.price ?? "")
          : "",
      });
    } else {
      updateRow(rowId, { productId: null, name: value, sku: null });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, rowId: string) {
    if (e.key !== "Enter") return;
    const target = e.target as HTMLInputElement;
    // Enter в поле цены = быстрый переход к следующей строке
    e.preventDefault();
    if (target.name === "price") {
      addRow();
    }
  }

  const totals = useMemo(() => {
    const filled = rows.filter((r) => r.name.trim() && (Number(r.quantity) || 0) > 0);
    const sum = filled.reduce((s, r) => s + lineTotal(r), 0);
    const orderCount = new Set(filled.map((r) => r.date)).size;
    return { filled: filled.length, sum, orderCount };
  }, [rows]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    if (!customerName.trim()) {
      setError("Укажите контрагента — выберите из списка или впишите нового");
      return;
    }
    if (totals.filled === 0) {
      setError("Добавьте хотя бы одну строку: товар, количество и цену");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/warehouse/deals/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          comment: comment.trim() || null,
          rows: rows
            .filter((r) => r.name.trim() && (Number(r.quantity) || 0) > 0)
            .map((r) => ({
              date: r.date,
              productId: r.productId,
              name: r.name.trim(),
              sku: r.sku,
              quantity: Number(r.quantity) || 0,
              price: Number(r.price) || 0,
            })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось загрузить заказы");
        setSaving(false);
        return;
      }
      setResult({
        created: data.created ?? 0,
        totalSum: data.totalSum ?? 0,
        firstNumber: data.deals?.[0]?.number ?? 0,
        lastNumber: data.deals?.[data.deals.length - 1]?.number ?? 0,
      });
      // Очищаем таблицу, контрагента и дату оставляем — удобно загружать
      // следующего контрагента/следующую партию
      setRows([]);
      setComment("");
      router.refresh();
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1 className="admin-h1">Массовая загрузка заказов</h1>
          <p className="admin-sub">
            Старые проведённые заказы контрагентов — вне складского учёта. Суммы попадают в отчёты и прогноз выручки.
          </p>
        </div>
      </div>

      <div className="admin-card" style={{ marginBottom: 14 }}>
        <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--adm-muted)", lineHeight: 1.6, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--adm-steel)" }} />
          <span>
            Строки группируются по дате: <b>одна дата = один заказ</b> (например, все строки за 15.04.2024 — это один заказ с несколькими позициями).
            Заказы сохраняются как <b>проведённые (архив)</b>: остатки склада и банк не изменяются, контрагент добавляется в справочник автоматически.
          </span>
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div className="admin-card">
          <div className="admin-card__head">
            <h3 className="admin-card__title">1. Контрагент</h3>
          </div>
          <div className="admin-card__pad">
            <div className="imp-grid imp-grid--customer">
              <div className="admin-field" style={{ gridColumn: "1 / -1" }}>
                <label className="admin-label">
                  <UserRound size={12} style={{ verticalAlign: "-1px" }} /> Покупатель (контрагент) *
                </label>
                <SearchCombobox
                  options={customerOptions}
                  value={customerName}
                  onChange={setCustomerName}
                  placeholder="Выберите или впишите нового контрагента..."
                  emptyText="Нового контрагента — просто впишите название, он создастся автоматически"
                  required
                />
                {customerName.trim() &&
                  !customerOptions.some(
                    (o) => o.title.toLocaleLowerCase("ru-RU") === customerName.trim().toLocaleLowerCase("ru-RU")
                  ) && (
                    <span className="admin-hint" style={{ marginTop: 4, color: "var(--adm-kraft)" }}>
                      Контрагент будет создан автоматически при загрузке
                    </span>
                  )}
              </div>
              <div className="admin-field">
                <label className="admin-label">
                  <CalendarRange size={12} style={{ verticalAlign: "-1px" }} /> Дата по умолчанию
                </label>
                <input
                  type="date"
                  className="admin-input"
                  value={defaultDate}
                  onChange={(e) => setDefaultDate(e.target.value)}
                />
                <span className="admin-hint">Проставляется новым строкам, можно менять в каждой строке</span>
              </div>
              <div className="admin-field">
                <label className="admin-label">Комментарий к партии (необязательно)</label>
                <input
                  type="text"
                  className="admin-input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Например: перенос из старой тетради за 2024 год"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="admin-card" style={{ marginTop: 14 }}>
          <div className="admin-card__head">
            <h3 className="admin-card__title">2. Позиции</h3>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => addRow()}
            >
              <Plus size={14} /> Добавить строку
            </button>
          </div>
          <div className="admin-card__pad">
            {rows.length === 0 ? (
              <div className="admin-empty" style={{ padding: 24 }}>
                <div className="admin-empty__icon"><Upload size={32} /></div>
                <p>Таблица пуста — добавьте первую строку</p>
              </div>
            ) : (
              <div className="admin-table-wrap imp-table-wrap">
                <table className="admin-table imp-table">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Дата</th>
                      <th>Товар</th>
                      <th style={{ width: 110 }}>Кол-во</th>
                      <th style={{ width: 140 }}>Цена, ₽</th>
                      <th style={{ width: 140 }}>Сумма</th>
                      <th style={{ width: 48 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={row.id}>
                        <td>
                          <input
                            type="date"
                            className="admin-input"
                            value={row.date}
                            onChange={(e) => updateRow(row.id, { date: e.target.value })}
                          />
                        </td>
                        <td>
                          <SearchCombobox
                            options={productOptions}
                            value={row.name}
                            onChange={(value, option) => pickProduct(row.id, value, option)}
                            placeholder="Товар или артикул..."
                            emptyText="Нет в каталоге — можно вписать название вручную"
                          />
                          {row.productId && row.sku && (
                            <span className="admin-hint" style={{ marginTop: 2 }}>
                              {row.sku}
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            className="admin-input"
                            min={0.01}
                            step="any"
                            name="quantity"
                            value={row.quantity}
                            onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="admin-input"
                            min={0}
                            step="any"
                            name="price"
                            value={row.price}
                            onChange={(e) => updateRow(row.id, { price: e.target.value })}
                            onKeyDown={(e) => handleKeyDown(e, row.id)}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="imp-table__sum">
                          {lineTotal(row) > 0 ? `${fmt(lineTotal(row))} ₽` : "—"}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="wh-item-row__del"
                            onClick={() => removeRow(row.id)}
                            aria-label="Удалить строку"
                            title="Удалить строку"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="imp-totals">
              <span>
                Строк: <b>{totals.filled}</b> · заказов (по датам): <b>{totals.orderCount}</b>
              </span>
              <span className="imp-totals__sum">
                Итого: <b>{fmt(totals.sum)} ₽</b>
              </span>
            </div>

            {error && <div className="wh-form-error">{error}</div>}

            {result && (
              <div className="imp-success">
                <CheckCircle2 size={16} />
                <span>
                  Загружено <b>{result.created}</b> {result.created === 1 ? "заказ" : result.created < 5 ? "заказа" : "заказов"} на{" "}
                  <b>{fmt(result.totalSum)} ₽</b>
                  {result.firstNumber > 0 &&
                    (result.firstNumber === result.lastNumber
                      ? ` · ЗК-${result.firstNumber}`
                      : ` · ЗК-${result.firstNumber}…ЗК-${result.lastNumber}`)}
                  . Суммы уже учитываются в отчётах и прогнозе выручки.
                </span>
              </div>
            )}

            <div className="wh-form-footer" style={{ marginTop: 14 }}>
              <LinkToDeals adminPath={adminPath} />
              <div className="admin-form-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost"
                  onClick={() => {
                    setRows([]);
                    setError("");
                    setResult(null);
                  }}
                  disabled={saving}
                >
                  Очистить
                </button>
                <button
                  type="submit"
                  className="admin-btn admin-btn--primary"
                  disabled={saving || rows.length === 0}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Загрузить {totals.filled > 0 ? `${totals.orderCount} зак.` : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function LinkToDeals({ adminPath }: { adminPath: string }) {
  return (
    <span className="admin-hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <CalendarRange size={12} />
      После загрузки заказы появятся в Учёт → Заказы (архив) и в отчётах.
      <a href={`/${adminPath}/warehouse?tab=deals`} style={{ color: "var(--adm-kraft)", fontWeight: 600 }}>
        Открыть заказы →
      </a>
    </span>
  );
}
