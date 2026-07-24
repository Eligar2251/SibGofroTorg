// src/app/api/admin/transports/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createTransport, getTransports } from "@/lib/warehouse";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const transports = await getTransports({ status });
    return NextResponse.json(transports);
  } catch (error) {
    console.error("Get transports error:", error);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const result = await createTransport(body);
    revalidateTag("warehouse-deals");
    return NextResponse.json(result);
  } catch (error) {
    console.error("Create transport error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка сервера" }, { status: 400 });
  }
}
