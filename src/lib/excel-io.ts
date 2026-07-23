// =========================================================
// FILE: src/lib/excel-io.ts
// Импорт / экспорт Excel для всех основных таблиц.
// Связи пишутся словами (названиями, номерами документов),
// а при импорте код сам находит нужные записи.
// =========================================================

import * as XLSX from "xlsx";
import { revalidateTag } from "next/cache";
import { getAdminDb } from "./supabase";
import {
  getAllCategories,
  getProducts,
  getOrders,
  getPromotions,
  getSettings,
  createCategory,
  createProduct,
  updateProduct,
  createOrder,
  updateSettings,
} from "./supabase-queries";
import {
  getCounterparties,
  getReceipts,
  getDeals,
  getPayments,
  getEmployees,
  getSalaries,
  saveCounterparty,
  saveEmployee,
  createReceipt,
  createDeal,
  createPayment,
  createSalary,
  postReceipt,
  postDeal,
  type StockDocItem,
} from "./warehouse";
import { VAT_RATE } from "./vat";

// ─── Нормализация текста для «умного» поиска ───────────────

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/[.,;:!?()[\]{}]/g, " ")
    .replace(/[-–—_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Сравнение строк: точное → начинается → содержит → по словам */
export function textScore(query: string, candidate: string): number {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 85;
  if (c.includes(q) || q.includes(c)) return 70;
  const qw = q.split(" ").filter(Boolean);
  const cw = new Set(c.split(" ").filter(Boolean));
  if (qw.length === 0) return 0;
  const hit = qw.filter((w) => cw.has(w) || [...cw].some((x) => x.includes(w) || w.includes(x))).length;
  if (hit === 0) return 0;
  return Math.round((hit / qw.length) * 55);
}

export function findBestByName<T>(
  query: string,
  items: T[],
  getName: (item: T) => string,
  minScore = 55
): T | null {
  if (!query?.trim()) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const score = textScore(query, getName(item));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= minScore ? best : null;
}

function cell(row: Record<string, any>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  // case-insensitive fallback
  const map = new Map(
    Object.keys(row).map((k) => [normalizeText(k), k])
  );
  for (const k of keys) {
    const real = map.get(normalizeText(k));
    if (real != null && row[real] != null && String(row[real]).trim() !== "") {
      return String(row[real]).trim();
    }
  }
  return "";
}

function num(row: Record<string, any>, ...keys: string[]): number | null {
  const raw = cell(row, ...keys);
  if (!raw) return null;
  const n = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function bool(row: Record<string, any>, ...keys: string[]): boolean | null {
  const raw = cell(row, ...keys).toLowerCase();
  if (!raw) return null;
  if (["1", "true", "да", "yes", "y", "истина", "+"].includes(raw)) return true;
  if (["0", "false", "нет", "no", "n", "ложь", "-"].includes(raw)) return false;
  return null;
}

function yn(v: unknown): string {
  if (v === true || v === 1 || v === "1") return "да";
  if (v === false || v === 0 || v === "0") return "нет";
  return v ? "да" : "нет";
}

function parseDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  // Excel serial
  if (/^\d+(\.\d+)?$/.test(raw) && Number(raw) > 20000 && Number(raw) < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + Number(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  // DD.MM.YYYY
  const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yy = m[3];
    if (yy.length === 2) yy = `20${yy}`;
    return `${yy}-${mm}-${dd}`;
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function slugify(text: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text
    .toLowerCase()
    .replace(/[а-яё]/gi, (c) => map[c.toLowerCase()] || c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

/** Разбор списка номеров: "ЗК-12, 15; ПО-3" → { deals:[12,15], receipts:[3] } */
export function parseDocRefs(raw: string): { deals: number[]; receipts: number[] } {
  const deals: number[] = [];
  const receipts: number[] = [];
  if (!raw?.trim()) return { deals, receipts };
  const parts = raw.split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const dealM = p.match(/(?:зк|заказ|deal)[-\s#№]*(\d+)/i);
    const recM = p.match(/(?:по|поступление|receipt|приход)[-\s#№]*(\d+)/i);
    const plain = p.match(/^#?№?\s*(\d+)$/);
    if (dealM) deals.push(Number(dealM[1]));
    else if (recM) receipts.push(Number(recM[1]));
    else if (plain) {
      // без префикса — пробуем оба (импорт решит по направлению)
      deals.push(Number(plain[1]));
      receipts.push(Number(plain[1]));
    }
  }
  return { deals: [...new Set(deals)], receipts: [...new Set(receipts)] };
}

function sheetToRows(wb: XLSX.WorkBook, name: string): Record<string, any>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows.filter((r) =>
    Object.values(r).some((v) => String(v ?? "").trim() !== "")
  );
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: Record<string, any>[], headers?: string[]) {
  const safe = name.slice(0, 31);
  let ws: XLSX.WorkSheet;
  if (rows.length === 0 && headers?.length) {
    ws = XLSX.utils.aoa_to_sheet([headers]);
  } else if (rows.length === 0) {
    ws = XLSX.utils.aoa_to_sheet([["(пусто)"]]);
  } else {
    ws = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : undefined);
  }
  // ширина колонок
  const keys = headers || (rows[0] ? Object.keys(rows[0]) : []);
  ws["!cols"] = keys.map((k) => ({
    wch: Math.min(42, Math.max(12, String(k).length + 2)),
  }));
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

// ─── ЭКСПОРТ ───────────────────────────────────────────────

export async function buildExcelExport(mode: "full" | "template" = "full"): Promise<Buffer> {
  const wb = XLSX.utils.book_new();

  // Инструкция
  addSheet(wb, "Инструкция", [
    { Поле: "Как пользоваться", Значение: "1) Скачайте шаблон или полный экспорт. 2) Заполните листы. 3) Загрузите файл обратно." },
    { Поле: "Связи словами", Значение: "Не пишите UUID. Указывайте названия: категория «Гофроящик», товар «Ящик 670», контрагент «ООО Ромашка»." },
    { Поле: "Категория у товара", Значение: "Колонка «Категория» — название категории. «гофроящик» = «Гофроящик» (поиск без регистра, по вхождению)." },
    { Поле: "Позиции документов", Значение: "Листы «Поступления_позиции» и «Заказы_позиции»: «Номер документа» + «Товар» (название или артикул) + Кол-во + Цена." },
    { Поле: "Платежи → заказы", Значение: "Колонка «Связанные заказы»: ЗК-12 или 12 или ЗК-12, ЗК-15" },
    { Поле: "Платежи → поступления", Значение: "Колонка «Связанные поступления»: ПО-3 или 3 или ПО-3, ПО-5" },
    { Поле: "Зарплата → сотрудник", Значение: "Колонка «Сотрудник» — ФИО как в листе «Сотрудники»." },
    { Поле: "Да / Нет", Значение: "Пишите: да/нет, true/false, 1/0" },
    { Поле: "Даты", Значение: "ДД.ММ.ГГГГ или ГГГГ-ММ-ДД" },
    { Поле: "Обновление", Значение: "Если заполнен ID — запись обновится. Без ID — создаётся новая (товары также ищутся по артикулу/названию)." },
    { Поле: "Порядок импорта", Значение: "Категории → Товары → Контрагенты → Сотрудники → Поступления → Заказы → Платежи → Зарплаты → Заявки → Акции → Настройки" },
    { Поле: "Пустые строки", Значение: "Пустые строки игнорируются. Лист можно не заполнять — он просто пропустится." },
  ]);

  const [
    categories,
    products,
    counterparties,
    employees,
    receipts,
    deals,
    payments,
    salaries,
    orders,
    promotions,
    settings,
  ] = mode === "template"
    ? [[], [], [], [], [], [], [], [], [], [], {} as Record<string, string>]
    : await Promise.all([
        getAllCategories(),
        getProducts({ includeHidden: true }),
        getCounterparties(),
        getEmployees(),
        getReceipts(),
        getDeals(),
        getPayments(),
        getSalaries(),
        getOrders({ limit: 2000, status: "all" }),
        getPromotions(),
        getSettings(),
      ]);

  const catById = new Map(categories.map((c) => [c.id, c.name]));

  // Категории
  const catRows =
    mode === "template"
      ? [
          {
            ID: "",
            Название: "Гофроящик",
            Слаг: "gofroyaschik",
            Иконка: "box",
            Описание: "Гофроящики разных размеров",
            "Порядок сортировки": 10,
            Видима: "да",
          },
        ]
      : categories.map((c) => ({
          ID: c.id,
          Название: c.name,
          Слаг: c.slug,
          Иконка: c.icon || "",
          Описание: c.description || "",
          "Порядок сортировки": c.sortOrder ?? 0,
          Видима: yn(c.isVisible !== false),
        }));
  addSheet(wb, "Категории", catRows, [
    "ID", "Название", "Слаг", "Иконка", "Описание", "Порядок сортировки", "Видима",
  ]);

  // Товары
  const productRows =
    mode === "template"
      ? [
          {
            ID: "",
            Название: "Ящик 670",
            Артикул: "BOX-670",
            Категория: "Гофроящик",
            Цена: 45,
            "Оптовая цена": 38,
            "Мин. опт": 100,
            "Длина мм": 670,
            "Ширина мм": 370,
            "Высота мм": 370,
            "Остаток": 500,
            "Порог остатка": 50,
            "В наличии": "да",
            "На заказ": "нет",
            Видимый: "да",
            Избранный: "нет",
            Акция: "нет",
            Описание: "Гофроящик 670×370×370",
          },
        ]
      : products.map((p) => ({
          ID: p.id,
          Название: p.name,
          Артикул: p.sku || "",
          Категория: (p.categoryId && catById.get(p.categoryId)) || "",
          Цена: p.price ?? "",
          "Оптовая цена": p.priceWholesale ?? "",
          "Мин. опт": p.minWholesaleQty ?? "",
          "Длина мм": p.dimensionLength ?? "",
          "Ширина мм": p.dimensionWidth ?? "",
          "Высота мм": p.dimensionHeight ?? "",
          "Остаток": p.stockQty ?? 0,
          "Порог остатка": p.stockWarnQty ?? "",
          "В наличии": yn(p.inStock),
          "На заказ": yn(p.madeToOrder),
          Видимый: yn(p.isVisible),
          Избранный: yn(p.isFeatured),
          Акция: yn(p.isPromo),
          "Метка акции": p.promoLabel || "",
          "Скидка тип": p.discountType || "",
          "Скидка значение": p.discountValue ?? "",
          Описание: p.description || "",
          Слаг: p.slug || "",
          Материал: p.material || "",
          "В упаковке": p.packQty ?? "",
          Вес: p.weight ?? "",
          "URL картинки": p.imageUrl || "",
        }));
  addSheet(wb, "Товары", productRows);

  // Контрагенты
  const cpRows =
    mode === "template"
      ? [
          {
            ID: "",
            Название: "ООО Ромашка",
            Роли: "поставщик, покупатель",
            Телефон: "+7 383 000-00-00",
            Email: "info@romashka.ru",
            ИНН: "5400000000",
            КПП: "540001001",
            Адрес: "Новосибирск, ул. Примерная, 1",
            Контакт: "Иванов И.И.",
            Комментарий: "",
          },
        ]
      : counterparties.map((c) => ({
          ID: c.id,
          Название: c.name,
          Роли: (c.roles || [])
            .map((r) => (r === "supplier" ? "поставщик" : "покупатель"))
            .join(", "),
          Телефон: c.phone || "",
          Email: c.email || "",
          ИНН: c.inn || "",
          КПП: c.kpp || "",
          ОГРН: c.ogrn || "",
          "Полное название": c.fullName || "",
          "Краткое название": c.shortName || "",
          "Юр. адрес": c.legalAddress || "",
          Адрес: c.address || "",
          Контакт: c.contactName || "",
          "Банк": c.bankName || "",
          "Р/с": c.bankAccount || "",
          БИК: c.bik || "",
          "К/с": c.correspondentAccount || "",
          Комментарий: c.comment || "",
        }));
  addSheet(wb, "Контрагенты", cpRows);

  // Сотрудники
  const empRows =
    mode === "template"
      ? [{ ID: "", ФИО: "Петров Пётр", Должность: "Кладовщик", Телефон: "", Комментарий: "" }]
      : employees.map((e) => ({
          ID: e.id,
          ФИО: e.name,
          Должность: e.position || "",
          Телефон: e.phone || "",
          Комментарий: e.comment || "",
        }));
  addSheet(wb, "Сотрудники", empRows);

  // Поступления + позиции
  const receiptHeaders = mode === "template"
    ? [
        {
          ID: "",
          Номер: 1,
          Дата: "23.07.2026",
          Поставщик: "ООО Ромашка",
          Статус: "черновик",
          Телефон: "",
          Email: "",
          ИНН: "",
          Адрес: "",
          Комментарий: "Пример поступления",
          "НДС %": 22,
        },
      ]
    : receipts.map((r) => ({
        ID: r.id,
        Номер: r.number,
        Дата: r.date,
        Поставщик: r.supplier,
        Статус: r.status === "posted" ? "проведено" : "черновик",
        Телефон: r.phone || "",
        Email: r.email || "",
        ИНН: r.inn || "",
        КПП: r.kpp || "",
        Адрес: r.address || "",
        Контакт: r.contactName || "",
        Комментарий: r.comment || "",
        Сумма: r.total,
        "НДС %": r.vatRate,
        "НДС сумма": r.vatAmount,
      }));
  addSheet(wb, "Поступления", receiptHeaders);

  const receiptItems: Record<string, any>[] = [];
  if (mode === "template") {
    receiptItems.push({
      "Номер документа": 1,
      Товар: "Ящик 670",
      Артикул: "BOX-670",
      "Кол-во": 100,
      "Цена": 30,
      "Сумма строки": 3000,
    });
  } else {
    for (const r of receipts) {
      for (const it of r.items || []) {
        receiptItems.push({
          "Номер документа": r.number,
          Товар: it.name,
          Артикул: it.sku || "",
          "Кол-во": it.quantity,
          Цена: it.price,
          "Сумма строки": it.lineTotal,
        });
      }
    }
  }
  addSheet(wb, "Поступления_позиции", receiptItems);

  // Заказы учёта + позиции
  const dealHeaders =
    mode === "template"
      ? [
          {
            ID: "",
            Номер: 1,
            Дата: "23.07.2026",
            Покупатель: "ООО Ромашка",
            Телефон: "",
            Статус: "новый",
            Комментарий: "Пример заказа",
            "НДС %": 22,
          },
        ]
      : deals.map((d) => ({
          ID: d.id,
          Номер: d.number,
          Дата: d.date,
          Покупатель: d.customerName,
          Телефон: d.customerPhone || d.phone || "",
          Email: d.email || "",
          ИНН: d.inn || "",
          Адрес: d.address || "",
          Статус:
            d.status === "completed"
              ? "проведён"
              : d.status === "cancelled"
              ? "отменён"
              : "новый",
          Комментарий: d.comment || "",
          Сумма: d.total,
          "НДС %": d.vatRate,
        }));
  addSheet(wb, "Заказы_учёта", dealHeaders);

  const dealItems: Record<string, any>[] = [];
  if (mode === "template") {
    dealItems.push({
      "Номер документа": 1,
      Товар: "Ящик 670",
      Артикул: "BOX-670",
      "Кол-во": 50,
      Цена: 45,
      "Сумма строки": 2250,
    });
  } else {
    for (const d of deals) {
      for (const it of d.items || []) {
        dealItems.push({
          "Номер документа": d.number,
          Товар: it.name,
          Артикул: it.sku || "",
          "Кол-во": it.quantity,
          Цена: it.price,
          "Сумма строки": it.lineTotal,
        });
      }
    }
  }
  addSheet(wb, "Заказы_позиции", dealItems);

  // Платежи
  const payRows =
    mode === "template"
      ? [
          {
            ID: "",
            Номер: 1,
            Дата: "23.07.2026",
            Направление: "входящий",
            Тип: "обычный",
            Контрагент: "ООО Ромашка",
            Сумма: 2250,
            "Оплачен": "нет",
            "Связанные заказы": "ЗК-1",
            "Связанные поступления": "",
            "Номер счёта": "",
            "НДС %": 22,
            Комментарий: "Оплата по заказу",
          },
        ]
      : payments.map((p) => ({
          ID: p.id,
          Номер: p.number,
          Дата: p.date,
          Направление: p.direction === "incoming" ? "входящий" : "исходящий",
          Тип:
            p.type === "cash"
              ? "наличные"
              : p.type === "transfer"
              ? "перевод"
              : p.type === "refund"
              ? "возврат"
              : p.type === "deposit"
              ? "внесение"
              : "обычный",
          Контрагент: p.counterparty,
          Сумма: p.amount,
          Оплачен: yn(p.isPaid),
          "Дата оплаты": p.paidAt || "",
          "Связанные заказы": (p.dealNumbers || []).map((n) => `ЗК-${n}`).join(", "),
          "Связанные поступления": (p.receiptNumbers || [])
            .map((n) => `ПО-${n}`)
            .join(", "),
          "Номер счёта": p.invoiceNumber || "",
          "НДС %": p.vatRate,
          "Исключить из баланса": yn(p.excludeFromBalance),
          Комментарий: p.comment || "",
        }));
  addSheet(wb, "Платежи", payRows);

  // Зарплаты
  const salRows =
    mode === "template"
      ? [
          {
            ID: "",
            Сотрудник: "Петров Пётр",
            Сумма: 50000,
            Дата: "01.07.2026",
            Источник: "банк",
            Выплачено: "нет",
            Комментарий: "",
          },
        ]
      : salaries.map((s) => ({
          ID: s.id,
          Сотрудник: s.employeeName,
          Сумма: s.amount,
          Дата: s.date,
          Источник: s.source === "cash" ? "касса" : "банк",
          Выплачено: yn(s.isPaid),
          "Дата выплаты": s.paidAt || "",
          Комментарий: s.comment || "",
        }));
  addSheet(wb, "Зарплаты", salRows);

  // Заявки сайта
  const orderRows =
    mode === "template"
      ? [
          {
            ID: "",
            Тип: "заказ",
            "Тип клиента": "физлицо",
            Имя: "Сидоров",
            Телефон: "+7 900 000-00-00",
            Email: "",
            Связь: "звонок",
            Оплата: "перевод",
            Статус: "новая",
            "Адрес доставки": "Новосибирск, ул. Ленина, 1",
            Комментарий: "",
            "Сумма": 4500,
            "Товары (название×кол-во×цена)": "Ящик 670×100×45",
          },
        ]
      : orders.map((o) => ({
          ID: o.id,
          Тип: o.type === "order" ? "заказ" : "заявка",
          "Тип клиента": o.customerType === "legal" ? "юрлицо" : "физлицо",
          Имя: o.customerName,
          Телефон: o.customerPhone,
          Email: o.customerEmail || "",
          Связь: o.communicationChannel || "",
          Оплата: o.paymentMethod || "",
          Статус:
            o.status === "in_progress"
              ? "в работе"
              : o.status === "completed"
              ? "проведена"
              : o.status === "rejected"
              ? "отклонена"
              : "новая",
          "Адрес доставки": o.deliveryAddress || "",
          "Есть доставка": yn(o.hasDelivery),
          "Тип доставки":
            o.deliveryType === "paid"
              ? "платная"
              : o.deliveryType === "free"
              ? "бесплатная"
              : "",
          "Стоимость доставки": o.deliveryCost ?? "",
          Комментарий: o.comment || "",
          Сумма: o.totalSum ?? "",
          "Товары (название×кол-во×цена)": Array.isArray(o.items)
            ? o.items
                .map((it) => `${it.name}×${it.quantity}×${it.price}`)
                .join(" | ")
            : o.productInfo || "",
        }));
  addSheet(wb, "Заявки_сайта", orderRows);

  // Акции
  const promoRows =
    mode === "template"
      ? [
          {
            ID: "",
            Заголовок: "Скидка на ящики",
            Подзаголовок: "до конца месяца",
            Бейдж: "-10%",
            "Тип ссылки": "нет",
            "Ссылка URL": "",
            "Товар (название)": "",
            Порядок: 1,
            Видима: "да",
          },
        ]
      : promotions.map((p) => ({
          ID: p.id,
          Заголовок: p.title,
          Подзаголовок: p.subtitle || "",
          Бейдж: p.badge || "",
          "Тип ссылки": p.linkType || "none",
          "Ссылка URL": p.linkUrl || "",
          "Товар ID": p.productId || "",
          Порядок: p.sortOrder ?? 0,
          Видима: yn(p.isVisible),
          Иконка: p.icon || "",
          Дедлайн: p.deadline || "",
        }));
  addSheet(wb, "Акции", promoRows);

  // Настройки
  const settingsRows =
    mode === "template"
      ? [
          { Ключ: "phone", Значение: "+7 (383) 000-00-00" },
          { Ключ: "address", Значение: "Новосибирск" },
          { Ключ: "email", Значение: "info@example.ru" },
          { Ключ: "working_hours", Значение: "Пн–Пт 9:00–18:00" },
          { Ключ: "delivery_price", Значение: "800" },
          { Ключ: "free_delivery_threshold", Значение: "30000" },
        ]
      : Object.entries(settings || {}).map(([k, v]) => ({
          Ключ: k,
          Значение: v ?? "",
        }));
  addSheet(wb, "Настройки", settingsRows);

  // Справочник связей
  addSheet(wb, "Справочник_связей", [
    { Сущность: "Товар → Категория", Как_писать: "В колонке «Категория» название категории, например: Гофроящик" },
    { Сущность: "Поступление → Поставщик", Как_писать: "Название контрагента-поставщика. Если нет — создастся автоматически." },
    { Сущность: "Поступление → Товары", Как_писать: "Лист «Поступления_позиции»: Номер документа + Товар (название или артикул)" },
    { Сущность: "Заказ учёта → Покупатель", Как_писать: "Название контрагента-покупателя" },
    { Сущность: "Заказ учёта → Товары", Как_писать: "Лист «Заказы_позиции»: Номер документа + Товар" },
    { Сущность: "Платёж → Заказы", Как_писать: "ЗК-12 или 12 или ЗК-12, ЗК-15" },
    { Сущность: "Платёж → Поступления", Как_писать: "ПО-3 или 3 или ПО-3, ПО-7" },
    { Сущность: "Платёж → Контрагент", Как_писать: "Название контрагента словами" },
    { Сущность: "Зарплата → Сотрудник", Как_писать: "ФИО сотрудника как в листе «Сотрудники»" },
    { Сущность: "Заявка → Товары", Как_писать: "Название×кол-во×цена | Название×кол-во×цена" },
  ]);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return Buffer.from(buf);
}

// ─── ИМПОРТ ────────────────────────────────────────────────

export interface ImportReport {
  success: boolean;
  sheets: Record<
    string,
    { created: number; updated: number; skipped: number; errors: string[] }
  >;
  warnings: string[];
  message: string;
}

function emptySheet(): ImportReport["sheets"][string] {
  return { created: 0, updated: 0, skipped: 0, errors: [] };
}

export async function importExcelWorkbook(buffer: Buffer): Promise<ImportReport> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const report: ImportReport = {
    success: true,
    sheets: {},
    warnings: [],
    message: "",
  };

  const db = getAdminDb();

  // Загружаем текущее состояние для резолва связей
  let categories = await getAllCategories();
  let products = await getProducts({ includeHidden: true });
  let counterparties = await getCounterparties();
  let employees = await getEmployees();
  let receipts = await getReceipts();
  let deals = await getDeals();

  const refreshProducts = async () => {
    products = await getProducts({ includeHidden: true });
  };
  const refreshCategories = async () => {
    categories = await getAllCategories();
  };
  const refreshCounterparties = async () => {
    counterparties = await getCounterparties();
  };
  const refreshEmployees = async () => {
    employees = await getEmployees();
  };
  const refreshReceipts = async () => {
    receipts = await getReceipts();
  };
  const refreshDeals = async () => {
    deals = await getDeals();
  };

  function resolveCategoryId(name: string): string | null {
    if (!name) return null;
    const found = findBestByName(name, categories, (c) => c.name, 50);
    return found?.id ?? null;
  }

  function resolveProduct(nameOrSku: string, skuHint?: string): (typeof products)[0] | null {
    if (skuHint) {
      const bySku = products.find(
        (p) => normalizeText(p.sku || "") === normalizeText(skuHint)
      );
      if (bySku) return bySku;
    }
    if (!nameOrSku) return null;
    // точный артикул
    const bySku2 = products.find(
      (p) => normalizeText(p.sku || "") === normalizeText(nameOrSku)
    );
    if (bySku2) return bySku2;
    return findBestByName(nameOrSku, products, (p) => `${p.name} ${p.sku || ""}`, 50);
  }

  // 1. Категории
  {
    const rows = sheetToRows(wb, "Категории");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "Название", "name", "Name");
      if (!name) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id");
        const existing = id
          ? categories.find((c) => c.id === id)
          : findBestByName(name, categories, (c) => c.name, 95);
        const payload = {
          name,
          slug: cell(row, "Слаг", "slug") || slugify(name),
          icon: cell(row, "Иконка", "icon") || null,
          description: cell(row, "Описание", "description") || null,
          sortOrder: num(row, "Порядок сортировки", "sortOrder") ?? 0,
          isVisible: bool(row, "Видима", "isVisible") ?? true,
        };
        if (existing) {
          await db
            .from("categories")
            .update({
              name: payload.name,
              slug: payload.slug,
              icon: payload.icon,
              description: payload.description,
              sort_order: payload.sortOrder,
              is_visible: payload.isVisible,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          s.updated++;
        } else {
          await createCategory(payload);
          s.created++;
        }
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Категории"] = s;
    await refreshCategories();
    revalidateTag("categories", { expire: 0 });
  }

  // 2. Товары
  {
    const rows = sheetToRows(wb, "Товары");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "Название", "name", "Name");
      if (!name) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id");
        const sku = cell(row, "Артикул", "sku") || null;
        const catName = cell(row, "Категория", "category", "categoryName");
        let categoryId = resolveCategoryId(catName);
        if (catName && !categoryId) {
          // автосоздание категории по слову
          const created = await createCategory({
            name: catName,
            slug: slugify(catName),
            sortOrder: 100,
            isVisible: true,
          });
          categoryId = created.id;
          await refreshCategories();
          report.warnings.push(
            `Товары: категория «${catName}» не найдена — создана автоматически`
          );
        }

        const existing =
          (id && products.find((p) => p.id === id)) ||
          (sku &&
            products.find((p) => normalizeText(p.sku || "") === normalizeText(sku))) ||
          findBestByName(name, products, (p) => p.name, 98) ||
          null;

        const payload: Record<string, any> = {
          name,
          slug: cell(row, "Слаг", "slug") || slugify(name),
          sku,
          categoryId,
          description: cell(row, "Описание", "description") || null,
          price: num(row, "Цена", "price"),
          priceWholesale: num(row, "Оптовая цена", "priceWholesale"),
          minWholesaleQty: num(row, "Мин. опт", "minWholesaleQty"),
          dimensionLength: num(row, "Длина мм", "dimensionLength"),
          dimensionWidth: num(row, "Ширина мм", "dimensionWidth"),
          dimensionHeight: num(row, "Высота мм", "dimensionHeight"),
          stockQty: num(row, "Остаток", "stockQty") ?? 0,
          stockWarnQty: num(row, "Порог остатка", "stockWarnQty"),
          inStock: bool(row, "В наличии", "inStock") ?? true,
          madeToOrder: bool(row, "На заказ", "madeToOrder") ?? false,
          isVisible: bool(row, "Видимый", "isVisible") ?? true,
          isFeatured: bool(row, "Избранный", "isFeatured") ?? false,
          isPromo: bool(row, "Акция", "isPromo") ?? false,
          promoLabel: cell(row, "Метка акции", "promoLabel") || null,
          material: cell(row, "Материал", "material") || null,
          packQty: num(row, "В упаковке", "packQty"),
          weight: num(row, "Вес", "weight"),
          imageUrl: cell(row, "URL картинки", "imageUrl") || null,
        };
        const discType = cell(row, "Скидка тип", "discountType");
        if (discType === "percent" || discType === "fixed") payload.discountType = discType;
        const discVal = num(row, "Скидка значение", "discountValue");
        if (discVal != null) payload.discountValue = discVal;

        if (existing) {
          await updateProduct(existing.id, payload);
          s.updated++;
        } else {
          await createProduct(payload);
          s.created++;
        }
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Товары"] = s;
    await refreshProducts();
  }

  // 3. Контрагенты
  {
    const rows = sheetToRows(wb, "Контрагенты");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "Название", "name");
      if (!name) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id") || null;
        const rolesRaw = cell(row, "Роли", "roles").toLowerCase();
        const roles: ("supplier" | "customer")[] = [];
        if (/постав|supplier/.test(rolesRaw) || !rolesRaw) roles.push("supplier");
        if (/покуп|customer|клиент/.test(rolesRaw) || !rolesRaw) roles.push("customer");
        if (roles.length === 0) roles.push("customer");

        const existing = id
          ? counterparties.find((c) => c.id === id)
          : findBestByName(name, counterparties, (c) => c.name, 95);

        await saveCounterparty({
          id: existing?.id || id,
          name,
          roles: [...new Set(roles)],
          phone: cell(row, "Телефон", "phone") || null,
          email: cell(row, "Email", "email") || null,
          inn: cell(row, "ИНН", "inn") || null,
          kpp: cell(row, "КПП", "kpp") || null,
          ogrn: cell(row, "ОГРН", "ogrn") || null,
          fullName: cell(row, "Полное название", "fullName") || null,
          shortName: cell(row, "Краткое название", "shortName") || null,
          legalAddress: cell(row, "Юр. адрес", "legalAddress") || null,
          address: cell(row, "Адрес", "address") || null,
          contactName: cell(row, "Контакт", "contactName") || null,
          bankName: cell(row, "Банк", "bankName") || null,
          bankAccount: cell(row, "Р/с", "bankAccount") || null,
          bik: cell(row, "БИК", "bik") || null,
          correspondentAccount: cell(row, "К/с", "correspondentAccount") || null,
          comment: cell(row, "Комментарий", "comment") || null,
        });
        if (existing) s.updated++;
        else s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Контрагенты"] = s;
    await refreshCounterparties();
  }

  // 4. Сотрудники
  {
    const rows = sheetToRows(wb, "Сотрудники");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "ФИО", "Имя", "name");
      if (!name) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id") || null;
        const existing = id
          ? employees.find((e) => e.id === id)
          : findBestByName(name, employees, (e) => e.name, 95);
        await saveEmployee({
          id: existing?.id || null,
          name,
          position: cell(row, "Должность", "position") || null,
          phone: cell(row, "Телефон", "phone") || null,
          comment: cell(row, "Комментарий", "comment") || null,
        });
        if (existing) s.updated++;
        else s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Сотрудники"] = s;
    await refreshEmployees();
  }

  // 5. Поступления (+ позиции)
  {
    const headers = sheetToRows(wb, "Поступления");
    const itemsAll = sheetToRows(wb, "Поступления_позиции");
    const s = emptySheet();

    // group items by doc number
    const itemsByNum = new Map<string, StockDocItem[]>();
    for (const ir of itemsAll) {
      const docNum = cell(ir, "Номер документа", "Номер", "number", "doc");
      if (!docNum) continue;
      const productName = cell(ir, "Товар", "name", "product");
      const sku = cell(ir, "Артикул", "sku");
      const prod = resolveProduct(productName, sku);
      if (!prod) {
        s.errors.push(
          `Позиция поступления №${docNum}: товар «${productName || sku}» не найден`
        );
        continue;
      }
      const qty = num(ir, "Кол-во", "quantity") || 0;
      const price = num(ir, "Цена", "price") || 0;
      const lineTotal = num(ir, "Сумма строки", "lineTotal") ?? qty * price;
      if (qty <= 0) continue;
      const list = itemsByNum.get(docNum) || [];
      list.push({
        productId: prod.id,
        name: prod.name,
        sku: prod.sku || null,
        quantity: qty,
        price,
        lineTotal: Math.round(lineTotal * 100) / 100,
      });
      itemsByNum.set(docNum, list);
    }

    for (let i = 0; i < headers.length; i++) {
      const row = headers[i];
      const supplier = cell(row, "Поставщик", "supplier");
      const docNum = cell(row, "Номер", "number") || String(i + 1);
      if (!supplier) {
        s.skipped++;
        continue;
      }
      try {
        // уже есть такой номер?
        const existingNum = num(row, "Номер", "number");
        if (
          existingNum != null &&
          receipts.some((r) => r.number === existingNum)
        ) {
          s.skipped++;
          report.warnings.push(
            `Поступление ПО-${existingNum} уже есть — пропущено (чтобы не дублировать)`
          );
          continue;
        }
        const items = itemsByNum.get(docNum) || itemsByNum.get(String(existingNum)) || [];
        if (items.length === 0) {
          s.errors.push(`стр.${i + 2}: нет позиций для поступления «${supplier}»`);
          continue;
        }
        const statusRaw = cell(row, "Статус", "status").toLowerCase();
        const created = await createReceipt({
          date: parseDate(cell(row, "Дата", "date")),
          supplier,
          phone: cell(row, "Телефон", "phone") || null,
          email: cell(row, "Email", "email") || null,
          inn: cell(row, "ИНН", "inn") || null,
          kpp: cell(row, "КПП", "kpp") || null,
          address: cell(row, "Адрес", "address") || null,
          contactName: cell(row, "Контакт", "contactName") || null,
          comment: cell(row, "Комментарий", "comment") || null,
          vatRate: num(row, "НДС %", "vatRate") ?? VAT_RATE,
          items,
        });
        if (/провед|posted|да/.test(statusRaw)) {
          try {
            await postReceipt(created.id);
          } catch (pe) {
            report.warnings.push(
              `ПО-${created.number}: создано, но не проведено — ${
                pe instanceof Error ? pe.message : pe
              }`
            );
          }
        }
        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Поступления"] = s;
    await refreshReceipts();
    await refreshProducts();
  }

  // 6. Заказы учёта
  {
    const headers = sheetToRows(wb, "Заказы_учёта");
    const itemsAll = sheetToRows(wb, "Заказы_позиции");
    const s = emptySheet();

    const itemsByNum = new Map<string, StockDocItem[]>();
    for (const ir of itemsAll) {
      const docNum = cell(ir, "Номер документа", "Номер", "number", "doc");
      if (!docNum) continue;
      const productName = cell(ir, "Товар", "name", "product");
      const sku = cell(ir, "Артикул", "sku");
      const prod = resolveProduct(productName, sku);
      if (!prod) {
        s.errors.push(
          `Позиция заказа №${docNum}: товар «${productName || sku}» не найден`
        );
        continue;
      }
      const qty = num(ir, "Кол-во", "quantity") || 0;
      const price = num(ir, "Цена", "price") || 0;
      const lineTotal = num(ir, "Сумма строки", "lineTotal") ?? qty * price;
      if (qty <= 0) continue;
      const list = itemsByNum.get(docNum) || [];
      list.push({
        productId: prod.id,
        name: prod.name,
        sku: prod.sku || null,
        quantity: qty,
        price,
        lineTotal: Math.round(lineTotal * 100) / 100,
      });
      itemsByNum.set(docNum, list);
    }

    for (let i = 0; i < headers.length; i++) {
      const row = headers[i];
      const customerName = cell(row, "Покупатель", "customerName", "Клиент");
      const docNum = cell(row, "Номер", "number") || String(i + 1);
      if (!customerName) {
        s.skipped++;
        continue;
      }
      try {
        const existingNum = num(row, "Номер", "number");
        if (
          existingNum != null &&
          deals.some((d) => d.number === existingNum)
        ) {
          s.skipped++;
          report.warnings.push(
            `Заказ ЗК-${existingNum} уже есть — пропущен`
          );
          continue;
        }
        const items = itemsByNum.get(docNum) || itemsByNum.get(String(existingNum)) || [];
        if (items.length === 0) {
          s.errors.push(`стр.${i + 2}: нет позиций для заказа «${customerName}»`);
          continue;
        }
        const statusRaw = cell(row, "Статус", "status").toLowerCase();
        const created = await createDeal({
          date: parseDate(cell(row, "Дата", "date")),
          customerName,
          customerPhone: cell(row, "Телефон", "phone") || null,
          email: cell(row, "Email", "email") || null,
          inn: cell(row, "ИНН", "inn") || null,
          address: cell(row, "Адрес", "address") || null,
          comment: cell(row, "Комментарий", "comment") || null,
          vatRate: num(row, "НДС %", "vatRate") ?? VAT_RATE,
          items,
        });
        if (/провед|completed|выполн/.test(statusRaw)) {
          try {
            await postDeal(created.id);
          } catch (pe) {
            report.warnings.push(
              `ЗК-${created.number}: создан, но не проведён — ${
                pe instanceof Error ? pe.message : pe
              }`
            );
          }
        }
        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Заказы_учёта"] = s;
    await refreshDeals();
    await refreshProducts();
    await refreshReceipts();
  }

  // 7. Платежи
  {
    const rows = sheetToRows(wb, "Платежи");
    const s = emptySheet();
    // актуальные deals/receipts после импорта
    await refreshDeals();
    await refreshReceipts();
    const dealByNum = new Map(deals.map((d) => [d.number, d]));
    const receiptByNum = new Map(receipts.map((r) => [r.number, r]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const counterparty = cell(row, "Контрагент", "counterparty");
      const amount = num(row, "Сумма", "amount");
      if (!counterparty || amount == null || amount <= 0) {
        s.skipped++;
        continue;
      }
      try {
        const existingNum = num(row, "Номер", "number");
        if (existingNum != null) {
          const { data: existPay } = await db
            .from("bank_payments")
            .select("id")
            .eq("number", existingNum)
            .maybeSingle();
          if (existPay) {
            s.skipped++;
            report.warnings.push(`Платёж №${existingNum} уже есть — пропущен`);
            continue;
          }
        }

        const dirRaw = cell(row, "Направление", "direction").toLowerCase();
        const direction =
          /исход|out|расход|платеж постав/.test(dirRaw) ? "outgoing" : "incoming";

        const typeRaw = cell(row, "Тип", "type").toLowerCase();
        let type: string = "regular";
        if (/нал|cash|касс/.test(typeRaw)) type = "cash";
        else if (/перевод|transfer/.test(typeRaw)) type = "transfer";
        else if (/возврат|refund/.test(typeRaw)) type = "refund";
        else if (/внесен|deposit/.test(typeRaw)) type = "deposit";

        const dealRefs = parseDocRefs(
          cell(row, "Связанные заказы", "dealNumbers", "deals", "Заказы")
        );
        const receiptRefs = parseDocRefs(
          cell(
            row,
            "Связанные поступления",
            "receiptNumbers",
            "receipts",
            "Поступления"
          )
        );

        const dealIds: string[] = [];
        const dealNumbers: number[] = [];
        for (const n of dealRefs.deals) {
          const d = dealByNum.get(n);
          if (d) {
            dealIds.push(d.id);
            dealNumbers.push(d.number);
          } else {
            report.warnings.push(
              `Платёж «${counterparty}»: заказ ЗК-${n} не найден`
            );
          }
        }
        const receiptIds: string[] = [];
        const receiptNumbers: number[] = [];
        for (const n of receiptRefs.receipts) {
          const r = receiptByNum.get(n);
          if (r) {
            receiptIds.push(r.id);
            receiptNumbers.push(r.number);
          } else if (!dealRefs.deals.includes(n)) {
            // plain number мог попасть и в deals — не дублируем warning
            report.warnings.push(
              `Платёж «${counterparty}»: поступление ПО-${n} не найдено`
            );
          }
        }

        // Контрагент
        const cp = findBestByName(counterparty, counterparties, (c) => c.name, 50);

        const isPaid = bool(row, "Оплачен", "isPaid") ?? false;
        const created = await createPayment({
          date: parseDate(cell(row, "Дата", "date")),
          direction,
          type,
          counterparty,
          counterpartyId: cp?.id || null,
          amount,
          dealIds,
          receiptIds,
          invoiceNumber: cell(row, "Номер счёта", "invoiceNumber") || null,
          vatRate: num(row, "НДС %", "vatRate") ?? VAT_RATE,
          isPaid,
          excludeFromBalance: bool(row, "Исключить из баланса", "excludeFromBalance") ?? false,
          comment: cell(row, "Комментарий", "comment") || null,
        });

        // дописываем номера связей (createPayment не всегда пишет numbers)
        if (dealNumbers.length || receiptNumbers.length) {
          await db
            .from("bank_payments")
            .update({
              deal_numbers: dealNumbers,
              receipt_numbers: receiptNumbers,
              deal_ids: dealIds,
              receipt_ids: receiptIds,
            })
            .eq("id", created.id);
        }

        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Платежи"] = s;
  }

  // 8. Зарплаты
  {
    const rows = sheetToRows(wb, "Зарплаты");
    const s = emptySheet();
    await refreshEmployees();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const empName = cell(row, "Сотрудник", "employeeName", "ФИО");
      const amount = num(row, "Сумма", "amount");
      if (!empName || amount == null) {
        s.skipped++;
        continue;
      }
      try {
        const emp = findBestByName(empName, employees, (e) => e.name, 50);
        if (!emp) {
          report.warnings.push(
            `Зарплата: сотрудник «${empName}» не найден — создаём запись только с именем`
          );
        }
        const sourceRaw = cell(row, "Источник", "source").toLowerCase();
        const source = /касс|cash|нал/.test(sourceRaw) ? "cash" : "bank";
        await createSalary({
          employeeId: emp?.id || null,
          employeeName: emp?.name || empName,
          amount,
          date: parseDate(cell(row, "Дата", "date")),
          source,
          isPaid: bool(row, "Выплачено", "isPaid") ?? false,
          comment: cell(row, "Комментарий", "comment") || null,
        });
        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Зарплаты"] = s;
  }

  // 9. Заявки сайта
  {
    const rows = sheetToRows(wb, "Заявки_сайта");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = cell(row, "Имя", "customerName", "Клиент");
      const phone = cell(row, "Телефон", "customerPhone", "phone");
      if (!name && !phone) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id");
        if (id) {
          const { data: exist } = await db
            .from("orders")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          if (exist) {
            s.skipped++;
            continue;
          }
        }
        const typeRaw = cell(row, "Тип", "type").toLowerCase();
        const type = /заявк|inquiry|уточн/.test(typeRaw) ? "inquiry" : "order";
        const custRaw = cell(row, "Тип клиента", "customerType").toLowerCase();
        const customerType = /юр|legal|организ/.test(custRaw)
          ? "legal"
          : "individual";
        const statusRaw = cell(row, "Статус", "status").toLowerCase();
        let status = "new";
        if (/работ|progress/.test(statusRaw)) status = "in_progress";
        else if (/провед|complete|выполн/.test(statusRaw)) status = "completed";
        else if (/отклон|reject|cancel/.test(statusRaw)) status = "rejected";

        const itemsRaw = cell(
          row,
          "Товары (название×кол-во×цена)",
          "Товары",
          "items"
        );
        const items: {
          productId: string;
          name: string;
          quantity: number;
          price: number;
          sku?: string;
        }[] = [];
        if (itemsRaw) {
          for (const part of itemsRaw
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean)) {
            const m = part.match(
              /^(.+?)[×xх]\s*(\d+(?:[.,]\d+)?)\s*[×xх]\s*(\d+(?:[.,]\d+)?)$/i
            );
            if (m) {
              const pName = m[1].trim();
              const qty = Number(m[2].replace(",", "."));
              const price = Number(m[3].replace(",", "."));
              const prod = resolveProduct(pName);
              items.push({
                productId: prod?.id || "",
                name: prod?.name || pName,
                sku: prod?.sku || undefined,
                quantity: qty,
                price,
              });
            }
          }
        }

        const created = await createOrder({
          type,
          customerType,
          customerName: name || "Клиент",
          customerPhone: phone || "",
          customerEmail: cell(row, "Email", "email") || null,
          communicationChannel:
            cell(row, "Связь", "communicationChannel") || "call",
          paymentMethod: cell(row, "Оплата", "paymentMethod") || null,
          comment: cell(row, "Комментарий", "comment") || null,
          status,
          deliveryAddress:
            cell(row, "Адрес доставки", "deliveryAddress") || null,
          items: type === "order" && items.length ? items : null,
          totalSum: num(row, "Сумма", "totalSum") ?? undefined,
          productInfo: type === "inquiry" ? itemsRaw || null : null,
        });

        const address = cell(row, "Адрес доставки", "deliveryAddress");
        const hasDelivery =
          bool(row, "Есть доставка", "hasDelivery") ?? Boolean(address);
        if (hasDelivery && created?.id) {
          try {
            const delivTypeRaw = cell(
              row,
              "Тип доставки",
              "deliveryType"
            ).toLowerCase();
            const deliveryType = /плат|paid/.test(delivTypeRaw)
              ? "paid"
              : "free";
            const deliveryCost =
              num(row, "Стоимость доставки", "deliveryCost") || 0;
            await db
              .from("orders")
              .update({
                delivery_address: address || null,
                has_delivery: true,
                delivery_type: deliveryType,
                delivery_cost: deliveryType === "paid" ? deliveryCost : 0,
              })
              .eq("id", created.id);
          } catch {
            // колонки доставки могут ещё не быть в БД
          }
        }

        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Заявки_сайта"] = s;
  }

  // 10. Акции
  {
    const rows = sheetToRows(wb, "Акции");
    const s = emptySheet();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = cell(row, "Заголовок", "title");
      if (!title) {
        s.skipped++;
        continue;
      }
      try {
        const id = cell(row, "ID", "id");
        const productName = cell(row, "Товар (название)", "productName");
        let productId = cell(row, "Товар ID", "productId") || null;
        if (!productId && productName) {
          productId = resolveProduct(productName)?.id || null;
        }
        const payload = {
          title,
          subtitle: cell(row, "Подзаголовок", "subtitle") || null,
          badge: cell(row, "Бейдж", "badge") || null,
          link_type: cell(row, "Тип ссылки", "linkType") || "none",
          link_url: cell(row, "Ссылка URL", "linkUrl") || null,
          product_id: productId,
          sort_order: num(row, "Порядок", "sortOrder") ?? 0,
          is_visible: bool(row, "Видима", "isVisible") ?? true,
          icon: cell(row, "Иконка", "icon") || null,
          deadline: cell(row, "Дедлайн", "deadline") || null,
        };
        if (id) {
          const { data: exist } = await db
            .from("promotions")
            .select("id")
            .eq("id", id)
            .maybeSingle();
          if (exist) {
            await db.from("promotions").update(payload).eq("id", id);
            s.updated++;
            continue;
          }
        }
        await db.from("promotions").insert(payload);
        s.created++;
      } catch (e) {
        s.errors.push(`стр.${i + 2}: ${e instanceof Error ? e.message : e}`);
      }
    }
    report.sheets["Акции"] = s;
    revalidateTag("promotions", { expire: 0 });
  }

  // 11. Настройки
  {
    const rows = sheetToRows(wb, "Настройки");
    const s = emptySheet();
    const map: Record<string, string> = {};
    for (const row of rows) {
      const key = cell(row, "Ключ", "key");
      const value = cell(row, "Значение", "value");
      if (!key) {
        s.skipped++;
        continue;
      }
      map[key] = value;
    }
    if (Object.keys(map).length) {
      try {
        await updateSettings(map);
        s.updated = Object.keys(map).length;
      } catch (e) {
        s.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    report.sheets["Настройки"] = s;
  }

  const totalErrors = Object.values(report.sheets).reduce(
    (n, s) => n + s.errors.length,
    0
  );
  const totalCreated = Object.values(report.sheets).reduce(
    (n, s) => n + s.created,
    0
  );
  const totalUpdated = Object.values(report.sheets).reduce(
    (n, s) => n + s.updated,
    0
  );
  report.success = totalErrors === 0 || totalCreated + totalUpdated > 0;
  report.message = `Создано: ${totalCreated}, обновлено: ${totalUpdated}, ошибок: ${totalErrors}, предупреждений: ${report.warnings.length}`;

  revalidateTag("orders", { expire: 0 });
  revalidateTag("products", { expire: 0 });
  revalidateTag("warehouse-receipts", { expire: 0 });
  revalidateTag("warehouse-deals", { expire: 0 });
  revalidateTag("warehouse-payments", { expire: 0 });
  revalidateTag("warehouse-salaries", { expire: 0 });
  revalidateTag("warehouse-employees", { expire: 0 });
  revalidateTag("warehouse-counterparties", { expire: 0 });

  return report;
}
