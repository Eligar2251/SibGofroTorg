/** Opt-in refresh of the clean PC baseline. Never pushes offline changes. */
import { applyPcDelta, trackedFromInitial, validateTrackedBackup } from "./pc-incremental";
import { assertPcOwner, commitPcLiveBaseline, pcLocalRoute, pcLocalStatus, readConfiguredPcStore } from "./pc-local-runtime";
import { stable } from "./merge-public-snapshots";

type Rpc = (fn:string,args?:Record<string,unknown>)=>Promise<unknown>;
function remote() {
  const route=pcLocalRoute();
  if(route.kind!=="remote") throw new Error("Обновление доступно только в режиме Supabase на локальном ПК.");
  // Remote can also be the unconfigured state. The store function then fails closed.
  const store=readConfiguredPcStore();
  return store;
}
export async function enablePcWorkingRefresh(rpc:Rpc,username:string) {
  const store=remote();
  if(store.baseHash!==store.currentHash) throw new Error("В локальной БД есть независимые изменения; обновление запрещено.");
  const tracked=trackedFromInitial(await rpc("sgt_pc_backup_snapshot"));
  assertPcOwner(tracked,username);
  return commitPcLiveBaseline(store.computerId,store.origin.source,store.revision,tracked,true);
}
export async function tickPcWorkingRefresh(rpc:Rpc) {
  const status=pcLocalStatus();
  if (!status.available || !status.configured || !status.liveEnabled || status.mode!=="remote") return {changed:false,disabled:true};
  const store=remote();
  if(store.baseHash!==store.currentHash) throw new Error("В локальной БД есть независимые изменения; обновление остановлено.");
  if(!store.tracking) throw new Error("Отслеживание не подготовлено; требуется новый снимок с подтверждением владельца.");
  const current=validateTrackedBackup({...store.current,pcTracking:store.tracking});
  const delta=await rpc("sgt_pc_backup_changes",{p_instance:store.tracking.instance,p_cursor:store.tracking.cursor,p_catalog_hash:store.tracking.catalogHash});
  if(!delta || typeof delta!=="object" || (delta as {reset?:unknown}).reset!==false) throw new Error("Источник потребовал новый снимок. Автоматическая замена остановлена; проверьте источник и подтвердите подготовку заново.");
  const result=applyPcDelta(current,delta as Parameters<typeof applyPcDelta>[1]);
  if(!result.changed) return {changed:false}; // Avoid rewriting a large unchanged JSON file.
  if(stable(result.backup.columns)!==stable(current.columns)) throw new Error("Схема изменилась; обновление остановлено.");
  result.backup.exportedAt=new Date().toISOString();
  commitPcLiveBaseline(store.computerId,store.origin.source,store.revision,result.backup,false);
  return {changed:true};
}
