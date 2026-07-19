import { NextRequest, NextResponse } from "next/server";
import { postDeal, cancelDeal, deleteDeal } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

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
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete deal error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
