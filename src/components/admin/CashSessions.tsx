// =========================================================
// FILE: src/components/admin/CashSessions.tsx
// Кассовые смены (Учёт → Банк → «Касса») в формате
// мобильного приложения: карточки смен. Клик по карточке
// открывает красиво оформленную модалку со всей информацией
// о смене: перенос, поступления, расходы, разбивка двух касс
// и итоговый остаток.
//
// Смена — это фактическая сводка (CashCollection): документ
// ничего не переводит и не списывает, он только снимок факта.
// =========================================================

"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  ChevronRight,
  CreditCard,
  History,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  type CashCollection,
  type CashCollectionItem,
  type CashCollectionExpense,
  getCashCollectionIncomeBreakdown,
  getCashCollectionExpenseBreakdown,
} from "@/lib/warehouse-shared";

const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

function fmtDateShort(raw: string): string {
  const d = new Date(`${String(raw || "").slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDateFull(raw: string): string {
  const d = new Date(`${String(raw || "").slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return raw;
  const text = d.toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Чип способа поступления/расхода: наличные / карта ЮМ / оба. */
function kindChip(item: CashCollectionItem): { label: string; cls: string } {
  const amount = Number(item.amount) || 0;
  const card = Math.max(
    0,
    Number(item.cardAmount != null ? item.cardAmount : item.kind === "card" ? amount : 0) || 0
  );
  const hasCard = card > 0.009;
  const hasCash = amount - card > 0.009;
  if (hasCard && hasCash) return { label: "Нал + ЮМ", cls: "cs-chip cs-chip--both" };
  if (hasCard) return { label: "Карта ЮМ", cls: "cs-chip cs-chip--card" };
  return { label: "Наличные", cls: "cs-chip cs-chip--cash" };
}

interface CashSessionsProps {
  /** Смены, отсортированные по дате (новые сверху). */
  collections: CashCollection[];
  /** id смены → наличный перенос на начало смены. */
  openingById: Map<string, number>;
  /** Идёт ли сохранение/отмена (блокирует кнопки). */
  busy: boolean;
  /** Отменить/удалить смену (noAccounting — старое закрытие без движения денег). */
  onDelete: (id: string, noAccounting?: boolean) => void;
  adminPath: string;
}

export function CashSessions({
  collections,
  openingById,
  busy,
  onDelete,
  adminPath,
}: CashSessionsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = collections.find((c) => c.id === openId) || null;

  if (collections.length === 0) {
    return (
      <div className="admin-empty" style={{ padding: 18 }}>
        <p>Сводок кассы пока нет</p>
      </div>
    );
  }

  return (
    <>
      <div className="cs-grid">
        {collections.map((collection) => {
          const income = getCashCollectionIncomeBreakdown(collection);
          const expense = getCashCollectionExpenseBreakdown(collection);
          const opening = r2(openingById.get(collection.id) || 0);
          const closing =
            collection.cashAmount != null
              ? r2(collection.cashAmount)
              : r2(opening + income.cash - expense.cash);
          const noAccounting = (collection.items || []).some((i) => i.noAccounting);
          const lines = (collection.items || []).length + (collection.expenses || []).length;
          return (
            <button
              key={collection.id}
              type="button"
              className={`cs-card${closing < 0 ? " cs-card--neg" : ""}`}
              onClick={() => setOpenId(collection.id)}
              title="Открыть смену"
            >
              <div className="cs-card__top">
                <span className="cs-card__date">{fmtDateFull(collection.date)}</span>
                {noAccounting ? (
                  <span className="admin-badge admin-badge--amber" title="Старое закрытие без перевода — платежи скрыты из баланса">
                    старое закрытие
                  </span>
                ) : (
                  <span className="cs-card__lines">{lines} оп.</span>
                )}
              </div>
              <div className="cs-card__closing">
                <span>остаток в кассе</span>
                <strong>{fmt(closing)} ₽</strong>
              </div>
              <div className="cs-card__tiles">
                <div className="cs-tile">
                  <span>
                    <History size={11} /> Перенос
                  </span>
                  <b>+{fmt(opening)} ₽</b>
                </div>
                <div className="cs-tile">
                  <span>
                    <ArrowDownLeft size={11} /> Приход
                  </span>
                  <b className="cs-in">+{fmt(income.total)} ₽</b>
                </div>
                <div className="cs-tile">
                  <span>
                    <ArrowUpRight size={11} /> Расход
                  </span>
                  <b className="cs-out">−{fmt(expense.total)} ₽</b>
                </div>
                <div className="cs-tile">
                  <span>
                    <CreditCard size={11} /> ЮМ
                  </span>
                  <b className="cs-ym">{fmt(income.card)} ₽</b>
                </div>
              </div>
              {collection.note && (
                <div className="cs-card__note">{collection.note}</div>
              )}
              <div className="cs-card__cta">
                Открыть смену <ChevronRight size={13} />
              </div>
            </button>
          );
        })}
      </div>

      {open && (
        <CashSessionModal
          collection={open}
          opening={r2(openingById.get(open.id) || 0)}
          busy={busy}
          onClose={() => setOpenId(null)}
          onDelete={() => {
            const noAccounting = (open.items || []).some((i) => i.noAccounting);
            setOpenId(null);
            onDelete(open.id, noAccounting);
          }}
          adminPath={adminPath}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Модалка смены: полная информация в «мобильном» оформлении.
// ────────────────────────────────────────────────────────────
function CashSessionModal({
  collection,
  opening,
  busy,
  onClose,
  onDelete,
  adminPath,
}: {
  collection: CashCollection;
  opening: number;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
  adminPath: string;
}) {
  const income = getCashCollectionIncomeBreakdown(collection);
  const expense = getCashCollectionExpenseBreakdown(collection);
  const closing =
    collection.cashAmount != null
      ? r2(collection.cashAmount)
      : r2(opening + income.cash - expense.cash);
  const noAccounting = (collection.items || []).some((i) => i.noAccounting);
  const items = collection.items || [];
  const expenseRows = collection.expenses || [];

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" onClick={onClose}>
        <div
          className="admin-modal cs-modal"
          style={{ maxWidth: 560 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`Сводка кассы ${fmtDateShort(collection.date)}`}
        >
          {/* ── Шапка ── */}
          <div className="cs-modal__head">
            <div>
              <div className="cs-modal__kicker">
                <Banknote size={13} /> Сводка кассовой смены
              </div>
              <h3 className="admin-modal__title" style={{ marginTop: 2 }}>
                {fmtDateFull(collection.date)}
              </h3>
              {noAccounting && (
                <span className="admin-badge admin-badge--amber" style={{ marginTop: 6 }}>
                  старое закрытие без перевода
                </span>
              )}
            </div>
            <button type="button" className="admin-modal__close" onClick={onClose} aria-label="Закрыть">
              <X size={14} />
            </button>
          </div>

          <div className="cs-modal__body">
            {/* ── Четыре главные цифры ── */}
            <div className="cs-tiles cs-tiles--big">
              <div className="cs-bigtile">
                <span className="cs-bigtile__label">
                  <History size={12} /> Перенос с прошлых дней
                </span>
                <b>+{fmt(opening)} ₽</b>
                <small>не прибыль</small>
              </div>
              <div className="cs-bigtile">
                <span className="cs-bigtile__label">
                  <ArrowDownLeft size={12} /> Поступления за день
                </span>
                <b className="cs-in">+{fmt(income.total)} ₽</b>
                <small>нал {fmt(income.cash)} · ЮМ {fmt(income.card)}</small>
              </div>
              <div className="cs-bigtile">
                <span className="cs-bigtile__label">
                  <ArrowUpRight size={12} /> Расходы за день
                </span>
                <b className="cs-out">−{fmt(expense.total)} ₽</b>
                <small>нал {fmt(expense.cash)} · ЮМ {fmt(expense.card)}</small>
              </div>
              <div className={`cs-bigtile${closing < 0 ? " cs-bigtile--neg" : ""}`}>
                <span className="cs-bigtile__label">
                  <Banknote size={12} /> Остаток в кассе
                </span>
                <b>{fmt(closing)} ₽</b>
                <small>на конец смены</small>
              </div>
            </div>

            {/* ── Поступления ── */}
            <div className="cs-section">
              <div className="cs-section__title">
                Поступления
                <b className="cs-in">+{fmt(income.total)} ₽</b>
              </div>
              {items.length === 0 ? (
                <div className="cs-section__empty">Поступлений не было</div>
              ) : (
                <div className="cs-list">
                  {items.map((item, idx) => {
                    const chip = kindChip(item);
                    return (
                      <div key={`${collection.id}-${item.paymentId}-${idx}`} className="cs-line">
                        <div className="cs-line__main">
                          <Link
                            href={`/${adminPath}/warehouse?tab=bank&payment=${item.paymentId}`}
                            className="cs-line__paynum"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ПЛ-{item.number || "—"}
                          </Link>
                          <span className="cs-line__name">{item.counterparty || "Без контрагента"}</span>
                        </div>
                        <span className={chip.cls}>{chip.label}</span>
                        <b className="cs-line__val cs-in">+{fmt(Number(item.amount) || 0)} ₽</b>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Расходы ── */}
            <div className="cs-section">
              <div className="cs-section__title">
                Расходы
                <b className="cs-out">−{fmt(expense.total)} ₽</b>
              </div>
              {expenseRows.length === 0 ? (
                <div className="cs-section__empty">Расходов не было</div>
              ) : (
                <div className="cs-list">
                  {expenseRows.map((row: CashCollectionExpense, idx: number) => (
                    <div key={`${collection.id}-expense-${idx}`} className="cs-line">
                      <div className="cs-line__main">
                        <span className="cs-line__name">
                          {row.title}
                          {row.comment ? <small> · {row.comment}</small> : null}
                        </span>
                      </div>
                      <span className={`cs-chip ${row.sourceKind === "card" ? "cs-chip--card" : "cs-chip--cash"}`}>
                        {row.sourceKind === "card" ? "Карта ЮМ" : "Наличные"}
                      </span>
                      <b className="cs-line__val cs-out">−{fmt(Number(row.amount) || 0)} ₽</b>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Разбивка двух касс ── */}
            <div className="cs-section">
              <div className="cs-section__title">Разбивка двух касс</div>
              <div className="cs-list">
                <div className="cs-line">
                  <span className="cs-line__name"><History size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />Перенос наличных</span>
                  <b>+{fmt(opening)} ₽</b>
                </div>
                <div className="cs-line">
                  <span className="cs-line__name"><Banknote size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />Поступило наличными</span>
                  <b className="cs-in">+{fmt(income.cash)} ₽</b>
                </div>
                <div className="cs-line">
                  <span className="cs-line__name"><ArrowUpRight size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />Расходы наличными</span>
                  <b className="cs-out">−{fmt(expense.cash)} ₽</b>
                </div>
                <div className="cs-line">
                  <span className="cs-line__name"><CreditCard size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />Поступило на ЮМ</span>
                  <b className="cs-ym">+{fmt(income.card)} ₽</b>
                </div>
                <div className="cs-line">
                  <span className="cs-line__name"><CreditCard size={12} style={{ verticalAlign: "-1px", marginRight: 6 }} />Расходы с ЮМ</span>
                  <b className="cs-ym">−{fmt(expense.card)} ₽</b>
                </div>
                <div className="cs-line cs-line--total">
                  <span className="cs-line__name">Остаток наличных</span>
                  <b>{fmt(closing)} ₽</b>
                </div>
              </div>
            </div>

            {collection.note && (
              <div className="cs-note">
                <span>Комментарий к смене</span>
                <p>{collection.note}</p>
              </div>
            )}
          </div>

          {/* ── Действия ── */}
          <div className="cs-modal__foot">
            <button
              type="button"
              className="admin-btn admin-btn--danger admin-btn--sm"
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={13} />
              {noAccounting ? "Вернуть платежи в сводку" : "Удалить смену"}
            </button>
            <button type="button" className="admin-btn admin-btn--outline" onClick={onClose}>
              <RotateCcw size={13} /> Закрыть
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
