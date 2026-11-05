/** Runs only inside the explicitly started PC server, never on Timeweb. */
import { archivePcSnapshotAt, isPcLocalServer, recordPcArchiveStatus } from "./pc-local-runtime";
const g=globalThis as typeof globalThis & {__sgtPcArchiveTimer?:ReturnType<typeof setInterval>};
export function ensurePcArchiveSchedulerStarted() {
  if(!isPcLocalServer() || g.__sgtPcArchiveTimer) return;
  const tick=()=>{const now=new Date();try{const result=archivePcSnapshotAt(now);recordPcArchiveStatus(now,result);}catch(e){console.error('[pc-archive]',e instanceof Error?e.message:String(e));try{recordPcArchiveStatus(now,null,e);}catch(statusError){console.error('[pc-archive-status]',statusError);}}};
  tick();g.__sgtPcArchiveTimer=setInterval(tick,30_000);g.__sgtPcArchiveTimer.unref?.();
}
