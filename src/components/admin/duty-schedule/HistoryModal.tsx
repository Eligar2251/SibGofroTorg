// =========================================================
// FILE: src/components/admin/duty-schedule/HistoryModal.tsx
// История версий табеля охраны: список сохранённых снимков и
// просмотр любой версии — смены, часы, начисления и выплаты
// именно такими, какими они были в тот момент.
//
// Левая колонка — версии (свежие сверху, верхняя = текущая).
// Правая колонка — выбранный месяц: сетка дежурств, начисленная
// зарплата и дни выплат. Кнопка «Восстановить» возвращает версию
// в работу (текущее состояние при этом тоже остаётся в истории).
// =========================================================

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Loader2,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import { ScheduleTable } from "./ScheduleTable";
import {
  DutyScheduleRevisionMeta,
  DutyScheduleRevisionSnapshot,
} from "./types";
import { MONTHS_RU, fillMissingDays } from "./scheduleGenerator";
import { useEscapeClose } from "@/hooks/use-escape-close";

interface Props {
  onClose: () => void;
  /** Список версий из базы (хук useDutySchedule). */
  revisions: DutyScheduleRevisionMeta[];
  /** Отпечаток текущего снимка — им помечается актуальная версия. */
  currentHash: string | null;
  historyEnabled: boolean;
  historyHint: string | null;
  historyError: string | null;
  historyLoading: boolean;
  /** Перечитать список (например, после отката). */
  onReload: () => void;
  /** Полный снимок выбранной версии. */
  onLoadRevision: (id: number) => Promise<DutyScheduleRevisionSnapshot>;
  /** Вернуть версию в работу. */
  onRestore: (id: number) => Promise<unknown>;
}

const fmtMoney = (value: number) => value.toLocaleString("ru-RU");

/** 'YYYY-MM' → «сентябрь 2026». */
function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return `${MONTHS_RU[month - 1]} ${year}`;
}

