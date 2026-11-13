/* Life HQ local store.
   Stands in for the Claude artifact host: window.claude.use("db" | "assets" | "downloads") with the same API
   the dashboard already calls (collection().onSnapshot / add / doc(id).set|update|delete, assets.upload,
   downloads.save). Data stays on this device: IndexedDB first, localStorage if IndexedDB is unavailable.
   Collections, document ids and fields are exactly the Claude version's, so its Backup JSON imports as-is.
   Optional cloud sync (Supabase): this device stays the primary store; changes are stamped (u), queued (dirty)
   and pushed/pulled with last-write-wins per document. Signed out, nothing leaves the device. */
(function(){
"use strict";
const DB_NAME="lifehq", DB_VER=1, LS="lifehq:v1:";
const COLS=["films","settings","goals","blocks","tasks","workouts","accounts","tints","people","money","budgets","ideas","designs"];
const mem={};               // col -> Map(id -> doc)
const listeners={};         // col -> [cb]
const meta={};              // lastBackupAt, firstRunAt, started
let idb=null, mode="memory", ready;
const err=(code,message)=>Object.assign(new Error(message||code),{code});
const clone=o=>o==null?o:JSON.parse(JSON.stringify(o));
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,10);
// sync bookkeeping per doc: key "col/id" -> {u: ISO time of last change, dirty: not yet pushed, del: tombstone}
const stamps=new Map(); const LEGACY="1970-01-01T00:00:00.000Z"; // docs from before sync: age unknown
const kOf=(col,id)=>col+"/"+id, ms=u=>u?Date.parse(u)||0:0;
const canon=v=>v&&typeof v==="object"?(Array.isArray(v)?"["+v.map(canon).join(",")+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canon(v[k])).join(",")+"}"):JSON.stringify(v===undefined?null:v);
const same=(a,b)=>canon(a)===canon(b); // jsonb reorders keys, so compare by content
const nextU=prev=>new Date(Math.max(Date.now(),ms(prev)+1)).toISOString();
let onLocalChange=()=>{};

