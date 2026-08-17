// =========================================================
// FILE: src/app/api/auth/me/route.ts
// =========================================================

import { NextResponse } from "next/server";
import {
  formatPhoneDisplay,
  getUserById,
  verifyUserSession,
} from "@/lib/user-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await verifyUserSession();
    if (!session) {
      return NextResponse.json(
        { user: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const user = await getUserById(session.uid);
    if (!user) {
      return NextResponse.json(
        { user: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const isPhoneUser = /^7\d{10}$/.test(user.phoneDigits || "");

    return NextResponse.json(
      {
        user: {
          id: user.id,
          username: user.username || null,
          phone: isPhoneUser ? formatPhoneDisplay(user.phoneDigits) : null,
          name: user.name || null,
          email: user.email || null,
          customerType: user.customerType || "individual",
          companyName: user.companyName || null,
          inn: user.inn || null,
          kpp: user.kpp || null,
          ogrn: user.ogrn || null,
          legalAddress: user.legalAddress || null,
          actualAddress: user.actualAddress || null,
          deliveryAddress: user.deliveryAddress || null,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Me error:", error);
    return NextResponse.json(
      { user: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
