/** Local website only: initialize and refresh the SAME PC JSON file. No offline writes. */
import { trackedFromInitial } from "./pc-incremental";
import { assertPcOwner, commitPcLiveBaseline, initializePcLocal, pcLocalRoute, pcLocalStatus } from "./pc-local-runtime";
import type { PublicBackup } from "./merge-public-snapshots";
type Source="primary"|"secondary";
export async function prepareAutomaticPcCopy(username:string,source:Source,root:string,getTracked:()=>Promise<unknown>,getFull:()=>Promise<PublicBackup>) {
  if(pcLocalRoute().kind!=="remote")throw new Error("Начальная копия доступна только при подключённой Supabase.");
  const before=pcLocalStatus();
  if(!before.available)throw new Error("Сайт не запущен в локальном режиме ПК.");
  if(before.configured && (before.ready || !before.autoManaged))return {status:before};
  if(before.configured && (before.root!==root || before.source!==source || before.mode!=="remote"))throw new Error("Настройки ПК изменились; копирование отменено.");
  let tracked:ReturnType<typeof trackedFromInitial>|undefined, warning="";
  try {tracked=trackedFromInitial(await getTracked());assertPcOwner(tracked,username)}
  catch(e) {warning=`Изменения пока не отслеживаются: ${e instanceof Error?e.message:String(e)}. Установите миграции и подготовьте журнал Supabase.`;}
  const snapshot=tracked || await getFull();assertPcOwner(snapshot,username);
  const current=pcLocalStatus();
  if(!current.available || (current.configured && (current.ready || !current.autoManaged || current.root!==root || current.source!==source || current.mode!=="remote"))) throw new Error("Настройки ПК изменились во время снимка; существующий файл не заменён.");
  const state=initializePcLocal(root,source,snapshot,{autoManaged:true});
  if(!state.configured || !state.computerId)throw new Error("Не удалось подготовить локальную копию.");
  if(tracked) commitPcLiveBaseline(state.computerId,source,0,tracked,true,true);
  return {status:pcLocalStatus(),warning};
}
