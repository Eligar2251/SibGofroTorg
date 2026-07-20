import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  postDeal,
  cancelDeal,
  deleteDeal,
  updateDeal,
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
    await updateDeal(id, {
      date: String(body.date || ""),
      customerName: String(body.customerName || ""),
      customerPhone: body.customerPhone ?? null,
      email: body.email ?? null,
      inn: body.inn ?? null,
      kpp: body.kpp ?? null,
      address: body.address ?? null,
      contactName: body.contactName ?? null,
      comment: body.comment ?? null,
      items: Array.isArray(body.items) ? body.items : [],
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
    if (body.action === "post") {
      await postDeal(id);
    } else if (body.action === "cancel") {
      await cancelDeal(id, body.reason ?? null);
    } else {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Update deal error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
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
    await deleteDeal(id);
    revalidateTag("products", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete deal error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
