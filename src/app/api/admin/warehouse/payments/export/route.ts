// =========================================================
// /api/admin/warehouse/payments/export
//
// GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD   — выгрузка ВСЕХ исходящих платежей
//       периода (устаревший режим: без выбора руками).
// GET  ?list=1[&from&to | &all=1]        — список платежей «на выгрузку»
//       (JSON) для модалки с галочками.
// POST { ids: [...] }                    — выгрузка только ВЫБРАННЫХ платежей
//       в формате 1CClientBankExchange v1.03 (Windows-1251, CRLF) для
//       загрузки в Альфа-Банк.
//
// В выгрузку попадают исходящие платежи поставщикам (type "regular"),
// в том числе НЕ проведённые (is_paid = false): платёжку можно отправить
// в банк до проведения платежа в учёте.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { buildClientBankExchange, ourCompanyParty } from "@/lib/client-bank-exchange";
import type { PayerParty, PaymentDoc } from "@/lib/client-bank-exchange";
import { encodeWindows1251 } from "@/lib/cp1251";
import {
  buildExportRows,
  dateSpanOf,
  matchesDateRange,
  sortExportRows,
  summarize,
  type ExportCounterpartyDbRow,
  type ExportPaymentDbRow,
  type ExportPaymentRow,
  type ExportReceiptDbRow,
} from "@/lib/payment-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Сколько платежей максимум отдаём в списке/выгружаем за раз. */
const MAX_ROWS = 1000;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Грузит ВСЕ исходящие платежи поставщикам + реквизиты.
 * Платежи нужны целиком (без фильтра по дате): по ним считается,
 * какая это часть платежа — первая, вторая…
 */
async function loadExportData(): Promise<{
  payments: ExportPaymentDbRow[];
  counterparties: ExportCounterpartyDbRow[];
  receipts: ExportReceiptDbRow[];
}> {
  const db = getAdminDb();
  const [payRes, cpRes, recRes] = await Promise.all([
    // Тип НЕ фильтруем в запросе: кроме оплаты поставщикам (regular)
    // выгружаются «сторонние расходники» (реклама, сайт, ежемесячные,
    // возвраты), а неподходящие типы (наличные, карты, внутренние
    // переводы) отсеивает isExportableType() в buildExportRows.
    db
      .from("bank_payments")
      .select(
        "id,number,date,type,counterparty,counterparty_id,receipt_ids,receipt_numbers,amount,vat_rate,vat_amount,is_paid,exclude_from_balance,exported_at,payment_purpose,payment_priority,payment_kind,comment"
      )
      .eq("direction", "outgoing"),
    // Вложенный select на контрагенте через .select не надёжен при
    // произвольных ограничениях RLS — грузим справочники отдельно.
    db.from("counterparties").select("*"),
    db
      .from("warehouse_receipts")
      .select("id,number,date,supplier,invoice_number,invoice_date,bank_account,bank_name,bank_city,bik,correspondent_account,inn,kpp"),
  ]);
  if (payRes.error) throw payRes.error;
  if (cpRes.error) throw cpRes.error;
  if (recRes.error) throw recRes.error;
  return {
    payments: (payRes.data || []) as ExportPaymentDbRow[],
    counterparties: (cpRes.data || []) as ExportCounterpartyDbRow[],
    receipts: (recRes.data || []) as ExportReceiptDbRow[],
  };
}

/** Строки выгрузки → документы ПП для файла Клиент-Банка. */
function toPaymentDocs(
  rows: ExportPaymentRow[],
  payer: PayerParty
): { docs: PaymentDoc[]; errors: string[] } {
  const docs: PaymentDoc[] = [];
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.payee) {
      errors.push(`ПЛ-${row.number}: ${row.issue || "не заполнены реквизиты получателя"}`);
      continue;
    }
    docs.push({
      number: row.number,
      date: row.date,
      amount: row.amount,
      payer,
      payee: row.payee,
      priority: row.priority,
      paymentKind: row.paymentKind,
      paymentType: "электронно",
      purpose: row.purpose,
      vatRate: row.vatRate,
      vatAmount: row.vatAmount,
      partLabel: row.partLabel || null,
    });
  }
  return { docs, errors };
}

/** Отмечаем выгруженные платежи (один раз) — чтобы не задвоить платёжки. */
async function markExported(rows: ExportPaymentRow[]): Promise<void> {
  const db = getAdminDb();
  const stamp = todayIso();
  for (const row of rows) {
    if (row.exportedAt) continue;
    try {
      await db
        .from("bank_payments")
        .update({ exported_at: stamp })
        .eq("id", row.id)
        .is("exported_at", null);
    } catch {
      // best-effort: отметка не должна ломать выгрузку
    }
  }
}

/** Текстовый файл Клиент-Банка в Windows-1251 как ответ. */
function fileResponse(content: string, filename: string, extra: Record<string, string>) {
  const body = encodeWindows1251(content);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=windows-1251",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      ...extra,
    },
  });
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Разбирает ?from/?to.
 *   ?all=1            — без фильтра по дате («Показать все платежи»);
 *   ?from&to          — указанный период;
 *   без параметров    — сегодня.
 * `allDates` отделён от пустых from/to именно потому, что «период не задан»
 * и «период не ограничен» — разные вещи: иначе «все платежи» молча
 * превращались бы в «сегодня».
 */
