import { NextRequest, NextResponse } from "next/server";
import { deleteSession } from "@/lib/auth";

const ADMIN_PATH = process.env.ADMIN_SECRET_PATH || "admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ adminPath: string }> }
) {
  const { adminPath } = await params;

  if (adminPath !== ADMIN_PATH) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteSession();
  return NextResponse.redirect(new URL(`/${ADMIN_PATH}/login`, request.url));
}