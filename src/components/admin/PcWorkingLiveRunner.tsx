"use client";
import { useEffect, useState } from "react";

/** Polls only while a local-PC owner's admin tab is open; no background daemon. */
export function PcWorkingLiveRunner() {
  const [error,setError]=useState("");
  useEffect(()=>{
    let stopped=false, enabled=false, running=false, lastError=0;
    async function refresh() {
      try {const r=await fetch('/api/admin/database/pc-local',{cache:'no-store'});if(!r.ok) return;const s=await r.json();enabled=s.available && s.configured && s.liveEnabled && s.mode==='remote';if(!enabled && !stopped)setError('');} catch { /* tick will report an error if enabled */ }
    }
    async function tick() {
      if(stopped||!enabled||running || Date.now()-lastError<30_000)return;
      running=true;
      try {const r=await fetch('/api/admin/database/pc-local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'live_tick'})});const data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);if(data.disabled)enabled=false;if(!stopped)setError('');}
      catch(e){lastError=Date.now();if(!stopped)setError(e instanceof Error?e.message:String(e));}
      finally {running=false;}
    }
    const update=()=>{void refresh().then(tick)};
    update();window.addEventListener('sgt-pc-working-live',update);
    const timer=window.setInterval(()=>void tick(),5000),configTimer=window.setInterval(()=>void refresh(),30000);
    return ()=>{stopped=true;clearInterval(timer);clearInterval(configTimer);window.removeEventListener('sgt-pc-working-live',update)};
  },[]);
  return error?<div role="alert" style={{padding:10,background:'#fff4e5',color:'#762d0a'}}>Автообновление копии ПК остановлено или задержано: {error}</div>:null;
}
