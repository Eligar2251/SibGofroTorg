// =========================================================
// FILE: src/app/api/auth/logout/route.ts
// =========================================================

import { NextResponse } from "next/server";
import { deleteUserSession } from "@/lib/user-auth";

export async function POST() {
  await deleteUserSession();
  return NextResponse.json({ success: true });
}