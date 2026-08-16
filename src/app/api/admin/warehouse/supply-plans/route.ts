import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getSupplyPlans, saveSupplyPlans } from "@/lib/supply-plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const plans = await getSupplyPlans();
    return NextResponse.json({ plans }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Get supply plans error:", error);
    return NextResponse.json(
      { error: "Не удалось загрузить планы поставок" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.plans)) {
      return NextResponse.json({ error: "Некорректный список планов" }, { status: 400 });
    }
    const plans = await saveSupplyPlans(body.plans);
    return NextResponse.json({ success: true, plans });
  } catch (error) {
    console.error("Save supply plans error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить планы" },
      { status: 400 }
    );
  }
}