// ---------- backends ----------
function openIdb(){
  return new Promise((res,rej)=>{
    if(!("indexedDB" in window)) return rej(err("no_idb"));
    let r; try{ r=indexedDB.open(DB_NAME,DB_VER); }catch(e){ return rej(e); }
    r.onupgradeneeded=()=>{ const d=r.result;
      if(!d.objectStoreNames.contains("docs")) d.createObjectStore("docs").createIndex("col","col");
      if(!d.objectStoreNames.contains("assets")) d.createObjectStore("assets");
      if(!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error||err("idb_open")); r.onblocked=()=>rej(err("idb_blocked"));
  });
}
const tx=(store,modeRW,fn)=>new Promise((res,rej)=>{ const t=idb.transaction(store,modeRW); const s=t.objectStore(store); let out; Promise.resolve(fn(s)).then(v=>out=v); t.oncomplete=()=>res(out); t.onerror=()=>rej(quota(t.error)); t.onabort=()=>rej(quota(t.error)); });
const reqP=r=>new Promise((res,rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
const quota=e=>e&&(e.name==="QuotaExceededError"||/quota/i.test(e.message||""))?err("quota_exceeded","Storage is full"):(e||err("idb_error"));

async function loadAll(){
  COLS.forEach(c=>mem[c]=new Map());
  try{ idb=await openIdb(); mode="indexeddb";
    const rows=await tx("docs","readonly",s=>reqP(s.getAll()));
    const keys=await tx("docs","readonly",s=>reqP(s.getAllKeys()));
    rows.forEach((r,i)=>{ void keys[i];
      if(r.col==="_tomb"){ const d=r.data||{}; stamps.set(r.id,{u:d.u||LEGACY,dirty:!!d.dirty,del:true}); return; } // r.id is "col/id"
      if(r.data==null) return;
      (mem[r.col]=mem[r.col]||new Map()).set(r.id,r.data);
      stamps.set(kOf(r.col,r.id),{u:r.u||LEGACY,dirty:!!r.dirty,del:false}); });
    const mk=await tx("meta","readonly",s=>reqP(s.getAllKeys())), mv=await tx("meta","readonly",s=>reqP(s.getAll()));
    mk.forEach((k,i)=>meta[k]=mv[i]);
  }catch(e){
    idb=null;
    try{ localStorage.setItem(LS+"probe","1"); localStorage.removeItem(LS+"probe"); mode="localstorage"; }catch(_){ mode="memory"; }
    if(mode==="localstorage"){
      COLS.forEach(c=>{ try{ const arr=JSON.parse(localStorage.getItem(LS+c)||"[]"); arr.forEach(d=>{ const {id,...rest}=d; mem[c].set(id,rest); }); }catch(_){} });
      try{ Object.assign(meta,JSON.parse(localStorage.getItem(LS+"meta")||"{}")); }catch(_){}
    }
  }
  if(!meta.firstRunAt) await setMeta("firstRunAt",new Date().toISOString());
  if(navigator.storage&&navigator.storage.persist) navigator.storage.persist().catch(()=>{});
}
async function persist(col,id,data,opt){ // data null = delete. opt: {u, dirty, quiet}
  opt=opt||{}; const k=kOf(col,id), prev=stamps.get(k);
  const st={u:opt.u||nextU(prev&&prev.u), dirty:opt.dirty!==undefined?opt.dirty:true, del:data==null};
  if(mode==="indexeddb"){ await tx("docs","readwrite",s=>{
    // deletes leave a small tombstone under "_tomb/" (older app versions ignore that collection) so sync can't bring the doc back
    if(data==null){ s.delete(k); s.put({col:"_tomb",id:k,data:{u:st.u,dirty:st.dirty}},"_tomb/"+k); }
    else { s.put({col,id,data,u:st.u,dirty:st.dirty},k); s.delete("_tomb/"+k); } });
    stamps.set(k,st); if(!opt.quiet) onLocalChange(); return; }
  if(mode==="localstorage"){ try{ localStorage.setItem(LS+col,JSON.stringify([...mem[col]].map(([i,d])=>({id:i,...d})))); }catch(e){ throw quota(e)||err("quota_exceeded"); } }
}
async function setMeta(k,v){ meta[k]=v;
  if(mode==="indexeddb") return tx("meta","readwrite",s=>s.put(v,k));
  if(mode==="localstorage") try{ localStorage.setItem(LS+"meta",JSON.stringify(meta)); }catch(_){}
}

// ---------- Firestore-style collection API used by the dashboard ----------
function emit(col){
  const docs=[...(mem[col]||new Map())].map(([id,d])=>({id,data:()=>clone(d)}));
  (listeners[col]||[]).forEach(cb=>{ try{ cb({docs,metadata:{fromCache:false}}); }catch(e){ console.error(e); } });
}
const known=col=>{ if(!mem[col]) mem[col]=new Map(); return mem[col]; };
function collection(col){
  return {
    onSnapshot(cb,onErr){ (listeners[col]=listeners[col]||[]).push(cb); ready.then(()=>emit(col)).catch(e=>onErr&&onErr(e)); return ()=>{ listeners[col]=(listeners[col]||[]).filter(x=>x!==cb); }; },
    async add(obj){ await ready; const id=newId(); known(col).set(id,clone(obj)); try{ await persist(col,id,mem[col].get(id)); }catch(e){ mem[col].delete(id); throw e; } emit(col); return {id}; },
    doc(id){ id=id||newId(); return {id,
      async set(obj){ await ready; const prev=known(col).get(id); mem[col].set(id,clone(obj)); try{ await persist(col,id,mem[col].get(id)); }catch(e){ prev?mem[col].set(id,prev):mem[col].delete(id); throw e; } emit(col); },
      async update(patch){ await ready; const prev=known(col).get(id); if(!prev) throw err("not_found","No document "+col+"/"+id); const next=Object.assign(clone(prev),clone(patch)); mem[col].set(id,next); try{ await persist(col,id,next); }catch(e){ mem[col].set(id,prev); throw e; } emit(col); },
      async delete(){ await ready; const prev=known(col).get(id); mem[col].delete(id); try{ await persist(col,id,null); }catch(e){ if(prev) mem[col].set(id,prev); throw e; } emit(col); } }; }
  };
}

// ---------- images (Designs) ----------
const urlCache=new Map();
const blobToDataUrl=b=>new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(r.error); r.readAsDataURL(b); });
const dataUrlToBlob=async u=>(await fetch(u)).blob();
async function shrink(file){ // keep phone photos reasonable: longest side 2000px, JPEG; small files untouched
  if(!file.type||!/^image\/(jpeg|png|webp|heic|heif)/.test(file.type)||file.size<900*1024||!window.createImageBitmap) return file;
  try{ const bm=await createImageBitmap(file), k=Math.min(1,2000/Math.max(bm.width,bm.height)); const c=document.createElement("canvas"); c.width=Math.round(bm.width*k); c.height=Math.round(bm.height*k); c.getContext("2d").drawImage(bm,0,0,c.width,c.height); return await new Promise(r=>c.toBlob(b=>r(b||file),"image/jpeg",0.85)); }catch(_){ return file; }
}
async function putAsset(id,blob){
  if(mode==="indexeddb") await tx("assets","readwrite",s=>s.put(blob,id));
  else if(mode==="localstorage"){ try{ localStorage.setItem(LS+"asset:"+id,await blobToDataUrl(blob)); }catch(e){ throw err("quota_exceeded","Storage is full"); } }
  else urlCache.set(id,URL.createObjectURL(blob));
}
async function getAsset(id){
  if(mode==="indexeddb") return tx("assets","readonly",s=>reqP(s.get(id)));
  if(mode==="localstorage"){ const u=localStorage.getItem(LS+"asset:"+id); return u?dataUrlToBlob(u):null; }
  return null;
}
async function allAssetIds(){ if(mode==="indexeddb") return tx("assets","readonly",s=>reqP(s.getAllKeys())); if(mode==="localstorage") return Object.keys(localStorage).filter(k=>k.startsWith(LS+"asset:")).map(k=>k.slice((LS+"asset:").length)); return []; }
const assets={
  async upload(file){ await ready; const id="img_"+newId(); await putAsset(id,await shrink(file)); return {id}; },
  async url(id){ if(!id) return ""; if(urlCache.has(id)) return urlCache.get(id); await ready; let b=await getAsset(id).catch(()=>null);
    if(!b) b=await fetchCloudAsset(id).catch(()=>null);   // made on another device: fetch once, then it's offline too
    if(!b) return ""; const u=URL.createObjectURL(b); urlCache.set(id,u); return u; }
};

// ---------- downloads (PDF invoices, backups) ----------
const downloads={
  async save({filename,data}){
    const blob=data instanceof Blob?data:new Blob([data]);
    const file=new File([blob],filename,{type:blob.type||"application/octet-stream"});
    const standaloneIOS=navigator.standalone===true||(/iPhone|iPad/.test(navigator.userAgent)&&matchMedia("(display-mode: standalone)").matches);
    // Home-screen apps on iPhone can't do normal downloads; the share sheet offers "Save to Files", Mail, AirDrop…
    if(standaloneIOS&&navigator.canShare&&navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file],title:filename}); }catch(e){ if(e&&e.name==="AbortError") throw err("declined"); throw e; }
    } else {
      const u=URL.createObjectURL(blob), a=document.createElement("a"); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),10000);
    }
    if(/backup/i.test(filename)) await markBackup();
  }
};

