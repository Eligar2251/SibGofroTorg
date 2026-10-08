import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  deleteReceipt,
  postReceipt,
  cancelReceipt,
  finishReceiptTransport,
  markReceiptOverdeliveryPaid,
  setReceiptTransport,
  updateReceipt,
} from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await updateReceipt(id, {
      date: String(body.date || ""),
      supplier: String(body.supplier || ""),
      phone: body.phone ?? null,
      email: body.email ?? null,
      inn: body.inn ?? null,
      kpp: body.kpp ?? null,
      address: body.address ?? null,
      contactName: body.contactName ?? null,
      comment: body.comment ?? null,
      bankAccount: body.bankAccount ?? null,
      bankName: body.bankName ?? null,
      bankCity: body.bankCity ?? null,
      bik: body.bik ?? null,
      correspondentAccount: body.correspondentAccount ?? null,
      invoiceNumber: body.invoiceNumber ?? null,
      invoiceDate: body.invoiceDate ?? null,
      items: Array.isArray(body.items) ? body.items : [],
      vatRate: body.vatRate,
      linkedDealIds: body.linkedDealIds,
      linkedPaymentIds: body.linkedPaymentIds,
      noPayment: body.noPayment === true,
      isConsignment: body.isConsignment === true,
      // «Заберём сами»: пометку перевозки сохраняем вместе с документом.
      ...(body.needsTransport !== undefined
        ? {
            needsTransport: body.needsTransport === true,
            transportPlannedDate: body.transportPlannedDate ?? null,
          }
        : {}),
      paymentSplits: Array.isArray(body.paymentSplits)
        ? body.paymentSplits
        : undefined,
    });
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    let result: Record<string, unknown> = {};
    if (body.action === "post") {
      result = await postReceipt(
        id,
        Array.isArray(body.items)
          ? body.items.map((item: any) => ({
              productId: String(item?.productId || ""),
              quantity: Number(item?.quantity) || 0,
            }))
          : undefined,
        // Ручная приёмка из карточки поставки: разрешено ввести больше
        // заказанного (перепоставка с отдельным долгом), а флагом acceptExtra —
        // дописать излишек в уже полностью принятую поставку («Принять ещё»).
        {
          allowOverdelivery: body.allowOverdelivery === true,
          acceptExtraOnPosted: body.acceptExtra === true,
        }
      );
    } else if (body.action === "cancel") {
      await cancelReceipt(id);
    } else if (body.action === "transport") {
      // Быстрая пометка «Заберём сами» из списка поставок (в т.ч. для
      // частично принятой поставки, где обычное редактирование запрещено).
      await setReceiptTransport(id, {
        needsTransport: body.needsTransport === true,
        transportPlannedDate: body.transportPlannedDate ?? null,
      });
    } else if (body.action === "finish-transport") {
      result = await finishReceiptTransport(id);
    } else if (body.action === "mark-overdelivery-paid") {
      result = await markReceiptOverdeliveryPaid(id, String(body.productId || ""));
    } else {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteReceipt(id);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete receipt error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
