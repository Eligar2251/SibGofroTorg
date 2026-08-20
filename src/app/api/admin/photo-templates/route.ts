// =========================================================
// FILE: src/app/api/admin/photo-templates/route.ts
// Библиотека шаблонов конструктора фото: список и сохранение
// нового шаблона (в т.ч. копии существующего).
// =========================================================

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getPhotoTemplates, savePhotoTemplates } from "@/lib/supabase-queries";
import {
  createTemplateId,
  PHOTO_TEMPLATES_LIMIT,
  type SavedPhotoTemplate,
} from "@/lib/photo-template";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const templates = await getPhotoTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Get photo templates error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const name = String(body?.name || "").trim().slice(0, 120);
    const template = body?.template;
    if (!name) {
      return NextResponse.json({ error: "Укажите название шаблона" }, { status: 400 });
    }
    if (!template || typeof template !== "object" || !Array.isArray(template.elements)) {
      return NextResponse.json({ error: "Некорректный шаблон" }, { status: 400 });
    }

    const templates = await getPhotoTemplates();
    if (templates.length >= PHOTO_TEMPLATES_LIMIT) {
      return NextResponse.json(
        { error: `Достигнут лимит шаблонов (${PHOTO_TEMPLATES_LIMIT}) — удалите лишние` },
        { status: 400 }
      );
    }

    const created: SavedPhotoTemplate = {
      id: createTemplateId(),
      name,
      updatedAt: new Date().toISOString(),
      template,
    };
    await savePhotoTemplates([created, ...templates]);
    return NextResponse.json({ success: true, template: created });
  } catch (error) {
    console.error("Create photo template error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
