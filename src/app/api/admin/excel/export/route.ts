// src/app/api/admin/excel/export/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { buildExcelExport } from "@/lib/excel-io";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const mode =
      request.nextUrl.searchParams.get("mode") === "template"
        ? "template"
        : "full";
    const buf = await buildExcelExport(mode);
    const stamp = new Date().toISOString().slice(0, 10);
    const filename =
      mode === "template"
        ? `shablon-sibgofrotorg-${stamp}.xlsx`
        : `export-sibgofrotorg-${stamp}.xlsx`;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Excel export error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось сформировать Excel",
      },
      { status: 500 }
    );
  }
}
