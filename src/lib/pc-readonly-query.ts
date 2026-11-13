import { LocalJsonSupabaseClient, type LocalDbFileEnvelope } from "./local-json-db";
import { readActivePcSnapshot } from "./pc-local-runtime";
import type { PublicBackup } from "./merge-public-snapshots";

type Call = {method:string;args:any[]};
const unsupported = (detail:string) => ({data:null,error:{code:"PC_QUERY_UNSUPPORTED",message:`Локальная копия не поддерживает этот запрос: ${detail}. Используйте Supabase после восстановления связи.`}});
/** Операторы, которые локальный движок считает так же, как PostgREST. Остальные — отказ, а не «похоже на правду». */
const SUPPORTED_OPS = new Set(["eq","neq","gt","gte","lt","lte","like","ilike","is","in","cs"]);

function checkOrSpec(spec:string, columns:Set<string>, path:string[]): string | null {
  const text = spec.trim();
  if (!text) return "пустое условие or";
  const clauses: string[] = [];
  let depth = 0, current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { clauses.push(current); current = ""; continue; }
    current += ch;
  }
  clauses.push(current);
  for (const raw of clauses) {
    const clause = raw.trim();
    const nested = /^(and|or)\(([\s\S]*)\)$/i.exec(clause);
    if (nested) {
      if (path.length >= 4) return "слишком вложенное условие or";
      const error = checkOrSpec(nested[2], columns, [...path, nested[1].toLowerCase()]);
      if (error) return error;
      continue;
    }
    const firstDot = clause.indexOf(".");
    if (firstDot <= 0) return `условие «${clause.slice(0, 40)}» не разобрано`;
    const column = clause.slice(0, firstDot);
    let rest = clause.slice(firstDot + 1);
    if (/^not\./i.test(rest)) rest = rest.slice(4);
    const secondDot = rest.indexOf(".");
    if (secondDot <= 0) return `условие «${clause.slice(0, 40)}» без значения`;
    const operator = rest.slice(0, secondDot).toLowerCase();
    if (!columns.has(column)) return `поле ${column} в условии or`;
    if (!SUPPORTED_OPS.has(operator)) return `оператор ${operator} в условии or`;
  }
  return null;
}

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
    if (["eq","neq","gt","gte","lt","lte","is","in","ilike","like","contains"].includes(method)) {
      if (typeof args[0] !== "string" || !names.has(args[0])) return unsupported(`поле ${String(args[0])}`);
      if (method === "is" && ![null, true, false].includes(args[1])) return unsupported("сравнение IS");
      if (method === "in" && (!Array.isArray(args[1]) || args[1].some((v:unknown)=>v===null || typeof v==="object"))) return unsupported("условие IN");
      if ((method === "ilike" || method === "like") && (typeof args[1] !== "string" || args[1].includes("\\"))) return unsupported(`условие ${method.toUpperCase()}`);
      // Числа и строки локальный движок сравнивает как PostgREST; объекты — только
      // в contains (jsonb-вхождения), где значение обрабатывается deepContains.
      if (method !== "contains" && method !== "in" && method !== "is" && (args[1] === null || args[1] === undefined || typeof args[1] === "object")) return unsupported(`сравнение ${method} с NULL или объектом`);
      continue;
    }
    if (method === "not") {
      if (typeof args[0] !== "string" || !names.has(args[0])) return unsupported(`поле ${String(args[0])}`);
      if (!SUPPORTED_OPS.has(String(args[1]).toLowerCase())) return unsupported(`оператор not.${String(args[1])}`);
      continue;
    }
    if (method === "or") {
      const error = checkOrSpec(String(args[0] ?? ""), names, []);
      if (error) return unsupported(error);
      continue;
    }
    if (method === "order") {
      if (typeof args[0] !== "string" || !names.has(args[0])) return unsupported(`сортировка по ${String(args[0])}`);
      if (args[1] && (typeof args[1] !== "object" || Object.keys(args[1]).some(k=>!["ascending","nullsFirst"].includes(k)))) return unsupported("сортировка связанной таблицы");
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