// ---------- backup helpers shared with the dashboard and the welcome screen ----------
async function markBackup(){ await setMeta("lastBackupAt",new Date().toISOString()); updateReminder(); }
async function exportAssets(){ const ids=await allAssetIds(), out={}; for(const id of ids){ const b=await getAsset(id); if(b) out[id]=await blobToDataUrl(b); } return out; }
async function importAssets(map){ let n=0; for(const [id,u] of Object.entries(map||{})){ if(typeof u==="string"&&u.startsWith("data:")){ await putAsset(id,await dataUrlToBlob(u)); urlCache.delete(id); n++; } } return n; }
function parseBackup(text){
  let obj; try{ obj=JSON.parse(text); }catch(_){ throw err("bad_json","That isn't valid JSON. Paste the whole backup, from the first { to the last }."); }
  const cols=obj&&obj.collections&&typeof obj.collections==="object"?obj.collections:obj;
  const found=COLS.filter(c=>Array.isArray(cols&&cols[c]));
  if(!found.length) throw err("no_data","No Life HQ data found in that file.");
  return {cols,found,assets:obj.assets||null};
}
async function importBackup(text){ // merge by id, never deletes
  await ready; const {cols,found,assets:am}=parseBackup(text); let n=0;
  for(const c of found){ for(const d of cols[c]){ if(!d||typeof d!=="object") continue; const {id,...body}=d; const k=id?String(id):newId(); known(c).set(k,clone(body)); const st=stamps.get(kOf(c,k)); await persist(c,k,mem[c].get(k),{u:st&&!st.del?nextU(st.u):LEGACY}); n++; } emit(c); }
  const imgs=am?await importAssets(am):0;
  await setMeta("started",true);
  return {docs:n,images:imgs,collections:found.length};
}
const isEmpty=()=>COLS.every(c=>!mem[c]||!mem[c].size);

