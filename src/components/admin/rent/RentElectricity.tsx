// =========================================================
// FILE: src/components/admin/rent/RentElectricity.tsx
// Модуль расчёта электроэнергии арендаторов по счётчикам:
//   - Помесячная ведомость показаний (Нач. показание авто из
//     прошлого месяца, ввод Кон. показания, мгновенный расчёт
//     расхода кВт⋅ч и суммы по индивидуальному тарифу, по стандарту 9 ₽)
//   - Автоматическая запись итогов в счета за ЭЭ (кто сколько должен)
//   - Модальное окно полной истории показаний по клику на арендатора
//   - Выгрузка ведомости на печать / PDF
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
  Zap,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  calcElectricityReading,
  DEFAULT_ELECTRICITY_TARIFF,
  electricityPeriodMonthKey,
  findPreviousReading,
  isElectricityInvoice,
  normalizeElectricityPeriod,
  rentFmt,
  rentFmtDate,
  rentFmtDec,
  rentInvoiceState,
  rentMonthLabel,
  rentTodayIso,
  roundMoney2,
  roundReading1,
  shiftElectricityMonth,
  stripElectricityTag,
  RENT_INVOICE_STATE_LABELS,
  type RentInvoice,
  type RentInvoiceState,
  type RentMeterReading,
  type RentOrg,
  type RentPayment,
  type RentTenant,
} from "@/lib/rent-shared";
import { QuickPayModal } from "./RentInvoices";
import { useEscapeClose } from "@/hooks/use-escape-close";

const STATE_BADGE: Record<RentInvoiceState, string> = {
  paid: "admin-badge admin-badge--green",
  cancelled: "admin-badge admin-badge--muted",
  overdue: "admin-badge admin-badge--red",
  grace: "admin-badge admin-badge--amber",
  due_today: "admin-badge admin-badge--amber",
  upcoming: "admin-badge admin-badge--amber",
  awaiting: "admin-badge admin-badge--blue",
};

interface DraftRow {
  readingStart: string;
  readingEnd: string;
  tariff: string;
  dirty: boolean;
}

function fmtInputNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return String(v);
}

