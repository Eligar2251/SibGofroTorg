// =========================================================
// FILE: src/app/api/admin/photo-templates/[id]/route.ts
// Шаблон фото: перезапись (название/дизайн) и удаление.
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPhotoTemplates, savePhotoTemplates } from "@/lib/supabase-queries";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const templates = await getPhotoTemplates();
    const index = templates.findIndex((t) => t.id === id);
    if (index < 0) {
      return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
    }

    const name =
      body?.name != null ? String(body.name).trim().slice(0, 120) : templates[index].name;
    if (!name) {
      return NextResponse.json({ error: "Укажите название шаблона" }, { status: 400 });
    }
    const template =
      body?.template && typeof body.template === "object" && Array.isArray(body.template.elements)
        ? body.template
        : templates[index].template;

    const next = [...templates];
    next[index] = {
      ...templates[index],
      name,
      template,
      updatedAt: new Date().toISOString(),
    };
    await savePhotoTemplates(next);
    return NextResponse.json({ success: true, template: next[index] });
  } catch (error) {
    console.error("Update photo template error:", error);
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
    const templates = await getPhotoTemplates();
    await savePhotoTemplates(templates.filter((t) => t.id !== id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete photo template error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
