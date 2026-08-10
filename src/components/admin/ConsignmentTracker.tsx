"use client";

import { useMemo, useState } from "react";
import { HandCoins, Loader2, Check, PencilLine } from "lucide-react";
import type {
  BankPayment,
  ConsignmentManualSale,
  CustomerDeal,
  WarehouseReceipt,
} from "@/lib/warehouse-shared";

const money = (n: number) => `${Math.round(n * 100) / 100} ₽`;

/**
 * Реестр товара на реализации. Один товар одновременно относится
 * к одному поставщику.
 *
 * Продажи считаются автоматически по ОТГРУЗКАМ заказов учёта:
 *  - если у заказа есть shippedItems — берём отгруженные количества
 *    (работает и для частичных отгрузок: товар попадает в реестр
 *    сразу после кнопки «Отгрузить», не дожидаясь статуса «Проведён»);
 *  - если shippedItems пустые, но заказ «Проведён» — берём позиции
 *    целиком (старые заказы до появления частичных отгрузок).
 * Поверх автоподсчёта можно вручную вписать дополнительные продажи
 * (например, проданные вне заказов учёта).
 */
export function ConsignmentTracker({
  receipts,
  deals,
  payments,
  manualSales = [],
}: {
  receipts: WarehouseReceipt[];
  deals: CustomerDeal[];
  payments: BankPayment[];
  manualSales?: ConsignmentManualSale[];
}) {
  // Ручные продажи: ключ «поставка:товар» → количество.
  const [manualMap, setManualMap] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const row of manualSales) {
      m.set(`${row.receiptId}:${row.productId}`, Number(row.quantity) || 0);
    }
    return m;
  });
  // Черновики инпутов (пока пользователь редактирует).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const rows = useMemo(() => {
    // Партии из поставок «на реализации».
    const lots = receipts
      .filter((r) => r.isConsignment)
      .flatMap((r) =>
        r.items.map((i) => ({ receipt: r, item: i, supplied: i.quantity, sold: 0 }))
      );
    const byProduct = new Map<string, typeof lots>();
    for (const lot of lots) {
      const list = byProduct.get(lot.item.productId) || [];
      list.push(lot);
      byProduct.set(lot.item.productId, list);
    }
    for (const list of byProduct.values())
      list.sort(
        (a, b) =>
          a.receipt.date.localeCompare(b.receipt.date) || a.receipt.number - b.receipt.number
      );

    // FIFO-распределение отгруженных количеств по партиям.
    const salesDeals = deals
      .filter((d) => d.status !== "cancelled")
      .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);
    for (const deal of salesDeals) {
      const shipped = (deal.shippedItems || [])
        .map((s) => ({ productId: s.productId, qty: Number(s.shippedQty) || 0 }))
        .filter((s) => s.qty > 0);
      // Есть отгрузки — считаем по ним (в т.ч. частичные); нет, но заказ
      // проведён — считаем позиции целиком (legacy-заказы).
      const effective =
        shipped.length > 0
          ? shipped
          : deal.status === "completed"
            ? deal.items.map((i) => ({ productId: i.productId, qty: i.quantity }))
            : [];
      for (const entry of effective) {
        let left = entry.qty;
        for (const lot of byProduct.get(entry.productId) || []) {
          if (left <= 0) break;
          const used = Math.min(left, lot.supplied - lot.sold);
          lot.sold += used;
          left -= used;
        }
      }
    }

    return lots.map((lot) => {
      const key = `${lot.receipt.id}:${lot.item.productId}`;
      const manual = manualMap.get(key) || 0;
      const totalSold = Math.min(lot.supplied, lot.sold + manual);
      const receiptPayments = payments
        .filter(
          (p) =>
            p.direction === "outgoing" &&
            p.isPaid &&
            (p.receiptIds || []).includes(lot.receipt.id)
        )
        .reduce((s, p) => s + p.amount, 0);
      const receiptTotal = lot.receipt.total || 1;
      const paid = receiptPayments * ((lot.item.lineTotal || lot.item.price * lot.supplied) / receiptTotal);
      const soldValue = totalSold * lot.item.price;
      return {
        ...lot,
        key,
        manual,
        totalSold,
        paid,
        soldValue,
        due: Math.max(0, soldValue - paid),
        debt: Math.max(0, (lot.item.lineTotal || lot.item.price * lot.supplied) - paid),
      };
    });
  }, [receipts, deals, payments, manualMap]);

  async function saveManual(
    key: string,
    row: { receiptId: string; productId: string; productName: string },
    rawValue: string,
    maxQty: number
  ) {
    const parsed = Math.max(0, Math.floor(Number(String(rawValue).replace(",", ".")) || 0));
    const qty = Math.min(parsed, Math.max(0, maxQty));
    const current = manualMap.get(key) || 0;
    if (qty === current) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      return;
    }
    setSavingKey(key);
    // Оптимистично обновляем реестр, при ошибке откатываем.
    setManualMap((m) => {
      const next = new Map(m);
      next.set(key, qty);
      return next;
    });
    try {
      const res = await fetch("/api/admin/warehouse/consignment-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptId: row.receiptId,
          productId: row.productId,
          productName: row.productName,
          quantity: qty,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Ошибка сохранения");
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1600);
    } catch (error) {
      // Откат + сообщение.
      setManualMap((m) => {
        const next = new Map(m);
        if (current > 0) next.set(key, current);
        else next.delete(key);
        return next;
      });
      alert(error instanceof Error ? error.message : "Не удалось сохранить ручную продажу");
    } finally {
      setSavingKey(null);
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
    }
  }

  if (!rows.length)
    return (
      <div className="admin-empty">
        <HandCoins size={28} />
        <p>Нет поставок, отмеченных как «Товар на реализации».</p>
      </div>
    );

  return (
    <div>
      <p className="admin-hint" style={{ marginBottom: 10 }}>
        Продажи попадают сюда автоматически после отгрузки заказа учёта
        (включая частичные отгрузки). Если что-то продано вне заказов —
        впишите количество вручную в колонке «Вручную».
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Поставщик / ПО</th>
              <th>Товар</th>
              <th>Поставлено</th>
              <th>Продано (отгрузки)</th>
              <th>Вручную (+)</th>
              <th>Всего продано</th>
              <th>Остаток</th>
              <th>Продано по закупочной цене</th>
              <th>Оплачено</th>
              <th>К оплате по продажам</th>
              <th>Полный долг</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const maxManual = Math.max(0, r.supplied - r.sold);
              const draft = drafts[r.key];
              const inputKey = `${r.key}:${r.manual}`;
              return (
                <tr key={r.key}>
                  <td>
                    {r.receipt.supplier}
                    <br />
                    <small>ПО-{r.receipt.number}</small>
                  </td>
                  <td>{r.item.name}</td>
                  <td>{r.supplied}</td>
                  <td>{r.sold}</td>
                  <td>
                    {/* key привязан к сохранённому значению: после сейва
                        инпут перерисовывается с актуальной цифрой. */}
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input
                        key={inputKey}
                        type="number"
                        min={0}
                        max={maxManual}
                        step={1}
                        defaultValue={r.manual || ""}
                        placeholder="0"
                        className="admin-input"
                        style={{ width: 78, padding: "5px 8px", textAlign: "right" }}
                        title={`Максимум ${maxManual} (поставлено минус отгруженное)`}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [r.key]: e.target.value }))
                        }
                        onBlur={(e) =>
                          saveManual(
                            r.key,
                            { receiptId: r.receipt.id, productId: r.item.productId, productName: r.item.name },
                            e.target.value,
                            maxManual
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                      />
                      {savingKey === r.key ? (
                        <Loader2 size={14} style={{ color: "var(--adm-sand)" }} className="animate-spin" />
                      ) : savedKey === r.key ? (
                        <Check size={14} style={{ color: "var(--adm-pine)" }} />
                      ) : draft !== undefined && draft !== String(r.manual || "") ? (
                        <PencilLine size={13} style={{ color: "var(--adm-sand)" }} />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <b>{r.totalSold}</b>
                  </td>
                  <td>{r.supplied - r.totalSold}</td>
                  <td>{money(r.soldValue)}</td>
                  <td>{money(r.paid)}</td>
                  <td>{money(r.due)}</td>
                  <td>{money(r.debt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
