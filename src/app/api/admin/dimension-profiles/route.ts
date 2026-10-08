// Типы размеров товаров: список и создание.
import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createDimensionProfile, getDimensionProfiles } from "@/lib/dimension-profiles-db";

export async function GET() {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ profiles: await getDimensionProfiles() });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const profile = await createDimensionProfile(body);
    return NextResponse.json({ profile });
  } catch (error: any) {
    console.error("Create dimension profile error:", error);
    return NextResponse.json(
      { error: error?.message || "Не удалось создать тип размеров" },
      { status: 400 }
    );
  }
}
