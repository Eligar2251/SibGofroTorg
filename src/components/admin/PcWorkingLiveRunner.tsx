"use client";
import { useEffect, useState } from "react";

/** The website itself updates its PC JSON while an owner tab is open. */
export function PcWorkingLiveRunner() {
  const [error,setError]=useState("");
  useEffect(()=>{
    let stopped=false, enabled=false, running=false, lastError=0, lastPrepare=0;
    async function post(action:string) {
      const r=await fetch('/api/admin/database/pc-local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
      const data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;
    }
    async function refresh() {
      if(stopped || running)return;
      running=true;
      try {
        const r=await fetch('/api/admin/database/pc-local',{cache:'no-store'});const s=await r.json();if(!r.ok)throw new Error(s.error||`HTTP ${r.status}`);
        if(!s.available || s.mode==='readonly') {enabled=false;return;}
        if((!s.configured || (s.autoManaged && !s.ready)) && Date.now()-lastPrepare>=60_000) {
          lastPrepare=Date.now();const data=await post('auto_prepare');enabled=!!data.status?.liveEnabled;window.dispatchEvent(new Event('sgt-pc-local-status'));
          if(!stopped)setError(data.warning||'');return;
        }
        if(s.autoManaged && s.ready && !s.liveEnabled && s.mode==='remote' && Date.now()-lastPrepare>=60_000) {
          lastPrepare=Date.now();const data=await post('auto_resume');enabled=!!data.status?.liveEnabled;window.dispatchEvent(new Event('sgt-pc-local-status'));
          if(!stopped)setError(data.disabled?'':enabled?'':'Изменения пока не отслеживаются.');return;
        }
        enabled=!!(s.configured && s.liveEnabled && s.mode==='remote');
        if(!s.autoManaged && !enabled && !stopped)setError('');
      } catch(e){if(!stopped)setError(e instanceof Error?e.message:String(e));}
      finally{running=false;}
    }
    async function tick() {
      if(stopped||!enabled||running||Date.now()-lastError<30_000)return;
      running=true;
      try {const data=await post('live_tick');if(data.changed)window.dispatchEvent(new Event('sgt-pc-local-status'));if(data.disabled)enabled=false;if(!stopped)setError('');}
      catch(e){lastError=Date.now();if(!stopped)setError(e instanceof Error?e.message:String(e));}
      finally {running=false;}
    }
    const update=()=>{void refresh().then(tick)};
    update();window.addEventListener('sgt-pc-working-live',update);
    const timer=window.setInterval(()=>void tick(),5000),configTimer=window.setInterval(()=>void refresh(),30000);
    return ()=>{stopped=true;clearInterval(timer);clearInterval(configTimer);window.removeEventListener('sgt-pc-working-live',update)};
  },[]);
  return error?<div role="alert" style={{padding:10,background:'#fff4e5',color:'#762d0a'}}>Локальная копия ПК: {error}</div>:null;
}
