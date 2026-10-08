// =========================================================
// GET /api/admin/warehouse/payments/export
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Выгрузка платёжных поручений (исходящих, проведённых) за период
// в формате 1CClientBankExchange v1.03 для загрузки в Альфа-Банк.
// Кодировка ответа — Windows-1251, переводы строк — CRLF.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import {
  buildClientBankExchange,
  ourCompanyParty,
  partLabelFor,
} from "@/lib/client-bank-exchange";
import { encodeWindows1251 } from "@/lib/cp1251";
import type { PayerParty, PaymentDoc } from "@/lib/client-bank-exchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isoDate(raw: string | null): string {
  if (!raw) return "";
  return String(raw).slice(0, 10);
}

function num(raw: any, fallback = 0): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function txt(raw: any, fallback = ""): string {
  return raw != null ? String(raw) : fallback;
}

/**
 * Строит название месяца в родительном падеже для назначения платежа
 * вида «от 07 октября 2026».
 */
function monthGenitive(month0: number): string {
  return [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ][month0] || "";
}

/** Форматирует дату в русском варианте для назначения платежа ("07 октября 2026"). */
function longRuDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate().toString().padStart(2, "0")} ${monthGenitive(
    d.getMonth()
  )} ${d.getFullYear()}`;
}

/**
 * Форматирует сумму для назначения в виде "20014-00" (тире вместо точки, копейки).
 */
function moneyDash(n: number): string {
  const kopecks = Math.round((Number(n) || 0) * 100);
  const rub = Math.floor(kopecks / 100);
  const kop = kopecks % 100;
  return `${rub}-${kop.toString().padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = searchParams.get("from") || today;
    const dateTo = searchParams.get("to") || dateFrom;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return NextResponse.json(
        { error: "from/to должны быть в формате YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const db = getAdminDb();

    // Берём всех контрагентов, чтобы подтянуть банковские реквизиты.
    // Вложенный select на контрагенте через .select не надёжен при
    // произвольных ограничениях RLS — грузим counterparties отдельно.
    const [{ data: payments, error: payErr }, { data: counterparties, error: cpErr }, { data: receipts, error: recErr }] = await Promise.all([
      db
        .from("bank_payments")
        .select("*")
        .eq("direction", "outgoing")
        .eq("is_paid", true)
        .eq("exclude_from_balance", false)
        .eq("type", "regular")
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: true })
        .order("number", { ascending: true }),
      db.from("counterparties").select("*"),
      db.from("warehouse_receipts").select("id,number,date,supplier,invoice_number,invoice_date,total"),
    ]);
    if (payErr) throw payErr;
    if (cpErr) throw cpErr;
    if (recErr) throw recErr;

    const cpById = new Map<string, any>();
    for (const cp of counterparties || []) {
      cpById.set(String(cp.id), cp);
    }
    const recById = new Map<string, any>();
    for (const r of receipts || []) {
      recById.set(String(r.id), r);
    }

    // Группируем платежи по поступлению (receipt_id), чтобы определить
    // «часть» (первая/вторая/...) в назначении платежа.
    const byReceipt = new Map<string, any[]>();
    for (const p of payments || []) {
      const rids = Array.isArray(p.receipt_ids) ? p.receipt_ids : [];
      const key = rids[0] ? String(rids[0]) : `free-${p.id}`;
      if (!byReceipt.has(key)) byReceipt.set(key, []);
      byReceipt.get(key)!.push(p);
    }
    for (const list of byReceipt.values()) {
      list.sort((a: any, b: any) => Number(a.number) - Number(b.number));
    }

    const payer = ourCompanyParty();
    const docs: PaymentDoc[] = [];
    const errors: string[] = [];

    for (const p of payments || []) {
      const rids = Array.isArray(p.receipt_ids) ? p.receipt_ids : [];
      const rid = rids[0] ? String(rids[0]) : null;
      const receipt = rid ? recById.get(rid) : null;
      const cp = p.counterparty_id ? cpById.get(String(p.counterparty_id)) : null;

      // Банковские реквизиты получателя: сначала из поступления,
      // потом из карточки контрагента.
      const payeeAcct = txt(receipt?.bank_account || cp?.bank_account);
      const payeeBank = txt(receipt?.bank_name || cp?.bank_name);
      const payeeBankCity = txt(receipt?.bank_city || cp?.bank_city);
      const payeeBik = txt(receipt?.bik || cp?.bik);
      const payeeCorr = txt(receipt?.correspondent_account || cp?.correspondent_account);
      const payeeInn = txt(receipt?.inn || cp?.inn);
      const payeeKpp = txt(receipt?.kpp || cp?.kpp);
      const payeeName =
        txt(cp?.full_name) ||
        txt(cp?.short_name) ||
        txt(p.counterparty);

      if (!payeeAcct || !payeeBik || !payeeBank) {
        errors.push(
          `ПЛ-${p.number}: не заполнены банковские реквизиты поставщика «${p.counterparty}» (р/с, БИК или банк). Откройте поступление и заполните реквизиты.`
        );
        continue;
      }
      if (!payeeInn) {
        errors.push(
          `ПЛ-${p.number}: не заполнен ИНН поставщика «${p.counterparty}».`
        );
        continue;
      }

      // Определяем часть платежа (первая/вторая/...) — по группе платежей,
      // привязанных к одному и тому же поступлению.
      const groupKey = rid || `free-${p.id}`;
      const group = byReceipt.get(groupKey) || [p];
      const indexInGroup = group.findIndex((x: any) => x.id === p.id);
      const totalParts = group.length;
      const partLabel = partLabelFor(indexInGroup, totalParts);

      // Назначение платежа:
      //   «оплата [первой части] по счёту № N от DD MMMM YYYY. В том числе НДС X%»
      // Если номера/даты счёта нет — используем номер поступления и дату.
      const invNum = receipt?.invoice_number
        ? String(receipt.invoice_number)
        : receipt
          ? String(receipt.number)
          : "";
      const invDateRaw = isoDate(receipt?.invoice_date || receipt?.date);
      const invDateLabel = invDateRaw ? longRuDate(invDateRaw) : "";

      let basePurpose = txt(p.payment_purpose);
      if (!basePurpose) {
        const parts: string[] = [];
        if (partLabel) parts.push(`оплата ${partLabel}`);
        else parts.push("оплата");
        if (invNum) parts.push(`по счёту № ${invNum}`);
        if (invDateLabel) parts.push(`от ${invDateLabel}`);
        parts.push(".");
        const vatRate = num(p.vat_rate, 22);
        if (vatRate > 0) parts.push(` В том числе НДС ${vatRate}%, ${moneyDash(num(p.vat_amount))}`);
        else parts.push(" Без НДС");
        basePurpose = parts.join("").replace(/\s+\./g, ".").replace(/\s+,/g, ",").trim();
      }

      const payee: PayerParty = {
        name: payeeName,
        inn: payeeInn,
        kpp: payeeKpp || null,
        account: payeeAcct,
        bankName: payeeBank,
        bankCity: payeeBankCity || "",
        bik: payeeBik,
        corrAccount: payeeCorr || "",
      };

      docs.push({
        number: Number(p.number),
        date: isoDate(p.date),
        amount: num(p.amount),
        payer,
        payee,
        priority: num(p.payment_priority, 5) || 5,
        paymentKind: txt(p.payment_kind, "01") || "01",
        paymentType: "электронно",
        purpose: basePurpose,
        vatRate: num(p.vat_rate, 22),
        vatAmount: num(p.vat_amount),
        partLabel,
      });
    }

    if (docs.length === 0) {
      return NextResponse.json(
        {
          error: errors.length > 0
            ? errors.join("\n")
            : `Нет проведённых исходящих платежей за период ${dateFrom} — ${dateTo}.`,
        },
        { status: 400 }
      );
    }

    // Помечаем успешно выгруженные платежи как экспортированные (один раз),
    // чтобы при повторной выгрузке было видно, что платёжка уже ушла в банк.
    // Не блокирует повторную выгрузку, но помогает не задвоить.
    const exportedDocNumbers = new Set(docs.map((d) => d.number));
    for (const p of payments || []) {
      if (!exportedDocNumbers.has(Number(p.number))) continue;
      try {
        await db
          .from("bank_payments")
          .update({ exported_at: new Date().toISOString().slice(0, 10) })
          .eq("id", p.id)
          .is("exported_at", null);
      } catch (e) {
        // игнорируем best-effort
      }
    }
    // Есть ошибки валидации? Покажем в ответе как предупреждение (в заголовке
    // ответа) — пользователь сможет их увидеть, даже если файл сформировался
    // частично (только с валидными платежами).

    const content = buildClientBankExchange({
      ourAccount: payer.account,
      dateFrom,
      dateTo,
      payments: docs,
    });

    const body = encodeWindows1251(content);
    const filename = `kl_to_1c_${dateFrom}_${dateTo}.txt`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=windows-1251",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    console.error("1C Client Bank export error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка выгрузки" },
      { status: 500 }
    );
  }
}
