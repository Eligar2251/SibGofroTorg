"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Pencil, Check, X } from "lucide-react";
import type { CustomerDeal, WarehouseReceipt, WarehouseStockRow } from "@/lib/warehouse-shared";

const r = (n: number) => Math.round(n * 100) / 100;
const m = (n: number) => `${r(n).toLocaleString("ru-RU")} ₽`;

export function ProductSalesPopularity({
  deals,
  receipts,
  stock = [],
  from,
  to,
}: {
  deals: CustomerDeal[];
  receipts: WarehouseReceipt[];
  stock?: WarehouseStockRow[];
  from: string;
  to: string;
}) {
  const [manual, setManual] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    try {
      setManual(JSON.parse(localStorage.getItem("sgt-manual-product-costs") || "{}"));
    } catch {}
  }, []);

  const purchasePriceById = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of stock || []) {
      if (p.purchasePrice != null && p.purchasePrice > 0) map.set(p.id, p.purchasePrice);
    }
    return map;
  }, [stock]);

  const costsFromReceipts = useMemo(() => {
    const map = new Map<string, number>();
    for (const receipt of [...receipts].sort((a, b) => b.date.localeCompare(a.date))) {
      for (const item of receipt.items) if (!map.has(item.productId) && item.price > 0) map.set(item.productId, item.price);
    }
    return map;
  }, [receipts]);

  const rows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; qty: number; revenue: number }>();
    for (const d of deals) if (d.status === "completed" && (!from || d.date >= from) && (!to || d.date <= to)) for (const i of d.items) {
      const x = map.get(i.productId) || { id: i.productId, name: i.name, qty: 0, revenue: 0 };
      x.qty += i.quantity;
      x.revenue += i.lineTotal;
      map.set(i.productId, x);
    }
    return [...map.values()]
      .map((x) => {
        const fromStock = purchasePriceById.get(x.id) || 0;
        const fromReceipt = costsFromReceipts.get(x.id) || 0;
        const fromManual = Number(manual[x.id]) || 0;
        const cost = fromStock || fromReceipt || fromManual || 0;
        // priority: stock purchasePrice > receipt > manual local
        // but if manual is set after stock missing, manual wins over receipt? keep stock highest
        const effective = fromManual ? Number(manual[x.id]) : (fromStock || fromReceipt);
        return { ...x, cost: effective, profit: r(x.revenue - x.qty * effective), source: fromStock ? "товар" : fromReceipt ? "поставка" : fromManual ? "вручную" : "" };
      })
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  }, [deals, from, to, manual, costsFromReceipts, purchasePriceById]);

  function setCostLocal(id: string, v: string) {
    const next = { ...manual, [id]: v };
    if (!v) delete next[id];
    setManual(next);
    localStorage.setItem("sgt-manual-product-costs", JSON.stringify(next));
  }

  async function saveCost(id: string, value: string) {
    const num = Number(value);
    if (!value || isNaN(num) || num < 0) {
      setEditing(null);
      return;
    }
    setSaving(id);
    setCostLocal(id, value);
    try {
      await fetch(`/api/admin/products/${id}/purchase-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchasePrice: num }),
      });
    } catch {}
    setSaving(null);
    setEditing(null);
  }

  if (!rows.length) return <div className="admin-empty"><BarChart3 size={28} /><p>За выбранный период отпущенных товаров нет.</p></div>;
  const revenue = rows.reduce((s, x) => s + x.revenue, 0), profit = rows.filter((x) => x.cost > 0).reduce((s, x) => s + x.profit, 0), missing = rows.filter((x) => x.cost <= 0).length;
  return <>
    <div className="wh-report-summary"><div><BarChart3 size={15} /><span>Товаров</span><strong>{rows.length}</strong></div><div><span>Выручка</span><strong>{m(revenue)}</strong></div><div><span>Прибыль по товарам с ценой</span><strong>{m(profit)}</strong></div>{missing > 0 && <div><span>Нужна закупочная цена</span><strong>{missing}</strong></div>}</div>
    <p className="admin-muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Рейтинг составлен по количеству отпущенного товара. Закупочная цена берётся из карточки товара (если указана) или из последней поставки; кликните на цену, чтобы отредактировать. Сохранение в отчёте также обновляет карточку товара.</p>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Товар</th><th>Продано, шт.</th><th>Выручка</th><th>Закупочная цена</th><th>Прибыль</th></tr></thead><tbody>{rows.map((x, i) => (
      <tr key={x.id}>
        <td><b>#{i + 1} · {x.name}</b></td>
        <td>{x.qty}</td>
        <td>{m(x.revenue)}</td>
        <td>
          {editing === x.id ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input className="admin-input" type="number" min="0" step="0.01" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveCost(x.id, draft); if (e.key === "Escape") setEditing(null); }} style={{ width: 120 }} />
              <button type="button" className="admin-btn admin-btn--primary admin-btn--sm" disabled={!!saving} onClick={() => saveCost(x.id, draft)}><Check size={13} /></button>
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setEditing(null)}><X size={13} /></button>
            </span>
          ) : x.cost > 0 ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span>{m(x.cost)}</span>
              <span style={{ fontSize: 10, color: "var(--adm-muted)", border: "1px solid var(--adm-border)", borderRadius: 4, padding: "1px 4px" }}>{(x as any).source}</span>
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" title="Редактировать закупочную цену" onClick={() => { setEditing(x.id); setDraft(String(x.cost)); }}><Pencil size={12} /></button>
            </span>
          ) : (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input className="admin-input" type="number" min="0" step="0.01" placeholder="Укажите цену" value={manual[x.id] || ""} onChange={e => setCostLocal(x.id, e.target.value)} onBlur={e => { if (e.target.value) saveCost(x.id, e.target.value); }} style={{ width: 130 }} />
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" title="Сохранить" onClick={() => { if (manual[x.id]) saveCost(x.id, manual[x.id]); }}><Check size={13} /></button>
            </span>
          )}
        </td>
        <td style={{ fontWeight: 800, color: x.cost > 0 ? "var(--adm-pine)" : "var(--adm-sand)" }}>{x.cost > 0 ? m(x.profit) : "Нужна цена"}</td>
      </tr>
    ))}</tbody></table></div>
  </>;
}
