import { NextRequest, NextResponse } from "next/server";
import { deleteCashCollection } from "@/lib/warehouse";
import { requireAdminApi, hasPermission } from "@/lib/auth";
import { logAdminAction } from "@/lib/activity-log";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  if (!hasPermission(auth, "delete")) {
    return NextResponse.json({ error: "Нет прав на удаление" }, { status: 403 });
  }

  try {
    const { id } = await params;
    await deleteCashCollection(id);

    await logAdminAction(
      auth.displayName,
      auth.role,
      "delete",
      "cash-collection",
      id,
      `Удалена сводка кассы #${id.slice(0, 8)}`
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete cash collection error:", error);
    return NextResponse.json(
      { error: error?.message || "Ошибка сервера" },
      { status: 400 }
    );
  }
}