function parseInputNum(raw: string): number | null {
  const clean = String(raw || "")
    .trim()
    .replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export function RentElectricity({
  adminPath,
  readOnly,
  orgs,
  tenants: initialTenants,
  invoices: initialInvoices,
  payments,
  meterReadings: initialReadings,
}: {
  adminPath: string;
  readOnly: boolean;
  orgs: RentOrg[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  payments: RentPayment[];
  meterReadings: RentMeterReading[];
}) {
  void adminPath;
  const router = useRouter();
  const today = rentTodayIso();
  const currentMonthKey = today.slice(0, 7);

  const [tenants, setTenants] = useState<RentTenant[]>(initialTenants);
  const [invoices, setInvoices] = useState<RentInvoice[]>(initialInvoices);
  const [readings, setReadings] = useState<RentMeterReading[]>(initialReadings);

  useEffect(() => setTenants(initialTenants), [initialTenants]);
  useEffect(() => setInvoices(initialInvoices), [initialInvoices]);
  useEffect(() => setReadings(initialReadings), [initialReadings]);

  // Список доступных месяцев (из показаний + текущий + предыдущие)
  const [extraMonths, setExtraMonths] = useState<string[]>([]);
  const monthOptions = useMemo(() => {
    const set = new Set<string>([
      currentMonthKey,
      shiftElectricityMonth(currentMonthKey, -1),
      shiftElectricityMonth(currentMonthKey, -2),
      ...extraMonths,
    ]);
    for (const r of readings) {
      set.add(electricityPeriodMonthKey(r.period));
    }
    for (const inv of invoices) {
      if (isElectricityInvoice(inv)) {
        set.add(inv.periodStart.slice(0, 7));
      }
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [readings, invoices, currentMonthKey, extraMonths]);

  const [activeMonth, setActiveMonth] = useState<string>(() => {
    // По умолчанию выбираем самый свежий месяц с показаниями или текущий месяц
    const fromReadings = initialReadings
      .map((r) => electricityPeriodMonthKey(r.period))
      .sort((a, b) => b.localeCompare(a))[0];
    return fromReadings || currentMonthKey;
  });

  const activePeriod = useMemo(
    () => normalizeElectricityPeriod(activeMonth),
    [activeMonth]
  );

  const [orgFilter, setOrgFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [debtFilter, setDebtFilter] = useState<"unpaid" | "paid" | "all">("unpaid");

  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [savingTenantId, setSavingTenantId] = useState("");
  const [busyInvoiceId, setBusyInvoiceId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [historyTenant, setHistoryTenant] = useState<RentTenant | null>(null);
  const [paying, setPaying] = useState<{
    inv: RentInvoice;
    tenant?: RentTenant;
  } | null>(null);

  const endInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Оплаты по счетам
  const paidByInvoice = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (p.isPaid && p.direction === "incoming" && p.invoiceId) {
        m.set(p.invoiceId, (m.get(p.invoiceId) || 0) + p.amount);
      }
    }
    return m;
  }, [payments]);

  const invoiceHasPayments = useMemo(() => {
    const s = new Set<string>();
    for (const p of payments) if (p.invoiceId) s.add(p.invoiceId);
    return s;
  }, [payments]);

  // Пересчитываем черновики при смене месяца или поступлении новых данных
  useEffect(() => {
    const next: Record<string, DraftRow> = {};
    for (const t of tenants) {
      const existing = readings.find(
        (r) =>
          r.tenantId === t.id &&
          normalizeElectricityPeriod(r.period) === activePeriod
      );
      const prev = findPreviousReading(readings, t.id, activePeriod);
      const defaultStart =
        existing?.readingStart != null
          ? existing.readingStart
          : prev?.readingEnd != null
            ? prev.readingEnd
            : null;
      const defaultTariff =
        existing?.tariff != null && existing.tariff > 0
          ? existing.tariff
          : t.electricityTariff || DEFAULT_ELECTRICITY_TARIFF;

      next[t.id] = {
        readingStart: fmtInputNum(defaultStart),
        readingEnd: fmtInputNum(existing?.readingEnd ?? null),
        tariff: fmtInputNum(defaultTariff),
        dirty: false,
      };
    }
    setDrafts(next);
    setError("");
  }, [activePeriod, tenants, readings]);

  function updateDraft(
    tenantId: string,
    field: "readingStart" | "readingEnd" | "tariff",
    value: string
  ) {
    setDrafts((prev) => {
      const cur = prev[tenantId] || {
        readingStart: "",
        readingEnd: "",
        tariff: String(DEFAULT_ELECTRICITY_TARIFF),
        dirty: false,
      };
      return {
        ...prev,
        [tenantId]: {
          ...cur,
          [field]: value,
          dirty: true,
        },
      };
    });
  }

  // Строки таблицы за выбранный месяц
  const tableRows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("ru-RU");
    return tenants
      .filter((t) => (showArchived ? true : t.status === "active"))
      .filter((t) => orgFilter === "all" || t.orgId === orgFilter)
      .filter(
        (t) =>
          !q ||
          t.name.toLocaleLowerCase("ru-RU").includes(q) ||
          (t.office || "").toLocaleLowerCase("ru-RU").includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"))
      .map((tenant) => {
        const savedReading =
          readings.find(
            (r) =>
              r.tenantId === tenant.id &&
              normalizeElectricityPeriod(r.period) === activePeriod
          ) || null;
        const prevReading = findPreviousReading(readings, tenant.id, activePeriod);
        const draft = drafts[tenant.id] || {
          readingStart: fmtInputNum(
            savedReading?.readingStart ?? prevReading?.readingEnd ?? null
          ),
          readingEnd: fmtInputNum(savedReading?.readingEnd ?? null),
          tariff: fmtInputNum(
            savedReading?.tariff ??
              tenant.electricityTariff ??
              DEFAULT_ELECTRICITY_TARIFF
          ),
          dirty: false,
        };

        const startNum = parseInputNum(draft.readingStart);
        const endNum = parseInputNum(draft.readingEnd);
        const tariffNum =
          parseInputNum(draft.tariff) ??
          tenant.electricityTariff ??
          DEFAULT_ELECTRICITY_TARIFF;

        const calc = calcElectricityReading(startNum, endNum, tariffNum);
        const isAutoStart =
          prevReading?.readingEnd != null &&
          startNum != null &&
          Math.abs(roundReading1(startNum) - roundReading1(prevReading.readingEnd)) < 0.001;
        const hasPrevDiscrepancy =
          prevReading?.readingEnd != null &&
          startNum != null &&
          Math.abs(roundReading1(startNum) - roundReading1(prevReading.readingEnd)) >= 0.05;

        // Связанный счёт за ЭЭ за этот месяц
        const linkedInvoice =
          (savedReading?.invoiceId
            ? invoices.find((i) => i.id === savedReading.invoiceId)
            : null) ||
          invoices.find(
            (i) =>
              i.tenantId === tenant.id &&
              i.periodStart === activePeriod &&
              isElectricityInvoice(i) &&
              i.status !== "cancelled"
          ) ||
          null;

        const invoicePaidSum = linkedInvoice
          ? paidByInvoice.get(linkedInvoice.id) || 0
          : 0;
        const invoiceRemaining = linkedInvoice
          ? linkedInvoice.status === "paid"
            ? 0
            : Math.max(0, linkedInvoice.amount - invoicePaidSum)
          : 0;

        return {
          tenant,
          savedReading,
          prevReading,
          draft,
          startNum,
          endNum,
          tariffNum,
          calc,
          isAutoStart,
          hasPrevDiscrepancy,
          linkedInvoice,
          invoicePaidSum,
          invoiceRemaining,
        };
      });
  }, [
    tenants,
    showArchived,
    orgFilter,
    query,
    readings,
    activePeriod,
    drafts,
    invoices,
    paidByInvoice,
  ]);

  // Итоги по таблице за выбранный месяц
  const totals = useMemo(() => {
    let consumption = 0;
    let amount = 0;
    let filledCount = 0;
    let dirtyCount = 0;
    let hasError = false;
    let monthUnpaidDebt = 0;

    for (const r of tableRows) {
      if (r.draft.dirty) dirtyCount++;
      if (r.calc.error) hasError = true;
      if (r.startNum != null && r.endNum != null && r.calc.valid) {
        consumption = roundReading1(consumption + r.calc.consumption);
        amount = roundMoney2(amount + r.calc.amount);
        filledCount++;
      }
      if (r.linkedInvoice && r.linkedInvoice.status === "awaiting") {
        monthUnpaidDebt = roundMoney2(monthUnpaidDebt + r.invoiceRemaining);
      }
    }
    return {
      consumption,
      amount,
      filledCount,
      dirtyCount,
      hasError,
      monthUnpaidDebt,
    };
  }, [tableRows]);

  // Все счета за электроэнергию (кто сколько должен)
  const electricityInvoices = useMemo(() => {
    const tenantById = Object.fromEntries(tenants.map((t) => [t.id, t]));
    return invoices
      .filter((inv) => isElectricityInvoice(inv))
      .map((inv) => {
        const tenant = tenantById[inv.tenantId];
        const state = rentInvoiceState(inv, tenant?.deferralDays ?? 0, today);
        const paidSum = paidByInvoice.get(inv.id) || 0;
        const remaining =
          inv.status === "paid" || inv.status === "cancelled"
            ? 0
            : Math.max(0, roundMoney2(inv.amount - paidSum));
        const reading =
          readings.find(
            (r) =>
              r.invoiceId === inv.id ||
              (r.tenantId === inv.tenantId &&
                normalizeElectricityPeriod(r.period) === inv.periodStart)
          ) || null;
        return { inv, tenant, state, paidSum, remaining, reading };
      })
      .filter(({ inv }) => orgFilter === "all" || inv.orgId === orgFilter)
      .filter(({ state }) => {
        if (debtFilter === "all") return state !== "cancelled";
        if (debtFilter === "unpaid") return state !== "paid" && state !== "cancelled";
        return state === "paid";
      })
      .sort((a, b) => b.inv.periodStart.localeCompare(a.inv.periodStart));
  }, [invoices, tenants, today, paidByInvoice, readings, orgFilter, debtFilter]);

  // Сводка долгов по арендаторам за ЭЭ (кто сколько должен всего)
  const debtorSummary = useMemo(() => {
    const map = new Map<
      string,
      { tenant: RentTenant; debt: number; count: number; kwh: number }
    >();
    const tenantById = Object.fromEntries(tenants.map((t) => [t.id, t]));
    for (const inv of invoices) {
      if (!isElectricityInvoice(inv) || inv.status !== "awaiting") continue;
      const tenant = tenantById[inv.tenantId];
      if (!tenant) continue;
      if (orgFilter !== "all" && inv.orgId !== orgFilter) continue;
      const paidSum = paidByInvoice.get(inv.id) || 0;
      const rem = Math.max(0, roundMoney2(inv.amount - paidSum));
      if (rem <= 0) continue;
      const reading = readings.find(
        (r) =>
          r.invoiceId === inv.id ||
          (r.tenantId === inv.tenantId &&
            normalizeElectricityPeriod(r.period) === inv.periodStart)
      );
      const cur = map.get(tenant.id) || {
        tenant,
        debt: 0,
        count: 0,
        kwh: 0,
      };
      cur.debt = roundMoney2(cur.debt + rem);
      cur.count += 1;
      if (reading) cur.kwh = roundReading1(cur.kwh + reading.consumption);
      map.set(tenant.id, cur);
    }
    return [...map.values()].sort((a, b) => b.debt - a.debt);
  }, [invoices, tenants, orgFilter, paidByInvoice, readings]);

  const totalElectricityDebt = useMemo(
    () => roundMoney2(debtorSummary.reduce((s, d) => s + d.debt, 0)),
    [debtorSummary]
  );

  const orgName = (id: string) =>
    orgs.find((o) => o.id === id)?.shortName || id;

  // Кнопка «+ Добавить месяц»: создаёт записи нового месяца для всех активных
  // арендаторов и автоматически переносит конечные показания прошлого месяца в начальные.
  async function handleAddNextMonth() {
    const latestMonth = monthOptions[0] || currentMonthKey;
    const nextMonth =
      activeMonth === latestMonth
        ? shiftElectricityMonth(latestMonth, 1)
        : shiftElectricityMonth(activeMonth, 1);
    const nextPeriod = normalizeElectricityPeriod(nextMonth);
    if (!extraMonths.includes(nextMonth)) {
      setExtraMonths((prev) => [...prev, nextMonth]);
    }
    setActiveMonth(nextMonth);

    const activeList = tenants.filter((t) => t.status === "active");
    if (activeList.length === 0) {
      setNotice(`Открыт период ${rentMonthLabel(nextMonth)}.`);
      return;
    }

    const bulkItems = activeList
      .filter(
        (t) =>
          !readings.some(
            (r) =>
              r.tenantId === t.id &&
              normalizeElectricityPeriod(r.period) === nextPeriod
          )
      )
      .map((t) => {
        const prev = findPreviousReading(readings, t.id, nextPeriod);
        return {
          tenantId: t.id,
          period: nextPeriod,
          tariff: t.electricityTariff || DEFAULT_ELECTRICITY_TARIFF,
          readingStart: prev?.readingEnd ?? null,
          readingEnd: null,
          syncInvoice: false,
          updateTenantTariff: false,
        };
      });

    if (bulkItems.length === 0) {
      setNotice(
        `Открыт расчёт за ${rentMonthLabel(nextMonth)}. Начальные показания подставлены из прошлого месяца.`
      );
      return;
    }

    setSavingAll(true);
    setError("");
    try {
      const res = await fetch("/api/admin/rent/electricity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: bulkItems, syncInvoice: false }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.readings)) {
        setReadings((prev) => {
          const map = new Map<string, RentMeterReading>();
          for (const r of prev) {
            map.set(
              `${r.tenantId}:${normalizeElectricityPeriod(r.period)}`,
              r
            );
          }
          for (const r of data.readings as RentMeterReading[]) {
            map.set(
              `${r.tenantId}:${normalizeElectricityPeriod(r.period)}`,
              r
            );
          }
          return [...map.values()];
        });
      }
      setNotice(
        `Добавлен месяц ${rentMonthLabel(nextMonth)} для ${bulkItems.length} активных арендаторов. Начальные показания автоматически перенесены из прошлого месяца.`
      );
      router.refresh();
    } catch {
      setNotice(
        `Открыт расчёт за ${rentMonthLabel(nextMonth)}. Начальные показания автоматически перенесены из предыдущего месяца.`
      );
    } finally {
      setSavingAll(false);
    }
  }

  // Сохранение одной строки арендатора
  async function saveSingleRow(row: (typeof tableRows)[number]) {
    if (row.calc.error) {
      setError(`«${row.tenant.name}»: ${row.calc.error}`);
      return;
    }
    setSavingTenantId(row.tenant.id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rent/electricity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              tenantId: row.tenant.id,
              period: activePeriod,
              tariff: row.tariffNum,
              readingStart: row.startNum,
              readingEnd: row.endNum,
              syncInvoice: true,
              updateTenantTariff: true,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить");

      if (Array.isArray(data.readings) && data.readings[0]) {
        const saved: RentMeterReading = data.readings[0];
        setReadings((prev) => {
          const rest = prev.filter(
            (r) =>
              !(
                r.tenantId === saved.tenantId &&
                normalizeElectricityPeriod(r.period) ===
                  normalizeElectricityPeriod(saved.period)
              )
          );
          return [saved, ...rest];
        });
      }
      setDrafts((prev) => ({
        ...prev,
        [row.tenant.id]: {
          ...(prev[row.tenant.id] || row.draft),
          dirty: false,
        },
      }));
      setNotice(
        `Показания «${row.tenant.name}» сохранены${
          row.calc.amount > 0
            ? ` · начислено ${rentFmt(row.calc.amount)} ₽ в счёт за ЭЭ`
            : ""
        }.`
      );
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка сохранения");
    } finally {
      setSavingTenantId("");
    }
  }

  // Пакетное сохранение всех строк за выбранный месяц
  async function saveAllForMonth() {
    for (const row of tableRows) {
      if (row.calc.error) {
        setError(`«${row.tenant.name}»: ${row.calc.error}`);
        return;
      }
    }
    const itemsToSave = tableRows
      .filter(
        (r) =>
          r.draft.dirty ||
          r.startNum != null ||
          r.endNum != null ||
          r.savedReading != null
      )
      .map((r) => ({
        tenantId: r.tenant.id,
        period: activePeriod,
        tariff: r.tariffNum,
        readingStart: r.startNum,
        readingEnd: r.endNum,
        syncInvoice: true,
        updateTenantTariff: true,
      }));

    if (itemsToSave.length === 0) {
      setNotice("Нет данных для сохранения за выбранный месяц.");
      return;
    }

    setSavingAll(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rent/electricity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: itemsToSave }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка пакетного сохранения");

      if (Array.isArray(data.readings)) {
        setReadings((prev) => {
          const map = new Map<string, RentMeterReading>();
          for (const r of prev) {
            map.set(
              `${r.tenantId}:${normalizeElectricityPeriod(r.period)}`,
              r
            );
          }
          for (const r of data.readings as RentMeterReading[]) {
            map.set(
              `${r.tenantId}:${normalizeElectricityPeriod(r.period)}`,
              r
            );
          }
          return [...map.values()];
        });
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          next[k] = { ...next[k], dirty: false };
        }
        return next;
      });
      const invMsg =
        data.invoicesCreated || data.invoicesUpdated
          ? ` Счета за ЭЭ: выставлено ${data.invoicesCreated || 0}, обновлено ${data.invoicesUpdated || 0}.`
          : "";
      setNotice(
        `Ведомость за ${rentMonthLabel(activeMonth)} сохранена (${itemsToSave.length} аренд.).${invMsg}`
      );
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка сохранения");
    } finally {
      setSavingAll(false);
    }
  }

  async function patchElectricityInvoice(
    inv: RentInvoice,
    patch: Record<string, unknown>
  ) {
    setBusyInvoiceId(inv.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка");
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setBusyInvoiceId("");
    }
  }

  // Выгрузка ведомости на печать / PDF
  function handlePrintStatement() {
    const win = window.open("", "_blank", "width=980,height=720");
    if (!win) {
      window.print();
      return;
    }
    const rowsHtml = tableRows
      .map(
        (r, idx) => `
        <tr>
          <td style="text-align:center">${idx + 1}</td>
          <td><b>${r.tenant.name}</b>${r.tenant.office ? `<div style="font-size:11px;color:#666">${r.tenant.office}</div>` : ""}</td>
          <td style="text-align:center">${orgName(r.tenant.orgId)}</td>
          <td style="text-align:right">${rentFmtDec(r.tariffNum, 2)}</td>
          <td style="text-align:right">${r.startNum != null ? rentFmtDec(r.startNum, 1) : "—"}</td>
          <td style="text-align:right">${r.endNum != null ? rentFmtDec(r.endNum, 1) : "—"}</td>
          <td style="text-align:right;font-weight:600">${r.startNum != null && r.endNum != null && r.calc.valid ? rentFmtDec(r.calc.consumption, 1) : "—"}</td>
          <td style="text-align:right;font-weight:700">${r.startNum != null && r.endNum != null && r.calc.valid ? `${rentFmt(r.calc.amount)} ₽` : "—"}</td>
          <td style="text-align:center">${
            r.linkedInvoice
              ? r.linkedInvoice.status === "paid"
                ? "Оплачен"
                : `Долг ${rentFmt(r.invoiceRemaining)} ₽`
              : r.calc.amount > 0
                ? `К оплате ${rentFmt(r.calc.amount)} ₽`
                : "—"
          }</td>
        </tr>`
      )
      .join("");

    win.document.write(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Ведомость расчёта электроэнергии — ${rentMonthLabel(activeMonth)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1a1a18; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #555; font-size: 13px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 7px 9px; }
    th { background: #f4f2ed; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
    tfoot td { background: #f4f2ed; font-weight: 700; font-size: 14px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Ведомость расчёта электроэнергии арендаторов</h1>
  <div class="sub">Период: <b>${rentMonthLabel(activeMonth)}</b> · Дата формирования: ${rentFmtDate(today)}</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">№</th>
        <th>Арендатор</th>
        <th>Орг.</th>
        <th>Тариф, ₽/кВт⋅ч</th>
        <th>Нач. показание</th>
        <th>Кон. показание</th>
        <th>Расход, кВт⋅ч</th>
        <th>Сумма, руб.</th>
        <th>Статус счёта за ЭЭ</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" style="text-align:right">ИТОГО за ${rentMonthLabel(activeMonth)}:</td>
        <td style="text-align:right">${rentFmtDec(totals.consumption, 1)} кВт⋅ч</td>
        <td style="text-align:right">${rentFmt(totals.amount)} ₽</td>
        <td style="text-align:center">${totals.monthUnpaidDebt > 0 ? `Не оплачено: ${rentFmt(totals.monthUnpaidDebt)} ₽` : ""}</td>
      </tr>
    </tfoot>
  </table>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <div className="admin-stack">
      {/* ── Сводные карточки ── */}
      <div className="admin-stat-grid">
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{
              background: "var(--adm-kraft-pale)",
              color: "var(--adm-kraft)",
            }}
          >
            <Zap size={16} />
          </div>
          <div>
            <div className="admin-stat__label">
              Расход за {rentMonthLabel(activeMonth).toLocaleLowerCase("ru-RU")}
            </div>
            <div className="admin-stat__value">
              {rentFmtDec(totals.consumption, 1)} кВт⋅ч
            </div>
            <div className="admin-muted" style={{ fontSize: 12 }}>
              заполнено {totals.filledCount} из {tableRows.length} аренд.
            </div>
          </div>
        </div>

        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{
              background: "var(--adm-steel-pale)",
              color: "var(--adm-steel)",
            }}
          >
            <Banknote size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Начислено за месяц</div>
            <div className="admin-stat__value">{rentFmt(totals.amount)} ₽</div>
            <div className="admin-muted" style={{ fontSize: 12 }}>
              стандартный тариф {DEFAULT_ELECTRICITY_TARIFF} ₽/кВт⋅ч
            </div>
          </div>
        </div>

        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{
              background:
                totalElectricityDebt > 0
                  ? "var(--adm-rust-pale)"
                  : "var(--adm-pine-pale)",
              color:
                totalElectricityDebt > 0
                  ? "var(--adm-rust)"
                  : "var(--adm-pine)",
            }}
          >
            <AlertTriangle size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Должны за ЭЭ (по счетам)</div>
            <div
              className="admin-stat__value"
              style={{
                color:
                  totalElectricityDebt > 0
                    ? "var(--adm-rust)"
                    : "var(--adm-pine)",
              }}
            >
              {rentFmt(totalElectricityDebt)} ₽
            </div>
            <div className="admin-muted" style={{ fontSize: 12 }}>
              {debtorSummary.length > 0
                ? `${debtorSummary.length} аренд. ждут оплаты`
                : "все счета за ЭЭ оплачены"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Верхняя панель управления периодом ── */}
      <div className="admin-card" style={{ padding: "14px 16px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className="admin-btn admin-btn--icon admin-btn--outline"
              title="Предыдущий месяц"
              onClick={() =>
                setActiveMonth((m) => shiftElectricityMonth(m, -1))
              }
            >
              <ChevronLeft size={15} />
            </button>
            <input
              type="month"
              className="admin-input"
              style={{ width: 165, fontWeight: 600 }}
              value={activeMonth}
              onChange={(e) => {
                if (e.target.value) setActiveMonth(e.target.value);
              }}
            />
            <button
              type="button"
              className="admin-btn admin-btn--icon admin-btn--outline"
              title="Следующий месяц"
              onClick={() =>
                setActiveMonth((m) => shiftElectricityMonth(m, 1))
              }
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {!readOnly && (
            <button
              type="button"
              className="admin-btn admin-btn--outline"
              onClick={handleAddNextMonth}
              title="Открыть следующий месяц и автоматически перенести конечные показания прошлого месяца в начальные"
            >
              <CalendarPlus size={14} /> + Добавить месяц
            </button>
          )}

          <select
            className="admin-select"
            style={{ width: "auto" }}
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
          >
            <option value="all">Все организации</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName}
              </option>
            ))}
          </select>

          <div
            className="admin-field"
            style={{ position: "relative", minWidth: 210, marginBottom: 0 }}
          >
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                opacity: 0.5,
              }}
            />
            <input
              className="admin-input"
              style={{ paddingLeft: 32 }}
              placeholder="Поиск арендатора, офиса…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              cursor: "pointer",
              color: "var(--adm-ink-soft)",
            }}
          >
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Показать архивных
          </label>

          <span style={{ flex: 1 }} />

          <button
            type="button"
            className="admin-btn admin-btn--outline"
            onClick={handlePrintStatement}
            title="Печать или сохранение ведомости за месяц в PDF"
          >
            <Printer size={14} /> Печать / PDF
          </button>

          {!readOnly && (
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={savingAll || totals.hasError}
              onClick={saveAllForMonth}
              title="Сохранить все показания за месяц и автоматически записать суммы в счета за ЭЭ"
            >
              {savingAll ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              Сохранить и выставить счета за ЭЭ
              {totals.dirtyCount > 0 ? ` (${totals.dirtyCount})` : ""}
            </button>
          )}
        </div>

        {/* Быстрые вкладки месяцев */}
        <div
          className="admin-filters admin-filters--sub"
          style={{ marginTop: 10, marginBottom: 0 }}
        >
          {monthOptions.slice(0, 12).map((mKey) => (
            <button
              key={mKey}
              type="button"
              className={`admin-filter${
                activeMonth === mKey ? " admin-filter--active" : ""
              }`}
              onClick={() => setActiveMonth(mKey)}
            >
              {rentMonthLabel(mKey)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {notice && <div className="admin-success">{notice}</div>}

      {/* ── Основная таблица расчёта за выбранный месяц ── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <div>
            <h3 className="admin-card__title">
              Показания счётчиков — {rentMonthLabel(activeMonth)}
            </h3>
            <div className="admin-muted" style={{ fontSize: 12, marginTop: 2 }}>
              Начальное показание подставляется автоматически из конечного за
              прошлый месяц. Введите конечное показание — расход и сумма
              рассчитаются мгновенно, а при сохранении запишутся в счета за ЭЭ.
            </div>
          </div>
          <span className="admin-muted" style={{ fontSize: 13 }}>
            Итого: <b>{rentFmtDec(totals.consumption, 1)} кВт⋅ч</b> на сумму{" "}
            <b>{rentFmt(totals.amount)} ₽</b>
          </span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Арендатор</th>
                <th style={{ width: 120 }}>Тариф (₽/кВт⋅ч)</th>
                <th style={{ width: 175 }}>Нач. показание</th>
                <th style={{ width: 175 }}>Кон. показание</th>
                <th style={{ width: 135, textAlign: "right" }}>
                  Расход (кВт⋅ч)
                </th>
                <th style={{ width: 145, textAlign: "right" }}>Сумма (руб.)</th>
                <th style={{ width: 210 }}>Счёт за ЭЭ (долг)</th>
                <th style={{ width: 95 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="admin-table__empty">
                    Активные арендаторы не найдены
                  </td>
                </tr>
              )}
              {tableRows.map((row, idx) => {
                const {
                  tenant,
                  prevReading,
                  draft,
                  startNum,
                  endNum,
                  calc,
                  isAutoStart,
                  hasPrevDiscrepancy,
                  linkedInvoice,
                  invoicePaidSum,
                  invoiceRemaining,
                } = row;
                const nextRowTenantId = tableRows[idx + 1]?.tenant.id;
                const invState = linkedInvoice
                  ? rentInvoiceState(
                      linkedInvoice,
                      tenant.deferralDays ?? 0,
                      today
                    )
                  : null;

                return (
                  <tr
                    key={tenant.id}
                    style={
                      tenant.status === "archived"
                        ? { opacity: 0.6 }
                        : draft.dirty
                          ? { background: "var(--adm-paper-warm)" }
                          : undefined
                    }
                  >
                    {/* Арендатор (клик открывает модалку истории за все месяцы) */}
                    <td>
                      <button
                        type="button"
                        onClick={() => setHistoryTenant(tenant)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          fontWeight: 600,
                          color: "var(--adm-ink)",
                          fontSize: 13.5,
                        }}
                        title="Открыть историю показаний арендатора за все месяцы"
                      >
                        {tenant.name}
                      </button>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {tenant.office ? `${tenant.office} · ` : ""}
                        {orgName(tenant.orgId)}
                      </div>
                    </td>

                    {/* Тариф */}
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        disabled={readOnly}
                        className="admin-input"
                        style={{
                          padding: "5px 8px",
                          fontVariantNumeric: "tabular-nums",
                        }}
                        value={draft.tariff}
                        onChange={(e) =>
                          updateDraft(tenant.id, "tariff", e.target.value)
                        }
                        title="Индивидуальный тариф руб./кВт⋅ч (по стандарту 9.0)"
                      />
                    </td>

                    {/* Начальное показание */}
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="number"
                          step="0.1"
                          disabled={readOnly}
                          className="admin-input"
                          style={{
                            padding: "5px 8px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                          placeholder={
                            prevReading?.readingEnd != null
                              ? String(prevReading.readingEnd)
                              : "вручную"
                          }
                          value={draft.readingStart}
                          onChange={(e) =>
                            updateDraft(tenant.id, "readingStart", e.target.value)
                          }
                        />
                        {isAutoStart && (
                          <span
                            className="admin-badge admin-badge--muted"
                            style={{ flexShrink: 0, fontSize: 10 }}
                            title={`Подставлено автоматически из конечного показания за ${rentMonthLabel(
                              electricityPeriodMonthKey(prevReading!.period)
                            )}`}
                          >
                            авто
                          </span>
                        )}
                      </div>
                      {hasPrevDiscrepancy && prevReading && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 3,
                            fontSize: 11,
                            color: "var(--adm-kraft)",
                          }}
                          title="Начальное показание текущего месяца отличается от конечного показания предыдущего месяца. Прошлый месяц автоматически не меняется."
                        >
                          <AlertTriangle size={11} />
                          <span>
                            Прошл. мес.: <b>{rentFmtDec(prevReading.readingEnd, 1)}</b>
                          </span>
                          {!readOnly && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              style={{ padding: "0 4px", height: 18, fontSize: 10 }}
                              onClick={() =>
                                updateDraft(
                                  tenant.id,
                                  "readingStart",
                                  String(prevReading.readingEnd)
                                )
                              }
                              title="Вернуть значение из предыдущего месяца"
                            >
                              <RotateCcw size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Конечное показание */}
                    <td>
                      <input
                        ref={(el) => {
                          endInputRefs.current[tenant.id] = el;
                        }}
                        type="number"
                        step="0.1"
                        disabled={readOnly}
                        className="admin-input"
                        style={{
                          padding: "5px 8px",
                          fontVariantNumeric: "tabular-nums",
                          borderColor: calc.error ? "var(--adm-rust)" : undefined,
                        }}
                        placeholder="ввод…"
                        value={draft.readingEnd}
                        onChange={(e) =>
                          updateDraft(tenant.id, "readingEnd", e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (
                            (e.key === "Enter" || e.key === "ArrowDown") &&
                            nextRowTenantId
                          ) {
                            e.preventDefault();
                            endInputRefs.current[nextRowTenantId]?.focus();
                          }
                        }}
                      />
                      {calc.error && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--adm-rust)",
                            marginTop: 2,
                            fontWeight: 600,
                          }}
                        >
                          {calc.error}
                        </div>
                      )}
                    </td>

                    {/* Расход (кВт⋅ч) */}
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 600,
                        color:
                          startNum != null && endNum != null
                            ? calc.valid
                              ? "var(--adm-ink)"
                              : "var(--adm-rust)"
                            : "var(--adm-muted)",
                      }}
                    >
                      {startNum != null && endNum != null
                        ? `${rentFmtDec(calc.consumption, 1)} кВт⋅ч`
                        : "—"}
                    </td>

                    {/* Сумма (руб.) */}
                    <td
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: 700,
                        fontSize: 14,
                        color:
                          startNum != null && endNum != null && calc.valid
                            ? "var(--adm-ink)"
                            : "var(--adm-muted)",
                      }}
                    >
                      {startNum != null && endNum != null && calc.valid
                        ? `${rentFmt(calc.amount)} ₽`
                        : "—"}
                    </td>

                    {/* Счёт за ЭЭ / Долг */}
                    <td>
                      {linkedInvoice && invState ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 3,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "wrap",
                            }}
                          >
                            <span className="admin-muted" style={{ fontSize: 11.5 }}>
                              ЭЭ-{linkedInvoice.number}
                            </span>
                            <span className={STATE_BADGE[invState]}>
                              {invState === "paid"
                                ? "Оплачен"
                                : `Долг ${rentFmt(invoiceRemaining)} ₽`}
                            </span>
                            {!readOnly && linkedInvoice.status === "awaiting" && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--outline"
                                style={{ width: 24, height: 24 }}
                                title="Принять оплату за электроэнергию"
                                onClick={() =>
                                  setPaying({ inv: linkedInvoice, tenant })
                                }
                              >
                                <Banknote size={12} />
                              </button>
                            )}
                            {!readOnly &&
                              linkedInvoice.status === "awaiting" &&
                              !invoiceHasPayments.has(linkedInvoice.id) && (
                                <button
                                  type="button"
                                  className="admin-btn admin-btn--icon admin-btn--ghost"
                                  style={{ width: 24, height: 24 }}
                                  disabled={busyInvoiceId === linkedInvoice.id}
                                  title="Отметить счёт за ЭЭ оплаченным"
                                  onClick={() =>
                                    patchElectricityInvoice(linkedInvoice, {
                                      status: "paid",
                                    })
                                  }
                                >
                                  <CheckCircle2 size={12} />
                                </button>
                              )}
                          </div>
                          {invoicePaidSum > 0 &&
                            linkedInvoice.status === "awaiting" && (
                              <div className="admin-muted" style={{ fontSize: 11 }}>
                                внесено {rentFmt(invoicePaidSum)} ₽ из{" "}
                                {rentFmt(linkedInvoice.amount)} ₽
                              </div>
                            )}
                        </div>
                      ) : calc.valid && calc.amount > 0 ? (
                        <span
                          className="admin-badge admin-badge--amber"
                          title="Нажмите «Сохранить», чтобы записать начисление в счета за ЭЭ"
                        >
                          К выставлению: {rentFmt(calc.amount)} ₽
                        </span>
                      ) : (
                        <span className="admin-muted" style={{ fontSize: 12 }}>
                          —
                        </span>
                      )}
                    </td>

                    {/* Действия */}
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {!readOnly && (
                          <button
                            type="button"
                            className={`admin-btn admin-btn--icon ${
                              draft.dirty
                                ? "admin-btn--primary"
                                : "admin-btn--ghost"
                            }`}
                            disabled={
                              savingTenantId === tenant.id || Boolean(calc.error)
                            }
                            title="Сохранить строку и обновить счёт за ЭЭ"
                            onClick={() => saveSingleRow(row)}
                          >
                            {savingTenantId === tenant.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          className="admin-btn admin-btn--icon admin-btn--ghost"
                          title="История показаний арендатора за все месяцы и редактирование"
                          onClick={() => setHistoryTenant(tenant)}
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {tableRows.length > 0 && (
              <tfoot>
                <tr
                  style={{
                    background: "var(--adm-paper-warm)",
                    fontWeight: 700,
                  }}
                >
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    ИТОГО за {rentMonthLabel(activeMonth)}:
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 14,
                    }}
                  >
                    {rentFmtDec(totals.consumption, 1)} кВт⋅ч
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 15,
                    }}
                  >
                    {rentFmt(totals.amount)} ₽
                  </td>
                  <td colSpan={2}>
                    {totals.monthUnpaidDebt > 0 ? (
                      <span className="admin-badge admin-badge--red">
                        К оплате за месяц: {rentFmt(totals.monthUnpaidDebt)} ₽
                      </span>
                    ) : totals.amount > 0 ? (
                      <span className="admin-badge admin-badge--green">
                        За месяц долгов нет
                      </span>
                    ) : null}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ── Блок «Счета за ЭЭ — кто сколько должен» ── */}
      <div className="admin-card">
        <div className="admin-card__head">
          <div>
            <h3 className="admin-card__title">
              <Zap
                size={15}
                style={{
                  verticalAlign: "-2px",
                  marginRight: 6,
                  color: "var(--adm-kraft)",
                }}
              />
              Счета за ЭЭ — кто сколько должен
            </h3>
            <div className="admin-muted" style={{ fontSize: 12, marginTop: 2 }}>
              Все выставленные начисления за электроэнергию по показаниям
              счётчиков. Оплата проводится через банк аренды или отмечается
              вручную.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(
              [
                ["unpaid", `Неоплаченные (${debtorSummary.length})`],
                ["paid", "Оплаченные"],
                ["all", "Все счета за ЭЭ"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`admin-filter${
                  debtFilter === k ? " admin-filter--active" : ""
                }`}
                onClick={() => setDebtFilter(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Сводка должников чипами */}
        {debtorSummary.length > 0 && (
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--adm-border-soft)",
              background: "var(--adm-paper)",
            }}
          >
            <div
              className="admin-muted"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              Сейчас должны за электроэнергию — всего{" "}
              <b style={{ color: "var(--adm-rust)" }}>
                {rentFmt(totalElectricityDebt)} ₽
              </b>
              :
            </div>
            <div className="rent-chips">
              {debtorSummary.map((d) => (
                <button
                  key={d.tenant.id}
                  type="button"
                  className="rent-chip"
                  style={{ cursor: "pointer" }}
                  onClick={() => setHistoryTenant(d.tenant)}
                  title="Нажмите, чтобы открыть карточку показаний арендатора"
                >
                  <span>{d.tenant.name}</span>
                  <strong style={{ color: "var(--adm-rust)" }}>
                    {rentFmt(d.debt)} ₽
                  </strong>
                  {d.kwh > 0 && (
                    <span className="admin-muted" style={{ fontSize: 11 }}>
                      ({rentFmtDec(d.kwh, 1)} кВт⋅ч)
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Арендатор</th>
                <th>Период</th>
                <th>Показания и расход</th>
                <th>Сумма счёта</th>
                <th>Остаток долга</th>
                <th>Статус</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {electricityInvoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="admin-table__empty">
                    {debtFilter === "unpaid"
                      ? "Неоплаченных счетов за электроэнергию нет"
                      : "Счетов за электроэнергию ещё нет"}
                  </td>
                </tr>
              )}
              {electricityInvoices.map(
                ({ inv, tenant, state, paidSum, remaining, reading }) => (
                  <tr key={inv.id}>
                    <td className="admin-muted">ЭЭ-{inv.number}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {tenant?.name || "—"}
                      </div>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        {tenant?.office ? `${tenant.office} · ` : ""}
                        {orgName(inv.orgId)}
                      </div>
                    </td>
                    <td>
                      <b>{rentMonthLabel(inv.periodStart.slice(0, 7))}</b>
                      <div className="admin-muted" style={{ fontSize: 12 }}>
                        оплата до {rentFmtDate(inv.dueDate)}
                      </div>
                    </td>
                    <td>
                      {reading &&
                      reading.readingStart != null &&
                      reading.readingEnd != null ? (
                        <div>
                          <b>{rentFmtDec(reading.consumption, 1)} кВт⋅ч</b> ×{" "}
                          {rentFmtDec(reading.tariff, 2)} ₽
                          <div className="admin-muted" style={{ fontSize: 12 }}>
                            счётчик: {rentFmtDec(reading.readingStart, 1)} →{" "}
                            {rentFmtDec(reading.readingEnd, 1)}
                          </div>
                        </div>
                      ) : (
                        <div className="admin-muted" style={{ fontSize: 12 }}>
                          {stripElectricityTag(inv.comment) || "—"}
                        </div>
                      )}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      {rentFmt(inv.amount)} ₽
                    </td>
                    <td>
                      {remaining > 0 ? (
                        <strong style={{ color: "var(--adm-rust)" }}>
                          {rentFmt(remaining)} ₽
                        </strong>
                      ) : (
                        <span className="admin-muted">0 ₽</span>
                      )}
                      {paidSum > 0 && remaining > 0 && (
                        <div className="admin-muted" style={{ fontSize: 11 }}>
                          оплачено {rentFmt(paidSum)} ₽
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={STATE_BADGE[state]}>
                        {RENT_INVOICE_STATE_LABELS[state]}
                      </span>
                      {state === "paid" && inv.paidAt && (
                        <div
                          className="admin-muted"
                          style={{ fontSize: 12, marginTop: 2 }}
                        >
                          {rentFmtDate(inv.paidAt)}
                        </div>
                      )}
                    </td>
                    {!readOnly && (
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          {inv.status === "awaiting" && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--icon admin-btn--outline"
                              title="Принять оплату за электроэнергию"
                              onClick={() => setPaying({ inv, tenant })}
                            >
                              <Banknote size={14} />
                            </button>
                          )}
                          {inv.status === "awaiting" &&
                            !invoiceHasPayments.has(inv.id) && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                disabled={busyInvoiceId === inv.id}
                                title="Отметить оплаченным без платежа"
                                onClick={() =>
                                  patchElectricityInvoice(inv, {
                                    status: "paid",
                                  })
                                }
                              >
                                <CheckCircle2 size={14} />
                              </button>
                            )}
                          {inv.status === "paid" &&
                            !invoiceHasPayments.has(inv.id) && (
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                disabled={busyInvoiceId === inv.id}
                                title="Вернуть в ожидание оплаты"
                                onClick={() =>
                                  patchElectricityInvoice(inv, {
                                    status: "awaiting",
                                  })
                                }
                              >
                                <Undo2 size={14} />
                              </button>
                            )}
                          {tenant && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--icon admin-btn--ghost"
                              title="История показаний арендатора"
                              onClick={() => setHistoryTenant(tenant)}
                            >
                              <History size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Модальное окно истории показаний арендатора ── */}
      {historyTenant && (
        <TenantElectricityHistoryModal
          tenant={historyTenant}
          orgs={orgs}
          readings={readings.filter((r) => r.tenantId === historyTenant.id)}
          invoices={invoices.filter(
            (i) => i.tenantId === historyTenant.id && isElectricityInvoice(i)
          )}
          readOnly={readOnly}
          onClose={() => setHistoryTenant(null)}
          onChanged={(updatedReadings, updatedTariff) => {
            if (updatedTariff != null) {
              setTenants((prev) =>
                prev.map((t) =>
                  t.id === historyTenant.id
                    ? { ...t, electricityTariff: updatedTariff }
                    : t
                )
              );
              setHistoryTenant((prev) =>
                prev ? { ...prev, electricityTariff: updatedTariff } : null
              );
            }
            if (updatedReadings) {
              setReadings((prev) => {
                const other = prev.filter(
                  (r) => r.tenantId !== historyTenant.id
                );
                return [...updatedReadings, ...other];
              });
            }
            router.refresh();
          }}
        />
      )}

      {paying && (
        <QuickPayModal
          invoice={paying.inv}
          tenant={paying.tenant}
          paidBefore={paidByInvoice.get(paying.inv.id) || 0}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  );
}

// ── Модальное окно: история показаний арендатора за все месяцы ──

export function TenantElectricityHistoryModal({
  tenant,
  orgs,
  readings: initialTenantReadings,
  invoices,
  readOnly,
  onClose,
  onChanged,
}: {
  tenant: RentTenant;
  orgs: RentOrg[];
  readings: RentMeterReading[];
  invoices: RentInvoice[];
  readOnly: boolean;
  onClose: () => void;
  onChanged?: (
    updatedReadings?: RentMeterReading[],
    updatedTariff?: number
  ) => void;
}) {
  useEscapeClose(onClose);
  const [tenantReadings, setTenantReadings] = useState<RentMeterReading[]>(
    () =>
      [...initialTenantReadings].sort((a, b) =>
        b.period.localeCompare(a.period)
      )
  );
  useEffect(() => {
    setTenantReadings(
      [...initialTenantReadings].sort((a, b) =>
        b.period.localeCompare(a.period)
      )
    );
  }, [initialTenantReadings]);

  const [defaultTariff, setDefaultTariff] = useState<string>(
    String(tenant.electricityTariff || DEFAULT_ELECTRICITY_TARIFF)
  );
  const [savingTariff, setSavingTariff] = useState(false);

  // Редактируемая строка (по period)
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editTariff, setEditTariff] = useState("");
  const [savingRow, setSavingRow] = useState(false);

  // Добавление новой записи за произвольный месяц
  const [newMonth, setNewMonth] = useState(() => rentTodayIso().slice(0, 7));
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newTariff, setNewTariff] = useState(
    String(tenant.electricityTariff || DEFAULT_ELECTRICITY_TARIFF)
  );
  const [addingOpen, setAddingOpen] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Подставляем начальное показание при выборе месяца в форме добавления
  useEffect(() => {
    if (!addingOpen) return;
    const period = normalizeElectricityPeriod(newMonth);
    const existing = tenantReadings.find(
      (r) => normalizeElectricityPeriod(r.period) === period
    );
    const prev = findPreviousReading(tenantReadings, tenant.id, period);
    setNewStart(
      fmtInputNum(existing?.readingStart ?? prev?.readingEnd ?? null)
    );
    setNewEnd(fmtInputNum(existing?.readingEnd ?? null));
    setNewTariff(
      fmtInputNum(
        existing?.tariff ??
          tenant.electricityTariff ??
          DEFAULT_ELECTRICITY_TARIFF
      )
    );
  }, [newMonth, addingOpen, tenantReadings, tenant.id, tenant.electricityTariff]);

  function startEditRow(r: RentMeterReading) {
    setEditingPeriod(r.period);
    setEditStart(fmtInputNum(r.readingStart));
    setEditEnd(fmtInputNum(r.readingEnd));
    setEditTariff(fmtInputNum(r.tariff));
    setError("");
    setNotice("");
  }

  async function handleSaveDefaultTariff() {
    const t = parseInputNum(defaultTariff);
    if (t == null || t <= 0) {
      setError("Тариф должен быть больше 0");
      return;
    }
    setSavingTariff(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ electricityTariff: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения тарифа");
      setNotice(`Индивидуальный тариф арендатора обновлён: ${t} ₽/кВт⋅ч`);
      onChanged?.(undefined, t);
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setSavingTariff(false);
    }
  }

  async function handleSaveRow(
    period: string,
    startRaw: string,
    endRaw: string,
    tariffRaw: string
  ) {
    const startNum = parseInputNum(startRaw);
    const endNum = parseInputNum(endRaw);
    const tariffNum =
      parseInputNum(tariffRaw) ??
      tenant.electricityTariff ??
      DEFAULT_ELECTRICITY_TARIFF;
    const calc = calcElectricityReading(startNum, endNum, tariffNum);
    if (calc.error) {
      setError(calc.error);
      return;
    }

    setSavingRow(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/rent/electricity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              tenantId: tenant.id,
              period: normalizeElectricityPeriod(period),
              tariff: tariffNum,
              readingStart: startNum,
              readingEnd: endNum,
              syncInvoice: true,
              updateTenantTariff: false,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить");

      if (Array.isArray(data.readings) && data.readings[0]) {
        const saved: RentMeterReading = data.readings[0];
        const nextList = [
          saved,
          ...tenantReadings.filter(
            (r) =>
              normalizeElectricityPeriod(r.period) !==
              normalizeElectricityPeriod(saved.period)
          ),
        ].sort((a, b) => b.period.localeCompare(a.period));
        setTenantReadings(nextList);
        onChanged?.(nextList);
      }
      setEditingPeriod(null);
      setAddingOpen(false);
      setNotice(
        `Запись за ${rentMonthLabel(
          electricityPeriodMonthKey(period)
        )} сохранена.`
      );
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setSavingRow(false);
    }
  }

  async function handleDeleteRow(r: RentMeterReading) {
    if (
      !confirm(
        `Удалить показания за ${rentMonthLabel(
          electricityPeriodMonthKey(r.period)
        )}?`
      )
    )
      return;
    setSavingRow(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/rent/electricity/${r.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка удаления");
      const nextList = tenantReadings.filter((x) => x.id !== r.id);
      setTenantReadings(nextList);
      onChanged?.(nextList);
    } catch (e: any) {
      setError(e.message || "Ошибка");
    } finally {
      setSavingRow(false);
    }
  }

  const totalKwh = useMemo(
    () =>
      roundReading1(
        tenantReadings.reduce((s, r) => s + (r.consumption || 0), 0)
      ),
    [tenantReadings]
  );
  const totalAmount = useMemo(
    () => roundMoney2(tenantReadings.reduce((s, r) => s + (r.amount || 0), 0)),
    [tenantReadings]
  );

  const org = orgs.find((o) => o.id === tenant.orgId);

  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true">
        <div
          className="admin-modal"
          style={{ maxWidth: 880 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="admin-modal__head">
            <div>
              <h3 className="admin-modal__title">
                <Zap
                  size={16}
                  style={{
                    verticalAlign: "-2px",
                    marginRight: 6,
                    color: "var(--adm-kraft)",
                  }}
                />
                Электроэнергия: {tenant.name}
              </h3>
              <div className="admin-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {org?.shortName || tenant.orgId}
                {tenant.office ? ` · ${tenant.office}` : ""} · история показаний
                за все месяцы
              </div>
            </div>
            <button className="admin-modal__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {/* Настройка индивидуального тарифа арендатора */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 14px",
              background: "var(--adm-paper)",
              borderRadius: "var(--adm-r-sm)",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Индивидуальный тариф (руб./кВт⋅ч):
              </span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                disabled={readOnly}
                className="admin-input"
                style={{ width: 95, padding: "4px 8px", fontWeight: 700 }}
                value={defaultTariff}
                onChange={(e) => setDefaultTariff(e.target.value)}
              />
              {!readOnly && (
                <button
                  type="button"
                  className="admin-btn admin-btn--outline admin-btn--sm"
                  disabled={savingTariff}
                  onClick={handleSaveDefaultTariff}
                >
                  {savingTariff ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Save size={12} />
                  )}
                  Сохранить тариф
                </button>
              )}
            </div>

            {!readOnly && (
              <button
                type="button"
                className="admin-btn admin-btn--primary admin-btn--sm"
                onClick={() => setAddingOpen((v) => !v)}
              >
                <Plus size={13} /> Добавить / изменить месяц
              </button>
            )}
          </div>

          {/* Форма добавления/правки за выбранный месяц */}
          {addingOpen && !readOnly && (
            <div
              style={{
                padding: "12px 14px",
                border: "1px solid var(--adm-border-mid)",
                borderRadius: "var(--adm-r-sm)",
                marginBottom: 12,
                background: "var(--adm-paper-warm)",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                Запись показаний за месяц
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div className="admin-field" style={{ marginBottom: 0 }}>
                  <label className="admin-label">Месяц</label>
                  <input
                    type="month"
                    className="admin-input"
                    value={newMonth}
                    onChange={(e) => setNewMonth(e.target.value)}
                  />
                </div>
                <div className="admin-field" style={{ marginBottom: 0 }}>
                  <label className="admin-label">Тариф, ₽/кВт⋅ч</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    className="admin-input"
                    value={newTariff}
                    onChange={(e) => setNewTariff(e.target.value)}
                  />
                </div>
                <div className="admin-field" style={{ marginBottom: 0 }}>
                  <label className="admin-label">Нач. показание</label>
                  <input
                    type="number"
                    step="0.1"
                    className="admin-input"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                  />
                </div>
                <div className="admin-field" style={{ marginBottom: 0 }}>
                  <label className="admin-label">Кон. показание</label>
                  <input
                    type="number"
                    step="0.1"
                    className="admin-input"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    disabled={savingRow}
                    onClick={() =>
                      handleSaveRow(newMonth, newStart, newEnd, newTariff)
                    }
                  >
                    {savingRow ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Save size={13} />
                    )}
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost"
                    onClick={() => setAddingOpen(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
              {(() => {
                const c = calcElectricityReading(
                  parseInputNum(newStart),
                  parseInputNum(newEnd),
                  parseInputNum(newTariff)
                );
                return (
                  <div
                    className="admin-muted"
                    style={{ fontSize: 12, marginTop: 6 }}
                  >
                    {c.error ? (
                      <span style={{ color: "var(--adm-rust)" }}>
                        {c.error}
                      </span>
                    ) : c.valid ? (
                      <>
                        Расход: <b>{rentFmtDec(c.consumption, 1)} кВт⋅ч</b> · К
                        оплате: <b>{rentFmt(c.amount)} ₽</b>
                      </>
                    ) : (
                      "Введите начальное и конечное показания для расчёта"
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {error && (
            <div className="admin-error" style={{ marginBottom: 10 }}>
              {error}
            </div>
          )}
          {notice && (
            <div className="admin-success" style={{ marginBottom: 10 }}>
              {notice}
            </div>
          )}

          {/* Таблица истории за все месяцы */}
          <div className="admin-table-wrap" style={{ maxHeight: 420 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Тариф</th>
                  <th>Нач. показание</th>
                  <th>Кон. показание</th>
                  <th style={{ textAlign: "right" }}>Расход (кВт⋅ч)</th>
                  <th style={{ textAlign: "right" }}>Сумма (руб.)</th>
                  <th>Счёт за ЭЭ</th>
                  {!readOnly && <th />}
                </tr>
              </thead>
              <tbody>
                {tenantReadings.length === 0 && (
                  <tr>
                    <td colSpan={8} className="admin-table__empty">
                      Показаний по арендатору ещё нет
                    </td>
                  </tr>
                )}
                {tenantReadings.map((r) => {
                  const isEditing = editingPeriod === r.period;
                  const prev = findPreviousReading(
                    tenantReadings,
                    tenant.id,
                    r.period
                  );
                  const curStart = isEditing
                    ? parseInputNum(editStart)
                    : r.readingStart;
                  const curEnd = isEditing
                    ? parseInputNum(editEnd)
                    : r.readingEnd;
                  const curTariff = isEditing
                    ? parseInputNum(editTariff) ?? r.tariff
                    : r.tariff;
                  const liveCalc = calcElectricityReading(
                    curStart,
                    curEnd,
                    curTariff
                  );
                  const discrepancy =
                    prev?.readingEnd != null &&
                    curStart != null &&
                    Math.abs(
                      roundReading1(curStart) - roundReading1(prev.readingEnd)
                    ) >= 0.05;

                  const inv =
                    (r.invoiceId
                      ? invoices.find((i) => i.id === r.invoiceId)
                      : null) ||
                    invoices.find(
                      (i) =>
                        i.periodStart === normalizeElectricityPeriod(r.period) &&
                        i.status !== "cancelled"
                    ) ||
                    null;

                  return (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>
                        {rentMonthLabel(electricityPeriodMonthKey(r.period))}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            className="admin-input"
                            style={{ width: 80, padding: "4px 6px" }}
                            value={editTariff}
                            onChange={(e) => setEditTariff(e.target.value)}
                          />
                        ) : (
                          `${rentFmtDec(r.tariff, 2)} ₽`
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            className="admin-input"
                            style={{ width: 110, padding: "4px 6px" }}
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                          />
                        ) : (
                          rentFmtDec(r.readingStart, 1)
                        )}
                        {discrepancy && prev && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: "var(--adm-kraft)",
                              marginTop: 2,
                            }}
                            title="Отличается от конечного показания предыдущего месяца (прошлый месяц автоматически не меняется)"
                          >
                            ⚠️ прошл. мес.: {rentFmtDec(prev.readingEnd, 1)}
                          </div>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.1"
                            className="admin-input"
                            style={{ width: 110, padding: "4px 6px" }}
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                          />
                        ) : (
                          rentFmtDec(r.readingEnd, 1)
                        )}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                        }}
                      >
                        {curStart != null && curEnd != null
                          ? `${rentFmtDec(liveCalc.consumption, 1)} кВт⋅ч`
                          : "—"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 700,
                        }}
                      >
                        {curStart != null && curEnd != null && liveCalc.valid
                          ? `${rentFmt(liveCalc.amount)} ₽`
                          : "—"}
                      </td>
                      <td>
                        {inv ? (
                          <span
                            className={
                              inv.status === "paid"
                                ? "admin-badge admin-badge--green"
                                : "admin-badge admin-badge--amber"
                            }
                          >
                            ЭЭ-{inv.number} ·{" "}
                            {inv.status === "paid"
                              ? "оплачен"
                              : `долг ${rentFmt(inv.amount)} ₽`}
                          </span>
                        ) : (
                          <span className="admin-muted" style={{ fontSize: 12 }}>
                            —
                          </span>
                        )}
                      </td>
                      {!readOnly && (
                        <td>
                          {isEditing ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--primary"
                                disabled={savingRow || Boolean(liveCalc.error)}
                                title="Сохранить изменения за месяц"
                                onClick={() =>
                                  handleSaveRow(
                                    r.period,
                                    editStart,
                                    editEnd,
                                    editTariff
                                  )
                                }
                              >
                                {savingRow ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Check size={13} />
                                )}
                              </button>
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                title="Отмена"
                                onClick={() => setEditingPeriod(null)}
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                title="Редактировать показания за этот месяц"
                                onClick={() => startEditRow(r)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="admin-btn admin-btn--icon admin-btn--ghost"
                                title="Удалить запись"
                                onClick={() => handleDeleteRow(r)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {tenantReadings.length > 0 && (
                <tfoot>
                  <tr
                    style={{
                      background: "var(--adm-paper-warm)",
                      fontWeight: 700,
                    }}
                  >
                    <td colSpan={4} style={{ textAlign: "right" }}>
                      Всего за все месяцы:
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rentFmtDec(totalKwh, 1)} кВт⋅ч
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {rentFmt(totalAmount)} ₽
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="admin-modal__actions">
            <button className="admin-btn admin-btn--ghost" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
