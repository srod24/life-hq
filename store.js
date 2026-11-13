/* Life HQ local store.
   Stands in for the Claude artifact host: window.claude.use("db" | "assets" | "downloads") with the same API
   the dashboard already calls (collection().onSnapshot / add / doc(id).set|update|delete, assets.upload,
   downloads.save). Data stays on this device: IndexedDB first, localStorage if IndexedDB is unavailable.
   Collections, document ids and fields are exactly the Claude version's, so its Backup JSON imports as-is. */
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
    rows.forEach((r,i)=>{ (mem[r.col]=mem[r.col]||new Map()).set(r.id,r.data); void keys[i]; });
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
async function persist(col,id,data){ // data null = delete
  if(mode==="indexeddb") return tx("docs","readwrite",s=>{ const k=col+"/"+id; if(data==null) s.delete(k); else s.put({col,id,data},k); });
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
  async url(id){ if(!id) return ""; if(urlCache.has(id)) return urlCache.get(id); await ready; const b=await getAsset(id).catch(()=>null); if(!b) return ""; const u=URL.createObjectURL(b); urlCache.set(id,u); return u; }
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
  for(const c of found){ for(const d of cols[c]){ if(!d||typeof d!=="object") continue; const {id,...body}=d; const k=id?String(id):newId(); known(c).set(k,clone(body)); await persist(c,k,mem[c].get(k)); n++; } emit(c); }
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
  const due=!isEmpty()&&daysSince(base)>=7;
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
}

// ---------- boot ----------
ready=loadAll();
window.claude={ use: async name=>{ await ready; return name==="db"?{collection}:name==="assets"?assets:name==="downloads"?downloads:null; } };
window.LHQ={ get mode(){ return mode; }, meta:()=>clone(meta), markBackup, exportAssets, importAssets, importBackup, ready };
ready.then(()=>{
  const start=()=>{ if(isEmpty()&&!meta.started) welcome(); updateReminder(); setInterval(updateReminder,3600e3); };
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",start):start();
});
})();
