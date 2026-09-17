import { NextResponse } from "next/server";
import { deleteWpProduct, requireWastepaperApi } from "@/lib/wastepaper-account";
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) { const auth = await requireWastepaperApi(); if (auth instanceof NextResponse) return auth; await deleteWpProduct((await params).id); return NextResponse.json({ success: true }); }
