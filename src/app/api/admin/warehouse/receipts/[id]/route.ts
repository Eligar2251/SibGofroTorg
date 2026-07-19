import { NextRequest, NextResponse } from "next/server";
import { deleteReceipt } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteReceipt(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete receipt error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