// ---------- backup reminder (data lives only on this phone) ----------
function daysSince(isoStr){ return isoStr?(Date.now()-new Date(isoStr).getTime())/864e5:Infinity; }
function updateReminder(){
  const el=document.getElementById("backup-nudge"), btn=document.querySelector("header [data-backup]"); if(!el) return;
  const last=meta.lastBackupAt, since=Math.min(daysSince(last),Infinity), base=last||meta.firstRunAt;
  const synced=SYNC.lastOkAt&&daysSince(SYNC.lastOkAt)<7;
  const due=!isEmpty()&&daysSince(base)>=7&&!synced;
  el.hidden=!due;
  if(due) el.querySelector("span").textContent=last?`Your last backup was ${Math.floor(since)} days ago. Your data lives only on this phone.`:"You haven't made a backup yet. Your data lives only on this phone.";
  if(btn) btn.classList.toggle("nudge",due);
}

// ---------- first-run welcome ----------
function welcome(){
  const root=document.getElementById("welcome"); if(!root) return;
  root.hidden=false; document.documentElement.style.overflow="hidden";
  root.innerHTML=`<div class="sheet wsheet" role="dialog" aria-labelledby="w-h">
    <div class="wlogo" aria-hidden="true">HQ</div>
    <h2 id="w-h">Welcome to Life HQ</h2>
    <p class="wp">Your dashboard now runs as its own app. Everything is saved on this device. No account and no internet needed.</p>
    <div class="wcard"><h3>Bring your data from Claude</h3>
      <p class="wp">In the Claude version, tap <b>Backup</b> then <b>Download backup</b> (or <b>Copy JSON</b>). Then pick that file here, or paste it.</p>
      <div class="wrow"><label class="btn primary" for="w-file">Import backup file</label><input id="w-file" type="file" accept="application/json,.json,text/plain" hidden><button class="btn" id="w-paste-t" type="button">Paste JSON</button></div>
      <div id="w-paste" hidden><textarea id="w-text" placeholder='{"app":"Sean&#39;s Life HQ","collections":{…}}' aria-label="Backup JSON"></textarea><button class="btn primary" id="w-go" type="button">Import pasted backup</button></div>
      <div class="ferr" id="w-err" role="alert"></div><div id="w-ok" class="wp" role="status"></div></div>
    <div class="wcard"><h3>Already using Life HQ on another device?</h3>
      <p class="wp">Sign in with your email and your synced data comes down to this device.</p>
      <div class="wrow"><button class="btn primary" id="w-sync" type="button">Sign in to sync</button></div></div>
    <button class="btn" id="w-fresh" type="button">Start fresh</button>
    <p class="wp small">Tip: on iPhone, tap Share then <b>Add to Home Screen</b> to open Life HQ like an app.</p>
  </div>`;
  const done=async res=>{ document.getElementById("w-ok").textContent=`Imported ${res.docs} entries${res.images?` and ${res.images} images`:""}.`; await setMeta("started",true); setTimeout(close,700); };
  const fail=e=>{ document.getElementById("w-err").textContent=(e&&e.message)||"Couldn't import that."; };
  const close=()=>{ root.hidden=true; root.innerHTML=""; document.documentElement.style.overflow=""; updateReminder(); };
  document.getElementById("w-file").onchange=async e=>{ const f=e.target.files&&e.target.files[0]; if(!f) return; try{ await done(await importBackup(await f.text())); }catch(x){ fail(x); } };
  document.getElementById("w-paste-t").onclick=()=>{ const p=document.getElementById("w-paste"); p.hidden=!p.hidden; if(!p.hidden) document.getElementById("w-text").focus(); };
  document.getElementById("w-go").onclick=async()=>{ try{ await done(await importBackup(document.getElementById("w-text").value)); }catch(x){ fail(x); } };
  document.getElementById("w-fresh").onclick=async()=>{ await setMeta("started",true); close(); };
  document.getElementById("w-sync").onclick=()=>{ close(); window.dispatchEvent(new Event("lhq:open-sync")); };
}


