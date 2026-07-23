// src/app/api/admin/excel/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { importExcelWorkbook } from "@/lib/excel-io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "Прикрепите Excel-файл (.xlsx)" },
        { status: 400 }
      );
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Нужен файл Excel: .xlsx или .xls" },
        { status: 400 }
      );
    }
    // ~15 MB
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Файл слишком большой (макс. 15 МБ)" },
        { status: 400 }
      );
    }

    const ab = await file.arrayBuffer();
    const buffer = Buffer.from(ab);
    const report = await importExcelWorkbook(buffer);
    return NextResponse.json(report);
  } catch (error) {
    console.error("Excel import error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Ошибка импорта Excel",
      },
      { status: 500 }
    );
  }
}
