import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { effectiveSource } from "@/lib/full-backup";
import { pcLocalRoute } from "@/lib/pc-local-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET() {
  const auth=await requireAdminApi();if(auth instanceof NextResponse)return auth;
  if(auth.role!=="owner")return NextResponse.json({error:"Только владелец"},{status:403});
  const pc=pcLocalRoute();
  if(pc.kind==="error")return NextResponse.json({error:pc.message},{status:503,headers:{"Cache-Control":"no-store"}});
  return NextResponse.json({localReadonly:pc.kind==="readonly",source:pc.kind==="readonly"?null:effectiveSource()},{headers:{"Cache-Control":"private, no-store"}});
}