// ---------- cloud sync (Supabase) ----------
const SB_URL="https://jovhhdluaxydulcxrtqs.supabase.co";
const SB_KEY="sb_publishable_PJdtXXUxaOKe1WAaJWIjRQ_bcMTplS7";            // public by design; Row Level Security limits every row to its owner
const TABLE="lifehq_docs", BUCKET="lifehq-assets", PAGE=1000;
const SYNC={ state:"off", user:null, lastOkAt:null, error:"", pending:0 };
let sb=null, sbLoading=null, chan=null, pushTimer=null, syncing=null, again=false, pollTimer=null;
const syncListeners=new Set();
function setSync(patch){ Object.assign(SYNC,patch); SYNC.pending=[...stamps.values()].filter(x=>x.dirty).length;
  syncListeners.forEach(cb=>{ try{ cb({...SYNC}); }catch(e){ console.error(e); } }); updateReminder(); }
function loadSdk(){
  if(window.supabase&&window.supabase.createClient) return Promise.resolve(window.supabase);
  return sbLoading=sbLoading||new Promise((res,rej)=>{ const sc=document.createElement("script"); sc.src="vendor/supabase.umd.js?v=2.119.0"; sc.onload=()=>res(window.supabase); sc.onerror=()=>{ sbLoading=null; rej(err("sdk_load","Couldn't load sync. Check your connection.")); }; document.head.appendChild(sc); });
}
async function client(){
  if(sb) return sb; const S=await loadSdk();
  sb=S.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"implicit",storageKey:"lifehq-sync-auth"}});
  sb.auth.onAuthStateChange((ev,session)=>{ if(ev==="SIGNED_OUT"){ stopRealtime(); setSync({state:"off",user:null}); }
    else if(session&&session.user&&(!SYNC.user||SYNC.user.id!==session.user.id)){ const u=session.user; setTimeout(()=>begin(u),0); } }); // never call auth inside this callback
  return sb;
}
const online=()=>navigator.onLine!==false;
const netErr=e=>!online()||/fetch|network|load failed|timeout/i.test((e&&(e.message||e.name))||"");

function rowFor(k,st,uid){ const i=k.indexOf("/"), col=k.slice(0,i), id=k.slice(i+1);
  return {owner:uid,collection:col,id,data:st.del?{}:(mem[col]&&mem[col].get(id))||{},updated_at:st.u,deleted:!!st.del}; }
