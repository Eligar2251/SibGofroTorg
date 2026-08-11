import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { deleteCounterparty, saveCounterparty } from "@/lib/warehouse";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    await saveCounterparty({
      id,
      name: String(body.name || ""),
      roles: Array.isArray(body.roles) ? body.roles : [],
      phone: body.phone,
      email: body.email,
      inn: body.inn,
      kpp: body.kpp,
      ogrn: body.ogrn,
      fullName: body.fullName,
      shortName: body.shortName,
      legalAddress: body.legalAddress,
      taxSystem: body.taxSystem,
      bankAccount: body.bankAccount,
      bankName: body.bankName,
      bik: body.bik,
      correspondentAccount: body.correspondentAccount,
      address: body.address,
      contactName: body.contactName,
      comment: body.comment,
      priceTier: body.priceTier,
    });
    return NextResponse.json({ success: true });
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
  const { id } = await params;
  await deleteCounterparty(id);
  return NextResponse.json({ success: true });
}
