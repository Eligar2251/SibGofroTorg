import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { cleanPopupCampaign } from "@/lib/popup-campaign";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const clean = cleanPopupCampaign(await request.json());
    if (!clean.title) {
      return NextResponse.json(
        { error: "Заголовок обязателен" },
        { status: 400 }
      );
    }
    await getAdminDb()
      .collection("popupCampaigns")
      .doc(id)
      .update({ ...clean, updatedAt: FieldValue.serverTimestamp() });
    revalidateTag("popup-campaigns", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update popup error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
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
    await getAdminDb().collection("popupCampaigns").doc(id).delete();
    revalidateTag("popup-campaigns", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete popup error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
