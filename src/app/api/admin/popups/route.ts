import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { cleanPopupCampaign } from "@/lib/popup-campaign";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const clean = cleanPopupCampaign(await request.json());
    if (!clean.title) {
      return NextResponse.json(
        { error: "Заголовок обязателен" },
        { status: 400 }
      );
    }
    const db = getAdminDb();
    const ref = await db.collection("popupCampaigns").add({
      ...clean,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    revalidateTag("popup-campaigns", { expire: 0 });
    return NextResponse.json({ success: true, id: ref.id });
  } catch (error) {
    console.error("Create popup error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
