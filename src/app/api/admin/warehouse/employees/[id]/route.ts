import { NextRequest, NextResponse } from "next/server";
import { saveEmployee, deleteEmployee } from "@/lib/warehouse";
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
    const result = await saveEmployee({
      id,
      name: String(body.name || ""),
      position: body.position ?? null,
      phone: body.phone ?? null,
      comment: body.comment ?? null,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Update employee error:", error);
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
    await deleteEmployee(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete employee error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ошибка сервера" },
      { status: 400 }
    );
  }
}
