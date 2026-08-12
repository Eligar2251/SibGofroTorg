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
const moneyShort = (n: number) => {
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString("ru-RU");
};

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
 *
 * НОВОЕ: отслеживаем и продажную цену, выручку, прибыль, чистыми.
 * Для каждой поставки считаем:
 *   - сколько должны поставщику за позицию (по закупочной цене проданного)
 *   - на сколько продали (по продажной цене — выручка)
 *   - прибыль (выручка - закуп проданного)
 *   - оплачено поставщику
 *   - к оплате по продажам (закуп проданного - оплачено)
 *   - чистыми (выручка - оплачено) — сколько осталось после оплаты поставщику
 *   - к переводу (то же что к оплате) — сколько нужно перевести поставщику
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
    // Партии из поставок «на реализации» с дополнительным полем revenue (по продажной цене)
    type Lot = {
      receipt: WarehouseReceipt;
      item: WarehouseReceipt["items"][number];
      supplied: number;
      sold: number;
      revenue: number; // выручка по продажной цене авто-продаж
    };
    const lots: Lot[] = receipts
      .filter((r) => r.isConsignment)
      .flatMap((r) =>
        r.items.map((i) => ({ receipt: r, item: i, supplied: i.quantity, sold: 0, revenue: 0 }))
      );
    const byProduct = new Map<string, Lot[]>();
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

    // FIFO-распределение отгруженных количеств по партиям + накопление выручки
    const salesDeals = deals
      .filter((d) => d.status !== "cancelled")
      .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);

    // Для быстрого поиска цены продажи товара в конкретном заказе
    function dealSellingPrice(deal: CustomerDeal, productId: string): number {
      const found = deal.items.find((it) => it.productId === productId);
      if (found && Number(found.price) > 0) return Number(found.price);
      // fallback: если есть несколько строк одного товара — среднее
      const all = deal.items.filter((it) => it.productId === productId);
      if (all.length > 0) {
        const totalQty = all.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
        const totalSum = all.reduce((s, x) => s + (Number(x.lineTotal) || 0), 0);
        if (totalQty > 0) return totalSum / totalQty;
        const avg = all.reduce((s, x) => s + (Number(x.price) || 0), 0) / all.length;
        if (avg > 0) return avg;
      }
      return 0;
    }

    for (const deal of salesDeals) {
      const shipped = (deal.shippedItems || [])
        .map((s) => ({
          productId: s.productId,
          qty: Number(s.shippedQty) || 0,
          price: dealSellingPrice(deal, s.productId),
        }))
        .filter((s) => s.qty > 0);
      // Есть отгрузки — считаем по ним (в т.ч. частичные); нет, но заказ
      // проведён — считаем позиции целиком (legacy-заказы).
      const effective: { productId: string; qty: number; price: number }[] =
        shipped.length > 0
          ? shipped
          : deal.status === "completed"
            ? deal.items.map((i) => ({ productId: i.productId, qty: i.quantity, price: Number(i.price) || 0 }))
            : [];
      for (const entry of effective) {
        let left = entry.qty;
        for (const lot of byProduct.get(entry.productId) || []) {
          if (left <= 0) break;
          const avail = lot.supplied - lot.sold;
          if (avail <= 0) continue;
          const used = Math.min(left, avail);
          lot.sold += used;
          lot.revenue += used * (entry.price || 0);
          left -= used;
        }
      }
    }

    return lots.map((lot) => {
      const key = `${lot.receipt.id}:${lot.item.productId}`;
      const manual = manualMap.get(key) || 0;
      // Не даём превысить поставленное
      const totalSold = Math.min(lot.supplied, lot.sold + manual);
      const autoSold = lot.sold;
      const manualSold = totalSold - autoSold; // может быть меньше manual если переполнение

      // Закупочная цена за штуку. Для старых поставок, где price не
      // сохранился, восстанавливаем её из суммы строки.
      const unitPrice =
        Number(lot.item.price) > 0
          ? Number(lot.item.price)
          : lot.supplied > 0
            ? (Number(lot.item.lineTotal) || 0) / lot.supplied
            : 0;
      const lotTotal = Number(lot.item.lineTotal) || unitPrice * lot.supplied;
      const receiptPayments = payments
        .filter(
          (p) =>
            p.direction === "outgoing" &&
            p.isPaid &&
            (p.receiptIds || []).includes(lot.receipt.id)
        )
        .reduce((s, p) => s + p.amount, 0);
      const receiptTotal = lot.receipt.total || 1;
      const paid = receiptPayments * (lotTotal / receiptTotal);

      // Выручка: авто-продажи уже посчитаны в lot.revenue
      // Среднюю продажную цену считаем по авто-продажам
      const avgSellingPrice = autoSold > 0 ? lot.revenue / autoSold : 0;
      // Для ручных продаж используем среднюю продажную цену, если есть, иначе закупочную (не можем знать цену)
      const manualRevenue = manualSold > 0 ? manualSold * (avgSellingPrice > 0 ? avgSellingPrice : unitPrice) : 0;
      const totalRevenue = lot.revenue + manualRevenue;
      const effectiveAvgSelling = totalSold > 0 ? totalRevenue / totalSold : avgSellingPrice;

      const soldPurchaseValue = totalSold * unitPrice; // сколько должны по закупке за проданное
      const profit = totalRevenue - soldPurchaseValue; // прибыль
      const dueSales = Math.max(0, soldPurchaseValue - paid); // к оплате за проданное
      const debt = Math.max(0, lotTotal - paid); // полный долг по поставке
      const clean = totalRevenue - paid; // чистыми (выручка минус оплачено поставщику)

      return {
        ...lot,
        key,
        manual,
        manualSold,
        totalSold,
        unitPrice,
        avgSellingPrice,
        effectiveAvgSelling,
        totalRevenue,
        soldPurchaseValue,
        profit,
        paid,
        due: dueSales,
        debt,
        clean,
        // для перевода — то же что due, но явно именуем
        toTransfer: dueSales,
        soldValue: soldPurchaseValue, // legacy field
      };
    });
  }, [receipts, deals, payments, manualMap]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.supplied += r.supplied;
        acc.sold += r.totalSold;
        acc.purchaseSold += r.soldPurchaseValue;
        acc.revenue += r.totalRevenue;
        acc.profit += r.profit;
        acc.paid += r.paid;
        acc.due += r.due;
        acc.debt += r.debt;
        acc.clean += r.clean;
        return acc;
      },
      { supplied: 0, sold: 0, purchaseSold: 0, revenue: 0, profit: 0, paid: 0, due: 0, debt: 0, clean: 0 }
    );
  }, [rows]);

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
        впишите количество вручную в колонке «Вручную». Теперь отслеживаем:
        по закупке (сколько должны поставщику за проданное), по продаже (выручка),
        прибыль, оплачено, к оплате (сколько осталось перевести), чистыми (выручка − оплачено).
      </p>

      <div className="admin-card" style={{ marginBottom: 12, padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: "12px 18px", fontSize: 12 }}>
        <span>Поставлено: <b>{totals.supplied}</b> шт</span>
        <span>Продано: <b>{totals.sold}</b> шт</span>
        <span style={{ color: "var(--adm-steel)" }}>По закупке проданного: <b>{money(totals.purchaseSold)}</b></span>
        <span style={{ color: "var(--adm-pine)" }}>Выручка: <b>{money(totals.revenue)}</b></span>
        <span style={{ color: totals.profit >= 0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>Прибыль: <b>{money(totals.profit)}</b></span>
        <span>Оплачено поставщикам: <b>{money(totals.paid)}</b></span>
        <span style={{ color: "var(--adm-rust)" }}>К переводу: <b>{money(totals.due)}</b></span>
        <span>Чистыми: <b>{money(totals.clean)}</b></span>
        <span>Полный долг: <b>{money(totals.debt)}</b></span>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table" style={{ minWidth: 1100 }}>
          <thead>
            <tr>
              <th>Поставщик / ПО</th>
              <th>Товар (закуп / продаж)</th>
              <th style={{ textAlign: "right" }}>Поставлено</th>
              <th style={{ textAlign: "right" }}>Отгр / Вручн / Всего</th>
              <th style={{ textAlign: "right" }}>Остаток</th>
              <th style={{ textAlign: "right" }}>Продано по закупке<br /><small>должны за позицию</small></th>
              <th style={{ textAlign: "right" }}>Продано по продаже<br /><small>выручка</small></th>
              <th style={{ textAlign: "right" }}>Прибыль<br /><small>выручка − закуп</small></th>
              <th style={{ textAlign: "right" }}>Оплачено</th>
              <th style={{ textAlign: "right" }}>К оплате / переводу<br /><small>за проданное − оплачено</small></th>
              <th style={{ textAlign: "right" }}>Чистыми<br /><small>выручка − оплачено</small></th>
              <th style={{ textAlign: "right" }}>Полный долг</th>
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
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{r.receipt.supplier}</div>
                    <small style={{ color: "var(--adm-sand)" }}>ПО-{r.receipt.number} · {r.receipt.date?.slice(0, 10)}</small>
                  </td>
                  <td>
                    <div style={{ fontSize: 12, fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item.name}>{r.item.name}</div>
                    <small style={{ display: "block", color: "var(--adm-ink-muted)", fontSize: 11 }}>
                      закуп: {moneyShort(r.unitPrice)} ₽/шт
                    </small>
                    <small style={{ display: "block", color: "var(--adm-pine)", fontSize: 11 }}>
                      продаж: {r.effectiveAvgSelling > 0 ? `${moneyShort(r.effectiveAvgSelling)} ₽/шт` : "—"}
                    </small>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.supplied}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <span>{r.sold} / {r.manual} / <b>{r.totalSold}</b></span>
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
                          style={{ width: 62, padding: "3px 6px", textAlign: "right", fontSize: 12 }}
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
                          <Loader2 size={12} style={{ color: "var(--adm-sand)" }} className="animate-spin" />
                        ) : savedKey === r.key ? (
                          <Check size={12} style={{ color: "var(--adm-pine)" }} />
                        ) : draft !== undefined && draft !== String(r.manual || "") ? (
                          <PencilLine size={11} style={{ color: "var(--adm-sand)" }} />
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>{r.supplied - r.totalSold}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--adm-steel)" }}>{moneyShort(r.soldPurchaseValue)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--adm-pine)", fontWeight: 600 }}>{moneyShort(r.totalRevenue)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color: r.profit >= 0 ? "var(--adm-pine)" : "var(--adm-rust)", fontWeight: 700 }}>{moneyShort(r.profit)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{moneyShort(r.paid)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, color: r.due > 0 ? "var(--adm-rust)" : "var(--adm-pine)" }}>{moneyShort(r.due)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{moneyShort(r.clean)} ₽</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{moneyShort(r.debt)} ₽</td>
                </tr>
              );
            })}
            <tr style={{ background: "var(--adm-paper)", fontWeight: 700 }}>
              <td colSpan={2} style={{ textAlign: "right" }}>ИТОГО:</td>
              <td style={{ textAlign: "right" }}>{totals.supplied}</td>
              <td style={{ textAlign: "right" }}>{totals.sold}</td>
              <td style={{ textAlign: "right" }}></td>
              <td style={{ textAlign: "right" }}>{moneyShort(totals.purchaseSold)} ₽</td>
              <td style={{ textAlign: "right" }}>{moneyShort(totals.revenue)} ₽</td>
              <td style={{ textAlign: "right", color: totals.profit >=0 ? "var(--adm-pine)" : "var(--adm-rust)" }}>{moneyShort(totals.profit)} ₽</td>
              <td style={{ textAlign: "right" }}>{moneyShort(totals.paid)} ₽</td>
              <td style={{ textAlign: "right", color: "var(--adm-rust)" }}>{moneyShort(totals.due)} ₽</td>
              <td style={{ textAlign: "right" }}>{moneyShort(totals.clean)} ₽</td>
              <td style={{ textAlign: "right" }}>{moneyShort(totals.debt)} ₽</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

