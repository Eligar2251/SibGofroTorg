import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
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
      return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
    }
    const db = getAdminDb();
    await db.from("popup_campaigns").update({
      type: clean.type,
      title: clean.title,
      is_active: clean.isActive,
      kicker: clean.kicker,
      description: clean.description,
      details: clean.details,
      button_text: clean.buttonText,
      button_url: clean.buttonUrl,
      style: clean.style,
      image_url: clean.imageUrl,
      start_at: clean.startAt,
      end_at: clean.endAt,
      delay_seconds: clean.delaySeconds,
      duration_seconds: clean.durationSeconds,
      frequency: clean.frequency,
      sort_order: clean.sortOrder,
    }).eq("id", id);
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
    const db = getAdminDb();
    await db.from("popup_campaigns").delete().eq("id", id);
    revalidateTag("popup-campaigns", { expire: 0 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete popup error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
