// src/app/api/admin/promotions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const db = getAdminDb();
    const { data, error } = await db.from("promotions").select("*").order("sort_order", { ascending: true });
    if (error) throw error;
    const promos = (data || []).map((d: any) => ({
      id: d.id,
      title: d.title,
      subtitle: d.subtitle || null,
      badge: d.badge || null,
      image_url: d.image_url || null,
      link_type: d.link_type,
      product_id: d.product_id || null,
      link_url: d.link_url || null,
      sort_order: d.sort_order,
      is_visible: d.is_visible,
      icon: d.icon || null,
      color: d.color || null,
      light: d.light || null,
      deadline: d.deadline || null,
      created_at: d.created_at,
    }));
    return NextResponse.json({ promotions: promos });
  } catch (error) {
    console.error("Get promotions error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    if (!body.title) {
      return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
    }
    const db = getAdminDb();
    const { data, error } = await db.from("promotions").insert({
      title: body.title,
      subtitle: body.subtitle || null,
      badge: body.badge || null,
      image_url: body.imageUrl || null,
      link_type: body.linkType || "none",
      product_id: body.productId || null,
      link_url: body.linkUrl || null,
      sort_order: Number(body.sortOrder || 0),
      is_visible: body.isVisible ?? true,
      icon: body.icon || null,
      color: body.color || null,
      light: body.light || null,
      deadline: body.deadline || null,
    }).select("id").single();
    if (error) throw error;
    revalidateTag("promotions", { expire: 0 });
    return NextResponse.json({ success: true, id: data.id });
  } catch (error) {
    console.error("Create promotion error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
