// =========================================================
// FILE: src/app/api/orders/route.ts
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createOrder } from "@/lib/supabase-queries";
import {
  formatPhoneDisplay,
  getUserById,
  normalizePhone,
  updateUserProfile,
  verifyUserSession,
} from "@/lib/user-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { sendAdminNotifications } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 120;
const MAX_COMMENT = 2000;
const MAX_ITEMS = 80;
const MAX_QTY = 100_000;

function clip(s: unknown, max: number): string {
  return String(s ?? "").trim().slice(0, max);
}

function publicError(err: unknown): string {
  if (process.env.NODE_ENV !== "production" && err instanceof Error) {
    return err.message;
  }
  return "Внутренняя ошибка сервера";
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const rl = rateLimit(`orders:${ip}`, 30, 60 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Слишком много заявок. Попробуйте позже." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  try {
    const body = await request.json();

    const typeRaw = body.type === "inquiry" ? "inquiry" : "order";
    const session = await verifyUserSession();
    const account = session?.uid ? await getUserById(session.uid) : null;
    const customerType = body.customerType === "legal" ? "legal" : "individual";
    const isLegal = customerType === "legal";

    // У заявки «Узнать цену» контакты авторизованного клиента берутся только
    // из его аккаунта. Так номер/имя другого человека из формы не смогут
    // перезаписать профиль текущей сессии на общем компьютере.
    let customerName = clip(body.customerName, MAX_NAME);
    let customerPhoneRaw = clip(body.customerPhone, 40);
    if (typeRaw === "inquiry" && account) {
      customerName = clip(account.name, MAX_NAME) || "Клиент";
      customerPhoneRaw = account.phoneDigits;
    } else if (typeRaw === "inquiry" && !customerName) {
      customerName = "Клиент";
    }

    const customerEmail = body.customerEmail
      ? clip(body.customerEmail, 120)
      : account?.email || null;
    const comment = body.comment ? clip(body.comment, MAX_COMMENT) : "";

    if (!customerPhoneRaw || (typeRaw === "order" && !customerName)) {
      return NextResponse.json(
        {
          error:
            typeRaw === "order"
              ? "Имя и телефон обязательны"
              : "Телефон обязателен",
        },
        { status: 400 }
      );
    }

    const companyName = isLegal ? clip(body.companyName, 200) : null;
    const shortName = isLegal ? clip(body.shortName, 200) || null : null;
    const inn = isLegal ? clip(body.inn, 20).replace(/\D/g, "") : null;
    const kpp = isLegal && body.kpp ? clip(body.kpp, 20).replace(/\D/g, "") : null;
    const ogrn = isLegal && body.ogrn ? clip(body.ogrn, 20).replace(/\D/g, "") : null;
    const legalAddress = isLegal ? clip(body.legalAddress, 300) : null;
    const actualAddress =
      isLegal && body.actualAddress ? clip(body.actualAddress, 300) : null;
    const taxSystem = isLegal && body.taxSystem ? clip(body.taxSystem, 40) : null;
    const bankAccount = isLegal && body.bankAccount ? clip(body.bankAccount, 40).replace(/\D/g, "") : null;
    const bankName = isLegal && body.bankName ? clip(body.bankName, 200) : null;
    const bik = isLegal && body.bik ? clip(body.bik, 20).replace(/\D/g, "") : null;
    const correspondentAccount = isLegal && body.correspondentAccount ? clip(body.correspondentAccount, 40).replace(/\D/g, "") : null;
    const deliveryAddress = body.deliveryAddress
      ? clip(body.deliveryAddress, 300)
      : null;

    if (isLegal) {
      if (!companyName) {
        return NextResponse.json(
          { error: "Укажите полное наименование организации" },
          { status: 400 }
        );
      }
      if (!inn || (inn.length !== 10 && inn.length !== 12)) {
        return NextResponse.json(
          { error: "ИНН: 10 или 12 цифр" },
          { status: 400 }
        );
      }
      if (!customerEmail) {
        return NextResponse.json(
          { error: "Укажите рабочую почту для выставления счёта" },
          { status: 400 }
        );
      }
      if (!legalAddress) {
        return NextResponse.json(
          { error: "Укажите юридический адрес" },
          { status: 400 }
        );
      }
    }

    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return NextResponse.json({ error: "Некорректный email" }, { status: 400 });
    }

    const phoneDigits = normalizePhone(customerPhoneRaw);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return NextResponse.json(
        { error: "Некорректный номер телефона" },
        { status: 400 }
      );
    }

    // Сессия — единственный источник userId и номера аккаунта (не из body!).
    const sessionPhoneDigits = session ? normalizePhone(session.phone) : null;
    if (
      typeRaw === "order" &&
      sessionPhoneDigits &&
      phoneDigits !== sessionPhoneDigits
    ) {
      return NextResponse.json(
        {
          error:
            "Номер заказа не совпадает с номером текущего аккаунта. Выйдите из кабинета, чтобы использовать другой номер.",
        },
        { status: 409 }
      );
    }
    const finalPhoneDigits = sessionPhoneDigits || phoneDigits;
    const finalPhoneDisplay = formatPhoneDisplay(finalPhoneDigits);

    const commWhitelist = ["call", "whatsapp", "telegram", "max", "email"] as const;
    const communicationChannel = commWhitelist.includes(body.communicationChannel)
      ? body.communicationChannel
      : "call";

    let paymentMethod: string;
    if (isLegal) {
      paymentMethod = "invoice";
    } else if (body.paymentMethod === "cash") {
      paymentMethod = "cash";
    } else if (body.paymentMethod === "card" || body.paymentMethod === "transfer") {
      paymentMethod = "transfer";
    } else {
      paymentMethod = "transfer";
    }

    const orderData: Record<string, unknown> = {
      type: typeRaw,
      customerType,
      customerName,
      customerPhone: finalPhoneDisplay,
      customerPhoneDigits: finalPhoneDigits,
      customerEmail,
      communicationChannel,
      paymentMethod,
      comment,
      channel: "website",
      status: "new",
      // ТОЛЬКО из session
      userId: session?.uid ?? null,
      companyName,
      shortName,
      inn,
      kpp,
      ogrn,
      legalAddress,
      actualAddress,
      taxSystem,
      bankAccount,
      bankName,
      bik,
      correspondentAccount,
      deliveryAddress,
    };

    if (typeRaw === "order" && Array.isArray(body.items)) {
      const items = body.items.slice(0, MAX_ITEMS).map((item: any) => ({
        productId: clip(item.productId, 80),
        name: clip(item.name, 200),
        sku: item.sku ? clip(item.sku, 80) : "—",
        quantity: Math.min(
          MAX_QTY,
          Math.max(1, Number(item.quantity) || 1)
        ),
        price: Math.max(0, Number(item.price) || 0),
      }));
      if (items.length === 0) {
        return NextResponse.json(
          { error: "Корзина пуста" },
          { status: 400 }
        );
      }
      orderData.items = items;
      orderData.totalSum = Math.max(0, Number(body.totalSum) || 0);
    } else {
      orderData.type = "inquiry";
      orderData.productInfo = body.productInfo
        ? clip(body.productInfo, 300)
        : null;
      orderData.quantity =
        body.quantity != null
          ? Math.min(MAX_QTY, Math.max(0, Number(body.quantity) || 0))
          : null;
    }

    const createdOrder = await createOrder(orderData as any);
    if (typeRaw === "order") {
      revalidateTag("products", { expire: 0 });
    }

    // Контактное лицо в конкретном заказе может отличаться от владельца
    // аккаунта, поэтому имя профиля здесь принципиально не обновляем.
    if (session?.uid && typeRaw === "order") {
      updateUserProfile(session.uid, {
        email: customerEmail,
        customerType,
        companyName,
        inn,
        kpp,
        ogrn,
        legalAddress,
        actualAddress,
        deliveryAddress,
      }).catch((e) => console.error("profile after order:", e));
    }

    sendNotifications({
      id: createdOrder.id,
      type: (orderData.type as "order" | "inquiry") || "order",
      customerType,
      customerName,
      customerPhone: finalPhoneDisplay,
      customerEmail,
      communicationChannel,
      paymentMethod,
      items: orderData.items as any,
      totalSum: orderData.totalSum as number | undefined,
      productInfo: orderData.productInfo as string | null | undefined,
      quantity: orderData.quantity as number | null | undefined,
      comment,
      companyName,
      inn,
      kpp,
      ogrn,
      legalAddress,
      actualAddress,
    }).catch((err) => console.error("notify bots:", err));

    return NextResponse.json({ success: true, orderId: createdOrder.id });
  } catch (error: unknown) {
    console.error("Ошибка в API создания заказа:", error);
    return NextResponse.json({ error: publicError(error) }, { status: 500 });
  }
}

