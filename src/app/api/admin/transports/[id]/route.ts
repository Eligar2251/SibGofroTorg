// src/app/api/admin/transports/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { updateTransport, completeTransport, deleteTransport, archiveTransport } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.action === "complete") {
      await completeTransport(id);
    } else if (body.action === "archive") {
      await archiveTransport(id);
    } else {
      await updateTransport(id, body);
    }
    revalidateTag("warehouse-deals");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transport PATCH error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка" }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    await deleteTransport(id);
    revalidateTag("warehouse-deals");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Transport DELETE error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка" }, { status: 400 });
  }
}