function readRange(searchParams: URLSearchParams): {
  from: string | null;
  to: string | null;
  allDates: boolean;
  invalid: boolean;
} {
  if (searchParams.get("all") === "1") {
    return { from: null, to: null, allDates: true, invalid: false };
  }
  const from = searchParams.get("from");
  const to = searchParams.get("to") || from;
  if ((from && !validIsoDate(from)) || (to && !validIsoDate(to))) {
    return { from: null, to: null, allDates: false, invalid: true };
  }
  if (!from && !to) {
    const today = todayIso();
    return { from: today, to: today, allDates: false, invalid: false };
  }
  return { from, to, allDates: false, invalid: false };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const { from, to, allDates, invalid } = readRange(searchParams);
    if (invalid) return errorResponse("from/to должны быть в формате YYYY-MM-DD");

    const list =
      searchParams.get("list") === "1" || searchParams.get("list") === "true";

    // ── Режим списка: все исходящие платежи (в т.ч. не проведённые) ──
    // Модалка выгрузки показывает их с галочками, в файл идут только
    // отмеченные. ?all=1 — «Показать все платежи» без фильтра по дате.
    if (list) {
      const data = await loadExportData();
      const allRows = sortExportRows(
        buildExportRows(data.payments, data.counterparties, data.receipts)
      );

      const rows = allDates
        ? allRows
        : sortExportRows(allRows.filter((row) => matchesDateRange(row, from, to)));

      const total = summarize(allRows);
      return NextResponse.json({
        rows,
        range: { from, to },
        allDates,
        summary: summarize(rows),
        totals: {
          count: total.count,
          total: total.total,
          unexported: total.unexported,
        },
        limit: MAX_ROWS,
      });
    }

    // ── Устаревший режим GET: выгрузка всех платежей периода ──
    const dateFrom = from || todayIso();
    const dateTo = to || dateFrom;

    const data = await loadExportData();
    const allRows = buildExportRows(data.payments, data.counterparties, data.receipts);
    const rows = sortExportRows(
      allRows.filter((row) => matchesDateRange(row, dateFrom, dateTo))
    ).slice(0, MAX_ROWS);

    const payer = ourCompanyParty();
    const { docs, errors } = toPaymentDocs(rows, payer);

    if (docs.length === 0) {
      return errorResponse(
        errors.length > 0
          ? errors.join("\n")
          : `Нет исходящих платежей поставщикам за период ${dateFrom} — ${dateTo}.`
      );
    }

    await markExported(rows.filter((row) => !row.issue));

    const content = buildClientBankExchange({
      ourAccount: payer.account,
      dateFrom,
      dateTo,
      payments: docs,
    });

    return fileResponse(content, `kl_to_1c_${dateFrom}_${dateTo}.txt`, {
      "X-Export-Count": String(docs.length),
      "X-Export-Skipped": String(errors.length),
    });
  } catch (error: any) {
    console.error("1C Client Bank export error:", error);
    return errorResponse(error?.message || "Ошибка выгрузки", 500);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids = [...new Set(rawIds.map((id) => String(id)).filter(Boolean))];

    if (ids.length === 0) {
      return errorResponse("Выберите хотя бы один платёж для выгрузки");
    }
    if (ids.length > MAX_ROWS) {
      return errorResponse(`Слишком много платежей за раз (максимум ${MAX_ROWS})`);
    }

    const data = await loadExportData();
    // Части платежа считаются по ВСЕМ платежам поставки (options.onlyIds
    // ограничивает только итоговый набор строк).
    const rows = sortExportRows(
      buildExportRows(data.payments, data.counterparties, data.receipts, { onlyIds: ids })
    );

    const found = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      return errorResponse(
        `Не найдено платежей: ${missing.length}. Обновите список и выберите заново.`
      );
    }

    const broken = rows.filter((row) => row.issue);
    if (broken.length > 0) {
      return errorResponse(
        [
          "Нельзя выгрузить: у платежей не заполнены банковские реквизиты получателя.",
          ...broken.map((row) => `ПЛ-${row.number} (${row.counterparty}): ${row.issue}`),
          "Заполните реквизиты в поставке/карточке контрагента или снимите эти платежи с выгрузки.",
        ].join("\n")
      );
    }

    const payer = ourCompanyParty();
    const { docs } = toPaymentDocs(rows, payer);
    if (docs.length === 0) {
      return errorResponse("Нет платежей для выгрузки");
    }

    // Период в шапке файла — по фактическим датам выбранных платёжек.
    const span = dateSpanOf(rows);
    const dateFrom = span.from || todayIso();
    const dateTo = span.to || dateFrom;

    await markExported(rows);

    const content = buildClientBankExchange({
      ourAccount: payer.account,
      dateFrom,
      dateTo,
      payments: docs,
    });

    return fileResponse(content, `kl_to_1c_${dateFrom}_${dateTo}.txt`, {
      "X-Export-Count": String(docs.length),
      "X-Export-From": dateFrom,
      "X-Export-To": dateTo,
    });
  } catch (error: any) {
    console.error("1C Client Bank export (selected) error:", error);
    return errorResponse(error?.message || "Ошибка выгрузки", 500);
  }
}
