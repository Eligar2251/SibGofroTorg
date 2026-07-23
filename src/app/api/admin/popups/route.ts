import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";
import { cleanPopupCampaign } from "@/lib/popup-campaign";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const clean = cleanPopupCampaign(await request.json());
    if (!clean.title) {
      return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
    }
    const db = getAdminDb();
    const { data, error } = await db.from("popup_campaigns").insert({
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
    }).select("id").single();
    if (error) throw error;
    revalidateTag("popup-campaigns", { expire: 0 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Create popup error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