async function clearDirty(pushed){ // only if nothing changed since we read it
  const keys=pushed.filter(([k,u])=>{ const st=stamps.get(k); return st&&st.dirty&&st.u===u; }).map(([k])=>k); if(!keys.length) return;
  await tx("docs","readwrite",s=>{ for(const k of keys){ const st=stamps.get(k); st.dirty=false; const i=k.indexOf("/"), col=k.slice(0,i), id=k.slice(i+1);
    if(st.del) s.put({col:"_tomb",id:k,data:{u:st.u,dirty:false}},"_tomb/"+k); else s.put({col,id,data:mem[col].get(id),u:st.u,dirty:false},k); } });
}
async function pushAll(uid){
  const dirty=[...stamps].filter(([k,st])=>st.dirty&&(st.del||(mem[k.slice(0,k.indexOf("/"))]||new Map()).has(k.slice(k.indexOf("/")+1))));
  for(let i=0;i<dirty.length;i+=200){ const part=dirty.slice(i,i+200);
    const {error}=await sb.from(TABLE).upsert(part.map(([k,st])=>rowFor(k,st,uid)),{onConflict:"owner,collection,id"}); if(error) throw error;
    await clearDirty(part.map(([k,st])=>[k,st.u])); }
  await pushAssets(uid);
}
async function pushAssets(uid){
  const up=new Set(meta["sync:assetsUp"]||[]), ids=(await allAssetIds()).filter(id=>!up.has(id)); if(!ids.length) return;
  for(const id of ids){ const b=await getAsset(id); if(!b) continue;
    const {error}=await sb.storage.from(BUCKET).upload(uid+"/"+id,b,{upsert:true,contentType:b.type||"image/jpeg"});
    if(error&&!/exists|duplicate/i.test(error.message||"")) throw error; up.add(id); }
  await setMeta("sync:assetsUp",[...up]);
}
async function fetchCloudAsset(id){
  if(!SYNC.user||!/^img_[a-z0-9]+$/i.test(id)) return null; await client();
  const {data,error}=await sb.storage.from(BUCKET).download(SYNC.user.id+"/"+id); if(error||!data) return null;
  await putAsset(id,data); const up=new Set(meta["sync:assetsUp"]||[]); up.add(id); await setMeta("sync:assetsUp",[...up]); return data;
}
// apply remote rows with last-write-wins. first=true: never delete, keep both sides, log anything replaced
async function applyRemote(rows,{first=false,seen=new Set()}={}){
  const changed=new Set(), writes=[], conflicts=[];
  for(const r of rows){ if(!COLS.includes(r.collection)) continue;
    const k=kOf(r.collection,r.id), st=stamps.get(k), lu=st?ms(st.u):-1, ru=ms(r.updated_at), local=known(r.collection).get(r.id);
    if(first){ seen.add(k);
      if(r.deleted){ if(local) writes.push([r.collection,r.id,local,{u:nextU(r.updated_at),dirty:true,quiet:true}]); continue; } // deleted in the cloud but here: keep it, re-upload
      if(local&&st&&!st.del&&lu>ru){ writes.push([r.collection,r.id,local,{u:st.u,dirty:true,quiet:true}]); continue; }          // ours is newer
      if(local&&same(local,r.data)){ writes.push([r.collection,r.id,local,{u:r.updated_at,dirty:false,quiet:true}]); continue; } // identical
      if(local) conflicts.push({col:r.collection,id:r.id,local,localU:st&&st.u,remoteU:r.updated_at,at:new Date().toISOString()}); // cloud wins; keep our copy in the log
      known(r.collection).set(r.id,clone(r.data)); writes.push([r.collection,r.id,r.data,{u:r.updated_at,dirty:false,quiet:true}]); changed.add(r.collection); continue; }
    if(st&&lu>ru){ if(!st.dirty) writes.push([r.collection,r.id,st.del?null:local,{u:st.u,dirty:true,quiet:true}]); continue; } // ours is newer: push it
    if(st&&lu===ru){ if(!st.del&&local&&!same(local,r.data)&&!st.dirty){ known(r.collection).set(r.id,clone(r.data)); writes.push([r.collection,r.id,r.data,{u:r.updated_at,dirty:false,quiet:true}]); changed.add(r.collection); } continue; } // already have it
    if(r.deleted){ if(local||!st){ mem[r.collection].delete(r.id); writes.push([r.collection,r.id,null,{u:r.updated_at,dirty:false,quiet:true}]); changed.add(r.collection); } continue; }
    known(r.collection).set(r.id,clone(r.data)); writes.push([r.collection,r.id,r.data,{u:r.updated_at,dirty:false,quiet:true}]); changed.add(r.collection);
  }
  for(const [c,i,d,o] of writes) await persist(c,i,d,o);
  if(conflicts.length) await setMeta("sync:conflicts",[...(meta["sync:conflicts"]||[]),...conflicts].slice(-200));
  changed.forEach(emit); return {changed:changed.size,conflicts:conflicts.length};
}
async function pullSince(uid,since){
  let from=0, maxTs=since, all=[];
  for(;;){ let q=sb.from(TABLE).select("collection,id,data,updated_at,deleted,server_updated_at").eq("owner",uid).order("server_updated_at",{ascending:true}).range(from,from+PAGE-1);
    if(since) q=q.gt("server_updated_at",new Date(ms(since)-120e3).toISOString()); // overlap: tolerate commit-order skew
    const {data,error}=await q; if(error) throw error; all=all.concat(data);
    data.forEach(r=>{ if(!maxTs||ms(r.server_updated_at)>ms(maxTs)) maxTs=r.server_updated_at; }); if(data.length<PAGE) break; from+=PAGE; }
  return {rows:all,maxTs};
}
async function runSync(){
  if(syncing){ again=true; return syncing; }
  syncing=(async()=>{ do{ again=false;
    const uid=SYNC.user&&SYNC.user.id; if(!uid) return;
    if(!online()){ setSync({state:"offline"}); return; }
    setSync({state:"syncing",error:""});
    try{
      const {data:sd}=await sb.auth.getSession(); if(!sd||!sd.session){ SYNC.user=null; setSync({state:"off",error:"Signed out. Sign in again to keep syncing."}); return; } // also refreshes an expired token
      const first=meta["sync:firstDone"]!==uid;
      if(first){ // safe merge: pull everything, keep every local doc, upload all of them, delete nothing
        const seen=new Set(), {rows,maxTs}=await pullSince(uid,null); await applyRemote(rows,{first:true,seen});
        for(const [k,st] of [...stamps]){ if(seen.has(k)) continue; const i=k.indexOf("/"), col=k.slice(0,i), id=k.slice(i+1);
          if(st.del){ if(st.dirty) await persist(col,id,null,{u:st.u,dirty:false,quiet:true}); continue; }  // deletes from before sign-in stay local
          const d=(mem[col]||new Map()).get(id); if(d&&!st.dirty) await persist(col,id,d,{u:st.u,dirty:true,quiet:true}); }        // upload every local doc
        await pushAll(uid); await setMeta("sync:cursor",maxTs); await setMeta("sync:firstDone",uid);
      } else {
        await pushAll(uid);
        const {rows,maxTs}=await pullSince(uid,meta["sync:cursor"]||null); await applyRemote(rows); if(maxTs) await setMeta("sync:cursor",maxTs);
        if([...stamps.values()].some(x=>x.dirty)) await pushAll(uid);
      }
      await setMeta("sync:lastOkAt",new Date().toISOString()); setSync({state:"synced",lastOkAt:meta["sync:lastOkAt"]});
    }catch(e){ console.warn("Sync:",e&&e.message); setSync(netErr(e)?{state:"offline"}:{state:"error",error:(e&&e.message)||"Sync failed"}); }
  }while(again); })().finally(()=>{ syncing=null; });
  return syncing;
}
function startRealtime(uid){
  stopRealtime();
  chan=sb.channel("lhq-"+uid).on("postgres_changes",{event:"*",schema:"public",table:TABLE,filter:"owner=eq."+uid},p=>{
      const r=p.new&&p.new.collection?p.new:null; if(r&&meta["sync:firstDone"]===uid) applyRemote([r]).then(()=>setSync({})); })
    .subscribe(st=>{ if(st==="SUBSCRIBED") runSync(); });
}
function stopRealtime(){ if(chan&&sb){ sb.removeChannel(chan); } chan=null; }
async function begin(user){
  if(mode!=="indexeddb") return setSync({state:"error",error:"Sync needs IndexedDB, which isn't available here."});
  if(SYNC.user&&SYNC.user.id===user.id&&chan) return;   // already running
  SYNC.user={id:user.id,email:user.email}; await setMeta("sync:user",SYNC.user); if(chan) return;
  startRealtime(user.id); runSync();
  clearInterval(pollTimer); pollTimer=setInterval(()=>{ if(document.visibilityState==="visible") runSync(); },60e3);
}
onLocalChange=()=>{ if(!SYNC.user) return; setSync({}); clearTimeout(pushTimer); pushTimer=setTimeout(runSync,400); };
window.addEventListener("online",()=>{ if(SYNC.user) runSync(); });
window.addEventListener("offline",()=>{ if(SYNC.user) setSync({state:"offline"}); });
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible"&&SYNC.user) runSync(); });

