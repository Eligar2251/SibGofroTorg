// src/components/admin/DueSummaryModal.tsx
// Расширенная сводка взаиморасчётов и вычёркиваний по коробкам/товарам
//
// Позволяет просмотреть:
//  1. Что именно вычеркнуто из расчётов (контрагенты целиком или отдельные платежи/заказы)
//     с детализацией до номера коробки/товара и количества;
//  2. Все долги (нам должны / мы должны) с расшифровкой коробок по каждому документу.

"use client";

import { useState, useMemo } from "react";
import {
  Boxes,
  Scissors,
  RotateCcw,
  X,
  Search,
  CheckCircle2,
  AlertCircle,
  Package,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { type BankPayment, type CounterpartyBalance } from "@/lib/warehouse-shared";

export interface DueSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: "skipped" | "all";
  counterpartiesWithDebt: CounterpartyBalance[];
  dueBreakdown: {
    listByKey: Map<string, BankPayment[]>;
    skippedByKey: Map<string, number>;
  };
  skippedParties: Set<string>;
  skippedPaymentIds: Set<string>;
  onRestoreParty: (key: string) => void;
  onRestorePayment: (id: string) => void;
  onRestoreAll: () => void;
  paymentProductsSummaryById: Map<
    string,
    {
      summaryText: string;
      itemsList: {
        name: string;
        sku?: string | null;
        qty: number;
        unitLabel?: string;
        price?: number;
      }[];
    }
  >;
  adminPath: string;
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

function fmtDate(raw: string): string {
  if (!raw) return "—";
  const [y, m, d] = raw.split("-");
  return d && m && y ? `${d}.${m}.${y}` : raw;
}

function partyKey(type: "customer" | "supplier", name: string): string {
  return `${type}:${name.trim().toLocaleLowerCase("ru-RU")}`;
}

export function DueSummaryModal({
  isOpen,
  onClose,
  initialTab = "skipped",
  counterpartiesWithDebt,
  dueBreakdown,
  skippedParties,
  skippedPaymentIds,
  onRestoreParty,
  onRestorePayment,
  onRestoreAll,
  paymentProductsSummaryById,
}: DueSummaryModalProps) {
  const [activeTab, setActiveTab] = useState<"skipped" | "all">(initialTab);
  const [search, setSearch] = useState("");

  const skippedPartiesList = useMemo(() => {
    return counterpartiesWithDebt.filter((c) =>
      skippedParties.has(partyKey(c.type as any, c.name))
    );
  }, [counterpartiesWithDebt, skippedParties]);

  const skippedPaymentsList = useMemo(() => {
    const list: { payment: BankPayment; cpType: "customer" | "supplier"; cpName: string }[] = [];
    for (const [key, pays] of dueBreakdown.listByKey.entries()) {
      const isCustomer = key.startsWith("customer:");
      const cpType = isCustomer ? "customer" : "supplier";
      for (const p of pays) {
        if (skippedPaymentIds.has(p.id)) {
          list.push({
            payment: p,
            cpType,
            cpName: p.counterparty || "Без контрагента",
          });
        }
      }
    }
    return list;
  }, [dueBreakdown, skippedPaymentIds]);

  const skippedTotalSum = useMemo(() => {
    let sum = 0;
    for (const c of skippedPartiesList) {
      sum += c.balance;
    }
    for (const item of skippedPaymentsList) {
      if (!skippedParties.has(partyKey(item.cpType, item.cpName))) {
        sum += item.payment.amount;
      }
    }
    return Math.round(sum * 100) / 100;
  }, [skippedPartiesList, skippedPaymentsList, skippedParties]);

  const filteredAllDebt = useMemo(() => {
    if (!search.trim()) return counterpartiesWithDebt;
    const q = search.trim().toLowerCase();
    return counterpartiesWithDebt.filter((c) => {
      const key = partyKey(c.type as any, c.name);
      const pays = dueBreakdown.listByKey.get(key) || [];
      if (c.name.toLowerCase().includes(q)) return true;
      for (const p of pays) {
        const prodInfo = paymentProductsSummaryById.get(String(p.id));
        if (
          p.counterparty?.toLowerCase().includes(q) ||
          p.invoiceNumber?.toLowerCase().includes(q) ||
          (prodInfo && prodInfo.summaryText.toLowerCase().includes(q))
        ) {
          return true;
        }
      }
      return false;
    });
  }, [counterpartiesWithDebt, search, dueBreakdown, paymentProductsSummaryById]);

  if (!isOpen) return null;

  const totalSkippedCount = skippedParties.size + skippedPaymentIds.size;

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div
          className="admin-modal wh-modal"
          style={{ maxWidth: 860, width: "95%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <h3 className="admin-modal__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Boxes size={18} style={{ color: "var(--adm-primary)" }} />
              Расширенная сводка взаиморасчётов и вычёркиваний
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="admin-modal__close"
              aria-label="Закрыть"
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--adm-border)", paddingBottom: 12, marginBottom: 16 }}>
            <button
              type="button"
              className={`admin-btn ${activeTab === "skipped" ? "admin-btn--primary" : "admin-btn--ghost"}`}
              onClick={() => setActiveTab("skipped")}
            >
              <Scissors size={14} /> Вычеркнуто из расчётов ({totalSkippedCount})
            </button>
            <button
              type="button"
              className={`admin-btn ${activeTab === "all" ? "admin-btn--primary" : "admin-btn--ghost"}`}
              onClick={() => setActiveTab("all")}
            >
              <Package size={14} /> Все долги по коробкам ({counterpartiesWithDebt.length})
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}>
            {activeTab === "skipped" ? (
              <div className="admin-stack">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, background: "rgba(239, 68, 68, 0.06)", padding: "12px 16px", borderRadius: 10, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--adm-rust)" }}>
                      Вычеркнуто из расчётов на {fmt(skippedTotalSum)} ₽
                    </div>
                    <div style={{ fontSize: 12, color: "var(--adm-muted)", marginTop: 2 }}>
                      Эти контрагенты или документы временно исключены из общего итога. Вы можете просмотреть коробки по каждому документу или вернуть их в расчёт.
                    </div>
                  </div>
                  {totalSkippedCount > 0 && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      style={{ color: "var(--adm-pine)", borderColor: "var(--adm-pine)" }}
                      onClick={() => onRestoreAll()}
                    >
                      <RotateCcw size={14} /> Вернуть всё в расчёт
                    </button>
                  )}
                </div>

                {totalSkippedCount === 0 ? (
                  <div className="admin-empty" style={{ padding: 32 }}>
                    <CheckCircle2 size={24} style={{ color: "var(--adm-pine)", marginBottom: 8 }} />
                    <p style={{ fontWeight: 600 }}>Ничего не вычеркнуто из расчётов</p>
                    <p style={{ fontSize: 12, color: "var(--adm-muted)" }}>
                      Все долги покупателей и поставщиков полностью участвуют в сводке.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* ── Вычеркнутые контрагенты целиком ── */}
                    {skippedPartiesList.length > 0 && (
                      <div className="admin-card" style={{ marginBottom: 12 }}>
                        <div className="admin-card__head">
                          <h4 className="admin-card__title">
                            Контрагенты, вычеркнутые целиком ({skippedPartiesList.length})
                          </h4>
                        </div>
                        <div className="admin-card__pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {skippedPartiesList.map((c) => {
                            const key = partyKey(c.type as any, c.name);
                            const pays = dueBreakdown.listByKey.get(key) || [];
                            return (
                              <div
                                key={key}
                                style={{
                                  border: "1px solid var(--adm-border)",
                                  borderRadius: 8,
                                  padding: 12,
                                  background: "#fff",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                                    <span className="admin-badge admin-badge--muted" style={{ marginLeft: 8 }}>
                                      {c.type === "customer" ? "Покупатель" : "Поставщик"}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontWeight: 800, fontSize: 15, color: "var(--adm-rust)" }}>
                                      {c.type === "customer" ? "+" : "−"}{fmt(c.balance)} ₽
                                    </span>
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      onClick={() => onRestoreParty(key)}
                                      title="Вернуть контрагента в расчёт"
                                    >
                                      <RotateCcw size={12} /> Вернуть в расчёт
                                    </button>
                                  </div>
                                </div>

                                {/* Документы контрагента с коробками */}
                                {pays.length > 0 && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, borderTop: "1px dashed var(--adm-border)", paddingTop: 8 }}>
                                    {pays.map((p) => {
                                      const prodInfo = paymentProductsSummaryById.get(String(p.id));
                                      return (
                                        <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5, padding: "6px 8px", background: "var(--adm-steel-pale)", borderRadius: 6 }}>
                                          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                                            <span>{p.invoiceNumber || `ПЛ-${p.number}`} от {fmtDate(p.date)}</span>
                                            <span>{fmt(p.amount)} ₽</span>
                                          </div>
                                          {prodInfo?.summaryText && (
                                            <div style={{ fontSize: 11.5, color: "var(--adm-primary)" }}>
                                              📦 {prodInfo.summaryText}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Вычеркнутые отдельные документы ── */}
                    {skippedPaymentsList.length > 0 && (
                      <div className="admin-card">
                        <div className="admin-card__head">
                          <h4 className="admin-card__title">
                            Отдельные вычеркнутые документы и коробки ({skippedPaymentsList.length})
                          </h4>
                        </div>
                        <div className="admin-card__pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {skippedPaymentsList.map((item) => {
                            const p = item.payment;
                            const prodInfo = paymentProductsSummaryById.get(String(p.id));
                            return (
                              <div
                                key={p.id}
                                style={{
                                  border: "1px solid var(--adm-border)",
                                  borderRadius: 8,
                                  padding: 12,
                                  background: "#fff",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                  <div>
                                    <span style={{ fontWeight: 700, fontSize: 14 }}>{p.invoiceNumber || `ПЛ-${p.number}`}</span>
                                    <span style={{ color: "var(--adm-muted)", fontSize: 13, marginLeft: 6 }}>
                                      · {item.cpName} · {fmtDate(p.date)}
                                    </span>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontWeight: 800, fontSize: 14, color: "var(--adm-rust)" }}>
                                      {fmt(p.amount)} ₽
                                    </span>
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn--ghost admin-btn--sm"
                                      onClick={() => onRestorePayment(String(p.id))}
                                    >
                                      <RotateCcw size={12} /> Вернуть
                                    </button>
                                  </div>
                                </div>

                                {prodInfo?.summaryText ? (
                                  <div style={{ fontSize: 12.5, color: "var(--adm-primary)", fontWeight: 550, marginTop: 4 }}>
                                    📦 {prodInfo.summaryText}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 12, color: "var(--adm-muted)", fontStyle: "italic", marginTop: 4 }}>
                                    Позиции не расшифрованы в счёте
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="admin-stack">
                <div style={{ position: "relative", marginBottom: 12 }}>
                  <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-ink-muted)" }} />
                  <input
                    type="text"
                    placeholder="Поиск по контрагенту, номеру ПЛ или коробке (напр. 600×400, Гофрокороб)..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="admin-input"
                    style={{ paddingLeft: 32 }}
                  />
                </div>

                {filteredAllDebt.length === 0 ? (
                  <div className="admin-empty" style={{ padding: 24 }}>
                    <p>Ничего не найдено по запросу «{search}»</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {filteredAllDebt.map((c) => {
                      const key = partyKey(c.type as any, c.name);
                      const pays = dueBreakdown.listByKey.get(key) || [];
                      const isCustomer = c.type === "customer";
                      return (
                        <div
                          key={key}
                          style={{
                            border: "1px solid var(--adm-border)",
                            borderRadius: 10,
                            padding: 14,
                            background: "#fff",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                              <span
                                className="admin-badge"
                                style={{
                                  marginLeft: 8,
                                  background: isCustomer ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                                  color: isCustomer ? "var(--adm-pine)" : "var(--adm-rust)",
                                }}
                              >
                                {isCustomer ? "Должны нам" : "Мы должны"}
                              </span>
                            </div>
                            <span
                              style={{
                                fontWeight: 800,
                                fontSize: 16,
                                color: isCustomer ? "var(--adm-pine)" : "var(--adm-rust)",
                              }}
                            >
                              {isCustomer ? "+" : "−"}{fmt(c.balance)} ₽
                            </span>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {pays.map((p) => {
                              const prodInfo = paymentProductsSummaryById.get(String(p.id));
                              const isSkipped = skippedPaymentIds.has(p.id) || skippedParties.has(key);
                              return (
                                <div
                                  key={p.id}
                                  style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 3,
                                    padding: "8px 10px",
                                    background: isSkipped ? "rgba(0,0,0,0.03)" : "var(--adm-steel-pale)",
                                    borderRadius: 6,
                                    opacity: isSkipped ? 0.6 : 1,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div>
                                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                                        {p.invoiceNumber || `ПЛ-${p.number}`}
                                      </span>
                                      <span style={{ color: "var(--adm-muted)", fontSize: 12, marginLeft: 6 }}>
                                        · {fmtDate(p.date)}
                                      </span>
                                      {isSkipped && (
                                        <span className="admin-badge admin-badge--muted" style={{ marginLeft: 8, fontSize: 11 }}>
                                          Вычеркнуто
                                        </span>
                                      )}
                                    </div>
                                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                                      {isCustomer ? "+" : "−"}{fmt(p.amount)} ₽
                                    </span>
                                  </div>

                                  {prodInfo?.summaryText ? (
                                    <div
                                      style={{
                                        fontSize: 12,
                                        color: "var(--adm-primary)",
                                        fontWeight: 550,
                                        lineHeight: 1.35,
                                      }}
                                    >
                                      📦 {prodInfo.summaryText}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", borderTop: "1px solid var(--adm-border)", paddingTop: 12, marginTop: 16 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={onClose}
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
