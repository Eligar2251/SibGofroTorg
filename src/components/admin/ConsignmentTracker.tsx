"use client";

import { useMemo } from "react";
import { HandCoins } from "lucide-react";
import type { BankPayment, CustomerDeal, WarehouseReceipt } from "@/lib/warehouse-shared";

const money = (n: number) => `${Math.round(n * 100) / 100} ₽`;

/** Реестр товара на реализации. Один товар одновременно относится к одному поставщику. */
export function ConsignmentTracker({ receipts, deals, payments }: { receipts: WarehouseReceipt[]; deals: CustomerDeal[]; payments: BankPayment[] }) {
  const rows = useMemo(() => {
    const lots = receipts.filter((r) => r.isConsignment).flatMap((r) => r.items.map((i) => ({ receipt: r, item: i, supplied: i.quantity, sold: 0 })));
    const byProduct = new Map<string, typeof lots>();
    for (const lot of lots) { const list = byProduct.get(lot.item.productId) || []; list.push(lot); byProduct.set(lot.item.productId, list); }
    for (const list of byProduct.values()) list.sort((a,b) => a.receipt.date.localeCompare(b.receipt.date) || a.receipt.number-b.receipt.number);
    for (const deal of deals.filter((d) => d.status === "completed").sort((a,b) => a.date.localeCompare(b.date) || a.number-b.number)) for (const item of deal.items) {
      let left = item.quantity;
      for (const lot of byProduct.get(item.productId) || []) { if (left <= 0) break; const used = Math.min(left, lot.supplied-lot.sold); lot.sold += used; left -= used; }
    }
    return lots.map((lot) => {
      const receiptPayments = payments.filter((p) => p.direction === "outgoing" && p.isPaid && (p.receiptIds || []).includes(lot.receipt.id)).reduce((s,p)=>s+p.amount,0);
      const receiptTotal = lot.receipt.total || 1;
      const paid = receiptPayments * ((lot.item.lineTotal || lot.item.price*lot.supplied) / receiptTotal);
      const soldValue = lot.sold * lot.item.price;
      return { ...lot, paid, soldValue, due: Math.max(0, soldValue-paid), debt: Math.max(0, (lot.item.lineTotal || lot.item.price*lot.supplied)-paid) };
    });
  }, [receipts,deals,payments]);
  if (!rows.length) return <div className="admin-empty"><HandCoins size={28}/><p>Нет поставок, отмеченных как «Товар на реализации».</p></div>;
  return <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Поставщик / ПО</th><th>Товар</th><th>Поставлено</th><th>Продано</th><th>Остаток</th><th>Продано по закупочной цене</th><th>Оплачено</th><th>К оплате по продажам</th><th>Полный долг</th></tr></thead><tbody>{rows.map((r) => <tr key={`${r.receipt.id}-${r.item.productId}`}><td>{r.receipt.supplier}<br/><small>ПО-{r.receipt.number}</small></td><td>{r.item.name}</td><td>{r.supplied}</td><td>{r.sold}</td><td>{r.supplied-r.sold}</td><td>{money(r.soldValue)}</td><td>{money(r.paid)}</td><td>{money(r.due)}</td><td>{money(r.debt)}</td></tr>)}</tbody></table></div>;
}