function parseCode(input){ const t=String(input||"").trim();
  if(/^\d{6,10}$/.test(t.replace(/\s/g,""))) return {code:t.replace(/\s/g,"")};
  try{ const u=new URL(t); const th=u.searchParams.get("token")||u.searchParams.get("token_hash"); if(th) return {hash:th};
    const h=new URLSearchParams(u.hash.slice(1)); if(h.get("access_token")&&h.get("refresh_token")) return {session:{access_token:h.get("access_token"),refresh_token:h.get("refresh_token")}}; }catch(_){}
  return null; }
const syncApi={
  get status(){ return {...SYNC,pending:[...stamps.values()].filter(x=>x.dirty).length,available:mode==="indexeddb"}; },
  on(cb){ syncListeners.add(cb); return ()=>syncListeners.delete(cb); },
  async sendCode(email){ await client(); const {error}=await sb.auth.signInWithOtp({email:String(email).trim(),options:{shouldCreateUser:false,emailRedirectTo:location.origin+location.pathname}});
    if(error) throw err("otp",/not authorized/i.test(error.message)?"Supabase won't email this address yet (it needs custom email set up). Ask your assistant for a sign-in code.":/signup|not found|not allowed/i.test(error.message)?"That email doesn't have a Life HQ account.":/rate|seconds/i.test(error.message)?"Too many emails just now. Wait a bit, or ask your assistant for a sign-in code.":error.message); },
  async verify(email,input){ await client(); const p=parseCode(input); if(!p) throw err("bad_code","Enter the 6-digit code, or paste the sign-in link from the email.");
    const r=p.code?await sb.auth.verifyOtp({email:String(email).trim(),token:p.code,type:"email"}):p.hash?await sb.auth.verifyOtp({token_hash:p.hash,type:"email"}):await sb.auth.setSession(p.session);
    if(r.error) throw err("verify",/expired|invalid/i.test(r.error.message)?"That code is wrong or expired. Get a new one.":r.error.message);
    const user=r.data&&(r.data.user||(r.data.session&&r.data.session.user)); if(user&&(!SYNC.user||SYNC.user.id!==user.id)) await begin(user); return SYNC.user; },
  async signOut(){ stopRealtime(); clearInterval(pollTimer); try{ await client(); await sb.auth.signOut({scope:"local"}); }catch(_){}
    await setMeta("sync:user",null); await setMeta("sync:firstDone",null); await setMeta("sync:cursor",null); SYNC.user=null; setSync({state:"off"}); },
  syncNow:()=>runSync(),
  _rememberEmail:e=>setMeta("sync:lastEmail",e),
  conflicts:()=>clone(meta["sync:conflicts"]||[])
};
async function resumeSync(){ // signed in before: restore the saved session (works offline too)
  SYNC.lastOkAt=meta["sync:lastOkAt"]||null;
  const hasLink=/access_token=|[?&]token_hash=/.test(location.hash+location.search);
  if(!meta["sync:user"]&&!hasLink) return;
  const retry=()=>window.addEventListener("online",()=>resumeSync(),{once:true});
  if(meta["sync:user"]&&!online()){ SYNC.user=meta["sync:user"]; setSync({state:"offline"}); }
  try{ await client(); const {data}=await sb.auth.getSession(); const u=data&&data.session&&data.session.user;
    if(u){ SYNC.user=null; await begin(u); }
    else if(!online()){ retry(); }
    else if(meta["sync:user"]){ SYNC.user=null; setSync({state:"off",error:"Signed out. Sign in again to keep syncing."}); } }
  catch(e){ if(meta["sync:user"]){ SYNC.user=meta["sync:user"]; setSync({state:"offline"}); retry(); } }
}

// ---------- boot ----------
ready=loadAll();
window.claude={ use: async name=>{ await ready; return name==="db"?{collection}:name==="assets"?assets:name==="downloads"?downloads:null; } };
window.LHQ={ get mode(){ return mode; }, meta:()=>clone(meta), markBackup, exportAssets, importAssets, importBackup, ready, sync:syncApi };
ready.then(()=>{
  const start=()=>{ if(isEmpty()&&!meta.started) welcome(); updateReminder(); setInterval(updateReminder,3600e3); resumeSync(); };
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",start):start();
});
})();
