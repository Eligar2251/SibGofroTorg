import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { captureFullSnapshot, validateFullSnapshot } from "@/lib/full-backup";
import { assertPcOwner, initializePcLocal, isPcLocalServer, pcLocalStatus, readConfiguredPcSnapshot, setPcLocalMode } from "@/lib/pc-local-runtime";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function owner() { const a=await requireAdminApi(); if(a instanceof NextResponse) return a; return a.role==="owner" ? a : NextResponse.json({error:"Только владелец"},{status:403}); }
const result=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function GET() {
  const auth=await owner(); if(auth instanceof NextResponse) return auth;
  try {return result(pcLocalStatus());} catch(e) {return result({error:e instanceof Error?e.message:String(e)},503)}
}
export async function POST(req:NextRequest) {
  const auth=await owner(); if(auth instanceof NextResponse) return auth;
  if(!isPcLocalServer()) return result({error:"Эта операция доступна только на локальном сервере ПК."},403);
  const type=(req.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
  const origin=req.headers.get("origin"), host=(req.headers.get("host")||"").toLowerCase();
  try {if(type!=="application/json" || req.headers.get("sec-fetch-site")==="cross-site" || (origin && new URL(origin).host.toLowerCase()!==host)) return result({error:"Недопустимый источник запроса"},403)} catch{return result({error:"Недопустимый источник запроса"},403)}
  try {
    const body=await req.json();
    if(body.action==="prepare" || body.action==="prepare_file") {
      if((body.source!=="primary" && body.source!=="secondary") || typeof body.root!=="string") return result({error:"Укажите папку и источник"},400);
      const snapshot=body.action==="prepare_file" ? validateFullSnapshot(body.snapshot) : await captureFullSnapshot(body.source);
      assertPcOwner(snapshot,auth.username);
      return result(initializePcLocal(body.root,body.source,snapshot));
    }
    if(body.action==="mode" && (body.mode==="remote" || body.mode==="readonly")) {
      if(body.mode==="readonly") assertPcOwner(readConfiguredPcSnapshot(),auth.username);
      return result(setPcLocalMode(body.mode));
    }
    return result({error:"Неизвестная операция"},400);
  } catch(e) {return result({error:e instanceof Error?e.message:String(e)},409)}
}
