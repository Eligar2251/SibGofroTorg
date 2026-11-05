import { LocalJsonSupabaseClient, type LocalDbFileEnvelope } from "./local-json-db";
import { readActivePcSnapshot } from "./pc-local-runtime";
import type { PublicBackup } from "./merge-public-snapshots";

type Call = {method:string;args:any[]};
const unsupported = (detail:string) => ({data:null,error:{code:"PC_QUERY_UNSUPPORTED",message:`Локальная копия не поддерживает этот запрос: ${detail}. Используйте Supabase после восстановления связи.`}});
export function pcReadOnlyClient(snapshot:PublicBackup) {
  const store:LocalDbFileEnvelope={version:1,app:"SibGofroTorg",updatedAt:snapshot.exportedAt,lastSyncedAt:null,lastSyncSource:null,tables:snapshot.tables};
  return new LocalJsonSupabaseClient(store);
}
/** Refuse unsupported PostgREST features instead of silently returning incorrect data. */
export function checkPcReadOnlyQuery(snapshot:PublicBackup,table:string,calls:Call[]): ReturnType<typeof unsupported>|null {
  const cols=snapshot.columns[table];
  if (!Object.hasOwn(snapshot.tables,table) || !Array.isArray(cols)) return unsupported(`таблица или представление ${table} отсутствует`);
  const names=new Set(cols.map(c=>String((c as {name?:unknown}).name)));
  for (const {method,args} of calls) {
    if (["insert","update","upsert","delete"].includes(method)) return {data:null,error:{code:"PC_READ_ONLY",message:"Локальная копия пока доступна только для чтения. Запись отключена для защиты данных."}};
    if (method==="select") {
      const spec=String(args[0] || "*");
      if(spec!=="*") for(const part of spec.split(",")) {
        const item=part.trim(), pieces=item.split(":");
        if(pieces.length>2 || pieces.some(x=>!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x)) || !names.has(pieces[pieces.length-1])) return unsupported(`выборка ${spec}`);
      }
      continue;
    }
    if (["eq","is","in","ilike","order"].includes(method)) {
      if(typeof args[0]!=="string" || !names.has(args[0])) return unsupported(`поле ${String(args[0])}`);
      if(method==="eq" && (args[1]===null || args[1]===undefined || typeof args[1]==="object")) return unsupported("сравнение с NULL или объектом");
      if(method==="is" && ![null,true,false].includes(args[1])) return unsupported("сравнение IS");
      if(method==="in" && (!Array.isArray(args[1]) || args[1].some((v:unknown)=>v===null || typeof v==="object"))) return unsupported("условие IN");
      if(method==="ilike" && (typeof args[1]!=="string" || args[1].includes("\\"))) return unsupported("условие ILIKE");
      if(method==="order" && args[1] && (typeof args[1]!=="object" || Object.keys(args[1]).some(k=>!["ascending","nullsFirst"].includes(k)))) return unsupported("сортировка связанной таблицы");
      continue;
    }
    if(["limit","range","single","maybeSingle"].includes(method)) continue;
    return unsupported(method);
  }
  return null;
}
export function activePcQuery(table:string,calls:Call[]) {
  const snapshot=readActivePcSnapshot();
  return {snapshot,client:pcReadOnlyClient(snapshot),error:checkPcReadOnlyQuery(snapshot,table,calls)};
}
