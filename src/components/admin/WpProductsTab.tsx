// =========================================================
// FILE: src/components/admin/WpProductsTab.tsx
// Учёт макулатуры → вкладка «Виды макулатуры».
//
// Справочник видов — единственный источник видов для приёмок/отгрузок:
// новые виды сразу появляются в формах документов, переименование меняет
// подписи во всех документах и в остатках, а цена за кг подставляется
// в строку документа по умолчанию.
//
// Удаление: вид без документов удаляется совсем; вид, по которому уже
// есть приёмки/отгрузки, скрывается (не предлагается в формах, но старые
// документы сохраняют название) — его можно вернуть кнопкой «Вернуть».
// =========================================================

"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Eye, EyeOff, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { WP_TYPE_LABELS, wpProductTypeKey, type WpProduct } from "@/lib/wastepaper-account-shared";

const PRICE_FMT = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

interface Props {
  products: WpProduct[];
  /** Обновлённый список после любой операции (для мгновенного отображения). */
  onChange: (products: WpProduct[]) => void;
  /** Перечитать данные с сервера (router.refresh()). */
  onSaved: () => void;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string" && data.error) return data.error;
  } catch {
    // тело не JSON — покажем запасной текст
  }
  return fallback;
}

function sortProducts(list: WpProduct[]): WpProduct[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export function WpProductsTab({ products, onChange, onSaved }: Props) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const active = useMemo(() => sortProducts(products.filter((p) => p.isActive)), [products]);
  const hidden = useMemo(() => sortProducts(products.filter((p) => !p.isActive)), [products]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  function resetForm() {
    setAdding(false);
    setEditingId(null);
    setName("");
    setPrice("");
  }

  function startAdd() {
    setError("");
    setEditingId(null);
    setName("");
    setPrice("");
    setAdding(true);
  }

  function startEdit(p: WpProduct) {
    setError("");
    setAdding(false);
    setEditingId(p.id);
    setName(p.name);
    setPrice(p.pricePerKg > 0 ? String(p.pricePerKg) : "");
  }

  function applySaved(item: WpProduct) {
    const exists = products.some((p) => p.id === item.id);
    onChange(exists ? products.map((p) => (p.id === item.id ? item : p)) : [...products, item]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Укажите название вида макулатуры");
      return;
    }
    const pricePerKg = Math.max(0, Number(String(price).replace(",", ".")) || 0);
    setBusy(true);
    setError("");
    try {
      const res = await fetch(editingId ? `/api/admin/wp/products/${editingId}` : "/api/admin/wp/products", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, pricePerKg }),
      });
      if (!res.ok) throw new Error(await readError(res, "Не удалось сохранить вид макулатуры"));
      const data = await res.json();
      if (data?.item) applySaved(data.item as WpProduct);
      setNotice(editingId ? `Вид «${trimmed}» сохранён` : `Вид «${trimmed}» добавлен`);
      resetForm();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить вид макулатуры");
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: WpProduct) {
    if (!confirm(`Удалить вид «${p.name}»?\n\nЕсли по нему уже есть приёмки или отгрузки, вид будет скрыт из форм, а документы сохранят название.`)) return;
    setRowBusy(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/wp/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Не удалось удалить вид макулатуры"));
      const data = await res.json();
      if (data?.mode === "hidden" && data.item) {
        onChange(products.map((x) => (x.id === p.id ? (data.item as WpProduct) : x)));
        setNotice(`Вид «${p.name}» скрыт: по нему есть документы. Его можно вернуть в списке скрытых.`);
      } else {
        onChange(products.filter((x) => x.id !== p.id));
        setNotice(`Вид «${p.name}» удалён`);
      }
      if (editingId === p.id) resetForm();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить вид макулатуры");
    } finally {
      setRowBusy(null);
    }
  }

  async function setActive(p: WpProduct, isActive: boolean) {
    setRowBusy(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/wp/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: p.name, pricePerKg: p.pricePerKg, isActive }),
      });
      if (!res.ok) throw new Error(await readError(res, "Не удалось изменить вид макулатуры"));
      const data = await res.json();
      if (data?.item) applySaved(data.item as WpProduct);
      setNotice(isActive ? `Вид «${p.name}» снова доступен в документах` : `Вид «${p.name}» скрыт из форм`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось изменить вид макулатуры");
    } finally {
      setRowBusy(null);
    }
  }

  const formOpen = adding || editingId !== null;

  const form = (
    <form
      onSubmit={save}
      className="admin-card"
      style={{ padding: 16, marginBottom: 16, display: "grid", gap: 10 }}
    >
      <div style={{ fontWeight: 800, fontSize: 14 }}>
        {editingId ? "Изменить вид макулатуры" : "Новый вид макулатуры"}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="admin-field" style={{ flex: "2 1 240px", margin: 0 }}>
          <span className="admin-label">Название</span>
          <input
            className="admin-input"
            placeholder="Например, картон гофрированный"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={200}
            required
          />
        </label>
        <label className="admin-field" style={{ flex: "1 1 150px", margin: 0 }}>
          <span className="admin-label">Цена за кг, ₽</span>
          <input
            className="admin-input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="admin-btn admin-btn--primary" type="submit" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {editingId ? "Сохранить" : "Добавить"}
          </button>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={resetForm} disabled={busy}>
            <X size={15} /> Отмена
          </button>
        </div>
      </div>
      <p className="admin-sub" style={{ margin: 0 }}>
        Цена подставляется в строку приёмки/отгрузки по умолчанию — её можно поменять в самом документе.
      </p>
    </form>
  );

  function renderRow(p: WpProduct, isHidden: boolean) {
    const key = wpProductTypeKey(p);
    const legacy = Boolean(WP_TYPE_LABELS[key]);
    const isBusy = rowBusy === p.id;
    return (
      <tr key={p.id} style={isHidden ? { opacity: 0.65 } : undefined}>
        <td>
          <div style={{ fontWeight: 700 }}>{p.name}</div>
          {legacy && (
            <div className="admin-sub" style={{ margin: 0, fontSize: 11 }}>
              Исходный вид · тариф калькулятора сайта «{WP_TYPE_LABELS[key]}»
            </div>
          )}
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {p.pricePerKg > 0 ? `${PRICE_FMT.format(p.pricePerKg)} ₽/кг` : <span className="admin-sub">не задана</span>}
        </td>
        <td>
          {isHidden ? (
            <span className="admin-badge admin-badge--muted">скрыт</span>
          ) : (
            <span className="admin-badge admin-badge--green">в документах</span>
          )}
        </td>
        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          {isBusy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : isHidden ? (
            <>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setActive(p, true)}
                title="Вернуть в документы"
              >
                <RotateCcw size={13} /> Вернуть
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => remove(p)}
                title="Удалить окончательно (если нет документов)"
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => startEdit(p)}
                title="Изменить название или цену"
              >
                <Pencil size={13} /> Изменить
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setActive(p, false)}
                title="Скрыть из форм, документы сохранятся"
              >
                <EyeOff size={13} />
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => remove(p)}
                title="Удалить"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h2 className="admin-h2">Виды макулатуры</h2>
          <p className="admin-sub">
            Справочник видов для приёмок и отгрузок. Цена указывается за килограмм и не смешивается с товарами сайта.
          </p>
        </div>
        <button className="admin-btn admin-btn--primary" type="button" onClick={startAdd} disabled={busy}>
          <Plus size={15} /> Добавить вид
        </button>
      </div>

      {error && (
        <div className="admin-error" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <AlertCircle size={16} /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div style={{ marginBottom: 12 }}>
          <span className="admin-success">
            <Check size={14} /> {notice}
          </span>
        </div>
      )}

      {formOpen && form}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Вид</th>
              <th>Цена за кг</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <div className="admin-empty" style={{ padding: 20 }}>
                    <p>
                      Активных видов нет. Добавьте вид — он сразу появится в формах приёмки и отгрузки.
                    </p>
                  </div>
                </td>
              </tr>
            )}
            {active.map((p) => renderRow(p, false))}
          </tbody>
        </table>
      </div>

      {hidden.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
            {showHidden ? "Скрыть список" : `Скрытые виды (${hidden.length})`}
          </button>
          {showHidden && (
            <div className="admin-table-wrap" style={{ marginTop: 10 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Вид</th>
                    <th>Цена за кг</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>{hidden.map((p) => renderRow(p, true))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
