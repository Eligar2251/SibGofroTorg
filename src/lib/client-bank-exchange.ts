// =========================================================
// FILE: src/lib/client-bank-exchange.ts
// Генерация файла в формате 1CClientBankExchange (v1.03 Windows)
// для загрузки платёжных поручений в Альфа-Банк.
// =========================================================
//
// Формат (из документации Диасофт/Клиент-Банк):
//   1CClientBankExchange
//   ВерсияФормата=1.03
//   Кодировка=Windows
//   Отправитель=...
//   Получатель=...
//   ДатаСоздания=dd.MM.yyyy
//   ВремяСоздания=HH:mm:ss
//   ДатаНачала=dd.MM.yyyy
//   ДатаКонца=dd.MM.yyyy
//   РасчСчет=Номер р/с организации
//   Документ=Платежное поручение
//   ... (другие виды док.)
//   СекцияДокумент=Платежное поручение
//     Номер=...
//     Дата=dd.MM.yyyy
//     Сумма=#.##
//     ПлательщикСчет=...
//     Плательщик=ИНН XXXX Наименование
//     ПлательщикИНН=...
//     Плательщик1=Наименование
//     ПлательщикРасчСчет=...
//     ПлательщикБанк1=Наименование банка
//     ПлательщикБанк2=Город
//     ПлательщикБИК=БИК
//     ПлательщикКорсчет=к/с
//     ... то же для Получателя
//     ВидПлатежа=электронно
//     ВидОплаты=01
//     ПлательщикКПП=...
//     ПолучательКПП=0
//     Очередность=5
//     НазначениеПлатежа= (до 210 символов, одна строка)
//     НазначениеПлатежа1=... (видимая строка, может повторяться линиями)
//     НазначениеПлатежа2=Сумма XXXXX-YY
//     НазначениеПлатежа3=В т.ч. НДС(20%) ZZZZ-WW
//   КонецДокумента
//   ...
//   КонецФайла
// =========================================================

import "server-only";

import {
  COMPANY_BANK_ACCOUNT,
  COMPANY_BANK_NAME,
  COMPANY_BANK_CITY,
  COMPANY_BIK,
  COMPANY_CORRESPONDENT_ACCOUNT,
  COMPANY_INN,
  COMPANY_KPP,
  COMPANY_FULL_NAME,
} from "@/lib/site-config";
import { includedVat } from "@/lib/vat";

export interface PayerParty {
  /** Наименование (полное) */
  name: string;
  inn: string;
  kpp?: string | null;
  /** Расчётный счёт */
  account: string;
  bankName: string;
  bankCity?: string | null;
  bik: string;
  /** Корреспондентский счёт */
  corrAccount: string;
}

export interface PaymentDoc {
  number: number;
  date: string; // YYYY-MM-DD
  amount: number;
  payer: PayerParty;
  payee: PayerParty;
  priority?: number; // очерёдность, по умолч. 5
  paymentKind?: string; // вид оплаты "01"
  paymentType?: string; // вид платежа: "электронно"
  purpose: string; // основной текст назначения платежа
  vatRate?: number; // ставка НДС, %; если <= 0 или null — "Без НДС"
  vatAmount?: number | null; // сумма НДС
  /** Префикс части платежа: "первая часть", "вторая часть" и т.д. (для split-платежей). */
  partLabel?: string | null;
}

