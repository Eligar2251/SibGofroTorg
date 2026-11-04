"use client";
import { useEffect, useState } from "react";
type Status={available:boolean;configured?:boolean;root?:string;computerId?:string;source?:"primary"|"secondary";mode?:"readonly"|"remote";ready?:boolean;error?:string|null;createdAt?:string|null;totalRows?:number|null};
export function PcLocalReadOnlyPanel({adminPath}:{adminPath:string}) {
  const [status,setStatus]=useState<Status|null>(null),[root,setRoot]=useState(""),[source,setSource]=useState<"primary"|"secondary">("primary"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{fetch('/api/admin/database/pc-local',{cache:'no-store'}).then(async r=>{const data=await r.json();if(r.ok)setStatus(data);else {setStatus({available:true,error:data.error});setMessage(data.error||'Ошибка');}}).catch(()=>{setStatus({available:true});setMessage('Не удалось проверить локальный сервер.')})},[]);
  if(!status?.available) return null;
  async function run(body:object) {
    setBusy(true);setMessage('');
    try {const res=await fetch('/api/admin/database/pc-local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);setStatus(data);if('mode' in body) window.location.reload();else setMessage('Копия подготовлена. Пока она доступна только для чтения.');}
    catch(e){setMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}
  }
  return <section style={{padding:16,border:'1px solid var(--adm-border, #ddd)',borderRadius:12,marginBottom:16,display:'grid',gap:10}}>
    <strong>Локальная копия для просмотра на этом ПК — эксперимент</strong>
    <div style={{fontSize:13}}>Подготовьте копию заранее, пока Supabase доступна. Здесь проверяется вход и чтение части данных без интернета. После смены режима потребуется войти заново. Снимок создаётся один раз и автоматически не обновляется. Изменения и синхронизация пока отключены; некоторые запросы и представления не поддерживаются. Не используйте как рабочую офлайн-БД.</div>
    {!status.configured && <>
      <label>Папка на этом ПК или Z: <input className="admin-input" value={root} onChange={e=>setRoot(e.target.value)} placeholder="Например, Z:\\СибГофроТорг или C:\\СибГофроТорг" /></label>
      <label>Источник копии <select className="admin-input" value={source} onChange={e=>setSource(e.target.value as "primary"|"secondary")}><option value="primary">Supabase #1 (Cloud)</option><option value="secondary">Supabase #2 (Beget/VPS)</option></select></label>
      <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy || !root.trim()} onClick={()=>run({action:'prepare',root:root.trim(),source})}>Подготовить первую копию</button>
      <label style={{fontSize:12}}>Или выбрать заранее сохранённый полный JSON-файл (до 200 МБ): <input type="file" accept="application/json,.json" disabled={busy || !root.trim()} onChange={async e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(!file)return;if(file.size>200*1024*1024){setMessage('Файл больше 200 МБ; импорт остановлен.');return;}try {const snapshot=JSON.parse(await file.text());await run({action:'prepare_file',root:root.trim(),source,snapshot});}catch(err){setMessage(err instanceof Error?err.message:String(err));}}} /></label>
    </>}
    {status.configured && <>
      <div style={{fontSize:12}}>Папка: {status.root} / pc-{status.computerId}. Источник: {status.source === 'primary'?'Supabase #1':'Supabase #2'}. {status.ready ? `Строк: ${status.totalRows}; создана ${status.createdAt ? new Date(status.createdAt).toLocaleString('ru-RU') : '—'}.` : `Копия не готова: ${status.error || 'не найдена'}.`}</div>
      {!status.ready && status.mode==='remote' && <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy} onClick={()=>run({action:'prepare',root:status.root,source:status.source})}>Повторить подготовку</button>}
      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy||!status.ready||status.mode==='readonly'} onClick={()=>{if(window.confirm('Включить просмотр локальной копии для этого локального сервера? Все изменения будут заблокированы.'))run({action:'mode',mode:'readonly'})}}>Просматривать локальную копию</button>
        <button className="admin-btn admin-btn--outline admin-btn--sm" disabled={busy||status.mode==='remote'} onClick={()=>{if(window.confirm('Вернуться к удалённой БД? Локальная копия не синхронизируется и не перезаписывается.'))run({action:'mode',mode:'remote'})}}>Вернуться к Supabase</button>
      </div>
    </>}
    {message && <div role="status" style={{fontSize:12}}>{message}</div>}
  </section>;
}
