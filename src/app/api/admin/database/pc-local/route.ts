import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { captureFullSnapshot, validateFullSnapshot } from "@/lib/full-backup";
import { assertPcOwner, initializePcLocal, isPcLocalServer, pcLocalStatus, readConfiguredPcSnapshot, readConfiguredPcStore, setPcLocalMode, setPcLiveDisabled, setPcArchivesEnabled, pcLocalRoute } from "@/lib/pc-local-runtime";
import { resolveSupabaseCredentials } from "@/lib/db-runtime-config";
import { createDirectSupabaseClient } from "@/lib/supabase-server-engine";
import { enablePcWorkingRefresh, tickPcWorkingRefresh } from "@/lib/pc-working-live";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function owner() { const a=await requireAdminApi(); if(a instanceof NextResponse) return a; return a.role==="owner" ? a : NextResponse.json({error:"Только владелец"},{status:403}); }
const ticker=globalThis as typeof globalThis & {__sgtPcLiveBusy?:boolean;__sgtPcLiveLast?:number};
function rpcForPc() {
  const store=readConfiguredPcStore(); const c=resolveSupabaseCredentials(store.origin.source);
  if(!c.configured) throw new Error(`${c.label}: URL и секретный ключ не настроены.`);
  const db=createDirectSupabaseClient(c.url,c.serviceRoleKey,60_000);
  return async (fn:string,args?:Record<string,unknown>)=>{const {data,error}=await db.rpc(fn,args);if(error)throw new Error(`Не удалось обновить локальный снимок: ${error.message}`);return data;};
}
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
      if(pcLocalRoute().kind!=="remote") return result({error:"Сначала вернитесь в режим Supabase; локальная копия не будет заменена."},409);
      if((body.source!=="primary" && body.source!=="secondary") || typeof body.root!=="string") return result({error:"Укажите папку и источник"},400);
      const snapshot=body.action==="prepare_file" ? validateFullSnapshot(body.snapshot) : await captureFullSnapshot(body.source);
      assertPcOwner(snapshot,auth.username);
      return result(initializePcLocal(body.root,body.source,snapshot));
    }
    if(body.action==="archives" && typeof body.enabled==="boolean") return result(setPcArchivesEnabled(body.enabled));
    if(body.action==="live_disable") return result(setPcLiveDisabled());
    if(body.action==="live_enable") {
      if(body.confirmReplace!==true) return result({error:"Подтвердите замену чистой копии актуальным снимком выбранного источника."},400);
      if(pcLocalRoute().kind!=="remote") return result({error:"Включите режим Supabase перед подготовкой обновления."},409);
      await enablePcWorkingRefresh(rpcForPc(),auth.username);
      return result(pcLocalStatus());
    }
    if(body.action==="live_tick") {
      const status=pcLocalStatus();
      if(!status.available || !status.configured || !status.liveEnabled || status.mode!=="remote") return result({disabled:true});
      if(ticker.__sgtPcLiveBusy || Date.now()-(ticker.__sgtPcLiveLast||0)<3500) return result({busy:true});
      ticker.__sgtPcLiveBusy=true;ticker.__sgtPcLiveLast=Date.now();
      try {return result(await tickPcWorkingRefresh(rpcForPc()));} finally {ticker.__sgtPcLiveBusy=false;}
    }
    if(body.action==="mode" && (body.mode==="remote" || body.mode==="readonly")) {
      if(body.mode==="readonly") assertPcOwner(readConfiguredPcSnapshot(),auth.username);
      return result(setPcLocalMode(body.mode));
    }
    return result({error:"Неизвестная операция"},400);
  } catch(e) {return result({error:e instanceof Error?e.message:String(e)},409)}
}