async function sendNotifications(order: {
  id: string;
  type: "order" | "inquiry";
  customerType: "individual" | "legal";
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  communicationChannel: string;
  paymentMethod?: string;
  items?: { name: string; quantity: number; price: number }[];
  totalSum?: number;
  productInfo?: string | null;
  quantity?: number | null;
  comment?: string | null;
  companyName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  legalAddress?: string | null;
  actualAddress?: string | null;
}) {
  const isOrder = order.type === "order";
  const isLegal = order.customerType === "legal";
  const customerTypeLabel = isLegal ? "Юр. лицо" : "Физ. лицо";

  const channels: Record<string, string> = {
    call: "Телефонный звонок",
    whatsapp: "WhatsApp",
    telegram: "Telegram",
    max: "Макс",
    email: "Электронная почта",
  };
  const payments: Record<string, string> = {
    transfer: "Перевод на карту",
    cash: "Наличные",
    invoice: "Счёт",
  };

  let message = `<b>${isOrder ? "НОВЫЙ ЗАКАЗ" : "НОВАЯ ЗАЯВКА"} #${order.id.slice(0, 6)}</b>\n\n`;
  message += `<b>Клиент:</b> ${escapeHtml(order.customerName)} (${customerTypeLabel})\n`;
  message += `<b>Телефон:</b> ${escapeHtml(order.customerPhone)}\n`;
  if (order.customerEmail) {
    message += `<b>Email:</b> ${escapeHtml(order.customerEmail)}\n`;
  }
  message += `<b>Связь:</b> ${channels[order.communicationChannel] || "—"}\n`;
  if (order.paymentMethod) {
    message += `<b>Оплата:</b> ${payments[order.paymentMethod] || order.paymentMethod}\n`;
  }
  if (isLegal) {
    message += `\n<b>Реквизиты</b>\n`;
    if (order.companyName) message += `• ${escapeHtml(order.companyName)}\n`;
    if (order.inn) message += `• ИНН: ${escapeHtml(order.inn)}\n`;
    if (order.kpp) message += `• КПП: ${escapeHtml(order.kpp)}\n`;
    if (order.ogrn) message += `• ОГРН: ${escapeHtml(order.ogrn)}\n`;
    if (order.legalAddress)
      message += `• Юр. адрес: ${escapeHtml(order.legalAddress)}\n`;
    if (order.actualAddress)
      message += `• Факт. адрес: ${escapeHtml(order.actualAddress)}\n`;
  }
  message += `\n`;

  if (isOrder && order.items?.length) {
    message += `<b>Позиции:</b>\n`;
    order.items.forEach((item, i) => {
      message += `${i + 1}. ${escapeHtml(item.name)} (${item.quantity} шт.) — ${(item.price * item.quantity).toLocaleString("ru-RU")} ₽\n`;
    });
    message += `\n<b>Итого: ${order.totalSum?.toLocaleString("ru-RU")} ₽</b>\n\n`;
  } else {
    message += `<b>Товар:</b> ${escapeHtml(order.productInfo || "Не указан")}\n`;
    message += `<b>Кол-во:</b> ${order.quantity ?? "—"}\n\n`;
  }
  if (order.comment) {
    message += `<b>Комментарий:</b> ${escapeHtml(order.comment)}\n`;
  }

  await sendAdminNotifications(message);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}