/** ISO → «01.10.2026, 14:35». */
function fmtMoment(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Дата + время без повторения, когда это один и тот же день. */
function fmtRange(createdAt: string, updatedAt: string): string {
  const created = fmtMoment(createdAt);
  const updated = fmtMoment(updatedAt);
  return created === updated ? updated : `${updated} (с ${created})`;
}

export const HistoryModal: React.FC<Props> = ({
  onClose,
  revisions,
  currentHash,
  historyEnabled,
  historyHint,
  historyError,
  historyLoading,
  onReload,
  onLoadRevision,
  onRestore,
}) => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Какую версию уже загружаем/загрузили — чтобы не читать её повторно.
  const loadedIdRef = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<DutyScheduleRevisionSnapshot | null>(
    null
  );
  const [loadingRevision, setLoadingRevision] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [monthKey, setMonthKey] = useState<string>("");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEscapeClose(onClose, !restoring);

  const openRevision = useCallback(
    async (id: number) => {
      setSelectedId(id);
      setRevisionError(null);
      setLoadingRevision(true);
      setDoneMessage(null);
      try {
        const revision = await onLoadRevision(id);
        setSnapshot(revision);
        const months = collectMonths(revision);
        setMonthKey((current) =>
          current && months.includes(current)
            ? current
            : months[months.length - 1] ?? ""
        );
      } catch (error) {
        setSnapshot(null);
        setRevisionError(
          error instanceof Error ? error.message : "Не удалось прочитать версию"
        );
        // Не запоминаем неудачную попытку — при следующем клике повторим.
        loadedIdRef.current = null;
      } finally {
        setLoadingRevision(false);
      }
    },
    [onLoadRevision]
  );

  // Открыли список — сразу показываем самую свежую версию, а при клике
  // по другой строке читаем её снимок. Ref защищает от повторных
  // загрузок: список версий приходит новым массивом на каждый рендер.
  useEffect(() => {
    if (selectedId == null) {
      if (revisions.length > 0) setSelectedId(revisions[0].id);
      return;
    }
    if (loadedIdRef.current === selectedId) return;
    loadedIdRef.current = selectedId;
    void openRevision(selectedId);
  }, [revisions, selectedId, openRevision]);

  const handleRestore = async () => {
    if (selectedId == null) return;
    const item = revisions.find((revision) => revision.id === selectedId);
    const when = item ? fmtMoment(item.updatedAt) : "выбранную дату";
    if (
      !confirm(
        `Вернуть версию от ${when}?\n\n` +
          `Текущие данные табеля останутся в истории — их тоже можно будет вернуть. ` +
          `Сотрудники, смены, начисления и выплаты станут такими, какими были в этой версии.`
      )
    ) {
      return;
    }
    setRestoring(true);
    setRestoreError(null);
    try {
      await onRestore(selectedId);
      setDoneMessage(`Версия от ${when} восстановлена — она снова в работе.`);
      onReload();
    } catch (error) {
      setRestoreError(
        error instanceof Error ? error.message : "Не удалось восстановить версию"
      );
    } finally {
      setRestoring(false);
    }
  };

  const months = useMemo(
    () => (snapshot ? collectMonths(snapshot) : []),
    [snapshot]
  );

  const schedule = useMemo(() => {
    if (!snapshot || !monthKey) return [];
    const [year, month] = monthKey.split("-").map(Number);
    return fillMissingDays(snapshot.state.schedules?.[monthKey] ?? [], year, month);
  }, [snapshot, monthKey]);

  const scheduleEmployees = useMemo(
    () => (snapshot ? snapshot.state.employees ?? [] : []),
    [snapshot]
  );

  const amountOverrides = useMemo(
    () => (snapshot ? snapshot.state.amountOverrides?.[monthKey] ?? {} : {}),
    [snapshot, monthKey]
  );

  const accruals = useMemo(() => {
    if (!snapshot || !monthKey) return [];
    const stored = snapshot.state.salaryAccruals?.[monthKey];
    if (Array.isArray(stored)) return stored;
    return scheduleEmployees
      .filter((employee) => employee.active)
      .map((employee) => ({
        id: employee.id,
        employeeId: employee.id,
        employeeName: employee.name,
        amount: null as number | null,
      }));
  }, [snapshot, monthKey, scheduleEmployees]);

  const payouts = useMemo(
    () => (snapshot ? snapshot.state.salaryPayouts?.[monthKey] ?? [] : []),
    [snapshot, monthKey]
  );

  const awaiting = loadingRevision || restoring;

  return (
    <div className="ds-modal-overlay ds-history-overlay" onClick={onClose}>
      <div
        className="ds-modal ds-history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ds-history-head">
          <h3>
            <History size={17} /> История табеля охраны
          </h3>
          <span className="ds-history-sub">
            Сохраняются сотрудники, смены, часы, начисления и дни выплат.
            Верхняя версия — текущая.
          </span>
          <button
            type="button"
            className="ds-history-close"
            onClick={onClose}
            title="Закрыть (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="ds-history-body">
          <aside className="ds-history-list">
            <div className="ds-history-list-head">
              <span>Версии ({revisions.length})</span>
              <button
                type="button"
                className="ds-link-btn"
                onClick={onReload}
                disabled={historyLoading}
                title="Перечитать список версий из базы"
              >
                {historyLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}{" "}
                Обновить
              </button>
            </div>

            {!historyEnabled && (
              <div className="ds-history-warning">
                <AlertTriangle size={14} />
                <span>
                  {historyHint ||
                    "История версий ещё не подключена в базе. Выполните supabase/migration_duty_schedule_storage.sql в Supabase → SQL Editor."}
                </span>
              </div>
            )}

            {historyError && (
              <div className="ds-history-warning ds-history-warning--error">
                <AlertTriangle size={14} />
                <span>{historyError}</span>
              </div>
            )}

            {historyLoading && revisions.length === 0 && (
              <div className="ds-history-empty">
                <Loader2 size={15} className="animate-spin" /> Загружаем версии…
              </div>
            )}

            {!historyLoading && revisions.length === 0 && historyEnabled && (
              <div className="ds-history-empty">
                Версий пока нет — они появятся после первой правки табеля.
              </div>
            )}

            <ul className="ds-history-items">
              {revisions.map((revision) => {
                const isCurrent =
                  Boolean(currentHash) && revision.hash === currentHash;
                const period = revision.summary?.periods?.length
                  ? revision.summary.periods[revision.summary.periods.length - 1]
                  : null;
                return (
                  <li key={revision.id}>
                    <button
                      type="button"
                      className={`ds-history-item${
                        selectedId === revision.id ? " ds-history-item--active" : ""
                      }`}
                      onClick={() => void openRevision(revision.id)}
                    >
                      <span className="ds-history-item-top">
                        <Clock size={12} />
                        {fmtRange(revision.createdAt, revision.updatedAt)}
                        {isCurrent && (
                          <em className="ds-history-current">
                            <CheckCircle2 size={11} /> актуально
                          </em>
                        )}
                      </span>
                      {revision.note && (
                        <span className="ds-history-item-note">
                          {revision.note}
                        </span>
                      )}
                      <span className="ds-history-item-meta">
                        <UserRound size={11} />
                        {revision.createdBy || "—"}
                        {revision.summary && (
                          <>
                            {" · "}
                            {revision.summary.activeEmployees} чел.
                            {" · "}
                            {revision.summary.months} мес.
                            {revision.summary.lastMonth
                              ? ` (${revision.summary.lastMonth})`
                              : ""}
                          </>
                        )}
                      </span>
                      {period && (
                        <span className="ds-history-item-money">
                          {monthLabel(period.month)}: начислено{" "}
                          {fmtMoney(period.accrualTotal)} ₽ · выплат{" "}
                          {period.payoutRows} на {fmtMoney(period.payoutTotal)} ₽
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="ds-history-preview">
            {!snapshot && !loadingRevision && (
              <div className="ds-history-empty ds-history-empty--big">
                Выберите версию слева, чтобы посмотреть, как выглядели смены,
                зарплата и выплаты на тот момент.
              </div>
            )}

            {loadingRevision && (
              <div className="ds-history-empty ds-history-empty--big">
                <Loader2 size={16} className="animate-spin" /> Читаем версию…
              </div>
            )}

            {revisionError && (
              <div className="ds-history-warning ds-history-warning--error">
                <AlertTriangle size={14} />
                <span>{revisionError}</span>
              </div>
            )}

            {snapshot && !loadingRevision && (
              <>
                <div className="ds-history-preview-head">
                  <div>
                    <strong>
                      Версия от {fmtMoment(snapshot.updatedAt || snapshot.createdAt)}
                    </strong>
                    <span className="ds-history-preview-sub">
                      сохранил {snapshot.createdBy || "—"}
                      {snapshot.note ? ` · ${snapshot.note}` : ""}
                    </span>
                  </div>
                  <div className="ds-history-preview-actions">
                    <label>
                      Месяц:
                      <select
                        value={monthKey}
                        onChange={(event) => setMonthKey(event.target.value)}
                      >
                        {months.map((month) => (
                          <option key={month} value={month}>
                            {monthLabel(month)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ds-btn ds-btn--primary"
                      onClick={() => void handleRestore()}
                      disabled={awaiting || selectedId == null}
                      title="Сделать эту версию рабочей. Текущие данные останутся в истории."
                    >
                      {restoring ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <RotateCcw size={13} />
                      )}{" "}
                      Восстановить эту версию
                    </button>
                  </div>
                </div>

                {restoreError && (
                  <div className="ds-history-warning ds-history-warning--error">
                    <AlertTriangle size={14} />
                    <span>{restoreError}</span>
                  </div>
                )}
                {doneMessage && (
                  <div className="ds-history-done">
                    <CheckCircle2 size={14} /> {doneMessage}
                  </div>
                )}

                {months.length === 0 ? (
                  <div className="ds-history-empty ds-history-empty--big">
                    В этой версии ещё нет ни смен, ни зарплаты.
                  </div>
                ) : (
                  <>
                    <div className="ds-history-section-title">
                      Дежурства — {monthLabel(monthKey)}
                    </div>
                    <ScheduleTable
                      employees={scheduleEmployees}
                      schedule={schedule}
                      amountOverrides={amountOverrides}
                    />

                    <div className="ds-history-section-title">
                      Начисления за {monthLabel(monthKey)}
                    </div>
                    <div className="ds-payouts-table-wrap">
                      <table className="ds-payouts-table">
                        <thead>
                          <tr>
                            <th style={{ minWidth: "220px" }}>Человек</th>
                            <th style={{ width: "160px" }}>Итоговая сумма, ₽</th>
                            <th>Как задана</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accruals.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="ds-payouts-empty">
                                В этой версии в зарплате за{" "}
                                {monthLabel(monthKey).toLowerCase()} никого нет.
                              </td>
                            </tr>
                          ) : (
                            accruals.map((accrual) => (
                              <tr key={accrual.id}>
                                <td>{accrual.employeeName || "—"}</td>
                                <td className="ds-print-num">
                                  {accrual.amount == null
                                    ? "по табелю"
                                    : fmtMoney(accrual.amount)}
                                </td>
                                <td className="ds-muted">
                                  {accrual.amount == null
                                    ? "расчёт: часы × ставка базового месяца"
                                    : "сумма задана вручную"}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="ds-history-section-title">
                      Выплаты — {monthLabel(monthKey)}
                    </div>
                    <div className="ds-payouts-table-wrap">
                      <table className="ds-payouts-table">
                        <thead>
                          <tr>
                            <th style={{ width: "150px" }}>День выплаты</th>
                            <th style={{ minWidth: "200px" }}>Человек</th>
                            <th style={{ width: "140px" }}>Сумма, ₽</th>
                            <th>Назначение</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payouts.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="ds-payouts-empty">
                                Выплат в этой версии нет.
                              </td>
                            </tr>
                          ) : (
                            payouts.map((payout) => (
                              <tr key={payout.id}>
                                <td className="ds-print-num">
                                  {payout.date
                                    ? payout.date.split("-").reverse().join(".")
                                    : "—"}
                                </td>
                                <td>{payout.employeeName || "—"}</td>
                                <td className="ds-print-num">
                                  {fmtMoney(payout.amount || 0)}
                                </td>
                                <td className="ds-muted">
                                  {payout.comment?.trim() || "—"}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        {payouts.length > 0 && (
                          <tfoot>
                            <tr>
                              <td colSpan={2} className="ds-payouts-total-label">
                                Итого к выплате:
                              </td>
                              <td className="ds-payouts-total-sum">
                                {fmtMoney(
                                  payouts.reduce(
                                    (sum, payout) => sum + (payout.amount || 0),
                                    0
                                  )
                                )}{" "}
                                ₽
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

/** Все месяцы, которые есть в снимке версии. */
function collectMonths(snapshot: DutyScheduleRevisionSnapshot): string[] {
  const months = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (/^\d{4}-\d{2}$/.test(key)) months.add(key);
    }
  };
  collect(snapshot.state.schedules);
  collect(snapshot.state.amountOverrides);
  collect(snapshot.state.salaryAccruals);
  collect(snapshot.state.salaryPayouts);
  collect(snapshot.state.payoutTitles);
  return [...months].sort();
}