function pad2(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

/** YYYY-MM-DD → DD.MM.YYYY */
export function ruDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Форматирование суммы: 12345.67 → "12345.67" (ровно 2 знака). */
function money(n: number): string {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toFixed(2);
}

/**
 * Склоняет слово "часть" по номеру: 1→первая, 2→вторая, 3→третья, 4→четвертая, и т.д.
 */
function partLabelFor(index: number, total: number): string {
  if (total <= 1) return "";
  const labels = [
    "первая часть",
    "вторая часть",
    "третья часть",
    "четвертая часть",
    "пятая часть",
    "шестая часть",
    "седьмая часть",
    "восьмая часть",
    "девятая часть",
    "десятая часть",
  ];
  return labels[index] || `${index + 1}-я часть`;
}

/**
 * Строит текст назначения платежа для 1С/Клиент-банка.
 * Часть с НДС по правилам 1С: «В т.ч. НДС(20%) 3609-08».
 * Сумма форматируется как «Сумма 20014-00».
 */
export function buildPaymentPurposeLines(doc: PaymentDoc): {
  main: string;
  sumLine: string;
  vatLine: string;
  /** Поле НазначениеПлатежа (одной строкой, как в 1С — всё склеено). */
  combined: string;
} {
  const sumFormatted = money(doc.amount).replace(".", "-");
  const sumLine = `Сумма ${sumFormatted}`;

  let vatLine = "Без НДС";
  const rate = Math.round((doc.vatRate || 0) * 100) / 100;
  if (rate > 0) {
    let vatSum = Number(doc.vatAmount);
    if (!vatSum || vatSum <= 0.009) vatSum = includedVat(doc.amount, rate);
    const vatFormatted = money(vatSum).replace(".", "-");
    vatLine = `В т.ч. НДС(${rate}%) ${vatFormatted}`;
  }

  const main = (doc.purpose || "").trim();
  // Как в примере 1С: «...Сумма 20014-00В т.ч. НДС(22%) 3609-08» — без пробела между Суммой и В т.ч.
  const combined = `${main} ${sumLine}${vatLine !== "Без НДС" ? vatLine : ""}`.trim();

  return { main, sumLine, vatLine, combined };
}

/**
 * Формирует содержимое .txt файла для загрузки в Клиент-Банк (Альфа-Банк).
 * Кодировка — Windows-1251 (криллица) согласно спецификации; для отдачи в
 * браузере кодируем в 1251 в API-обработчике.
 */
export function buildClientBankExchange(params: {
  /** Р/с нашей организации (плательщика) для шапки РасчСчет. */
  ourAccount?: string;
  /** Дата начала периода (YYYY-MM-DD). */
  dateFrom: string;
  /** Дата конца периода (YYYY-MM-DD). */
  dateTo: string;
  /** Список ПП. */
  payments: PaymentDoc[];
  /** Отправитель в шапке (по умолчанию "Управление торговлей..."). */
  sender?: string;
  /** Получатель (по умолч. как в примере пользователя). */
  receiver?: string;
}): string {
  const now = new Date();
  const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const dateCreated = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()}`;

  const ourAccount = params.ourAccount || COMPANY_BANK_ACCOUNT;
  const sender = params.sender || "Управление торговлей, редакция 10.3";
  const receiver = params.receiver || "DiasoftCLIENT 4x4 for Windows Диасофт";

  const lines: string[] = [];
  lines.push("1CClientBankExchange");
  lines.push("ВерсияФормата=1.03");
  lines.push("Кодировка=Windows");
  lines.push(`Отправитель=${sender}`);
  lines.push(`Получатель=${receiver}`);
  lines.push(`ДатаСоздания=${dateCreated}`);
  lines.push(`ВремяСоздания=${timeStr}`);
  lines.push(`ДатаНачала=${ruDate(params.dateFrom)}`);
  lines.push(`ДатаКонца=${ruDate(params.dateTo)}`);
  lines.push(`РасчСчет=${ourAccount}`);
  lines.push("Документ=Платежное поручение");
  lines.push("Документ=Заявление на аккредитив");
  lines.push("Документ=Платежное требование");
  lines.push("Документ=Инкассовое поручение");

  for (const p of params.payments) {
    lines.push("СекцияДокумент=Платежное поручение");
    lines.push(`Номер=${p.number}`);
    lines.push(`Дата=${ruDate(p.date)}`);
    lines.push(`Сумма=${money(p.amount)}`);

    // ── Плательщик ──
    lines.push(`ПлательщикСчет=${p.payer.account}`);
    lines.push(
      `Плательщик=ИНН ${p.payer.inn} ${p.payer.name}`
    );
    lines.push(`ПлательщикИНН=${p.payer.inn}`);
    lines.push(`Плательщик1=${p.payer.name}`);
    lines.push(`ПлательщикРасчСчет=${p.payer.account}`);
    lines.push(`ПлательщикБанк1=${p.payer.bankName}`);
    lines.push(`ПлательщикБанк2=${p.payer.bankCity || ""}`);
    lines.push(`ПлательщикБИК=${p.payer.bik}`);
    lines.push(`ПлательщикКорсчет=${p.payer.corAccount}`);

    // ── Получатель ──
    lines.push(`ПолучательСчет=${p.payee.account}`);
    lines.push(
      `Получатель=ИНН ${p.payee.inn} ${p.payee.name}`
    );
    lines.push(`ПолучательИНН=${p.payee.inn}`);
    lines.push(`Получатель1=${p.payee.name}`);
    lines.push(`ПолучательРасчСчет=${p.payee.account}`);
    lines.push(`ПолучательБанк1=${p.payee.bankName}`);
    lines.push(`ПолучательБанк2=${p.payee.bankCity || ""}`);
    lines.push(`ПолучательБИК=${p.payee.bik}`);
    lines.push(`ПолучательКорсчет=${p.payee.corAccount}`);

    // ── Общие поля ──
    lines.push(`ВидПлатежа=${p.paymentType || "электронно"}`);
    lines.push(`ВидОплаты=${p.paymentKind || "01"}`);
    lines.push(`ПлательщикКПП=${p.payer.kpp || "0"}`);
    // У получателя КПП может отсутствовать (ИП) — тогда ставим "0".
    lines.push(`ПолучательКПП=${p.payee.kpp && String(p.payee.kpp).trim() ? p.payee.kpp : "0"}`);
    lines.push(`Очередность=${p.priority || 5}`);

    const purpose = buildPaymentPurposeLines(p);
    lines.push(`НазначениеПлатежа=${purpose.combined}`);
    lines.push(`НазначениеПлатежа1=${purpose.main}`);
    lines.push(`НазначениеПлатежа2=${purpose.sumLine}`);
    lines.push(`НазначениеПлатежа3=${purpose.vatLine}`);

    lines.push("КонецДокумента");
  }

  lines.push("КонецФайла");
  // Важно: в файле используем CRLF (\r\n) — как в оригинале 1С.
  return lines.join("\r\n") + "\r\n";
}

/**
 * Собирает PayerParty нашей организации из настроек (сайт-конфиг).
 * При необходимости в будущем можно читать из БД (settings).
 */
export function ourCompanyParty(): PayerParty {
  return {
    name: COMPANY_FULL_NAME,
    inn: COMPANY_INN,
    kpp: COMPANY_KPP,
    account: COMPANY_BANK_ACCOUNT,
    bankName: COMPANY_BANK_NAME,
    bankCity: COMPANY_BANK_CITY,
    bik: COMPANY_BIK,
    corrAccount: COMPANY_CORRESPONDENT_ACCOUNT,
  };
}

/** Склоняет "часть" по индексу (0-based) при общем количестве total. */
export { partLabelFor };
