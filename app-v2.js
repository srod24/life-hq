/* Life HQ dashboard (same code as the Claude artifact, running on store.js). */
(function(){
"use strict";
// ---------- helpers ----------
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2,"0");
const iso = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayISO = () => iso(new Date());
const localDT = d => iso(d)+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
const parseD = s => { if(!s) return null; const [y,m,d] = s.slice(0,10).split("-").map(Number); return new Date(y,m-1,d); };
const daysBetween = (a,b) => Math.round((parseD(b)-parseD(a))/864e5);
const addDays = (s,n) => { const d=parseD(s); d.setDate(d.getDate()+n); return iso(d); };
// Whole dollars stay compact ($425); amounts with cents keep them ($50.50) so totals never round away from the invoice.
const money = n => { const v=Math.round((Number(n)||0)*100)/100, whole=Number.isInteger(v); return v.toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:whole?0:2,maximumFractionDigits:whole?0:2}); };
const fmtDate = s => { const d=parseD(s); return d ? d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) : ""; };
const isDateOnly = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||""));
// Date-only values (paidDate, due…) are local calendar days. new Date("2026-11-13") would read them as UTC midnight
// and show the previous evening in Florida, so format them as days instead.
const fmtDT = s => { if(!s) return ""; if(isDateOnly(s)) return parseD(s).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"}); const d=new Date(s); return isNaN(d) ? s : d.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); };
// Sortable timestamp for mixed values: UTC ISO (created), local "YYYY-MM-DDTHH:MM" (when, completedAt) and date-only (paidDate, end of that day).
const tms = s => { if(!s) return 0; if(isDateOnly(s)){ const d=parseD(s); d.setHours(23,59,59); return d.getTime(); } const d=new Date(s); return isNaN(d)?0:d.getTime(); };
const monthKey = s => (s||"").slice(0,7);
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const todayDay = () => DAYS[(new Date().getDay()+6)%7];

// ---------- schemas ----------
const AREAS=["PerformCore","Tint jobs","SJR","Trading","Content","Health","Relationships","Admin","Personal"];
const AREA_HUE={PerformCore:208,"Tint jobs":178,SJR:32,Trading:135,Content:330,Health:8,Relationships:290,Admin:222,Personal:55};
const dot=a=>`<i class="adot" style="background:hsl(${AREA_HUE[a]??200} 55% 50%)"></i>`;
const goalOpts=()=>[{v:"",l:"None"},...data.goals.filter(g=>g.status!=="Done").map(g=>({v:g.id,l:g.title}))];
const divOf = x => (x&&x.division) || "Automotive";
const DIV = {
  Automotive:{schema:"tints",services:["Auto tint","PPF","Ceramic coating","Other"],acctTypes:["Detail shop","Dealership","Body shop","Fleet","Wholesale","Other"],emptyAcct:"Add the shops, dealers and fleets you work for. Their jobs, balance and comebacks roll up here.",emptyJobs:"Book a job: pick the account, vehicle, film and price. Tap a job to see its history or log a comeback."},
  Residential:{schema:"flatJobs",services:["Solar control","Privacy / decorative","Security / safety","Removal","Other"],acctTypes:["Builder","Homeowner","HOA","Property manager","Other"],emptyAcct:"Add builders, HOAs and property managers. Homeowners can be one-off jobs with no account.",emptyJobs:"Book a job with the address, film, square feet and rate. Price fills in as sq ft × rate."},
  Commercial:{schema:"flatJobs",services:["Solar control","Security / safety","Privacy / decorative","Anti-graffiti","Removal","Other"],acctTypes:["Property manager","General contractor","Business owner","Building owner","Other"],emptyAcct:"Add property managers, GCs and business owners. Their jobs, square footage and balance roll up here.",emptyJobs:"Book a job with the property, film, square feet and rate. Price fills in as sq ft × rate."}
};
const ACCT_TYPES=[...new Set(Object.values(DIV).flatMap(d=>d.acctTypes))];
const acctOpts=v=>[{v:"",l:divOf(v)==="Automotive"?"Retail / walk-in":"No account (one-off customer)"},...[...data.accounts].filter(a=>divOf(a)===divOf(v)||a.id===v.accountId).sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(a=>({v:a.id,l:a.name}))];
const S = {
  films:{label:"Film", fields:[
    {k:"name",label:"Film name",type:"text",req:true,ph:"Silver 20, Ceramic 35, 8 mil security…"},
    {k:"category",label:"Category",type:"select",opts:["Solar control","Security / safety","Privacy / decorative","Anti-graffiti","Other"],half:true},
    {k:"rate",label:"Price per sq ft ($)",type:"number",req:true,half:true},
    {k:"divisions",label:"Used for",type:"select",opts:["Residential & Commercial","Residential","Commercial"]},
    {k:"notes",label:"Notes",type:"textarea",ph:"Brand, warranty, minimums…"}]},
  settings:{label:"Invoice settings", fields:[
    {k:"bizName",label:"Business name",type:"text",req:true},
    {k:"phone",label:"Phone",type:"tel",half:true},
    {k:"email",label:"Email",type:"email",half:true},
    {k:"address",label:"Address",type:"textarea",ph:"Street\nNaples, FL 341xx"},
    {k:"payment",label:"How to pay (printed on every invoice)",type:"textarea",ph:"PayPal: you@email.com · Zelle: 239-xxx-xxxx"},
    {k:"prefix",label:"Invoice # prefix",type:"text",half:true},
    {k:"terms",label:"Due in (days)",type:"number",half:true}]},
  goals:{label:"Goal", fields:[
    {k:"title",label:"Goal",type:"text",req:true,ph:"Land first commercial film client"},
    {k:"area",label:"Area",type:"select",opts:AREAS,half:true},
    {k:"status",label:"Status",type:"select",opts:["Active","Ongoing","Next","Parked","Done"],half:true},
    {k:"target",label:"Done looks like",type:"text",ph:"Measurable outcome"},
    {k:"deadline",label:"Deadline",type:"date",half:true},
    {k:"next",label:"Next action",type:"text",half:true},
    {k:"why",label:"Why / notes",type:"textarea"}]},
  blocks:{label:"Time block", fields:[
    {k:"focus",label:"What you work on",type:"text",req:true,ph:"Outbound: GC and property manager pitches"},
    {k:"day",label:"Day",type:"select",opts:DAYS,req:true,half:true},
    {k:"area",label:"Area",type:"select",opts:AREAS,half:true},
    {k:"start",label:"Start",type:"time",req:true,half:true},
    {k:"end",label:"End",type:"time",req:true,half:true},
    {k:"goal",label:"Moves which goal",type:"select",opts:goalOpts}]},
  tasks:{label:"Task", fields:[
    {k:"title",label:"Task",type:"text",req:true,ph:"Send Aaron the pilot proposal"},
    {k:"goal",label:"Goal",type:"select",opts:goalOpts},
    {k:"area",label:"Area",type:"select",opts:["PerformCore","SJR","Personal","Home","Other"],half:true},
    {k:"priority",label:"Priority",type:"select",opts:["High","Medium","Low"],half:true},
    {k:"due",label:"Due",type:"date",half:true},
    {k:"status",label:"Status",type:"select",opts:["To do","Doing","Done"],half:true},
    {k:"notes",label:"Notes",type:"textarea"}]},
  workouts:{label:"Workout", fields:[
    {k:"title",label:"Workout",type:"text",req:true,ph:"Push day, 5k run…"},
    {k:"day",label:"Day",type:"select",opts:DAYS,req:true,half:true},
    {k:"time",label:"Time",type:"time",half:true},
    {k:"type",label:"Type",type:"select",opts:["Strength","Cardio","Mobility","Sport","Rest"],half:true},
    {k:"duration",label:"Minutes",type:"number",half:true},
    {k:"details",label:"Details",type:"textarea",ph:"Sets, reps, distance"}]},
  accounts:{label:"Account", fields:[
    {k:"name",label:"Account name",type:"text",req:true,ph:"J&V"},
    {k:"division",label:"Division",type:"select",opts:["Automotive","Residential","Commercial"],half:true},
    {k:"type",label:"Type",type:"select",opts:ACCT_TYPES,half:true},
    {k:"terms",label:"Pay terms (days)",type:"number",half:true},
    {k:"contact",label:"Contact person",type:"text",half:true},
    {k:"phone",label:"Phone",type:"tel",half:true},
    {k:"email",label:"Email",type:"email"},
    {k:"address",label:"Address",type:"textarea"},
    {k:"rates",label:"Agreed rates",type:"textarea",ph:"Full sedan $250 · Windshield $150…"},
    {k:"notes",label:"Notes",type:"textarea"}]},
  flatJobs:{coll:"tints",label:"Job", fields:[
    {k:"division",type:"hidden"},
    {k:"accountId",label:"Account",type:"select",opts:acctOpts},
    {k:"client",label:"Customer name (if no account)",type:"text"},
    {k:"phone",label:"Phone",type:"tel",half:true},
    {k:"when",label:"Scheduled",type:"datetime-local",req:true,half:true},
    {k:"job",label:"Property / address",type:"text",ph:"1234 Gulf Shore Blvd, Unit 5"},
    {k:"service",label:"Service",type:"select",opts:v=>DIV[divOf(v)].services,half:true},
    {k:"lines",label:"Films & square footage",type:"filmlines"},
    {k:"status",label:"Status",type:"select",opts:["Booked","Confirmed","Done","Paid","Cancelled"],half:true},
    {k:"completedAt",label:"Completed at",type:"datetime-local",half:true},
    {k:"tech",label:"Installed by",type:"text",half:true},
    {k:"notes",label:"Notes",type:"textarea",ph:"Windows, panes, access, glass type…"}],
    beforeSave:(out,item)=>{
      if(out.accountId){ const a=data.accounts.find(x=>x.id===out.accountId); if(a) out.client=a.name; }
      if(!out.client) return "Pick an account or enter a customer name.";
      const L=out.lines||[];
      if(!L.length) return "Add at least one film with square feet.";
      if(L.some(l=>!l.film)) return "Choose a film for every line.";
      if(L.some(l=>!(l.sqft>0)||!(l.rate>0))) return "Each film needs square feet and a rate.";
      out.sqft=L.reduce((s,l)=>s+l.sqft,0); out.price=Math.round(L.reduce((s,l)=>s+l.amount,0)*100)/100;
      out.rate=out.sqft?Math.round(out.price/out.sqft*100)/100:0; out.film=[...new Set(L.map(l=>l.film))].join(", ");
      if((out.status==="Done"||out.status==="Paid")&&!out.completedAt) out.completedAt=localDT(new Date());
      if(out.status==="Paid"&&!(item&&item.paidDate)) out.paidDate=todayISO();
    }},
  tints:{label:"Job", fields:[
    {k:"division",type:"hidden"},
    {k:"accountId",label:"Account",type:"select",opts:acctOpts},
    {k:"client",label:"Customer name (retail only)",type:"text",ph:"Leave blank for account jobs"},
    {k:"phone",label:"Phone",type:"tel",half:true},
    {k:"when",label:"Scheduled",type:"datetime-local",req:true,half:true},
    {k:"job",label:"Vehicle",type:"text",ph:"2018 Toyota RAV4"},
    {k:"vin",label:"VIN",type:"text",ph:"17 characters, from the dash or door jamb"},
    {k:"service",label:"Service",type:"select",opts:["Auto tint","PPF","Ceramic coating","Flat glass","Other"],half:true},
    {k:"film",label:"Film / shade",type:"text",ph:"Ceramic 20%",half:true},
    {k:"price",label:"Price ($)",type:"number",half:true},
    {k:"status",label:"Status",type:"select",opts:["Booked","Confirmed","Done","Paid","Cancelled"],half:true},
    {k:"completedAt",label:"Completed at",type:"datetime-local",half:true},
    {k:"tech",label:"Installed by",type:"text",half:true},
    {k:"notes",label:"Notes",type:"textarea"}],
    beforeSave:(out,item)=>{
      if(out.accountId){ const a=data.accounts.find(x=>x.id===out.accountId); if(a) out.client=a.name; }
      if(!out.client) return "Pick an account or enter a customer name.";
      if(out.vin){ out.vin=String(out.vin).toUpperCase().replace(/[^A-Z0-9]/g,""); if(out.vin.length!==17||/[IOQ]/.test(out.vin)) return "The VIN should be 17 letters and numbers, with no I, O or Q. Check it or leave it blank."; }
      if((out.status==="Done"||out.status==="Paid")&&!out.completedAt) out.completedAt=localDT(new Date());
      if(out.status==="Paid"&&!(item&&item.paidDate)) out.paidDate=todayISO();
    }},
  people:{label:"Person", fields:[
    {k:"name",label:"Name",type:"text",req:true},
    {k:"circle",label:"Circle",type:"select",opts:["Family","Friend","Business","Client","Mentor"],half:true},
    {k:"cadence",label:"Check in every (days)",type:"select",opts:["7","14","30","60","90"],half:true},
    {k:"last",label:"Last contact",type:"date",half:true},
    {k:"how",label:"How they're doing",type:"text",half:true,ph:"Great, stressed, new baby…"},
    {k:"next",label:"Next time, ask about",type:"text"},
    {k:"notes",label:"Notes",type:"textarea"}]},
  money:{label:"Entry", fields:[
    {k:"kind",label:"Type",type:"select",opts:["Invoice","Expense","Income"],req:true,half:true},
    {k:"amount",label:"Amount ($)",type:"number",req:true,half:true},
    {k:"party",label:"Client / vendor",type:"text",req:true},
    {k:"entity",label:"Business",type:"select",opts:["PerformCore","SJR Wealth Group","Personal","Other"],half:true},
    {k:"category",label:"Budget category",type:"text",half:true,ph:"Film, Software, Food…"},
    {k:"date",label:"Date",type:"date",req:true,half:true},
    {k:"due",label:"Due (invoices)",type:"date",half:true},
    {k:"status",label:"Invoice status",type:"select",opts:["","Draft","Sent","Paid"]},
    {k:"notes",label:"Notes",type:"textarea"}]},
  budgets:{label:"Budget", fields:[
    {k:"category",label:"Category",type:"text",req:true,ph:"Must match expense categories"},
    {k:"limit",label:"Monthly limit ($)",type:"number",req:true}]},
  ideas:{label:"Idea", fields:[
    {k:"title",label:"Idea",type:"text",req:true},
    {k:"area",label:"Area",type:"select",opts:["PerformCore","SJR","New venture","Content","Personal"],half:true},
    {k:"stage",label:"Stage",type:"select",opts:["Raw","Exploring","Building","Parked"],half:true},
    {k:"score",label:"Conviction (1–5)",type:"select",opts:["1","2","3","4","5"],half:true},
    {k:"notes",label:"Notes",type:"textarea"}]},
  designs:{label:"Design", fields:[
    {k:"title",label:"Title",type:"text",req:true},
    {k:"project",label:"Project",type:"text",half:true,ph:"PerformCore site, logo…"},
    {k:"status",label:"Status",type:"select",opts:["Concept","In progress","Final"],half:true},
    {k:"link",label:"Link (Figma, Canva…)",type:"url"},
    {k:"image",label:"Image",type:"image"},
    {k:"notes",label:"Notes",type:"textarea"}]}
};
const COLS = Object.keys(S).filter(k=>!S[k].coll);
const TABS = [["today","Today"],["plan","Plan"],["tasks","Tasks"],["training","Training"],["auto","Automotive"],["res","Residential"],["com","Commercial"],["people","People"],["invoices","Invoices"],["money","Money"],["ideas","Ideas"],["designs","Designs"],["more","More"]];

// ---------- state ----------
const data = Object.fromEntries(COLS.map(c=>[c,[]]));
const loaded = new Set();
let db = null, assets = null, readOnly = false;
let ui = {ideaFilter:"All", tintFilter:"Upcoming", moneyFilter:"All", invFilter:"Open", invQ:""};

// ---------- status ----------
function setStatus(msg, err){ const el=$("#status"); el.textContent=msg||""; el.className="status"+(err?" err":""); el.hidden=!msg; }

// ---------- routing ----------
function route(){ let h=location.hash.slice(1); if(h==="tint") h="auto"; return TABS.some(t=>t[0]===h) ? h : "today"; }
window.addEventListener("hashchange", render);

// ---------- derived ----------
function due(p){ if(!p.last) return {days:-1,state:"never"}; const d=Number(p.cadence||30)-daysBetween(p.last,todayISO()); return {days:d,state:d<0?"over":d<=3?"soon":"ok"}; }
function invState(m){ if(m.kind!=="Invoice") return null; if(m.status==="Paid") return "Paid"; if(m.status==="Sent" && m.due && m.due<todayISO()) return "Overdue"; return m.status||"Draft"; }
const upcomingTints = () => data.tints.filter(t=>t.when && t.when.slice(0,10)>=todayISO() && !["Cancelled","Done","Paid"].includes(t.status)).sort((a,b)=>a.when.localeCompare(b.when));

// ===== Receivables: the one place that decides what you're owed =====
// An invoice's amount is its line items NET of any negative lines (deposits, payments, discounts).
// Once a job is on an invoice that still exists, the invoice is the source of truth for that money;
// the job's own price only counts while the job isn't invoiced yet. Every total, badge and list reads from rx().
const r2 = n => Math.round((Number(n)||0)*100)/100;
const invById = id => id ? data.money.find(m=>m.id===id&&m.kind==="Invoice") : null;
const isOpenInv = m => ["Sent","Overdue"].includes(invState(m));
const invJobs = m => { const ids=new Set(m.jobIds||[]); return data.tints.filter(a=>ids.has(a.id)||(m.id&&a.invoiceId===m.id)); };
const invDivision = m => m.division || ((invJobs(m)[0]&&divOf(invJobs(m)[0]))) || (DIV[m.category]?m.category:"");
function receivables(){
  const items=[], covered=new Set();
  data.money.filter(m=>m.kind==="Invoice"&&invState(m)!=="Paid").forEach(m=>{
    const jobs=invJobs(m); jobs.forEach(j=>covered.add(j.id));
    items.push({kind:"inv",inv:m,jobs,amount:Math.max(0,r2(m.amount)),client:String(m.party||"").trim()||"Unknown",div:invDivision(m),state:invState(m),date:m.date||"",due:m.due||""});
  });
  data.tints.filter(a=>a.status==="Done"&&!covered.has(a.id)).forEach(a=>{
    const inv=invById(a.invoiceId);
    if(inv) return; // its invoice is Paid: the invoice wins (Invoices → Needs a look flags the stale job)
    items.push({kind:"job",jobs:[a],amount:r2(a.price),client:clientOf(a),div:divOf(a),state:"Not invoiced",date:(a.completedAt||a.when||"").slice(0,10),due:""});
  });
  return items;
}
let RXC=null;
function rx(){
  if(RXC) return RXC;
  const items=receivables(), owedByJob={};
  // spread each invoice's balance over its unpaid jobs by price, so per-job numbers add up to the invoice exactly
  items.forEach(it=>{ const un=it.jobs.filter(j=>j.status==="Done"); if(!un.length) return; const tot=un.reduce((s,j)=>s+(Number(j.price)||0),0); let left=it.amount;
    un.forEach((j,i)=>{ const v=i===un.length-1?r2(left):r2(tot>0?it.amount*(Number(j.price)||0)/tot:it.amount/un.length); owedByJob[j.id]=Math.max(0,v); left-=v; }); });
  const openInv=data.money.filter(m=>m.kind==="Invoice"&&isOpenInv(m));
  const sum=xs=>r2(xs.reduce((s,i)=>s+i.amount,0));
  RXC={items,owedByJob,openInv,total:sum(items),sent:sum(items.filter(i=>i.kind==="inv"&&i.state!=="Draft")),drafts:sum(items.filter(i=>i.kind==="inv"&&i.state==="Draft")),notInvoiced:sum(items.filter(i=>i.kind==="job"))};
  return RXC;
}
const unitsOf = it => Math.max(1,it.jobs.filter(j=>j.status==="Done").length);
// Money actually in for a month: paid invoices by the day they were paid, plus paid jobs that never had an invoice.
// (A paid job whose invoice is still open isn't counted until the invoice is paid; that mismatch is flagged.)
function collectedIn(mk, div){
  let s=0;
  data.money.forEach(m=>{ if(m.kind==="Invoice"&&invState(m)==="Paid"&&monthKey(m.paidDate||m.date)===mk&&(!div||invDivision(m)===div)) s+=Number(m.amount)||0; });
  data.tints.forEach(a=>{ if(a.status==="Paid"&&monthKey(paidOn(a))===mk&&(!div||divOf(a)===div)&&!invById(a.invoiceId)) s+=Number(a.price)||0; });
  return r2(s);
}
// People: "due" = overdue, never contacted, or due within 3 days. Today, the nav badge and People all use this.
const peopleDue = () => data.people.filter(p=>due(p).state!=="ok");
// Tasks: due today or overdue (the nav badge); Tasks also shows the open total.
const tasksDue = () => data.tasks.filter(x=>x.status!=="Done"&&x.due&&x.due<=todayISO());
// Training: this Monday–Sunday in local time; a workout counts once, on its own day's date.
function weekDates(){ const n=new Date(), mon=new Date(n.getFullYear(),n.getMonth(),n.getDate()-((n.getDay()+6)%7)); return DAYS.map((_,i)=>iso(new Date(mon.getFullYear(),mon.getMonth(),mon.getDate()+i))); }
function trainingWeek(){ const wd=weekDates(), planned=data.workouts.filter(w=>w.type!=="Rest"&&DAYS.includes(w.day)); const done=planned.filter(w=>(w.doneDates||[]).includes(wd[DAYS.indexOf(w.day)])).length; return {wd,planned:planned.length,done,left:Math.max(0,planned.length-done)}; }
// Data check: places where jobs and invoices disagree
function dataIssues(){
  const out=[];
  data.money.filter(m=>m.kind==="Invoice").forEach(m=>{
    const jobs=invJobs(m), st=invState(m);
    if(st==="Paid") jobs.filter(j=>j.status==="Done").forEach(j=>out.push({sev:"fix",msg:`${m.number||"An invoice"} is paid, but the job "${j.job||"Job"}" still shows unpaid.`,fix:"jobpaid",id:j.id,inv:m.id}));
    if(isOpenInv(m)&&jobs.length&&jobs.every(j=>j.status==="Paid")) out.push({sev:"warn",msg:`Every job on ${m.number||"an invoice"} is marked paid, but the invoice is still open (${money2(m.amount)}). Mark the invoice paid if the money came in.`,fix:"invpaid",id:m.id});
    const items=(m.lines||[]).filter(l=>Number(l.amount)>=0).reduce((s,l)=>s+(Number(l.amount)||0),0), credits=(m.lines||[]).filter(l=>Number(l.amount)<0).reduce((s,l)=>s-Number(l.amount),0);
    const jobTot=jobs.reduce((s,j)=>s+(Number(j.price)||0),0);
    if(jobs.length&&Math.abs(r2(m.amount)-r2(jobTot))>0.004){
      const why=credits>0?`after ${money2(credits)} in credits/payments on the invoice`:Math.abs(items-jobTot)>0.004?"because the invoice lines were edited after it was made":"";
      out.push({sev:"info",msg:`${m.number||"Invoice"} bills ${money2(m.amount)} but its job${jobs.length>1?"s are":" is"} priced ${money2(jobTot)}${why?" ("+why+")":""}. Totals use the invoice.`,id:m.id});
    }
  });
  data.tints.filter(a=>a.invoiceId&&!invById(a.invoiceId)).forEach(a=>out.push({sev:"fix",msg:`"${a.job||"A job"}" points to invoice ${a.invoiceNumber||""} which no longer exists. It's counted as not invoiced.`,fix:"unlink",id:a.id}));
  return out;
}

// ---------- render ----------
// ---------- shell: iOS tab bar (phone), sidebar (desktop), collapsing title ----------
const ICON={
  today:'<path d="M3.5 10.6 12 3.8l8.5 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-4.2v-5.8H9.2v5.8H5A1.5 1.5 0 0 1 3.5 19z"/>',
  tasks:'<circle cx="12" cy="12" r="8.6"/><path d="m8.2 12.4 2.6 2.6 5-5.4"/>',
  jobs:'<path d="M4.6 12.4 6.5 7.5A2 2 0 0 1 8.4 6.2h7.2a2 2 0 0 1 1.9 1.3l1.9 4.9"/><rect x="2.8" y="12.2" width="18.4" height="5.6" rx="1.8"/><path d="M6 17.8v2M18 17.8v2"/><path d="M6.6 15h.01M17.4 15h.01"/><path d="M9.5 9.2h5" opacity=".5"/>',
  money:'<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.6"/><circle cx="12" cy="12" r="2.7"/><path d="M6.4 9.4v5.2M17.6 9.4v5.2"/>',
  more:'<rect x="4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8"/>',
  plan:'<rect x="3.6" y="5" width="16.8" height="15.4" rx="2.6"/><path d="M3.6 9.8h16.8M8.2 3v3.6M15.8 3v3.6M7.8 13.6h2.4M13.8 13.6h2.4M7.8 16.8h2.4"/>',
  training:'<path d="M6.6 6.8v10.4M17.4 6.8v10.4M3.6 9.4v5.2M20.4 9.4v5.2M6.6 12h10.8"/>',
  people:'<circle cx="9" cy="8.4" r="3.2"/><path d="M3.4 19.6c.6-3.2 2.8-5 5.6-5s5 1.8 5.6 5"/><circle cx="17.2" cy="9.4" r="2.4"/><path d="M16 14.7c2.3.1 4 1.6 4.6 4.5"/>',
  ideas:'<path d="M9.2 17.6h5.6M10.2 20.6h3.6"/><path d="M12 3.4a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.3v1.1h5v-1.1c0-.9.4-1.7 1.1-2.3A6 6 0 0 0 12 3.4z"/>',
  designs:'<path d="M12 3.4a8.6 8.6 0 1 0 0 17.2c1.2 0 1.8-.8 1.8-1.6 0-1.3-1-1.8-1-3 0-1 .8-1.6 1.8-1.6h2.3a3.8 3.8 0 0 0 3.7-3.8c0-4-3.9-7.2-8.6-7.2z"/><circle cx="7.6" cy="11.2" r="1"/><circle cx="10.4" cy="7.5" r="1"/><circle cx="15" cy="7.6" r="1"/>',
  invoices:'<path d="M6 3.4h12v17.2l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 19.1z"/><path d="M9 8h6M9 11.4h6M9 14.8h3.6"/>',
  ledger:'<path d="M4 19.5h16"/><rect x="5.4" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6.5" width="3" height="10.5" rx="1"/><rect x="15.6" y="9" width="3" height="8" rx="1"/>',
  house:'<path d="M4 11 12 4.5l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
  building:'<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M9 7.5h.01M15 7.5h.01M9 11h.01M15 11h.01M9 14.5h.01M15 14.5h.01M10.5 20.5v-3h3v3"/>',
  film:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><path d="M3.5 9.5 9 4.5M3.5 15l10.5-10.5M8 19.5 20.5 7M14 19.5l6.5-6.5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
  backup:'<path d="M12 3.8v10.6M7.6 10l4.4 4.4 4.4-4.4"/><path d="M4.4 15.6v2.6a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-2.6"/>',
  key:'<rect x="2.8" y="6" width="18.4" height="12" rx="2.6"/><path d="M6.8 10h.01M10.4 10h.01M14 10h.01M17.4 10h.01M7.6 14h8.8"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  chev:'<path d="m9.5 5.8 6.2 6.2-6.2 6.2"/>',
  clock:'<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3 2"/>',
  bolt:'<path d="M13 3 5 13.5h6L10.6 21 19 10.4h-6z"/>'
};
const svg=(k,cls)=>`<svg class="ic${cls?" "+cls:""}" viewBox="0 0 24 24" aria-hidden="true">${ICON[k]||""}</svg>`;
const HUE={today:"#0B7A85",tasks:"#2F6BFF",jobs:"#0B7A85",auto:"#0B7A85",res:"#1F9D62",com:"#3D63DD",money:"#159957",invoices:"#0B7A85",plan:"#5B5BD6",training:"#F06A35",people:"#A855F7",ideas:"#E3A008",designs:"#EC4899",film:"#64748B",settings:"#64748B",backup:"#0EA5E9",key:"#64748B",clock:"#5B5BD6"};
const GROUP={today:"today",tasks:"tasks",auto:"jobs",res:"jobs",com:"jobs",invoices:"money",money:"money",plan:"more",training:"more",people:"more",ideas:"more",designs:"more",more:"more"};
const TITLE={today:"Today",plan:"Plan",tasks:"Tasks",training:"Training",auto:"Jobs",res:"Jobs",com:"Jobs",people:"People",invoices:"Money",money:"Money",ideas:"Ideas",designs:"Designs",more:"More"};
const uiMem=(k,v)=>{ try{ if(v===undefined) return localStorage.getItem("lifehq:ui:"+k); localStorage.setItem("lifehq:ui:"+k,v); }catch(_){ return null; } };
const lastDiv=()=>["auto","res","com"].includes(uiMem("div"))?uiMem("div"):"auto";
const lastMoney=()=>["invoices","money"].includes(uiMem("money"))?uiMem("money"):"invoices";
function counts(){
  const R=rx(), tw=trainingWeek(), up=upcomingTints(), td=tasksDue(), pd=peopleDue(), t=todayISO();
  const upc=d=>up.filter(a=>divOf(a)===d).length;
  return {R,tw,up,td,pd,t,
    tasks:[td.length,td.some(x=>x.due<t),td.length+" due today or overdue"],
    jobs:[up.length,false,up.length+" upcoming job"+(up.length===1?"":"s")],
    auto:[upc("Automotive"),false,"upcoming"],res:[upc("Residential"),false,"upcoming"],com:[upc("Commercial"),false,"upcoming"],
    money:[R.openInv.length,R.openInv.some(m=>invState(m)==="Overdue"),R.openInv.length+" open invoice"+(R.openInv.length===1?"":"s")],
    invoices:[R.openInv.length,R.openInv.some(m=>invState(m)==="Overdue"),"open invoices"],
    training:[tw.left,false,tw.left+" workouts left this week"],
    people:[pd.length,pd.some(p=>due(p).state==="over"),pd.length+" check-ins due"],
    more:[pd.length,pd.some(p=>due(p).state==="over"),pd.length+" check-in"+(pd.length===1?"":"s")+" due"],
    ideas:[0],designs:[0],plan:[0],today:[0]};
}
const badge=(c,soft)=>c&&c[0]?`<span class="badge${c[1]?" bad":soft?" soft":""}" aria-label="${esc(c[2]||"")}">${c[0]}</span>`:"";
function nav(){
  const r=route(), g=GROUP[r], C=counts();
  if(["auto","res","com"].includes(r)) uiMem("div",r);
  if(["invoices","money"].includes(r)) uiMem("money",r);
  const tabs=[["today","Today","today","#today"],["tasks","Tasks","tasks","#tasks"],["jobs","Jobs","jobs","#"+lastDiv()],["money","Money","money","#"+lastMoney()],["more","More","more","#more"]];
  $("#tabbar").innerHTML=tabs.map(([k,l,ic,h])=>`<a href="${h}" ${g===k?'aria-current="page"':""}${C[k]&&C[k][0]?` title="${esc(C[k][2])}"`:""}>${svg(ic)}<span>${l}</span>${k==="today"?"":badge(C[k])}</a>`).join("");
  const si=(k,l,ic)=>`<a class="si" href="#${k}" ${r===k?'aria-current="page"':""}>${svg(ic)}<span>${l}</span>${k==="money"?"":badge(C[k],true)}</a>`;
  $("#sidenav").innerHTML=si("today","Today","today")+si("tasks","Tasks","tasks")+si("plan","Plan","plan")
    +`<div class="sgrp">PerformCore</div>`+si("auto","Automotive","jobs")+si("res","Residential","house")+si("com","Commercial","building")+si("invoices","Invoices","invoices")+si("money","Budget &amp; ledger","ledger")
    +`<div class="sgrp">Life</div>`+si("training","Training","training")+si("people","People","people")+si("ideas","Ideas","ideas")+si("designs","Designs","designs");
  $("#tb-title").textContent=TITLE[r]||"Life HQ";
  document.title=r==="today"?"Life HQ":(TITLE[r]||"")+" · Life HQ";
}
let lastRoute=null;
function render(){
  RXC=null;
  $("#today-label").textContent=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  nav();
  const r=route(), v=$("#view"), changed=r!==lastRoute; lastRoute=r;
  // live data updates re-render the view; keep whatever you were typing in (search, quick add) focused
  const ae=document.activeElement, keep=ae&&ae.id&&v.contains(ae)?{id:ae.id,val:ae.value,s:ae.selectionStart,e:ae.selectionEnd}:null;
  v.innerHTML = ({today:vToday,plan:vPlan,tasks:vTasks,training:vTraining,auto:vAuto,res:vRes,com:vCom,people:vPeople,money:vMoney,invoices:vInvoices,ideas:vIdeas,designs:vDesigns,more:vMore})[r]();
  if(r==="designs") hydrateImages();
  updateFab();
  if(changed){ v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); if(!keep) window.scrollTo(0,0);
    const td=v.querySelector(".week .day.today"); if(td&&td.parentElement.scrollWidth>td.parentElement.clientWidth) td.parentElement.scrollLeft=td.offsetLeft-16; }
  if(keep){ const el=document.getElementById(keep.id); if(el){ if(keep.val!=null&&"value" in el) el.value=keep.val; el.focus({preventScroll:true}); try{ el.setSelectionRange(keep.s,keep.e); }catch(_){} } }
}
const empty = (title, body, action) => `<div class="empty"><b>${esc(title)}</b>${esc(body)}${action?`<div style="margin-top:10px">${action}</div>`:""}</div>`;
const addBtn = (col, label, preset) => readOnly ? "" : `<button class="btn primary" data-add="${col}" ${preset?`data-preset='${esc(JSON.stringify(preset))}'`:""}>${esc(label)}</button>`;

function vToday(){
  const t=todayISO(), dn=todayDay(), now=new Date(), hr=now.getHours();
  const greet=hr<5?"Good evening":hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
  const R=rx(), mk=monthKey(t), overdue=R.openInv.filter(m=>invState(m)==="Overdue");
  const spent=data.money.filter(m=>m.kind==="Expense"&&monthKey(m.date)===mk).reduce((s,m)=>s+Number(m.amount||0),0);
  const inc=collectedIn(mk)+data.money.filter(m=>m.kind==="Income"&&monthKey(m.date)===mk).reduce((s,m)=>s+Number(m.amount||0),0);
  const limit=data.budgets.reduce((s,b)=>s+Number(b.limit||0),0);
  const owedSub=[R.sent?`${money(R.sent)} invoiced`:"",R.drafts?`${money(R.drafts)} in drafts`:"",R.notInvoiced?`${money(R.notInvoiced)} not invoiced`:""].filter(Boolean).join(" · ");
  const monthName=now.toLocaleDateString("en-US",{month:"long"});
  // schedule
  const blocks=dayBlocks(dn), nm=nowMin(), cur=blocks.find(isNow), next=blocks.find(b=>toMin(b.start)>nm), rest=blocks.filter(b=>toMin(b.end)>nm);
  const dur=m=>{ const h=Math.floor(m/60), mm=m%60; return h?`${h}h${mm?" "+mm+"m":""}`:`${mm}m`; };
  let nowHtml;
  if(cur){ const st=toMin(cur.start), en=toMin(cur.end), pct=Math.max(2,Math.min(100,(nm-st)/(en-st)*100));
    nowHtml=`<div class="nk"><span class="live"></span>Now · ${fmtT(cur.start)}–${fmtT(cur.end)}</div><div class="nt" data-edit="blocks" data-id="${cur.id}" tabindex="0">${esc(cur.focus)}</div><div class="bar"><i style="width:${pct}%"></i></div><div class="nm">${dur(en-nm)} left${cur.goal&&goalTitle(cur.goal)?` · → ${esc(goalTitle(cur.goal))}`:""}${next&&next!==cur?` · Up next ${fmtT(next.start)} ${esc(next.focus)}`:""}</div>`; }
  else if(next){ nowHtml=`<div class="nk" style="color:var(--muted)">${svg("clock")}Up next · in ${dur(toMin(next.start)-nm)}</div><div class="nt" data-edit="blocks" data-id="${next.id}" tabindex="0">${dot(next.area)}${esc(next.focus)}</div><div class="nm">${fmtT(next.start)}–${fmtT(next.end)}${next.goal&&goalTitle(next.goal)?` · → ${esc(goalTitle(next.goal))}`:""}</div>`; }
  else nowHtml=`<div class="nk" style="color:var(--muted)">${svg("clock")}Schedule</div><div class="nt">${blocks.length?"That's a wrap for today":"Nothing blocked today"}</div><div class="nm">${blocks.length?`${blocks.length} block${blocks.length===1?"":"s"} done. Plan tomorrow in <a href="#plan">Plan</a>.`:`Build your week in <a href="#plan">Plan</a>.`}</div>`;
  if(blocks.length) nowHtml+=`<details><summary>Today's schedule · ${blocks.length}</summary><div class="mini" style="margin-top:6px">${blocks.map(blockRow).join("")}</div></details>`;
  // tasks, people, money, training, jobs, ideas
  const dueT=sortTasks(data.tasks.filter(x=>x.status!=="Done"&&x.due&&x.due<=t)).slice(0,6), hi=data.tasks.filter(x=>x.status!=="Done"&&!x.due&&x.priority==="High").slice(0,3), tl=[...dueT,...hi];
  const pAll=peopleDue().map(p=>({p,d:due(p)})).sort((a,b)=>a.d.days-b.d.days);
  const unpaid=[...R.items].sort((a,b)=>({Overdue:0}[a.state]??1)-({Overdue:0}[b.state]??1)||(a.due||a.date||"").localeCompare(b.due||b.date||""));
  const wk=data.workouts.filter(w=>w.day===dn).sort((a,b)=>(a.time||"").localeCompare(b.time||"")), tw=trainingWeek();
  const dots=DAYS.map((d,i)=>{ const ws=data.workouts.filter(w=>w.day===d&&w.type!=="Rest"), date=tw.wd[i], done=ws.some(w=>(w.doneDates||[]).includes(date));
    const cls=done?"done":ws.length?(date<t?"missed":"plan"):""; return `<span class="${d===dn?"td":""}" title="${esc(d)}"><i class="${cls}"></i>${d[0]}</span>`; }).join("");
  const tints=upcomingTints().slice(0,4), hot=data.ideas.filter(i=>i.stage!=="Parked").sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,3);
  const tile=(ic,title,link,body,extra)=>`<section class="tile"${extra||""}><div class="tile-h"><h3><span class="tic" style="background:${HUE[ic]}">${svg({auto:"jobs",res:"house",com:"building"}[ic]||ic)}</span>${title}</h3>${link||""}</div>${body}</section>`;
  const fabActs=readOnly?"":`<div class="fab-acts" hidden>${addBtn("tasks","New task",{status:"To do",priority:"Medium",due:t})}${addBtn("tints","Book a job",{division:"Automotive",status:"Booked",service:"Auto tint",when:t+"T09:00"})}<button class="btn" data-newinv>New invoice</button>${addBtn("workouts","Add workout",{day:dn})}${addBtn("people","Add person",{cadence:"30",last:t})}${addBtn("ideas","Capture idea",{stage:"Raw",score:"3"})}</div>`;
  return `${fabActs}
  <div class="greet"><div class="gd">${esc(now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}))}</div><h2>${greet}, Sean</h2></div>
  <div class="tgrid top">
    <a class="hero" href="#invoices" aria-label="Money: ${esc(money(R.total))} owed to you">
      <div class="hk">Owed to you ${overdue.length?`<span class="hpill">${overdue.length} overdue</span>`:R.total?"":`<span class="hpill ok">All paid</span>`}</div>
      <div class="hv">${money(R.total)}</div>
      <div class="hs">${esc(owedSub||"Nothing outstanding")}${R.openInv.length?` · ${R.openInv.length} open invoice${R.openInv.length===1?"":"s"}`:""}</div>
      <div class="hrow"><div class="hcell"><small>Collected · ${esc(monthName)}</small><b>${money(inc)}</b></div><div class="hcell"><small>Spent${limit?` of ${money(limit)}`:""}</small><b>${money(spent)}</b></div></div>
    </a>
    <section class="nowcard">${nowHtml}</section>
  </div>
  <div class="tcols">
    ${tile("tasks","Tasks due",`<a href="#tasks">All</a>`,`${quickAdd()}<div class="mini">${tl.length?tl.map(taskRow).join(""):empty("You're all caught up","Nothing due today. Add one above.")}</div>`)}
    ${tile("invoices",`Unpaid <span class="num" style="color:var(--muted);font-weight:600">${money(R.total)}</span>`,`<a href="#invoices">Invoices</a>`,`<div class="mini">${unpaid.length?unpaid.slice(0,5).map(it=>it.kind==="inv"?moneyRow(it.inv):tintRow(it.jobs[0])).join("")+(unpaid.length>5?`<div class="row" style="cursor:default"><a href="#invoices" class="s" style="color:var(--accent)">${unpaid.length-5} more →</a></div>`:""):empty("Nothing outstanding","Finished jobs and sent invoices show here until they're paid.")}</div>`)}
    ${tile("people","Check-ins",`<a href="#people">${pAll.length?pAll.length+" due":"People"}</a>`,`<div class="mini">${pAll.length?pAll.slice(0,5).map(x=>personRow(x.p)).join(""):empty("Everyone's current","People show up here when it's time to reach out.")}</div>`)}
    ${tile("training","Training",`<a href="#training">${tw.done}/${tw.planned} this week</a>`,`<div class="wdots">${dots}</div><div class="mini">${wk.length?wk.map(w=>wkRow(w,t)).join(""):empty("Rest day","Nothing scheduled today.")}</div>`)}
    ${tile("auto","Upcoming jobs",`<a href="#${lastDiv()}">Jobs</a>`,`<div class="mini">${tints.length?tints.map(tintRow).join(""):empty("No jobs booked ahead",readOnly?"":"Tap + to book one.")}</div>`)}
    ${tile("ideas","Top ideas",`<a href="#ideas">All</a>`,`<div class="mini">${hot.length?hot.map(ideaRow).join(""):empty("No ideas yet","Capture them in Ideas.")}</div>`)}
  </div>`;
}

// ---------- plan ----------
const toMin=s=>{ if(!s) return null; const [h,m]=s.split(":").map(Number); return h*60+(m||0); };
const fmtT=s=>{ const m=toMin(s); if(m==null) return ""; const h=Math.floor(m/60), mm=m%60; return ((h+11)%12+1)+(mm?":"+pad(mm):"")+(h<12?"a":"p"); };
const blockMins=b=>Math.max(0,(toMin(b.end)??0)-(toMin(b.start)??0));
const nowMin=()=>{ const d=new Date(); return d.getHours()*60+d.getMinutes(); };
const dayBlocks=d=>data.blocks.filter(b=>b.day===d).sort((a,b)=>(a.start||"").localeCompare(b.start||""));
const isNow=b=>b.day===todayDay()&&toMin(b.start)<=nowMin()&&nowMin()<toMin(b.end);
const goalTitle=id=>{ const g=data.goals.find(x=>x.id===id); return g?g.title:""; };
function blockRow(b){
  const now=isNow(b), past=b.day===todayDay()&&toMin(b.end)<=nowMin();
  return `<div class="row" data-edit="blocks" data-id="${b.id}" tabindex="0" style="${past?"opacity:.55":""}"><span class="t">${dot(b.area)}${esc(b.focus)}</span><span class="r">${now?`<span class="chip a">Now</span>`:""}<span class="num" style="font-size:13px">${fmtT(b.start)}–${fmtT(b.end)}</span></span>${b.goal&&goalTitle(b.goal)?`<span class="s">→ ${esc(goalTitle(b.goal))}</span>`:""}</div>`;
}
function goalCard(g){
  const t=todayISO();
  const tk=data.tasks.filter(x=>x.goal===g.id), dn=tk.filter(x=>x.status==="Done").length;
  const hrs=data.blocks.filter(b=>b.goal===g.id).reduce((s,b)=>s+blockMins(b),0)/60;
  const left=g.deadline?daysBetween(t,g.deadline):null;
  const dl=left==null?"":left<0?`<span class="chip b">${-left}d late</span>`:left<=14?`<span class="chip w">${left}d left</span>`:`<span class="chip num">${fmtDate(g.deadline)}</span>`;
  const st={Active:"a",Ongoing:"g",Done:"g"}[g.status]||"";
  return `<div class="card" data-edit="goals" data-id="${g.id}" tabindex="0" style="${g.status==="Parked"||g.status==="Done"?"opacity:.65":""}"><div class="body" style="gap:6px">
    <span style="display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:12px;color:var(--muted)"><span>${dot(g.area)}${esc(g.area||"")}</span><span style="display:flex;gap:4px">${dl}<span class="chip ${st}">${esc(g.status||"Next")}</span></span></span>
    <span style="font:700 17px/1.25 var(--f-display)">${esc(g.title)}</span>
    ${g.target?`<span style="font-size:13px;color:var(--muted)">Done = ${esc(g.target)}</span>`:""}
    ${g.next?`<span style="font-size:13px"><b>Next:</b> ${esc(g.next)}</span>`:""}
    <span style="display:flex;justify-content:space-between;font:500 12px var(--f-mono);color:var(--muted);margin-top:4px"><span>${tk.length?`${dn}/${tk.length} tasks`:"No tasks linked"}</span><span>${hrs?hrs.toFixed(hrs%1?1:0)+" h/wk":"No time blocked"}</span></span>
    ${tk.length?`<div class="bar" style="margin-top:0"><i style="width:${dn/tk.length*100}%"></i></div>`:""}
  </div></div>`;
}
function vPlan(){
  const dn=todayDay();
  const order={Active:0,Ongoing:1,Next:2,Parked:3,Done:4};
  const goals=[...data.goals].sort((a,b)=>(order[a.status]??2)-(order[b.status]??2)||(a.deadline||"9").localeCompare(b.deadline||"9"));
  const active=goals.filter(g=>g.status==="Active");
  const unblocked=active.filter(g=>!data.blocks.some(b=>b.goal===g.id));
  const hrsBy={}; data.blocks.forEach(b=>{const k=b.area||"Other"; hrsBy[k]=(hrsBy[k]||0)+blockMins(b)/60;});
  const areas=Object.entries(hrsBy).sort((a,b)=>b[1]-a[1]); const maxH=Math.max(1,...areas.map(a=>a[1])); const totalH=areas.reduce((s,a)=>s+a[1],0);
  const warn=[];
  if(active.length>3) warn.push(`${active.length} goals are Active. Past 3 at once, most stall. Move some to Next.`);
  unblocked.forEach(g=>warn.push(`"${g.title}" is Active but has no time blocked on the schedule.`));
  return `<div class="sec-head"><h2>Plan</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${addBtn("blocks","Add time block",{day:dn,area:"PerformCore"})}${addBtn("goals","Add goal",{status:"Next",area:"PerformCore"})}</div></div>
  ${warn.length?`<div class="panel" style="margin-bottom:16px;border-color:var(--sun);background:var(--sun-soft)">${warn.map(w=>`<div style="font-size:14px;color:var(--ink)">${esc(w)}</div>`).join("")}</div>`:""}
  ${goals.length?`<div class="cards" style="margin-bottom:24px">${goals.map(goalCard).join("")}</div>`:`<div class="list" style="margin-bottom:24px">${empty("No goals yet","Add 2–3 Active goals with a measurable target, then block time for each on the schedule below.")}</div>`}
  <div class="sec-head" style="margin-top:8px"><h2>The week</h2><span class="chip num">${totalH.toFixed(1)} h scheduled</span></div>
  ${areas.length?`<div class="panel" style="margin-bottom:16px"><h3>Hours per week by area</h3>${areas.map(([a,h])=>`<div style="display:grid;grid-template-columns:minmax(90px,140px) 1fr auto;gap:10px;align-items:center;padding:4px 0;font-size:14px"><span>${dot(a)}${esc(a)}</span><div class="bar" style="margin:0"><i style="width:${h/maxH*100}%;background:hsl(${AREA_HUE[a]??200} 55% 50%)"></i></div><span class="num" style="font-size:13px">${h.toFixed(h%1?1:0)}h</span></div>`).join("")}</div>`:""}
  <div class="week">${DAYS.map(d=>{const bs=dayBlocks(d); return `<div class="day ${d===dn?"today":""}"><div class="dn"><span>${d}</span><span class="num">${(bs.reduce((s,b)=>s+blockMins(b),0)/60).toFixed(1)}h</span></div>
    ${bs.map(b=>`<div class="wk ${isNow(b)?"now":""}" data-edit="blocks" data-id="${b.id}" tabindex="0"><div class="wm num">${fmtT(b.start)}–${fmtT(b.end)}</div><div class="wt">${dot(b.area)}${esc(b.focus)}</div></div>`).join("")}
    ${readOnly?"":`<button class="btn sm" data-add="blocks" data-preset='${esc(JSON.stringify({day:d,area:"PerformCore"}))}' style="margin-top:auto">+ Block</button>`}</div>`;}).join("")}</div>`;
}
const PRI={High:0,Medium:1,Low:2};
// ----- quick add: "Call Steve fri !high #PerformCore" -----
const TASK_AREAS=["PerformCore","SJR","Personal","Home","Other"];
const WD={sun:0,sunday:0,mon:1,monday:1,tue:2,tues:2,tuesday:2,wed:3,weds:3,wednesday:3,thu:4,thur:4,thurs:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};
function parseQuick(raw){
  let s=String(raw||"").trim(), due=todayISO(), dueSet=false, priority="Medium", area="";
  // read trailing tokens (any order): !high/!med/!low, #area, today/tomorrow/weekday/11-20 or 11/20, "no date"
  for(let guard=0;guard<6;guard++){
    let m;
    if((m=s.match(/\s*!(high|hi|h|medium|med|m|low|lo|l)$/i))){ const x=m[1][0].toLowerCase(); priority=x==="h"?"High":x==="l"?"Low":"Medium"; s=s.slice(0,m.index); continue; }
    if((m=s.match(/\s*#([\w&-]+)$/))){ const a=TASK_AREAS.find(o=>o.toLowerCase()===m[1].toLowerCase()||(m[1].toLowerCase()==="pc"&&o==="PerformCore")); if(a){ area=a; s=s.slice(0,m.index); continue; } }
    if(!dueSet&&(m=s.match(/\s+(?:due\s+|by\s+|on\s+)?(today|tonight|tomorrow|tmrw|tmr|no date|someday|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?)$/i))){
      const w=m[1].toLowerCase(), t=todayISO();
      if(w==="today"||w==="tonight") due=t; else if(/^(tomorrow|tmrw|tmr)$/.test(w)) due=addDays(t,1); else if(w==="no date"||w==="someday") due="";
      else if(m[2]){ const now=new Date(); let y=m[4]?Number(m[4]):now.getFullYear(); if(y<100) y+=2000; let d=iso(new Date(y,Number(m[2])-1,Number(m[3]))); if(!m[4]&&d<t) d=iso(new Date(y+1,Number(m[2])-1,Number(m[3]))); due=d; }
      else { const k=WD[w]; if(k==null) break; const cur=new Date().getDay(); due=addDays(t,(k-cur+7)%7); }
      dueSet=true; s=s.slice(0,m.index); continue; }
    break;
  }
  return {title:s.trim(),due,priority,area};
}
const quickHint = q => { const p=parseQuick(q); if(!p.title) return "End with a day (fri, tomorrow, 11/20), !high or !low, #Home or #PerformCore. Due today if no day."+(matchMedia("(pointer:fine)").matches?" Press t anywhere to jump here.":""); return "Saves as: "+[p.due?(p.due===todayISO()?"due today":"due "+fmtDT(p.due)):"no due date",p.priority!=="Medium"?p.priority+" priority":"",p.area].filter(Boolean).join(" · "); };
const quickAdd = () => readOnly?"":`<form class="qa" data-qa novalidate><input id="qa-task" type="text" value="${esc(ui.qa||"")}" placeholder="Quick add: Call Steve fri !high #PerformCore" aria-label="Quick add a task" autocomplete="off" enterkeyhint="done"><button class="btn sm primary" type="submit">Add</button><div class="qa-hint" id="qa-hint">${esc(quickHint(ui.qa||""))}</div></form>`;
function sortTasks(xs){ return [...xs].sort((a,b)=>((a.due||"9999")).localeCompare(b.due||"9999")||(PRI[a.priority]??1)-(PRI[b.priority]??1)); }
function taskRow(x){
  const t=todayISO(), done=x.status==="Done";
  const dueChip=done?"":x.due?(x.due<t?`<span class="chip b">${daysBetween(x.due,t)}d late</span>`:x.due===t?`<span class="chip w">Today</span>`:`<span class="chip num">${fmtDate(x.due)}</span>`):"";
  const pri=x.priority==="High"?`<span class="chip b">High</span>`:x.priority==="Low"?`<span class="chip">Low</span>`:"";
  return `<div class="row${!done&&x.due&&x.due<t?" od":""}" data-edit="tasks" data-id="${x.id}" tabindex="0"><span class="t" style="display:flex;gap:10px;align-items:center">${readOnly?"":`<button class="check ${done?"on":""}" data-task="${x.id}" aria-label="${done?"Reopen":"Complete"} ${esc(x.title)}">${done?"✓":""}</button>`}<span style="${done?"text-decoration:line-through;color:var(--muted)":""}">${esc(x.title)}</span></span><span class="r">${x.status==="Doing"?`<span class="chip a">Doing</span>`:""}${pri}${dueChip}</span>${x.area||x.notes||x.goal?`<span class="s">${[x.area,x.goal&&goalTitle(x.goal)?"→ "+goalTitle(x.goal):"",x.notes?x.notes.slice(0,120):""].filter(Boolean).map(esc).join(" · ")}</span>`:""}</div>`;
}
function vTasks(){
  const t=todayISO(), f=ui.taskFilter||"Open";
  const open=data.tasks.filter(x=>x.status!=="Done");
  let groups;
  if(f==="Done"){ groups=[["Completed",data.tasks.filter(x=>x.status==="Done").sort((a,b)=>(b.completed||"").localeCompare(a.completed||""))]]; }
  else {
    const src=f==="Open"?open:open.filter(x=>x.area===f);
    const wkEnd=addDays(t,7);
    groups=[["Overdue",src.filter(x=>x.due&&x.due<t)],["Today",src.filter(x=>x.due===t)],["Next 7 days",src.filter(x=>x.due&&x.due>t&&x.due<=wkEnd)],["Later",src.filter(x=>x.due&&x.due>wkEnd)],["No date",src.filter(x=>!x.due)]].map(([k,v])=>[k,sortTasks(v)]).filter(g=>g[1].length);
  }
  const areas=[...new Set(open.map(x=>x.area).filter(Boolean))].sort();
  const dueN=tasksDue().length;
  return `<div class="sec-head"><h2>Tasks</h2><div style="display:flex;gap:10px;align-items:center">${dueN?`<span class="chip w num">${dueN} due</span>`:""}<span class="chip a num">${open.length} open</span>${addBtn("tasks","Add task",{status:"To do",priority:"Medium",due:t})}</div></div>
  ${quickAdd()}
  <div class="filters">${["Open",...areas,"Done"].map(x=>`<button data-filter="taskFilter" data-v="${esc(x)}" aria-pressed="${x===f}">${esc(x)}</button>`).join("")}</div>
  ${groups.length?groups.map(([k,v])=>`<h3 style="margin-top:16px${k==="Overdue"?";color:var(--bad)":""}">${k} · ${v.length}</h3><div class="list">${v.map(taskRow).join("")}</div>`).join(""):`<div class="list">${empty(f==="Done"?"Nothing completed yet":"No open tasks","Add a task with a due date and priority. Due and overdue tasks also show on Today.")}</div>`}`;
}
function wkRow(w,t){
  const on=(w.doneDates||[]).includes(t);
  return `<div class="row" data-edit="workouts" data-id="${w.id}" tabindex="0"><span class="t" style="display:flex;gap:10px;align-items:center">${readOnly?"":`<button class="check ${on?"on":""}" data-done="${w.id}" aria-label="Mark ${esc(w.title)} done today">${on?"✓":""}</button>`}${esc(w.title)}</span><span class="r">${w.time?`<span class="num">${esc(w.time)}</span>`:""}${w.type?`<span class="chip">${esc(w.type)}</span>`:""}</span>${w.details?`<span class="s">${esc(w.details)}</span>`:""}</div>`;
}
function vTraining(){
  const t=todayISO(), dn=todayDay();
  const tw=trainingWeek(), weekDates=tw.wd;
  return `<div class="sec-head"><h2>Training</h2><div style="display:flex;gap:10px;align-items:center"><span class="chip ${tw.planned&&tw.done>=tw.planned?"g":"a"} num">${tw.done}/${tw.planned} done this week</span>${addBtn("workouts","Add workout",{day:dn})}</div></div>
  <div class="week">${DAYS.map((d,i)=>{
    const ws=data.workouts.filter(w=>w.day===d).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
    const date=weekDates[i];
    return `<div class="day ${d===dn?"today":""}"><div class="dn"><span>${d}</span><span class="num">${fmtDate(date)}</span></div>
    ${ws.map(w=>{const on=(w.doneDates||[]).includes(date), missed=!on&&date<t&&w.type!=="Rest";return `<div class="wk ${on?"done":""}${missed?" missed":""}" data-edit="workouts" data-id="${w.id}" tabindex="0"><div style="display:flex;gap:6px;align-items:flex-start;justify-content:space-between"><span class="wt">${esc(w.title)}</span>${readOnly||date>t?"":`<button class="check ${on?"on":""}" data-done="${w.id}" data-date="${date}" aria-label="Mark done">${on?"✓":""}</button>`}</div><div class="wm">${[missed?"Missed":"",w.time,w.type,w.duration?w.duration+" min":""].filter(Boolean).map(esc).join(" · ")}</div></div>`;}).join("")}
    ${readOnly?"":`<button class="btn sm" data-add="workouts" data-preset='${esc(JSON.stringify({day:d}))}' style="margin-top:auto">+ Add</button>`}</div>`;
  }).join("")}</div>`;
}

function vlt(film){ const m=String(film||"").match(/(\d{1,2})\s*%/); if(!m) return esc(film||""); const p=Number(m[1]); const shade=Math.round(14+(p/100)*80); return `<span class="vlt"><i style="background:hsl(200 10% ${shade}%)"></i>${esc(film)}</span>`; }
const unpaidTints = () => data.tints.filter(a=>a.status==="Done");
const paidOn = a => (a.paidDate||a.when||"").slice(0,10);
const acctOf = a => a&&a.accountId ? data.accounts.find(x=>x.id===a.accountId) : null;
const clientOf = a => { const ac=acctOf(a); return ((ac&&ac.name)||a.client||"Unknown").trim(); };
const isFlat = a => divOf(a)!=="Automotive";
const sqLabel = a => Number(a.sqft)>0 ? `${Number(a.sqft).toLocaleString()} sq ft${(a.lines||[]).length>1?` · ${a.lines.length} films`:Number(a.rate)>0?` × ${money2(a.rate)}`:""}` : "";
const jobFilmLines = a => (a.lines&&a.lines.length) ? a.lines : (Number(a.sqft)>0||a.film ? [{filmId:"",film:a.film||"",area:"",sqft:Number(a.sqft)||0,rate:Number(a.rate)||0,amount:Number(a.price)||0}] : []);
const lastRate = (accountId, div) => { const j=data.tints.filter(a=>a.accountId===accountId&&divOf(a)===div&&Number(a.rate)>0).sort((x,y)=>(y.when||"").localeCompare(x.when||""))[0]; return j?j.rate:""; };
let modalRefresh = null;
function tintRow(a){
  const chip={Booked:"a",Confirmed:"a",Done:"w",Paid:"g",Cancelled:"b"}[a.status]||"a";
  const label=a.status==="Done"?"Unpaid":a.status==="Paid"&&a.paidDate?"Paid "+fmtDate(a.paidDate):(a.status||"Booked");
  const doneDay=(a.completedAt||a.when||"").slice(0,10);
  const age=a.status==="Done"&&doneDay?daysBetween(doneDay,todayISO()):0;
  const cb=(a.returns||[]).length;
  const canDone=["Booked","Confirmed"].includes(a.status||"Booked")&&a.when&&a.when.slice(0,10)<=todayISO();
  const inv=invById(a.invoiceId), ow=a.status==="Done"?rx().owedByJob[a.id]:undefined;
  const late=a.status==="Done"&&((inv&&invState(inv)==="Overdue")||age>7); // goal: paid within 7 days
  const owChip=ow!=null&&Math.abs(ow-r2(a.price))>0.004?`<span class="chip w num" title="Balance on ${esc(inv?inv.number||"the invoice":"the job")} after credits or payments">${money(ow)} due</span>`:"";
  return `<div class="row${late?" od":""}" data-job="${a.id}" tabindex="0"><span class="t">${esc(clientOf(a))}${a.job?` <span style="font-weight:400;color:var(--muted)">· ${esc(a.job)}</span>`:""}</span><span class="r">${a.price?`<span class="num">${money(a.price)}</span>`:""}${owChip}${cb?`<span class="chip b">${cb} comeback${cb>1?"s":""}</span>`:""}<span class="chip ${late?"b":chip}">${esc(label)}${age>0?` · ${age}d`:""}</span>${inv&&a.invoiceNumber?`<span class="chip">${esc(a.invoiceNumber)}</span>`:""}${readOnly?"":canDone?`<button class="btn sm" data-markdone="${a.id}">Done</button>`:a.status==="Done"?`<button class="btn sm" data-paid="${a.id}">Mark paid</button>`:""}</span><span class="s">${a.completedAt?`Completed ${esc(fmtDT(a.completedAt))}`:esc(fmtDT(a.when))}${a.service?" · "+esc(a.service):""}${a.vin?` · <span class="num">VIN ${esc(a.vin)}</span>`:""}${sqLabel(a)?" · "+esc(sqLabel(a)):""}${a.film?" · ":""}${vlt(a.film)}${a.notes?`<br>${esc(a.notes.replace(/\s*\n\s*/g," · ").slice(0,160))}`:""}</span></div>`;
}

// ----- job history sheet -----
function openJob(id){
  const close=()=>{ modalRefresh=null; $("#modal-root").innerHTML=""; };
  let cbOpen=false;
  const draw=()=>{
    const a=data.tints.find(x=>x.id===id); if(!a){ close(); return; }
    const ac=acctOf(a), returns=[...(a.returns||[])].sort((x,y)=>(x.at||"").localeCompare(y.at||""));
    const ev=[
      {t:a.created,l:"Booked"},
      {t:a.when,l:"Scheduled"},
      {t:a.completedAt,l:"Completed"+(a.tech?" by "+a.tech:""),c:"g"},
      {t:a.invoicedAt,l:"Invoiced"+(a.invoiceNumber?" "+a.invoiceNumber:"")},
      {t:a.paidDate,l:"Paid",c:"g"},
      ...returns.map(r=>({t:r.at,l:"Comeback: "+(r.issue||""),c:"b",sub:[r.work?"Work performed: "+r.work:"",r.type,r.charge?money2(r.charge):"",r.tech?"by "+r.tech:""].filter(Boolean).join(" · ")}))
    ].filter(e=>e.t).sort((x,y)=>tms(x.t)-tms(y.t));
    const st={Booked:"a",Confirmed:"a",Done:"w",Paid:"g",Cancelled:"b"}[a.status]||"a";
    const canDone=["Booked","Confirmed"].includes(a.status||"Booked");
    const mid=isFlat(a)?`<div class="stat"><div class="k">Area</div><div style="font-weight:600;margin-top:4px;font-size:14px">${Number(a.sqft)>0?esc(Number(a.sqft).toLocaleString())+" sq ft":"—"}${Number(a.rate)>0?`<div style="font-weight:400;color:var(--muted);font-size:13px">${money2(a.rate)} / sq ft</div>`:""}</div></div>`:`<div class="stat"><div class="k">Service</div><div style="font-weight:600;margin-top:4px;font-size:14px">${esc(a.service||"—")}</div></div>`;
    $("#modal-root").innerHTML=`<div class="ov" id="ov"><div class="sheet" id="jsheet" role="dialog" aria-label="Job history" style="max-width:600px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div style="min-width:0"><h2 style="margin-bottom:2px">${esc(a.job||a.service||"Job")}</h2>
      <div style="font-size:14px;color:var(--muted)">${ac?`<button class="btn sm" data-acct="${ac.id}" style="margin-right:6px">${esc(ac.name)}</button>${esc(ac.type||"")}`:esc(clientOf(a))}${" · "+esc(divOf(a))}${isFlat(a)&&a.service?" · "+esc(a.service):""}</div>${!isFlat(a)?`<div class="num" style="font-size:13px;margin-top:6px;user-select:all">${a.vin?"VIN "+esc(a.vin):`<span style="color:var(--muted)">No VIN on file. Tap Edit to add it.</span>`}</div>`:""}</div>
      <span class="chip ${st}">${esc(a.status==="Done"?"Done · unpaid":a.status||"Booked")}</span></div>
      <div class="stats" style="margin:14px 0 6px;grid-template-columns:repeat(3,minmax(0,1fr))"><div class="stat"><div class="k">Price</div><div class="v num" style="font-size:19px">${money(a.price)}</div>${(()=>{ const ow=a.status==="Done"?rx().owedByJob[a.id]:undefined; return ow!=null&&Math.abs(ow-r2(a.price))>0.004?`<div class="ss" style="color:var(--sun)">${money2(ow)} still due</div>`:""; })()}</div>${mid}<div class="stat"><div class="k">Film</div><div style="font-weight:600;margin-top:4px;font-size:14px">${a.film?vlt(a.film):"—"}</div></div></div>
      ${a.notes?`<div style="font-size:14px;white-space:pre-wrap;margin:8px 0 12px">${esc(a.notes)}</div>`:""}
      ${isFlat(a)&&jobFilmLines(a).length?`<h3 style="margin-top:14px">Films</h3><div class="list">${jobFilmLines(a).map(l=>`<div class="row" style="cursor:default"><span class="t">${esc(l.film||"Film")}${l.area?` <span style="font-weight:400;color:var(--muted)">· ${esc(l.area)}</span>`:""}</span><span class="r"><span class="num" style="font-weight:600">${money2(l.amount)}</span></span><span class="s num">${Number(l.sqft).toLocaleString()} sq ft × ${money2(l.rate)}/sf</span></div>`).join("")}</div>`:""}
      <h3 style="margin-top:14px">History</h3>
      <ol class="tl">${ev.map(e=>`<li class="${e.c||""}"><span class="num tlt">${esc(fmtDT(e.t))}</span><span class="tll">${esc(e.l)}</span>${e.sub?`<span class="tls">${esc(e.sub)}</span>`:""}</li>`).join("")}</ol>
      <form id="cb-form" ${cbOpen?"":"hidden"} novalidate class="panel" style="margin-top:12px">
        <h3>Log comeback</h3>
        <div class="frow"><div class="f"><label for="cb-at">Came back</label><input id="cb-at" type="datetime-local" value="${localDT(new Date())}"></div><div class="f"><label for="cb-type">Covered as</label><select id="cb-type"><option>Warranty</option><option>Goodwill</option><option>Billable</option></select></div></div>
        <div class="f"><label for="cb-issue">What came back *</label><input id="cb-issue" placeholder="Bubbling, peeling edge, contamination…"></div>
        <div class="f"><label for="cb-work">Work performed *</label><textarea id="cb-work" placeholder="Removed and re-applied, same film"></textarea></div>
        <div class="frow"><div class="f"><label for="cb-charge">Charge ($)</label><input id="cb-charge" type="number" step="any" inputmode="decimal" value="0"></div><div class="f"><label for="cb-tech">Done by</label><input id="cb-tech" value="${esc(a.tech||"")}"></div></div>
        <div class="ferr" id="cb-err" role="alert"></div>
        <div class="acts"><span></span><span class="rt"><button type="button" class="btn" id="cb-cancel">Cancel</button><button type="submit" class="btn primary">Save comeback</button></span></div>
      </form>
      <div class="ferr" id="j-err" role="alert"></div>
      <div class="acts">${readOnly?"<span></span>":`<span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="j-edit">Edit</button>${a.status!=="Cancelled"&&!cbOpen?`<button class="btn" id="j-cb">Log comeback</button>`:""}</span>`}
      <span class="rt"><button class="btn" id="j-close">Close</button>${readOnly?"":canDone?`<button class="btn primary" id="j-done">Mark done now</button>`:a.status==="Done"?`<button class="btn primary" id="j-paid">Mark paid</button>`:""}</span></div>
    </div></div>`;
    const ov=$("#ov"); ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    $("#jsheet").addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
    $("#j-close").onclick=close;
    const err=$("#j-err");
    const ed=$("#j-edit"); if(ed) ed.onclick=()=>openForm(DIV[divOf(a)].schema,a);
    const cbb=$("#j-cb"); if(cbb) cbb.onclick=()=>{ cbOpen=true; draw(); $("#cb-issue").focus(); };
    const cbc=$("#cb-cancel"); if(cbc) cbc.onclick=()=>{ cbOpen=false; draw(); };
    const dn=$("#j-done"); if(dn) dn.onclick=async()=>{ dn.disabled=true; try{ await db.collection("tints").doc(a.id).update({status:"Done",completedAt:localDT(new Date()),updated:new Date().toISOString()}); }catch(e){ dn.disabled=false; err.textContent="Couldn't mark it done. Try again."; } };
    const pd=$("#j-paid"); if(pd) pd.onclick=async()=>{ pd.disabled=true; try{ await db.collection("tints").doc(a.id).update({status:"Paid",paidDate:todayISO(),updated:new Date().toISOString()}); await syncInvoiceAfterJobPaid([a.id]); }catch(e){ pd.disabled=false; err.textContent="Couldn't mark it paid. Try again."; } };
    const cf=$("#cb-form"); cf.addEventListener("submit",async e=>{
      e.preventDefault(); const ce=$("#cb-err");
      const r={id:Date.now().toString(36),at:$("#cb-at").value||localDT(new Date()),type:$("#cb-type").value,issue:$("#cb-issue").value.trim(),work:$("#cb-work").value.trim(),charge:Number($("#cb-charge").value)||0,tech:$("#cb-tech").value.trim()};
      if(!r.issue||!r.work){ ce.textContent="Fill in what came back and the work performed."; return; }
      const list=[...(a.returns||[]),r].slice(-50);
      try{ await db.collection("tints").doc(a.id).update({returns:list,updated:new Date().toISOString()}); cbOpen=false; draw(); }
      catch(ex){ ce.textContent="Couldn't save the comeback ("+(ex.code||"error")+"). Try again."; }
    });
  };
  modalRefresh=()=>{ if(!cbOpen) draw(); };
  draw();
}

// ----- account sheet -----
function acctStats(ac){
  const jobs=data.tints.filter(a=>a.accountId===ac.id);
  const open=jobs.filter(a=>a.status==="Done");
  const paid=jobs.filter(a=>a.status==="Paid");
  const done=jobs.filter(a=>a.status==="Done"||a.status==="Paid");
  const cbs=jobs.reduce((s,a)=>s+(a.returns||[]).length,0);
  const sq=done.reduce((s,a)=>s+(Number(a.sqft)||0),0);
  const last=jobs.reduce((m,a)=>{ const d=(a.completedAt||a.when||""); return d>m?d:m; },"");
  const ids=new Set(jobs.map(a=>a.id));
  const openTot=r2(rx().items.filter(it=>it.jobs.some(j=>ids.has(j.id))||(it.inv&&it.inv.accountId===ac.id)).reduce((s,it)=>s+it.amount,0));
  return {jobs,open,openTot,paidTot:paid.reduce((s,a)=>s+Number(a.price||0),0),done:done.length,cbs,sq,last};
}
function openAccount(id){
  const close=()=>{ modalRefresh=null; $("#modal-root").innerHTML=""; };
  const draw=()=>{
    const ac=data.accounts.find(x=>x.id===id); if(!ac){ close(); return; }
    const div=divOf(ac), D=DIV[div];
    const s=acctStats(ac), jobs=[...s.jobs].sort((x,y)=>(y.completedAt||y.when||"").localeCompare(x.completedAt||x.when||""));
    const contact=[ac.contact,ac.phone,ac.email].filter(Boolean);
    $("#modal-root").innerHTML=`<div class="ov" id="ov"><div class="sheet" id="asheet" role="dialog" aria-label="Account" style="max-width:640px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><h2 style="margin-bottom:2px">${esc(ac.name)}</h2><div style="font-size:14px;color:var(--muted)">${esc(div)} · ${esc(ac.type||"Account")}${ac.terms?` · Net ${esc(ac.terms)}`:""}</div></div>${readOnly?"":`<button class="btn sm" id="a-edit">Edit</button>`}</div>
      ${contact.length||ac.address?`<div style="font-size:14px;margin-top:10px;user-select:text">${contact.map(esc).join(" · ")}${ac.address?`<br><span style="color:var(--muted)">${esc(ac.address).replace(/\n/g,", ")}</span>`:""}</div>`:""}
      <div class="stats" style="margin:14px 0;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
        <div class="stat"><div class="k">Open balance</div><div class="v num" style="font-size:20px;${s.openTot?"color:var(--sun)":""}">${money(s.openTot)}</div></div>
        <div class="stat"><div class="k">Paid to date</div><div class="v num" style="font-size:20px">${money(s.paidTot)}</div></div>
        <div class="stat"><div class="k">${s.sq?"Sq ft installed":"Jobs done"}</div><div class="v num" style="font-size:20px">${s.sq?s.sq.toLocaleString():s.done}</div></div>
        <div class="stat"><div class="k">Comebacks</div><div class="v num" style="font-size:20px;${s.cbs?"color:var(--bad)":""}">${s.cbs}${s.done?`<span style="font:500 12px var(--f-mono);color:var(--muted)"> · ${Math.round(s.cbs/s.done*100)}%</span>`:""}</div></div>
      </div>
      ${ac.rates?`<div class="panel" style="margin-bottom:12px"><h3>Agreed rates</h3><div style="font-size:14px;white-space:pre-wrap">${esc(ac.rates)}</div></div>`:""}
      ${ac.notes?`<div style="font-size:14px;color:var(--muted);white-space:pre-wrap;margin-bottom:12px">${esc(ac.notes)}</div>`:""}
      <h3>Jobs</h3><div class="list">${jobs.length?jobs.map(tintRow).join(""):empty("No jobs yet","Book this account's first job.")}</div>
      <div class="acts" style="margin-top:14px"><span>${readOnly?"":`<button class="btn" id="a-book">Book job</button>`}</span><span class="rt"><button class="btn" id="a-close">Close</button>${!readOnly&&s.open.some(a=>!invById(a.invoiceId))?`<button class="btn primary" data-invoice-client="${esc(ac.name)}" data-div="${esc(div)}">Invoice open jobs</button>`:""}</span></div>
    </div></div>`;
    const ov=$("#ov"); ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    $("#asheet").addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
    $("#a-close").onclick=close;
    const ed=$("#a-edit"); if(ed) ed.onclick=()=>openForm("accounts",ac);
    const bk=$("#a-book"); if(bk) bk.onclick=()=>openForm(D.schema,null,{division:div,accountId:ac.id,status:"Booked",service:D.services[0],when:localDT(new Date()),rate:lastRate(ac.id,div)});
  };
  modalRefresh=draw;
  draw();
}

function vDiv(div){
  const t=todayISO(), D=DIV[div], flat=div!=="Automotive", K="v_"+div, F="f_"+div;
  const view=ui[K]||"Jobs";
  const DSEG=[["auto","Automotive","Automotive"],["res","Residential","Residential"],["com","Commercial","Commercial"]];
  const head=`<div class="sec-head"><h2>Jobs</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${addBtn("accounts","Add account",{division:div,type:D.acctTypes[0],terms:flat?15:7})}${flat&&!readOnly?`<button class="btn" data-films>Film prices</button>`:""}${addBtn(D.schema,"Book job",{division:div,status:"Booked",service:D.services[0]})}</div></div>
  <nav class="seg" aria-label="Division">${DSEG.map(([h,l,d])=>`<a href="#${h}" ${d===div?'aria-current="page"':""}>${l}</a>`).join("")}</nav>
  <div class="seg sm" role="group" aria-label="View">${["Jobs","Accounts"].map(x=>`<button data-filter="${K}" data-v="${x}" aria-pressed="${x===view}">${x}</button>`).join("")}</div>`;
  const jobsAll=data.tints.filter(a=>divOf(a)===div);
  if(view==="Accounts"){
    const accts=data.accounts.filter(ac=>divOf(ac)===div).map(ac=>({ac,s:acctStats(ac)})).sort((x,y)=>y.s.openTot-x.s.openTot||(x.ac.name||"").localeCompare(y.ac.name||""));
    const retail=jobsAll.filter(a=>!a.accountId);
    return head+`<div class="list">${accts.length?accts.map(({ac,s})=>`<div class="row" data-acct="${ac.id}" tabindex="0"><span class="t">${esc(ac.name)} <span class="chip">${esc(ac.type||"Account")}</span></span><span class="r">${s.openTot?`<span class="chip w num">${money(s.openTot)} open</span>`:`<span class="chip g">Paid up</span>`}${s.cbs?`<span class="chip b">${s.cbs} comeback${s.cbs>1?"s":""}</span>`:""}</span><span class="s">${s.done} job${s.done===1?"":"s"} done${s.sq?" · "+s.sq.toLocaleString()+" sq ft":""} · ${money(s.paidTot)} paid${s.last?" · last job "+fmtDate(s.last):""}${ac.contact||ac.phone?" · "+esc([ac.contact,ac.phone].filter(Boolean).join(", ")):""}</span></div>`).join(""):empty("No "+div.toLowerCase()+" accounts yet",D.emptyAcct)}</div>
    ${retail.length?`<p style="font-size:13px;color:var(--muted);margin-top:10px">${retail.length} job${retail.length===1?"":"s"} aren't tied to an account.</p>`:""}`;
  }
  const f=ui[F]||"Upcoming";
  const up=jobsAll.filter(a=>a.when&&a.when.slice(0,10)>=t&&!["Cancelled","Done","Paid"].includes(a.status)).sort((a,b)=>a.when.localeCompare(b.when));
  let rows=[...jobsAll];
  if(f==="Upcoming") rows=up;
  else if(f==="Past") rows=rows.filter(a=>a.when&&a.when.slice(0,10)<t).sort((a,b)=>(b.completedAt||b.when).localeCompare(a.completedAt||a.when));
  else if(f==="Unpaid") rows=rows.filter(a=>a.status==="Done").sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  else if(f==="Comebacks") rows=rows.filter(a=>(a.returns||[]).length).sort((a,b)=>((b.returns||[]).slice(-1)[0].at||"").localeCompare((a.returns||[]).slice(-1)[0].at||""));
  else rows.sort((a,b)=>(b.when||"").localeCompare(a.when||""));
  const mk=monthKey(t);
  const rev=collectedIn(mk,div);
  const booked=up.reduce((s,a)=>s+Number(a.price||0),0);
  const dItems=rx().items.filter(it=>it.div===div), unTotal=r2(dItems.reduce((s,it)=>s+it.amount,0)), unCount=dItems.reduce((s,it)=>s+unitsOf(it),0);
  const cb90=jobsAll.reduce((s,a)=>s+(a.returns||[]).filter(r=>r.at&&r.at.slice(0,10)>=addDays(t,-90)).length,0);
  const doneMonth=jobsAll.filter(a=>(a.status==="Done"||a.status==="Paid")&&monthKey(a.completedAt||a.when)===mk);
  const sqMonth=doneMonth.reduce((s,a)=>s+(Number(a.sqft)||0),0), valMonth=doneMonth.filter(a=>Number(a.sqft)>0).reduce((s,a)=>s+Number(a.price||0),0);
  const byClient={}; dItems.forEach(it=>{ (byClient[it.client]=byClient[it.client]||[]).push(it); });
  const clients=Object.entries(byClient).map(([k,v])=>{ const j0=v.flatMap(it=>it.jobs)[0]; const ac=(j0&&acctOf(j0))||data.accounts.find(x=>(x.name||"").trim()===k)||null;
    return {k,v,ac,n:v.reduce((s,it)=>s+unitsOf(it),0),od:v.some(it=>it.state==="Overdue"),tot:r2(v.reduce((s,it)=>s+it.amount,0)),oldest:v.reduce((m,it)=>it.date&&it.date<m?it.date:m,"9999")}; }).sort((a,b)=>b.tot-a.tot);
  const itemHtml=it=>{ if(it.kind==="job"){ const a=it.jobs[0]; return `<span data-job="${a.id}" tabindex="0" style="cursor:pointer">${esc((a.job||"Job")+" "+money(it.amount))}</span> <span class="chip w">Not invoiced</span>`; }
    const un=it.jobs.filter(j=>j.status==="Done"), gross=r2(un.reduce((s,j)=>s+(Number(j.price)||0),0)), names=(un.length?un:it.jobs).map(j=>j.job||"Job").join(", ")||"Invoice";
    return `${esc(names+" "+money(it.amount))}${un.length&&Math.abs(gross-it.amount)>0.004?` <span style="color:var(--muted)">(of ${esc(money(gross))})</span>`:""} <span class="chip ${it.state==="Overdue"?"b":it.state==="Draft"?"":""}" data-edit="money" data-id="${it.inv.id}" tabindex="0" style="cursor:pointer" title="Open invoice">${esc(it.inv.number||"Invoice")}${it.state!=="Sent"?" · "+esc(it.state):""}</span>`; };
  return head+`<div class="stats"><div class="stat"><div class="k">Unpaid</div><div class="v num" style="${unTotal?"color:var(--sun)":""}">${money(unTotal)}<span style="font:500 13px var(--f-mono);color:var(--muted)"> · ${unCount} job${unCount===1?"":"s"}</span></div></div><div class="stat"><div class="k">Booked ahead</div><div class="v num">${money(booked)}</div></div><div class="stat"><div class="k">Collected this month</div><div class="v num">${money(rev)}</div></div>${flat?`<div class="stat"><div class="k">Sq ft installed · month</div><div class="v num">${sqMonth.toLocaleString()}${sqMonth?`<span style="font:500 13px var(--f-mono);color:var(--muted)"> · avg ${money2(valMonth/sqMonth)}/sf</span>`:""}</div></div>`:""}<div class="stat"><div class="k">Comebacks · 90 days</div><div class="v num" style="${cb90?"color:var(--bad)":""}">${cb90}</div></div></div>
  ${clients.length?`<section class="panel" style="margin-bottom:16px"><h3>Who owes you</h3>${clients.map(c=>`<div class="brow" style="cursor:default"><div class="l"><span>${c.ac?`<button class="btn sm" data-acct="${c.ac.id}" style="font-weight:600">${esc(c.k)}</button>`:`<b>${esc(c.k)}</b>`} <span style="color:var(--muted);font-size:13px">${c.n} job${c.n===1?"":"s"}${c.oldest<"9999"?" · oldest "+fmtDate(c.oldest):""}${c.od?` · <span style="color:var(--bad)">overdue</span>`:""}</span></span><span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end"><span class="num" style="font-weight:600">${money(c.tot)}</span>${readOnly?"":`${c.v.some(it=>it.kind==="job")?`<button class="btn sm primary" data-invoice-client="${esc(c.k)}" data-div="${esc(div)}">Invoice</button>`:""}<button class="btn sm" data-paid-client="${esc(c.k)}" data-div="${esc(div)}">Mark all paid</button>`}</span></div><div style="font-size:13px;color:var(--muted);margin-top:4px">${c.v.map(itemHtml).join(" · ")}</div></div>`).join("")}</section>`:""}
  <div class="filters">${["Upcoming","Unpaid","Past","Comebacks","All"].map(x=>`<button data-filter="${F}" data-v="${x}" aria-pressed="${x===f}">${x}</button>`).join("")}</div>
  <div class="list">${rows.length?rows.map(tintRow).join(""):empty(f==="Upcoming"?"No upcoming jobs":f==="Comebacks"?"No comebacks logged":"Nothing here",D.emptyJobs)}</div>`;
}
const vAuto=()=>vDiv("Automotive"), vRes=()=>vDiv("Residential"), vCom=()=>vDiv("Commercial");

function personRow(p){
  const d=due(p);
  const chip=d.state==="never"?`<span class="chip w">No contact logged</span>`:d.state==="over"?`<span class="chip b">${-d.days}d overdue</span>`:d.state==="soon"?`<span class="chip w">${d.days?`Due in ${d.days}d`:"Due today"}</span>`:`<span class="chip g" title="Next check-in in ${d.days} days">Next in ${d.days}d</span>`;
  return `<div class="row${d.state==="over"?" od":""}" data-edit="people" data-id="${p.id}" tabindex="0"><span class="t">${esc(p.name)}${p.circle?` <span class="chip">${esc(p.circle)}</span>`:""}</span><span class="r">${chip}${readOnly?"":`<button class="btn sm" data-checkin="${p.id}">Checked in</button>`}</span><span class="s">${p.how?"Doing: "+esc(p.how):""}${p.how&&p.next?" · ":""}${p.next?"Ask about: "+esc(p.next):""}${!p.how&&!p.next&&p.last?"Last talked "+fmtDate(p.last):""}</span></div>`;
}
function vPeople(){
  const rows=data.people.map(p=>({p,d:due(p)})).sort((a,b)=>a.d.days-b.d.days);
  const dueRows=rows.filter(x=>x.d.state!=="ok").map(x=>x.p), okRows=rows.filter(x=>x.d.state==="ok").map(x=>x.p);
  return `<div class="sec-head"><h2>People</h2><div style="display:flex;gap:10px;align-items:center">${rows.length?`<span class="chip ${dueRows.length?"w":"g"} num">${dueRows.length} due · ${rows.length} total</span>`:""}${addBtn("people","Add person",{cadence:"30",last:todayISO()})}</div></div>
  ${rows.length?`${dueRows.length?`<h3>Check in now · ${dueRows.length}</h3><div class="list" style="margin-bottom:16px">${dueRows.map(personRow).join("")}</div>`:""}${okRows.length?`<h3>Up to date · ${okRows.length}</h3><div class="list">${okRows.map(personRow).join("")}</div>`:""}`:`<div class="list">${empty("No one tracked yet","Add someone, pick how often to check in, and they'll surface on Today when it's time.")}</div>`}`;
}

function moneyRow(m){
  const st=invState(m);
  const chip=m.kind==="Invoice"?`<span class="chip ${st==="Paid"?"g":st==="Overdue"?"b":st==="Sent"?"w":""}">${esc(st)}</span>`:`<span class="chip ${m.kind==="Income"?"g":""}">${esc(m.kind)}</span>`;
  const sign=m.kind==="Expense"?"−":"";
  return `<div class="row${st==="Overdue"?" od":""}" data-edit="money" data-id="${m.id}" tabindex="0"><span class="t">${m.number?`<span class="num" style="color:var(--muted);font-weight:500">${esc(m.number)}</span> `:""}${esc(m.party)}</span><span class="r"><span class="num">${sign}${money(m.amount)}</span>${chip}${m.kind==="Invoice"&&st!=="Paid"&&!readOnly?`<button class="btn sm" data-invpaid="${m.id}">Mark paid</button>`:""}</span><span class="s">${[m.entity,m.category,fmtDate(m.date),m.kind==="Invoice"&&m.due?"due "+fmtDate(m.due):""].filter(Boolean).map(esc).join(" · ")}</span></div>`;
}
function vMoney(){
  const mk=monthKey(todayISO()), f=ui.moneyFilter;
  let rows=[...data.money].sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  if(f==="Invoices") rows=rows.filter(m=>m.kind==="Invoice");
  if(f==="Expenses") rows=rows.filter(m=>m.kind==="Expense");
  if(f==="Income") rows=rows.filter(m=>m.kind==="Income"||(m.kind==="Invoice"&&m.status==="Paid"));
  const spentBy={}; data.money.filter(m=>m.kind==="Expense"&&monthKey(m.date)===mk).forEach(m=>{const c=(m.category||"Uncategorized").trim();spentBy[c.toLowerCase()]=(spentBy[c.toLowerCase()]||0)+Number(m.amount||0);});
  const budgets=[...data.budgets].sort((a,b)=>(a.category||"").localeCompare(b.category||""));
  const monthName=new Date().toLocaleDateString("en-US",{month:"long"});
  return `<div class="sec-head"><h2>Money</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${readOnly?"":`<button class="btn" data-settings>Invoice settings</button><button class="btn" data-newinv>New invoice</button>`}${addBtn("budgets","Set budget")}${addBtn("money","Add entry",{kind:"Invoice",status:"Draft",date:todayISO(),due:addDays(todayISO(),Number(invSettings().terms)||7)})}</div></div>
  <nav class="seg" aria-label="Money">${[["invoices","Invoices"],["money","Budget & ledger"]].map(([h,l])=>`<a href="#${h}" ${route()===h?'aria-current="page"':""}>${esc(l)}</a>`).join("")}</nav>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start">
    <section class="panel"><h3>${monthName} budget</h3>${budgets.length?budgets.map(b=>{const s=spentBy[(b.category||"").trim().toLowerCase()]||0,l=Number(b.limit||0),p=l?Math.min(100,s/l*100):0;return `<div class="brow" data-edit="budgets" data-id="${b.id}" tabindex="0"><div class="l"><span>${esc(b.category)}</span><span class="num">${money(s)} / ${money(l)}</span></div><div class="bar"><i class="${s>l?"over":""}" style="width:${p}%"></i></div></div>`;}).join(""):empty("No budgets set","Add a category and monthly limit. Expenses with the same category count against it.")}</section>
    <section style="min-width:0"><div class="filters">${["All","Invoices","Expenses","Income"].map(x=>`<button data-filter="moneyFilter" data-v="${x}" aria-pressed="${x===f}">${x}</button>`).join("")}</div>
    <div class="list">${rows.length?rows.map(moneyRow).join(""):empty("No entries yet","Log invoices, expenses and income. Overdue invoices flag automatically.")}</div></section>
  </div>`;
}

const dots = s => { const n=Math.max(0,Math.min(5,Math.round(Number(s)||0))); return "●".repeat(n)+"○".repeat(5-n); };
function ideaRow(i){ return `<div class="row" data-edit="ideas" data-id="${i.id}" tabindex="0"><span class="t">${esc(i.title)}</span><span class="r">${i.score?`<span class="score">${dots(i.score)}</span>`:""}${i.area?`<span class="chip a">${esc(i.area)}</span>`:""}</span>${i.notes?`<span class="s">${esc(i.notes.slice(0,140))}</span>`:""}</div>`; }
function vIdeas(){
  const stages=["Raw","Exploring","Building","Parked"];
  return `<div class="sec-head"><h2>Ideas</h2>${addBtn("ideas","Capture idea",{stage:"Raw",score:"3"})}</div>
  ${data.ideas.length?`<div class="cols">${stages.map(st=>{const xs=data.ideas.filter(i=>(i.stage||"Raw")===st).sort((a,b)=>(b.score||0)-(a.score||0));return `<div class="col"><h3>${st} · ${xs.length}</h3>${xs.map(i=>`<div class="card" data-edit="ideas" data-id="${i.id}" tabindex="0"><div class="body"><span style="font-weight:600">${esc(i.title)}</span><span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${i.area?`<span class="chip a">${esc(i.area)}</span>`:""}${i.score?`<span class="score">${dots(i.score)}</span>`:""}</span>${i.notes?`<span style="font-size:13px;color:var(--muted)">${esc(i.notes.slice(0,120))}</span>`:""}</div></div>`).join("")}</div>`;}).join("")}</div>`:`<div class="list">${empty("No ideas yet","Capture it raw. Score conviction 1–5 and move it through stages.")}</div>`}`;
}

function vDesigns(){
  const rows=[...data.designs].sort((a,b)=>(b.updated||"").localeCompare(a.updated||""));
  return `<div class="sec-head"><h2>Designs</h2>${addBtn("designs","Add design",{status:"Concept"})}</div>
  ${rows.length?`<div class="cards">${rows.map(d=>`<div class="card" data-edit="designs" data-id="${d.id}" tabindex="0"><div class="img">${d.image?`<img data-asset="${esc(d.image)}" alt="${esc(d.title)}">`:"No image"}</div><div class="body"><span style="font-weight:600">${esc(d.title)}</span><span style="display:flex;gap:6px;flex-wrap:wrap">${d.project?`<span class="chip">${esc(d.project)}</span>`:""}<span class="chip ${d.status==="Final"?"g":d.status==="In progress"?"w":"a"}">${esc(d.status||"Concept")}</span></span>${d.link?`<a href="${esc(d.link)}" target="_blank" rel="noopener" style="font-size:13px;color:var(--accent);overflow-wrap:anywhere" data-stop>Open link ↗</a>`:""}</div></div>`).join("")}</div>`:`<div class="list">${empty("No designs yet","Save mockups, logos and references with an image or a Figma/Canva link.")}</div>`}`;
}
function hydrateImages(){ document.querySelectorAll("img[data-asset]").forEach(img=>{ const id=img.dataset.asset; if(assets&&assets.url) assets.url(id).then(u=>{ if(u) img.src=u; else img.replaceWith(Object.assign(document.createElement("span"),{textContent:"Image not on this device"})); }); else img.src="/_blob/"+id; }); }


// ---------- More ----------
function vMore(){
  const C=counts(), R=C.R, tw=C.tw, mk=monthKey(todayISO());
  const active=data.goals.filter(g=>g.status==="Active").length, hrs=data.blocks.reduce((s,b)=>s+blockMins(b),0)/60;
  const divSub=d=>{ const un=R.items.filter(i=>i.div===d).reduce((s,i)=>s+i.amount,0), up=C.up.filter(a=>divOf(a)===d).length; return [up?`${up} upcoming`:"",un?`${money(un)} unpaid`:"",!up&&!un?`${data.tints.filter(a=>divOf(a)===d).length} jobs`:""].filter(Boolean).join(" · "); };
  const meta=window.LHQ?LHQ.meta():{}, lb=meta.lastBackupAt?Math.floor((Date.now()-new Date(meta.lastBackupAt))/864e5):null;
  const row=(href,ic,label,sub,c)=>`${href.startsWith("#")?`<a class="mrow" href="${href}">`:`<button class="mrow" ${href}>`}<span class="mic" style="background:${HUE[ic]||HUE.today}">${svg({auto:"jobs",res:"house",com:"building"}[ic]||ic)}</span><span class="ml"><b>${label}</b><small>${esc(sub)}</small></span>${badge(c)}${svg("chev","chev")}${href.startsWith("#")?"</a>":"</button>"}`;
  return `<div class="sec-head"><h2>More</h2></div>
  <h3>Life</h3><div class="mlist">
    ${row("#plan","plan","Plan",`${active} active goal${active===1?"":"s"} · ${hrs.toFixed(hrs%1?1:0)} h a week`)}
    ${row("#training","training","Training",`${tw.done} of ${tw.planned} done this week`,C.training)}
    ${row("#people","people","People",`${C.pd.length} due · ${data.people.length} total`,C.people)}
    ${row("#ideas","ideas","Ideas",`${data.ideas.length} idea${data.ideas.length===1?"":"s"}`)}
    ${row("#designs","designs","Designs",`${data.designs.length} saved`)}
  </div>
  <h3>PerformCore</h3><div class="mlist">
    ${row("#auto","auto","Automotive",divSub("Automotive"),C.auto)}
    ${row("#res","res","Residential",divSub("Residential"),C.res)}
    ${row("#com","com","Commercial",divSub("Commercial"),C.com)}
    ${row("#invoices","invoices","Invoices",`${money(R.sent)} open · ${money(collectedIn(mk))} collected this month`,C.invoices)}
    ${row("#money","ledger","Budget & ledger",`${data.budgets.length} budget${data.budgets.length===1?"":"s"} · ${data.money.filter(m=>m.kind!=="Invoice").length} entries`)}
    ${readOnly?"":row("data-films","film","Film prices",`${data.films.length} film${data.films.length===1?"":"s"} · price per sq ft`)}
    ${readOnly?"":row("data-settings","settings","Invoice settings","Business details and payment instructions")}
  </div>
  <h3>Your data</h3><div class="mlist">
    ${row("data-backup","backup","Backup &amp; shortcuts",lb==null?"No backup yet. Everything lives on this phone.":`Last backup ${lb===0?"today":lb+" day"+(lb===1?"":"s")+" ago"}`,lb==null||lb>=7?["!",true,"backup due"]:null)}
  </div>
  <p style="text-align:center;color:var(--faint);font-size:12.5px;margin:18px 0 0">Life HQ · saved on this device${window.LHQ?" ("+esc(LHQ.mode)+")":""}</p>`;
}

// ---------- invoices tab ----------
const invoicesAll=()=>data.money.filter(m=>m.kind==="Invoice");
const invVehicles=m=>(m.jobIds||[]).map(id=>data.tints.find(x=>x.id===id)).filter(Boolean);
const invSearchText=m=>[m.number,m.party,...(m.lines||[]).map(l=>l.desc+" "+(l.vin||"")),...invVehicles(m).map(j=>(j.job||"")+" "+(j.vin||""))].join(" ").toLowerCase();
function invRows(){
  const f=ui.invFilter, q=(ui.invQ||"").trim().toLowerCase();
  let xs=invoicesAll();
  if(f==="Open") xs=xs.filter(m=>isOpenInv(m)); // matches the Open total above
  if(f==="Drafts") xs=xs.filter(m=>invState(m)==="Draft");
  if(f==="Overdue") xs=xs.filter(m=>invState(m)==="Overdue");
  if(f==="Paid") xs=xs.filter(m=>invState(m)==="Paid");
  if(q) xs=xs.filter(m=>invSearchText(m).includes(q));
  return xs.sort((a,b)=>String(b.number||"").localeCompare(String(a.number||""),undefined,{numeric:true}));
}
function invRow(m){
  const st=invState(m), chip=st==="Paid"?"g":st==="Overdue"?"b":st==="Sent"?"w":"";
  const first=(m.lines||[]).find(l=>Number(l.amount)>=0)||{}, vin=(m.lines||[]).map(l=>l.vin).find(Boolean)||(invVehicles(m)[0]||{}).vin||"";
  const what=String(first.desc||"").split(" · ")[0].split(" — ")[0];
  return `<div class="row${st==="Overdue"?" od":""}" data-edit="money" data-id="${m.id}" tabindex="0"><span class="t"><span class="num" style="color:var(--muted);font-weight:500">${esc(m.number||"No #")}</span> ${esc(m.party)}${what?` <span style="font-weight:400;color:var(--muted)">· ${esc(what)}</span>`:""}</span><span class="r"><span class="num" style="font-weight:600">${money2(m.amount)}</span><span class="chip ${chip}">${esc(st)}</span><button class="btn sm" data-invpdf="${m.id}" aria-label="Download ${esc(m.number||"invoice")} as PDF">PDF</button>${st!=="Paid"&&!readOnly?`<button class="btn sm" data-invpaid="${m.id}">Mark paid</button>`:""}</span><span class="s">${[fmtLong(m.date)?"Issued "+fmtLong(m.date):"",st==="Paid"?(m.paidDate?"paid "+fmtLong(m.paidDate):"paid"):(m.due?"due "+fmtLong(m.due):""),m.division||m.category].filter(Boolean).map(esc).join(" · ")}${vin?` · <span class="num">VIN ${esc(vin)}</span>`:""}</span></div>`;
}
const invListHtml=()=>{ const xs=invRows(); return xs.length?xs.map(invRow).join(""):empty(ui.invQ?"No invoices match":"No invoices here",ui.invQ?"Try a client, invoice number, vehicle or VIN.":"Invoice a finished job from Automotive, Residential or Commercial, or tap New invoice."); };
function vInvoices(){
  const all=invoicesAll(), open=rx().openInv, over=open.filter(m=>invState(m)==="Overdue"), drafts=all.filter(m=>invState(m)==="Draft");
  const issues=dataIssues();
  const mk=monthKey(todayISO()), paidMonth=all.filter(m=>invState(m)==="Paid"&&monthKey(m.paidDate||m.date)===mk);
  return `<div class="sec-head"><h2>Money</h2><div style="display:flex;gap:8px;flex-wrap:wrap">${readOnly?"":`<button class="btn" data-settings>Invoice settings</button><button class="btn primary" data-newinv>New invoice</button>`}</div></div>
  <nav class="seg" aria-label="Money">${[["invoices","Invoices"],["money","Budget & ledger"]].map(([h,l])=>`<a href="#${h}" ${route()===h?'aria-current="page"':""}>${esc(l)}</a>`).join("")}</nav>
  <div class="stats"><div class="stat"><div class="k">Open</div><div class="v num" style="${open.length?"color:var(--sun)":""}">${money2(open.reduce((s,m)=>s+Number(m.amount||0),0))}<span style="font:500 13px var(--f-mono);color:var(--muted)"> · ${open.length}</span></div></div><div class="stat"><div class="k">Overdue</div><div class="v num" style="${over.length?"color:var(--bad)":""}">${money2(over.reduce((s,m)=>s+Number(m.amount||0),0))}<span style="font:500 13px var(--f-mono);color:var(--muted)"> · ${over.length}</span></div></div><div class="stat"><div class="k">Paid this month</div><div class="v num">${money2(paidMonth.reduce((s,m)=>s+Number(m.amount||0),0))}</div></div></div>
  ${(()=>{ const fixes=issues.filter(x=>x.sev!=="info"), notes=issues.filter(x=>x.sev==="info");
    const fixRow=x=>`<div class="brow" style="cursor:default"><div class="l"><span style="font-size:14px">⚠ ${esc(x.msg)}</span>${!readOnly&&x.fix?`<button class="btn sm" data-fix="${x.fix}" data-id="${esc(x.id)}">${x.fix==="jobpaid"?"Mark job paid":x.fix==="invpaid"?"Mark invoice paid":"Unlink"}</button>`:""}</div></div>`;
    const noteRow=x=>`<div class="brow" data-edit="money" data-id="${esc(x.id)}" tabindex="0"><div class="l"><span style="font-size:13px;color:var(--muted)">${esc(x.msg)}</span><span class="chip">Open</span></div></div>`;
    return (fixes.length?`<section class="panel" style="margin-bottom:16px;border-color:var(--sun);background:var(--sun-soft)"><h3 style="color:var(--ink)">Needs a look · ${fixes.length}</h3>${fixes.slice(0,12).map(fixRow).join("")}</section>`:"")
      +(notes.length?`<details class="panel" style="margin-bottom:16px;padding:10px 16px"><summary style="cursor:pointer;font-size:13px;color:var(--muted)">${notes.length} invoice${notes.length===1?"":"s"} bill${notes.length===1?"s":""} a different amount than the job price (deposits, discounts or edits). Totals use the invoice.</summary>${notes.slice(0,20).map(noteRow).join("")}</details>`:""); })()}
  <div class="f" style="max-width:420px"><label for="inv-search">Find an invoice</label><input id="inv-search" type="search" value="${esc(ui.invQ||"")}" placeholder="Client, invoice #, vehicle or VIN" autocomplete="off"></div>
  <div class="filters">${["Open","Overdue",...(drafts.length?["Drafts"]:[]),"Paid","All"].map(x=>`<button data-filter="invFilter" data-v="${x}" aria-pressed="${x===ui.invFilter}">${x}</button>`).join("")}</div>
  <div class="list" id="inv-list">${invListHtml()}</div>
  <p style="font-size:13px;color:var(--muted);margin-top:10px">PDF saves the invoice in the PerformCore design. Tap a row to edit it or record a payment. Open is what's still due after deposits and payments, the same number as Owed to you on Today${drafts.length?` (plus ${money2(drafts.reduce((s,m)=>s+Number(m.amount||0),0))} in drafts)`:""}.</p>`;
}
document.addEventListener("input",e=>{ if(e.target&&e.target.id==="inv-search"){ ui.invQ=e.target.value; const l=$("#inv-list"); if(l) l.innerHTML=invListHtml(); } });

// ---------- invoices ----------
const invSettings=()=>Object.assign({bizName:"PerformCore",prefix:"PC-",terms:7,phone:"",email:"",address:"",payment:""},(data.settings.find(s=>s.id==="invoice")||{}));
function nextInvNumber(){ const st=invSettings(), p=st.prefix||""; let max=1000; data.money.forEach(m=>{ if(m.number&&String(m.number).startsWith(p)){ const n=parseInt(String(m.number).slice(p.length),10); if(n>max) max=n; } }); return p+(max+1); }
function jobLines(a){ if(isFlat(a)&&a.lines&&a.lines.length){ const when=a.completedAt||a.when?" ("+fmtDate(a.completedAt||a.when)+")":""; return a.lines.map(l=>({desc:[a.job,l.area,l.film].filter(Boolean).join(" · ")+when,filmId:l.filmId||"",sqft:Number(l.sqft)||"",rate:Number(l.rate)||"",amount:Number(l.amount)||0})); } return [jobLine(a)]; }
function jobLine(a){ if(isFlat(a)){ const d=[a.job,a.service,a.film].filter(Boolean).join(" · ")+(a.completedAt||a.when?" ("+fmtDate(a.completedAt||a.when)+")":""); return {desc:d,sqft:Number(a.sqft)||"",rate:Number(a.rate)||"",amount:Number(a.price||0)}; } const bits=[a.job,a.service].filter(Boolean).join(" · "); const extra=(a.notes||"").replace(/\s*\n\s*/g,"; ").trim()||a.film||""; return {desc:bits+(extra?" — "+extra:"")+(a.when?" ("+fmtDate(a.when)+")":""), vin:a.vin||"", amount:Number(a.price||0)}; }
function buildPdf(inv){
  const st=invSettings(); const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"pt",format:"letter"});
  const W=612, M=50, DARK=[30,30,30], GREEN=[76,175,80], GRAY=[85,85,85], LG=[217,217,217], OFF=[244,244,244], WHITE=[255,255,255];
  const t=(s,x,y,o)=>{ o=o||{}; doc.setFont("helvetica",o.b?"bold":"normal"); doc.setFontSize(o.s||10); doc.setTextColor(...(o.c||DARK)); const op={}; if(o.align) op.align=o.align; if(o.sp) op.charSpace=o.sp; doc.text(String(s),x,y,op); };
  const lab=(s,x,y,c)=>t(s,x,y,{b:1,s:7.5,c:c||GREEN,sp:1});
  const all=inv.lines||[], items=all.filter(l=>Number(l.amount)>=0), pays=all.filter(l=>Number(l.amount)<0);
  const sub=items.reduce((s,l)=>s+(Number(l.amount)||0),0), credits=pays.reduce((s,l)=>s-Number(l.amount),0);
  const isPaid=invState(inv)==="Paid", bal=isPaid?0:Math.max(0,Math.round((sub-credits)*100)/100);
  const status=isPaid?"PAID IN FULL":invState(inv)==="Overdue"?"OVERDUE":credits>0?"PARTIALLY PAID":"PAYMENT DUE";
  const BADGE={"PAID IN FULL":[[232,245,233],GREEN,[46,125,50]],"OVERDUE":[[253,232,232],[211,47,47],[183,28,28]],"PARTIALLY PAID":[[255,246,221],[224,161,0],[138,98,0]],"PAYMENT DUE":[[255,246,221],[224,161,0],[138,98,0]]}[status];
  const net=inv.date&&inv.due?Math.max(0,daysBetween(inv.date,inv.due)):(Number(st.terms)||7);
  const decorate=()=>{ try{ doc.addImage(PC_WM,"PNG",(W-300)/2,250,300,352); }catch(_){} };
  decorate();
  doc.setFillColor(...DARK); doc.rect(0,0,W,8,"F"); doc.setFillColor(...GREEN); doc.rect(0,8,W*0.28,3,"F");
  try{ doc.addImage(PC_LOGO,"PNG",M,32,40,47); }catch(_){}
  doc.setDrawColor(...LG); doc.setLineWidth(0.8); doc.line(M+52,34,M+52,77);
  t("PERFORM",M+64,56,{s:19,sp:3}); const pw=doc.getTextWidth("PERFORM")+3*7; t("CORE",M+64+pw,56,{s:19,sp:3,c:GREEN});
  t("BUILDING PERFORMANCE COMPANY",M+65,74,{b:1,s:6.5,sp:1.6});
  t("INVOICE",W-M,56,{b:1,s:22,sp:1.5,align:"right"});
  [["Invoice #",inv.number||""],["Issued",fmtLong(inv.date)],[isPaid?"Paid":"Due",isPaid?fmtLong(inv.paidDate||inv.date):fmtLong(inv.due)],["Terms","Net "+net]].forEach(([k,v],i)=>{ const yy=76+i*13; t(k,W-150,yy,{s:8.5,c:GRAY,align:"right"}); t(v,W-M,yy,{b:1,s:8.5,align:"right"}); });
  doc.setDrawColor(...GREEN); doc.setLineWidth(1); doc.line(M,136,W-M,136);
  let y=158;
  lab("BILL TO",M,y); lab("DIVISION",330,y); lab("STATUS",462,y);
  t(inv.party||"",M,y+17,{b:1,s:12});
  String(inv.billTo||"").split("\n").map(s=>s.trim()).filter(Boolean).slice(0,3).forEach((l,i)=>t(doc.splitTextToSize(l,250)[0],M,y+31+i*12,{s:9.5,c:GRAY}));
  t(inv.division||inv.category||"Automotive",330,y+17,{s:10.5});
  doc.setFillColor(...BADGE[0]); doc.setDrawColor(...BADGE[1]); doc.setLineWidth(0.9); doc.roundedRect(462,y+5,96,17,8.5,8.5,"FD");
  t(status,510,y+16.5,{b:1,s:7,c:BADGE[2],sp:0.5,align:"center"});
  y=222;
  const head=()=>{ doc.setFillColor(...DARK); doc.rect(M,y,W-2*M,24,"F"); lab("DESCRIPTION",M+10,y+15,WHITE); t("AMOUNT",W-M-10,y+15,{b:1,s:7.5,c:WHITE,align:"right"}); y+=24; };
  head();
  const descW=W-2*M-130;
  const rows=[]; let curVeh=null;
  items.forEach(l=>{ const d=String(l.desc||""), k=d.indexOf(" · "), veh=k>0?d.slice(0,k).trim():null, work=k>0?d.slice(k+3).trim():d;
    if(veh&&veh!==curVeh){ rows.push({veh:true,text:veh,vin:String(l.vin||"").trim()}); curVeh=veh; }
    rows.push({veh:false,text:work,amount:l.amount,vin:veh?"":String(l.vin||"").trim(),indent:!!curVeh}); });
  rows.forEach(r=>{
    const x=M+10+(r.indent?12:0);
    doc.setFont("helvetica",r.veh?"bold":"normal"); doc.setFontSize(r.veh?10.5:10);
    const wrapped=doc.splitTextToSize(r.text,descW-(r.indent?12:0));
    const h=r.veh?(wrapped.length*13+12+(r.vin?12:0)):Math.max(26,wrapped.length*13+12+(r.vin?12:0));
    if(y+h>700){ doc.addPage(); decorate(); y=60; head(); }
    doc.setTextColor(...DARK); doc.text(wrapped,x,y+18);
    if(!r.veh) t(money2(r.amount),W-M-10,y+18,{align:"right"});
    if(r.vin) t("VIN  "+r.vin,x,y+18+wrapped.length*13,{b:1,s:8.5,c:GRAY,sp:0.4});
    y+=h; if(!r.veh){ doc.setDrawColor(...LG); doc.setLineWidth(0.8); doc.line(M,y,W-M,y); }
  });
  y+=22; if(y>640){ doc.addPage(); decorate(); y=60; }
  const tot=(k,v)=>{ t(k,W-160,y,{s:9.5,c:GRAY,align:"right"}); t(v,W-M-14,y,{s:9.5,align:"right"}); y+=18; };
  tot("Subtotal",money2(sub));
  pays.forEach(p=>tot(String(p.desc||"Payment received"),"-"+money2(-Number(p.amount))));
  if(isPaid&&sub-credits>0.004) tot("Payment received"+(inv.paidDate?" ("+fmtDate(inv.paidDate)+")":""),"-"+money2(sub-credits));
  if(!pays.length&&!isPaid) tot("Payments received",money2(0));
  doc.setFillColor(...DARK); doc.rect(W-300,y-4,250,28,"F"); doc.setFillColor(...GREEN); doc.rect(W-300,y-4,4,28,"F");
  t("BALANCE DUE",W-286,y+14,{b:1,s:9.5,c:WHITE,sp:1.2}); t(money2(bal),W-M-14,y+15,{b:1,s:12.5,c:GREEN,align:"right"});
  y+=46;
  if(y>490){ doc.addPage(); decorate(); y=60; }
  lab("PAYMENT",M,y);
  const pm=String(st.payment||"").split("\n").map(s=>s.trim()).filter(Boolean);
  pm.slice(0,5).forEach((line,i)=>{ const k=line.indexOf(":"); const yy=y+17+i*15; if(k>0){ t(line.slice(0,k).trim(),M,yy,{b:1,s:9}); t(line.slice(k+1).trim(),M+66,yy,{s:9}); } else t(line,M,yy,{s:9}); });
  const py=y+17+Math.max(1,Math.min(pm.length,5))*15+4;
  t(isPaid?"Paid in full. Thank you!":"Please reference invoice "+(inv.number||"")+" with your payment.",M,py,{s:8.5,c:GRAY});
  const sx=330; lab("CUSTOMER ACCEPTANCE",sx,y);
  doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...GRAY);
  doc.text(doc.splitTextToSize("I confirm the work above was completed to my satisfaction and I agree to the terms and warranty below.",W-M-sx),sx,y+15);
  doc.setDrawColor(...DARK); doc.setLineWidth(0.7);
  doc.line(sx,y+60,W-150,y+60); doc.line(W-140,y+60,W-M,y+60); doc.line(sx,y+90,W-150,y+90);
  t("Customer signature",sx,y+70,{s:7,c:GRAY}); t("Date",W-140,y+70,{s:7,c:GRAY}); t("Printed name",sx,y+100,{s:7,c:GRAY});
  y=Math.max(py,y+100)+16;
  const terms=[["Payment.",isPaid?"Paid in full. Thank you for your business.":"Due within "+net+" days of the invoice date (Net "+net+"). The balance shown reflects payments received to date."],
    ["Install warranty.","PerformCore warrants its installation for 30 days from the service date. Bubbling, peeling, lifting, edge gaps or contamination caused by the install and reported within that period will be corrected at no charge."],
    ["Curing & care.","Do not roll windows down for 3-5 days. Haze or small water pockets are normal and may take up to 30 days to clear. Wait 7 days before cleaning; use ammonia-free cleaner and a soft cloth only."],
    ["Not covered.","Scratches, impact, abrasive or razor cleaning, accidents, pre-existing glass damage, and defroster lines damaged while removing existing film."],
    ["Tint laws.","Customer selected the shades installed and is responsible for compliance with Florida window tint law. PerformCore is not liable for citations or required removal."]];
  const cw=W-2*M-28; doc.setFontSize(7.4);
  const laid=terms.map(([b,s])=>{ doc.setFont("helvetica","bold"); const bw=doc.getTextWidth(b+" "); doc.setFont("helvetica","normal"); return {b,bw,lines:doc.splitTextToSize(s,cw-bw)}; });
  const boxH=26+laid.reduce((s,x)=>s+x.lines.length*9.6+4.5,0);
  if(y+boxH>748){ doc.addPage(); decorate(); y=60; }
  doc.setFillColor(...OFF); doc.rect(M,y,W-2*M,boxH,"F"); doc.setFillColor(...GREEN); doc.rect(M,y,3,boxH,"F");
  lab("TERMS & WARRANTY",M+14,y+16);
  let ty=y+31;
  laid.forEach(x=>{ t(x.b,M+14,ty,{b:1,s:7.4}); x.lines.forEach((l,j)=>t(l,M+14+x.bw,ty+9.6*j,{s:7.4,c:GRAY})); ty+=x.lines.length*9.6+4.5; });
  const pages=doc.getNumberOfPages(); for(let pg=1;pg<=pages;pg++){ doc.setPage(pg); doc.setFillColor(...DARK); doc.rect(0,762,W,30,"F"); doc.setFillColor(...GREEN); doc.rect(0,760,W,2,"F"); t("INTELLIGENT SOLUTIONS. BETTER BUILDINGS.  ·  performcoregroup.com",W/2,780,{s:7.5,c:WHITE,sp:1,align:"center"}); }
  return doc.output("blob");
}
const PC_LOGO="data:image/png;base64,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";
const PC_WM="data:image/png;base64,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";
const money2=n=>(Number(n)||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const fmtLong=s=>{ const d=parseD(s); return d?d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):""; };
async function downloadPdf(inv, errEl){
  if(!window.jspdf){ errEl.textContent="The PDF tool didn't load. Reload the app."; return false; }
  const dl=await claude.use("downloads").catch(()=>null);
  if(!dl){ errEl.textContent="Saving files isn't available here. Reload the app and try again."; return false; }
  try{ await dl.save({filename:(inv.number+" "+(inv.party||"")).replace(/[^\w\- &]+/g,"").trim()+".pdf",data:buildPdf(inv)}); return true; }
  catch(e){ if(e&&e.code!=="declined") errEl.textContent="Couldn't save the PDF ("+(e.code||"error")+")."; return false; }
}
async function markInvoicePaid(inv){
  const d=todayISO(), now=new Date().toISOString();
  await db.collection("money").doc(inv.id).update({status:"Paid",paidDate:d,updated:now});
  for(const jid of (inv.jobIds||[])){ const j=data.tints.find(x=>x.id===jid); if(j&&j.status!=="Paid") await db.collection("tints").doc(jid).update({status:"Paid",paidDate:d,updated:now}); }
}
async function syncInvoiceAfterJobPaid(jobIds){
  const invIds=[...new Set(jobIds.map(id=>(data.tints.find(x=>x.id===id)||{}).invoiceId).filter(Boolean))];
  for(const iid of invIds){ const inv=data.money.find(m=>m.id===iid); if(!inv||inv.status==="Paid") continue;
    const allPaid=(inv.jobIds||[]).every(j=>jobIds.includes(j)||(data.tints.find(x=>x.id===j)||{}).status==="Paid");
    if(allPaid) await db.collection("money").doc(iid).update({status:"Paid",paidDate:todayISO(),updated:new Date().toISOString()}); }
}
function openInvoice({client, jobs, invoice, account, division}){
  modalRefresh=null;
  const st=invSettings(), isNew=!invoice, t=todayISO();
  const inv=invoice?JSON.parse(JSON.stringify(invoice)):{number:nextInvNumber(),party:client||"",billTo:account?[account.contact,account.phone,account.email,account.address].filter(Boolean).join("\n"):"",accountId:account?account.id:"",date:t,due:addDays(t,Number((account&&account.terms)||st.terms)||7),division:division||"",lines:(jobs||[]).flatMap(jobLines),jobIds:(jobs||[]).map(j=>j.id),notes:"",status:"Sent"};
  (inv.lines||[]).forEach(l=>{ if(!l.vin&&inv.jobIds&&inv.jobIds.length===1){ const j=data.tints.find(x=>x.id===inv.jobIds[0]); if(j&&j.vin&&!isFlat(j)) l.vin=j.vin; } });
  if(!inv.lines||!inv.lines.length) inv.lines=[{desc:"",amount:0}];
  inv.lines.forEach(l=>{ if(Number(l.amount)<0) l._pay=true; });
  const settingsMissing=!data.settings.find(s=>s.id==="invoice");
  const payHtml=(l,i)=>`<div class="iline" style="border:1px dashed var(--good);border-radius:8px;padding:8px;margin-bottom:8px;display:grid;grid-template-columns:1fr 110px 32px;gap:6px;align-items:center"><input id="il-d-${i}" data-li="${i}" data-lk="desc" value="${esc(l.desc)}" placeholder="Payment received" aria-label="Payment ${i+1} note"><input id="il-a-${i}" data-li="${i}" data-lk="amount" value="${esc(l.amount?Math.abs(Number(l.amount)):"")}" type="number" step="any" min="0" inputmode="decimal" placeholder="Paid $" aria-label="Payment ${i+1} amount" style="text-align:right;color:var(--good)"><button type="button" class="btn sm" data-rmline="${i}" aria-label="Remove payment">×</button></div>`;
  const lineHtml=(l,i)=>l._pay?payHtml(l,i):`<div class="iline" style="border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:8px;display:flex;flex-direction:column;gap:6px"><select id="il-f-${i}" data-li="${i}" data-lk="filmId" aria-label="Line ${i+1} film">${filmOptHtml(inv.division||"",l.filmId||"").replace('Choose film…','No film / not by sq ft').replace(/<option value="__custom"[^>]*>[^<]*<\/option>/,"")}</select><div style="display:grid;grid-template-columns:1fr 32px;gap:6px"><input id="il-d-${i}" data-li="${i}" data-lk="desc" value="${esc(l.desc)}" placeholder="Description" aria-label="Line ${i+1} description"><button type="button" class="btn sm" data-rmline="${i}" aria-label="Remove line">×</button></div>${l.vin!==undefined&&(l.vin||inv.division==="Automotive"||!inv.division)?`<input id="il-v-${i}" data-li="${i}" data-lk="vin" value="${esc(l.vin||"")}" placeholder="VIN (prints on the invoice)" aria-label="Line ${i+1} VIN" class="num">`:""}<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px"><input id="il-s-${i}" data-li="${i}" data-lk="sqft" value="${esc(l.sqft??"")}" type="number" step="any" inputmode="decimal" placeholder="Sq ft" aria-label="Line ${i+1} square feet"><input id="il-r-${i}" data-li="${i}" data-lk="rate" value="${esc(l.rate??"")}" type="number" step="any" inputmode="decimal" placeholder="$ / sq ft" aria-label="Line ${i+1} rate per square foot"><input id="il-a-${i}" data-li="${i}" data-lk="amount" value="${esc(l.amount)}" type="number" step="any" inputmode="decimal" placeholder="Amount" aria-label="Line ${i+1} amount" style="text-align:right"></div></div>`;
  const draw=()=>{
    const total=inv.lines.reduce((s,l)=>s+(Number(l.amount)||0),0), paidSoFar=inv.lines.filter(l=>l._pay).reduce((s,l)=>s-(Number(l.amount)||0),0);
    $("#modal-root").innerHTML=`<div class="ov" id="ov"><form class="sheet" id="ifrm" novalidate style="max-width:620px">
      <h2>${isNew?"New invoice":"Invoice "+esc(inv.number)}${!isNew?` <span class="chip ${invState(inv)==="Paid"?"g":invState(inv)==="Overdue"?"b":"w"}" style="vertical-align:4px">${esc(invState(inv))}</span>`:""}</h2>
      ${settingsMissing?`<div class="panel" style="margin-bottom:12px;background:var(--sun-soft);border-color:var(--sun);font-size:14px">Your business address and payment instructions aren't set, so they won't print. <button type="button" class="btn sm" id="iset">Add them</button></div>`:""}
      <div class="frow"><div class="f"><label for="i-party">Bill to</label><input id="i-party" data-k="party" value="${esc(inv.party)}"></div><div class="f"><label for="i-num">Invoice #</label><input id="i-num" data-k="number" value="${esc(inv.number)}"></div></div>
      <div class="f"><label for="i-billto">Client contact (optional)</label><textarea id="i-billto" data-k="billTo" style="min-height:52px" placeholder="Phone, email or address">${esc(inv.billTo||"")}</textarea></div>
      <div class="frow"><div class="f"><label for="i-date">Date</label><input id="i-date" type="date" data-k="date" value="${esc(inv.date)}"></div><div class="f"><label for="i-due">Due</label><input id="i-due" type="date" data-k="due" value="${esc(inv.due)}"></div></div>
      <div class="f"><label>Line items</label>${inv.lines.map(lineHtml).join("")}<span style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" id="iadd">+ Line</button>${readOnly?"":`<button type="button" class="btn sm" id="ipay" title="Deposit or partial payment. It comes off the balance and prints on the PDF.">+ Payment received</button>`}</span></div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--line);padding-top:10px;margin-bottom:12px"><span id="itotal-l" style="font:500 12px var(--f-mono);text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">${paidSoFar>0?`Balance due <span style="text-transform:none;letter-spacing:0">(after ${esc(money2(paidSoFar))} paid)</span>`:"Total due"}</span><span class="num" id="itotal" style="font:700 24px var(--f-display)">${money2(total)}</span></div>
      <div class="f"><label for="i-notes">Notes on invoice</label><textarea id="i-notes" data-k="notes" style="min-height:52px">${esc(inv.notes||"")}</textarea></div>
      <div class="ferr" id="ierr" role="alert"></div>
      <div class="acts">${!isNew&&!readOnly?`<span style="display:flex;gap:8px">${invState(inv)!=="Paid"?`<button type="button" class="btn" id="ipaid">Mark paid</button>`:""}<button type="button" class="btn danger" id="idel">Delete</button></span>`:"<span></span>"}
      <span class="rt"><button type="button" class="btn" id="icancel">Close</button>${!isNew?`<button type="button" class="btn" id="ipdf">PDF</button>`:""}${readOnly?"":`<button type="submit" class="btn primary" id="isave">${isNew?"Save &amp; download PDF":"Save"}</button>`}</span></div>
    </form></div>`;
    wire();
  };
  const collect=()=>{ document.querySelectorAll("#ifrm [data-k]").forEach(el=>{ inv[el.dataset.k]=el.value.trim(); }); document.querySelectorAll("#ifrm [data-li]").forEach(el=>{ const l=inv.lines[+el.dataset.li]; if(!l) return; const k=el.dataset.lk; l[k]=k==="desc"||k==="filmId"||k==="vin"?el.value:(el.value===""?(k==="amount"?0:""):Number(el.value)); if(l._pay&&k==="amount") l.amount=-Math.abs(Number(l.amount)||0); }); inv.lines.forEach(l=>{ if(!l._pay&&Number(l.sqft)>0&&Number(l.rate)>0) l.amount=Math.round(l.sqft*l.rate*100)/100; }); inv.amount=inv.lines.reduce((s,l)=>s+(Number(l.amount)||0),0); };
  const close=()=>{ $("#modal-root").innerHTML=""; };
  function wire(){
    const ov=$("#ov"), f=$("#ifrm"), err=$("#ierr");
    ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    f.addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
    $("#icancel").onclick=close;
    f.addEventListener("change",e=>{ if(e.target.dataset.lk!=="filmId") return; collect(); const l=inv.lines[+e.target.dataset.li]; const fm=data.films.find(x=>x.id===l.filmId); if(fm){ const old=l.film; l.film=fm.name; l.rate=Number(fm.rate)||""; if(!String(l.desc).trim()||l.desc===old) l.desc=fm.name; if(Number(l.sqft)>0) l.amount=Math.round(l.sqft*l.rate*100)/100; } draw(); const s=$("#il-s-"+e.target.dataset.li); if(s&&!s.value) s.focus(); });
    f.addEventListener("input",e=>{ const k=e.target.dataset.lk; if(k==="amount"||k==="sqft"||k==="rate"){ collect(); const i=e.target.dataset.li, l=inv.lines[+i]; if(k!=="amount"&&l&&!l._pay&&Number(l.sqft)>0&&Number(l.rate)>0){ const ai=$("#il-a-"+i); if(ai) ai.value=l.amount; } $("#itotal").textContent=money2(inv.amount); const pd=inv.lines.filter(x=>x._pay).reduce((s,x)=>s-(Number(x.amount)||0),0), tl=$("#itotal-l"); if(tl) tl.innerHTML=pd>0?`Balance due <span style="text-transform:none;letter-spacing:0">(after ${esc(money2(pd))} paid)</span>`:"Total due"; } });
    const ipay=$("#ipay"); if(ipay) ipay.onclick=()=>{ collect(); inv.lines.push({desc:"Payment received "+fmtDate(todayISO()),amount:0,_pay:true}); draw(); const a=$("#il-a-"+(inv.lines.length-1)); if(a) a.focus(); };
    $("#iadd").onclick=()=>{ collect(); inv.lines.push({desc:"",amount:0}); draw(); const ins=document.querySelectorAll('#ifrm [data-lk="desc"]'); ins[ins.length-1].focus(); };
    f.querySelectorAll("[data-rmline]").forEach(b=>b.onclick=()=>{ collect(); inv.lines.splice(+b.dataset.rmline,1); if(!inv.lines.length) inv.lines.push({desc:"",amount:0}); draw(); });
    const iset=$("#iset"); if(iset) iset.onclick=()=>openForm("settings",null,{bizName:"PerformCore",prefix:"PC-",terms:7});
    const pdf=$("#ipdf"); if(pdf) pdf.onclick=async()=>{ collect(); err.textContent=""; await downloadPdf(inv,err); };
    const paid=$("#ipaid"); if(paid) paid.onclick=async()=>{ paid.disabled=true; try{ await markInvoicePaid(inv); close(); }catch(e){ paid.disabled=false; err.textContent="Couldn't mark it paid. Try again."; } };
    const del=$("#idel"); if(del){ let armed=false; del.onclick=async()=>{ if(!armed){ armed=true; del.textContent="Tap again to delete"; return; } try{ for(const jid of (inv.jobIds||[])){ if(data.tints.find(x=>x.id===jid)) await db.collection("tints").doc(jid).update({invoiceId:"",invoiceNumber:""}); } await db.collection("money").doc(inv.id).delete(); close(); }catch(e){ err.textContent="Couldn't delete: "+(e.code||e.message); } }; }
    f.addEventListener("submit",async e=>{
      e.preventDefault(); collect(); err.textContent="";
      inv.lines=inv.lines.filter(l=>String(l.desc).trim()||Number(l.amount));
      if(!inv.party){ err.textContent="Add who the invoice is for."; return; }
      if(!inv.lines.some(l=>!l._pay&&Number(l.amount)>0)){ err.textContent="Add at least one line with an amount."; return; }
      if(inv.amount<-0.004){ err.textContent="Payments add up to more than the invoice. Check the amounts."; return; }
      if(!inv.number){ err.textContent="Add an invoice number."; return; }
      if(data.money.some(m=>m.number===inv.number&&m.id!==inv.id)){ err.textContent="Invoice "+inv.number+" already exists. Use a different number."; return; }
      const btn=$("#isave"); btn.disabled=true; btn.textContent="Saving…";
      const now=new Date().toISOString();
      const body={kind:"Invoice",number:inv.number,party:inv.party,billTo:inv.billTo||"",entity:"PerformCore",category:inv.division||"",amount:inv.amount,date:inv.date,due:inv.due,status:inv.status||"Sent",lines:inv.lines.map(l=>({desc:String(l.desc),vin:String(l.vin||""),filmId:String(l.filmId||""),sqft:Number(l.sqft)||0,rate:Number(l.rate)||0,amount:Number(l.amount)||0})),division:inv.division||"",jobIds:inv.jobIds||[],accountId:inv.accountId||"",notes:inv.notes||"",updated:now};
      try{
        if(isNew){ body.created=now; const ref=db.collection("money").doc(); await ref.set(body); inv.id=ref.id;
          for(const jid of body.jobIds){ await db.collection("tints").doc(jid).update({invoiceId:ref.id,invoiceNumber:inv.number,invoicedAt:localDT(new Date()),updated:now}); }
          btn.textContent="Downloading…"; await downloadPdf(Object.assign({},body,{id:ref.id}),err);
          if(!err.textContent) close(); else { btn.textContent="Saved"; }
        } else { await db.collection("money").doc(inv.id).update(body); close(); }
      }catch(ex){ btn.disabled=false; btn.textContent=isNew?"Save & download PDF":"Save"; err.textContent="Couldn't save ("+(ex.code||ex.message||"error")+"). Try again."; }
    });
    setTimeout(()=>{ const p=$("#i-party"); if(p&&!p.value) p.focus(); },30);
  }
  draw();
}

// ---------- film price list ----------
const filmsFor = div => [...data.films].filter(f=>!div||!f.divisions||f.divisions==="Residential & Commercial"||f.divisions===div).sort((a,b)=>(a.category||"").localeCompare(b.category||"")||(a.name||"").localeCompare(b.name||""));
const filmOptHtml = (div, sel) => `<option value="">Choose film…</option>${filmsFor(div).map(f=>`<option value="${esc(f.id)}" ${f.id===sel?"selected":""}>${esc(f.name)} — ${money2(f.rate)}/sf</option>`).join("")}<option value="__custom" ${sel==="__custom"?"selected":""}>Other film (type rate)</option>`;
function openFilms(){
  modalRefresh=null;
  const close=()=>{ modalRefresh=null; $("#modal-root").innerHTML=""; };
  const draw=()=>{
    const fs=filmsFor(""), cats=[...new Set(fs.map(f=>f.category||"Other"))];
    $("#modal-root").innerHTML=`<div class="ov" id="ov"><div class="sheet" id="fsheet" role="dialog" aria-label="Film prices" style="max-width:560px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 style="margin:0">Film prices</h2>${readOnly?"":`<button class="btn primary sm" data-add="films" data-preset='${esc(JSON.stringify({category:"Solar control",divisions:"Residential & Commercial"}))}'>Add film</button>`}</div>
      <p style="font-size:13px;color:var(--muted);margin:6px 0 14px">Your installed price per square foot. Picking a film on a job or invoice fills in this rate.</p>
      ${fs.length?cats.map(c=>`<h3 style="margin-top:12px">${esc(c)}</h3><div class="list">${fs.filter(f=>(f.category||"Other")===c).map(f=>`<div class="row" data-edit="films" data-id="${f.id}" tabindex="0"><span class="t">${esc(f.name)}</span><span class="r"><span class="num" style="font-weight:600">${money2(f.rate)}</span><span style="font-size:12px;color:var(--muted)">/ sq ft</span></span>${f.divisions&&f.divisions!=="Residential & Commercial"||f.notes?`<span class="s">${esc([f.divisions!=="Residential & Commercial"?f.divisions+" only":"",f.notes].filter(Boolean).join(" · "))}</span>`:""}</div>`).join("")}</div>`).join(""):`<div class="list">${empty("No films yet","Add each film you install with its price per square foot, like Silver 20 at $8.50.")}</div>`}
      <div class="acts" style="margin-top:14px"><span></span><span class="rt"><button class="btn" id="f-close">Close</button></span></div>
    </div></div>`;
    const ov=$("#ov"); ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
    $("#fsheet").addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
    $("#f-close").onclick=close;
  };
  modalRefresh=draw; draw();
}
// film line editor used inside the job form
function filmLinesEditor(root, initial, div){
  const lines=(initial&&initial.length?initial:[{filmId:"",film:"",area:"",sqft:"",rate:"",amount:0}]).map(l=>Object.assign({},l));
  const calc=l=>{ l.amount=Number(l.sqft)>0&&Number(l.rate)>0?Math.round(l.sqft*l.rate*100)/100:0; };
  const total=()=>lines.reduce((s,l)=>s+(Number(l.amount)||0),0), sq=()=>lines.reduce((s,l)=>s+(Number(l.sqft)||0),0);
  const draw=()=>{
    root.innerHTML=`${lines.map((l,i)=>`<div class="fline" data-i="${i}">
      <div style="display:grid;grid-template-columns:1fr auto 32px;gap:6px;align-items:center"><select id="fl-f-${i}" data-fk="filmId" aria-label="Film for line ${i+1}">${filmOptHtml(div,l.filmId)}</select><span class="num fl-amt" id="fl-a-${i}" style="font-weight:600;min-width:80px;text-align:right">${money2(l.amount)}</span><button type="button" class="btn sm" data-flrm="${i}" aria-label="Remove line">×</button></div>
      ${l.filmId==="__custom"?`<input id="fl-n-${i}" data-fk="film" value="${esc(l.film)}" placeholder="Film name" aria-label="Film name">`:""}
      <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);gap:6px"><input id="fl-ar-${i}" data-fk="area" value="${esc(l.area||"")}" placeholder="Area (optional)" aria-label="Area"><input id="fl-s-${i}" data-fk="sqft" type="number" step="any" inputmode="decimal" value="${esc(l.sqft)}" placeholder="Sq ft" aria-label="Square feet"><input id="fl-r-${i}" data-fk="rate" type="number" step="any" inputmode="decimal" value="${esc(l.rate)}" placeholder="$ / sq ft" aria-label="Rate per square foot"></div>
    </div>`).join("")}
    ${!filmsFor(div).length?`<div style="font-size:13px;color:var(--muted)">Your film price list is empty. Use "Other film" here, or add films under Film prices so rates fill in automatically.</div>`:""}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" id="fl-add">+ Add film</button><span style="font-size:14px"><span class="num" id="fl-sq" style="color:var(--muted)">${sq().toLocaleString()} sq ft</span> · <b class="num" id="fl-tot" style="font-size:17px">${money2(total())}</b></span></div>`;
  };
  const refreshTotals=()=>{ const st=root.querySelector("#fl-sq"), tt=root.querySelector("#fl-tot"); if(st) st.textContent=sq().toLocaleString()+" sq ft"; if(tt) tt.textContent=money2(total()); };
  root.addEventListener("input",e=>{ const row=e.target.closest(".fline"); if(!row) return; const l=lines[+row.dataset.i], k=e.target.dataset.fk; if(!l||!k||k==="filmId") return; l[k]=(k==="sqft"||k==="rate")?(e.target.value===""?"":Number(e.target.value)):e.target.value; calc(l); const a=root.querySelector("#fl-a-"+row.dataset.i); if(a) a.textContent=money2(l.amount); refreshTotals(); });
  root.addEventListener("change",e=>{ if(e.target.dataset.fk!=="filmId") return; const row=e.target.closest(".fline"), l=lines[+row.dataset.i]; l.filmId=e.target.value; const fm=data.films.find(f=>f.id===l.filmId); if(fm){ l.film=fm.name; l.rate=Number(fm.rate)||""; } else if(l.filmId!=="__custom"){ l.film=""; } calc(l); draw(); const s=root.querySelector("#fl-s-"+row.dataset.i); if(s&&!s.value) s.focus(); });
  root.addEventListener("click",e=>{ const rm=e.target.closest("[data-flrm]"); if(rm){ lines.splice(+rm.dataset.flrm,1); if(!lines.length) lines.push({filmId:"",film:"",area:"",sqft:"",rate:"",amount:0}); draw(); return; } if(e.target.closest("#fl-add")){ lines.push({filmId:"",film:"",area:"",sqft:"",rate:"",amount:0}); draw(); const sel=root.querySelector("#fl-f-"+(lines.length-1)); if(sel) sel.focus(); } });
  draw();
  return { get:()=>lines.filter(l=>Number(l.sqft)>0||l.film).map(l=>({filmId:l.filmId==="__custom"?"":(l.filmId||""),film:l.film||"",area:String(l.area||"").trim(),sqft:Number(l.sqft)||0,rate:Number(l.rate)||0,amount:Number(l.amount)||0})) };
}

// ---------- modal / form ----------
function openForm(col, item, preset){
  modalRefresh=null;
  const sc=S[col], isNew=!item, v=Object.assign({}, preset||{}, item||{});
  const field=f=>{
    const val=v[f.k]??"", id="f-"+col+"-"+f.k;
    if(f.type==="hidden") return `<input type="hidden" name="${f.k}" value="${esc(val)}">`;
    if(f.type==="filmlines") return `<div class="f"><label>${esc(f.label)}</label><div id="fl-root" style="display:flex;flex-direction:column;gap:8px"></div></div>`;
    let input;
    if(f.type==="select"){ const opts=(typeof f.opts==="function"?f.opts(v):f.opts).map(o=>typeof o==="object"?o:{v:o,l:o||"—"}); input=`<select id="${id}" name="${f.k}">${opts.map(o=>`<option value="${esc(o.v)}" ${String(val)===o.v?"selected":""}>${esc(o.l)}</option>`).join("")}</select>`; }
    else if(f.type==="textarea") input=`<textarea id="${id}" name="${f.k}" placeholder="${esc(f.ph||"")}">${esc(val)}</textarea>`;
    else if(f.type==="image") input=assets?`<input id="${id}" type="file" accept="image/*" name="__file"><input type="hidden" name="image" value="${esc(val)}">${val?`<img class="thumb" data-asset="${esc(val)}" alt="">`:""}`:`<span style="font-size:13px;color:var(--muted)">Image upload isn't available in this view. Use the link field.</span><input type="hidden" name="image" value="${esc(val)}">`;
    else input=`<input id="${id}" name="${f.k}" type="${f.type}" value="${esc(val)}" placeholder="${esc(f.ph||"")}" ${f.type==="number"?'step="any" inputmode="decimal"':""}>`;
    return `<div class="f"><label for="${id}">${esc(f.label)}${f.req?" *":""}</label>${input}</div>`;
  };
  // group half-width fields in pairs
  let html="", buf=[];
  sc.fields.forEach(f=>{ if(f.half){ buf.push(field(f)); if(buf.length===2){ html+=`<div class="frow">${buf.join("")}</div>`; buf=[]; } } else { if(buf.length){ html+=`<div class="frow">${buf.join("")}</div>`; buf=[]; } html+=field(f); } });
  if(buf.length) html+=`<div class="frow">${buf.join("")}</div>`;
  $("#modal-root").innerHTML=`<div class="ov" id="ov"><form class="sheet" id="frm" novalidate><h2>${isNew?"New":"Edit"} ${esc(sc.label.toLowerCase())}</h2>${html}<div class="ferr" id="ferr" role="alert"></div><div class="acts">${isNew||readOnly?"<span></span>":`<button type="button" class="btn danger" id="del">Delete</button>`}<span class="rt"><button type="button" class="btn" id="cancel">Cancel</button>${readOnly?"":`<button type="submit" class="btn primary" id="save">Save</button>`}</span></div></form></div>`;
  const ov=$("#ov"), frm=$("#frm"); hydrateImages();
  const flRoot=$("#fl-root"); const flEd=flRoot?filmLinesEditor(flRoot,(item?jobFilmLines(item):(v.lines||[])),divOf(v)):null;
  const close=()=>{ $("#modal-root").innerHTML=""; };
  ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
  $("#cancel").onclick=close;
  frm.addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
  setTimeout(()=>{ const first=frm.querySelector("input,select,textarea"); first&&first.focus(); },30);
  const del=$("#del");
  if(del){ let armed=false; del.onclick=async()=>{ if(!armed){ armed=true; del.textContent="Tap again to delete"; return; } try{ await db.collection(sc.coll||col).doc(item.id).delete(); close(); }catch(e){ $("#ferr").textContent="Couldn't delete: "+(e.message||e.code); } }; }
  frm.addEventListener("submit",async e=>{
    e.preventDefault();
    const fd=new FormData(frm), out={};
    for(const f of sc.fields){ if(f.type==="filmlines"){ out.lines=flEd?flEd.get():[]; continue; } if(f.type==="image"){ out.image=fd.get("image")||""; continue; } let x=fd.get(f.k); x=typeof x==="string"?x.trim():""; if(f.type==="number"&&x!=="") x=Number(x); if(f.k==="score"&&x!=="") x=Number(x); out[f.k]=x; }
    if(sc.beforeSave){ const msg=sc.beforeSave(out,item); if(msg){ $("#ferr").textContent=msg; return; } }
    const missing=sc.fields.filter(f=>f.req&&(out[f.k]===""||out[f.k]==null)).map(f=>f.label);
    if(missing.length){ $("#ferr").textContent="Fill in: "+missing.join(", "); return; }
    const btn=$("#save"); btn.disabled=true; btn.textContent="Saving…";
    try{
      const file=fd.get("__file");
      if(file && file.size && assets){ btn.textContent="Uploading…"; const up=await assets.upload(file); out.image=up.id; }
      out.updated=new Date().toISOString();
      if(isNew&&col==="settings"){ await db.collection("settings").doc("invoice").set(out); }
      else if(isNew){ out.created=out.updated; await db.collection(sc.coll||col).add(out); }
      else { await db.collection(sc.coll||col).doc(item.id).update(out); }
      close();
    }catch(err){ btn.disabled=false; btn.textContent="Save"; $("#ferr").textContent=err&&err.code==="quota_exceeded"?"Storage is full. Delete old entries and try again.":"Couldn't save ("+((err&&(err.message||err.code))||"unknown error")+"). Try again."; }
  });
}

// ---------- events ----------
document.addEventListener("click",async e=>{
  const t=e.target;
  if(t.closest("[data-stop]")) return;
  const fb=t.closest("[data-filter]"); if(fb){ ui[fb.dataset.filter]=fb.dataset.v; render(); return; }
  if(t.closest("[data-backup]")){ openBackup(); return; }
  if(!db && t.closest("[data-fix],[data-add],[data-edit],[data-done],[data-checkin],[data-paid],[data-paid-client],[data-invoice-client],[data-invpaid],[data-settings],[data-newinv],[data-films],[data-job],[data-acct],[data-markdone]")){ setStatus("Your data store isn't connected in this view, so changes can't be saved.",true); return; }
  const done=t.closest("[data-done]");
  if(done){ e.stopPropagation(); const w=data.workouts.find(x=>x.id===done.dataset.done); if(!w) return; const d=done.dataset.date||todayISO(); const arr=new Set(w.doneDates||[]); arr.has(d)?arr.delete(d):arr.add(d); const list=[...arr].sort().slice(-120); try{ await db.collection("workouts").doc(w.id).update({doneDates:list}); }catch(err){ setStatus("Couldn't update that workout. Try again.",true); } return; }
  if(t.closest("[data-settings]")){ const s=data.settings.find(x=>x.id==="invoice"); openForm("settings",s||null,s?null:{bizName:"PerformCore",prefix:"PC-",terms:7}); return; }
  if(t.closest("[data-newinv]")){ openInvoice({}); return; }
  if(t.closest("[data-films]")){ openFilms(); return; }
  const ic=t.closest("[data-invoice-client]");
  if(ic){ e.stopPropagation(); const name=ic.dataset.invoiceClient, dv=ic.dataset.div||""; const jobsI=unpaidTints().filter(a=>clientOf(a)===name&&!invById(a.invoiceId)&&(!dv||divOf(a)===dv)); openInvoice({client:name,division:dv||(jobsI[0]?divOf(jobsI[0]):""),account:data.accounts.find(x=>(x.name||"").trim()===name),jobs:jobsI.sort((a,b)=>(a.when||"").localeCompare(b.when||""))}); return; }
  const ipdf=t.closest("[data-invpdf]");
  if(ipdf){ e.stopPropagation(); const inv=data.money.find(m=>m.id===ipdf.dataset.invpdf); if(!inv) return; ipdf.disabled=true; const prev=ipdf.textContent; ipdf.textContent="Saving…"; const er={textContent:""}; await downloadPdf(inv,er); ipdf.disabled=false; ipdf.textContent=prev; if(er.textContent) setStatus(er.textContent,true); return; }
  const ip=t.closest("[data-invpaid]");
  if(ip){ e.stopPropagation(); const inv=data.money.find(m=>m.id===ip.dataset.invpaid); if(!inv) return; ip.disabled=true; try{ await markInvoicePaid(inv); }catch(err){ ip.disabled=false; setStatus("Couldn't mark that invoice paid. Try again.",true); } return; }
  const pd=t.closest("[data-paid]");
  if(pd){ e.stopPropagation(); pd.disabled=true; try{ await db.collection("tints").doc(pd.dataset.paid).update({status:"Paid",paidDate:todayISO(),updated:new Date().toISOString()}); await syncInvoiceAfterJobPaid([pd.dataset.paid]); }catch(err){ pd.disabled=false; setStatus("Couldn't mark that job paid. Try again.",true); } return; }
  const pc=t.closest("[data-paid-client]");
  if(pc){ e.stopPropagation(); const name=pc.dataset.paidClient;
    if(pc.dataset.armed!=="1"){ pc.dataset.armed="1"; pc.textContent="Tap again to confirm"; return; }
    pc.disabled=true; pc.textContent="Saving…";
    const dvp=pc.dataset.div||""; const its=rx().items.filter(it=>it.client===name&&(!dvp||it.div===dvp));
    try{ for(const it of its){ if(it.kind==="inv") await markInvoicePaid(it.inv); else await db.collection("tints").doc(it.jobs[0].id).update({status:"Paid",paidDate:todayISO(),updated:new Date().toISOString()}); } }
    catch(err){ setStatus("Some jobs for "+name+" couldn't be marked paid. Check the list and try again.",true); render(); }
    return; }
  const fx=t.closest("[data-fix]");
  if(fx){ e.stopPropagation(); fx.disabled=true; const id=fx.dataset.id, now=new Date().toISOString();
    try{ if(fx.dataset.fix==="jobpaid") await db.collection("tints").doc(id).update({status:"Paid",paidDate:todayISO(),updated:now});
      else if(fx.dataset.fix==="unlink") await db.collection("tints").doc(id).update({invoiceId:"",invoiceNumber:"",updated:now});
      else if(fx.dataset.fix==="invpaid"){ const inv=data.money.find(m=>m.id===id); if(inv) await markInvoicePaid(inv); } }
    catch(err){ fx.disabled=false; setStatus("Couldn't fix that. Try again.",true); } return; }
  const tk=t.closest("[data-task]");
  if(tk){ e.stopPropagation(); const x=data.tasks.find(y=>y.id===tk.dataset.task); if(!x) return; const nowDone=x.status!=="Done"; try{ await db.collection("tasks").doc(x.id).update({status:nowDone?"Done":"To do",completed:nowDone?new Date().toISOString():"",updated:new Date().toISOString()}); }catch(err){ setStatus("Couldn't update that task. Try again.",true); } return; }
  const ci=t.closest("[data-checkin]");
  if(ci){ e.stopPropagation(); try{ await db.collection("people").doc(ci.dataset.checkin).update({last:todayISO(),updated:new Date().toISOString()}); }catch(err){ setStatus("Couldn't log that check-in. Try again.",true); } return; }
  const add=t.closest("[data-add]");
  if(add){ let preset=null; try{ preset=add.dataset.preset?JSON.parse(add.dataset.preset):null; }catch(_){} openForm(add.dataset.add,null,preset); return; }
  const mk=t.closest("[data-markdone]");
  if(mk){ e.stopPropagation(); mk.disabled=true; try{ await db.collection("tints").doc(mk.dataset.markdone).update({status:"Done",completedAt:localDT(new Date()),updated:new Date().toISOString()}); }catch(err){ mk.disabled=false; setStatus("Couldn't mark that job done. Try again.",true); } return; }
  const ac=t.closest("[data-acct]");
  if(ac){ openAccount(ac.dataset.acct); return; }
  const jb=t.closest("[data-job]");
  if(jb){ openJob(jb.dataset.job); return; }
  const ed=t.closest("[data-edit]");
  if(ed){ const it=data[ed.dataset.edit].find(x=>x.id===ed.dataset.id); if(!it) return; if(ed.dataset.edit==="money"&&it.kind==="Invoice"&&Array.isArray(it.lines)) openInvoice({invoice:it}); else openForm(ed.dataset.edit,it); }
});
document.addEventListener("keydown",e=>{ if(e.key==="Enter"&&e.target.matches("[data-edit][tabindex],[data-job][tabindex],[data-acct][tabindex]")){ e.target.click(); } });

// ----- quick add -----
document.addEventListener("input",e=>{ if(e.target&&e.target.id==="qa-task"){ ui.qa=e.target.value; const h=$("#qa-hint"); if(h) h.textContent=quickHint(ui.qa); } });
document.addEventListener("submit",async e=>{
  const f=e.target; if(!f.matches||!f.matches("form[data-qa]")) return; e.preventDefault();
  const inp=f.querySelector("#qa-task"), p=parseQuick(inp.value);
  if(!p.title){ inp.focus(); return; }
  if(!db||readOnly){ setStatus("Your data store isn't connected in this view, so changes can't be saved.",true); return; }
  const now=new Date().toISOString(), btn=f.querySelector("button"); btn.disabled=true;
  try{ await db.collection("tasks").add({title:p.title,goal:"",area:p.area,priority:p.priority,due:p.due,status:"To do",notes:"",updated:now,created:now}); ui.qa=""; const i2=$("#qa-task"); if(i2){ i2.value=""; i2.focus(); } const h=$("#qa-hint"); if(h) h.textContent=quickHint(""); setStatus(""); }
  catch(err){ setStatus("Couldn't add that task ("+((err&&(err.code||err.message))||"error")+"). Try again.",true); }
  finally{ const b2=document.querySelector("form[data-qa] button"); if(b2) b2.disabled=false; }
});

// ----- keyboard shortcuts (ignored while typing) -----
const closeModal=()=>{ modalRefresh=null; $("#modal-root").innerHTML=""; };
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("#modal-root").innerHTML){ closeModal(); return; }
  if(e.metaKey||e.ctrlKey||e.altKey||e.isComposing) return;
  const tg=e.target; if(tg&&(tg.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
  if($("#modal-root").innerHTML) return;
  const r=route(), idx=TABS.findIndex(x=>x[0]===r), go=k=>{ location.hash=k; };
  const k=e.key;
  if(/^[0-9]$/.test(k)){ const i=k==="0"?9:Number(k)-1; if(TABS[i]){ e.preventDefault(); go(TABS[i][0]); } return; }
  if(k==="["||k==="ArrowLeft"&&e.shiftKey){ e.preventDefault(); go(TABS[(idx-1+TABS.length)%TABS.length][0]); return; }
  if(k==="]"||k==="ArrowRight"&&e.shiftKey){ e.preventDefault(); go(TABS[(idx+1)%TABS.length][0]); return; }
  if(k==="t"){ e.preventDefault(); if(!["today","tasks"].includes(r)) go("tasks"); setTimeout(()=>{ const q=$("#qa-task"); if(q) q.focus(); },0); return; }
  if(k==="/"){ const s=$("#inv-search")||$("#qa-task"); if(s){ e.preventDefault(); s.focus(); } else if(r!=="invoices"){ e.preventDefault(); go("invoices"); setTimeout(()=>{ const s2=$("#inv-search"); if(s2) s2.focus(); },0); } return; }
  if(k==="n"){ const pr=[...document.querySelectorAll("#view .sec-head .btn.primary")], b=$('#view .sec-head [data-add="money"]')||pr[pr.length-1]||$("#view .sec-head [data-add]"); if(b){ e.preventDefault(); b.click(); } else if(r==="today"){ e.preventDefault(); const q=$("#qa-task"); if(q) q.focus(); } return; }
  if(k==="?"){ e.preventDefault(); openBackup(); return; }
});

// ----- backup: export / import JSON (same collections and fields the dashboard already stores) -----
async function backupJson(){ const imgs=window.LHQ?await LHQ.exportAssets().catch(()=>({})):{}; return JSON.stringify({app:"Sean's Life HQ",format:1,exportedAt:new Date().toISOString(),collections:Object.fromEntries(COLS.map(c=>[c,data[c]])),...(Object.keys(imgs).length?{assets:imgs}:{})},null,1); }
async function saveFile(name, blob){
  const dl=window.claude&&claude.use?await claude.use("downloads").catch(()=>null):null;
  if(dl){ try{ await dl.save({filename:name,data:blob}); return "saved"; }catch(e){ if(e&&e.code==="declined") return "declined"; } }
  try{ const u=URL.createObjectURL(blob), a=document.createElement("a"); a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),4000); return "saved"; }catch(_){ return "failed"; }
}
function openBackup(){
  modalRefresh=null;
  const counts=COLS.map(c=>[c,data[c].length]).filter(x=>x[1]);
  const keys=[["1–9, 0","Jump to a tab (1 Today … 9 Invoices, 0 Money)"],["[  ]","Previous / next tab"],["t","Quick-add a task"],["n","New item on this tab"],["/","Search invoices"],["Esc","Close a sheet"],["?","This panel"],["Phone","Swipe a row right to complete it or mark it paid · pull a sheet down to close it · tap + to add"]];
  $("#modal-root").innerHTML=`<div class="ov" id="ov"><div class="sheet" id="bsheet" role="dialog" aria-label="Backup and shortcuts">
    <h2>Backup &amp; shortcuts</h2>
    <p style="font-size:14px;color:var(--muted);margin:0 0 10px">Download everything, design images included, as one JSON file, or bring a backup back in (a backup from the Claude version works too). Importing adds and updates entries by their ID. It never deletes anything. Your data lives only on this device, so download a backup every week or so and keep it in Files or iCloud Drive.</p>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px" class="num">${counts.length?counts.map(([c,n])=>`${esc(c)} ${n}`).join(" · "):"No data loaded yet."}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="b-exp">Download backup</button><button class="btn" id="b-copy">Copy JSON</button>${readOnly||!db?"":`<label class="btn" for="b-file" style="display:inline-flex;align-items:center">Import backup…</label><input id="b-file" type="file" accept="application/json,.json" hidden>`}</div>
    <div id="b-imp"></div><div class="ferr" id="b-err" role="alert"></div>
    <h3 style="margin-top:18px">Keyboard</h3>
    <div class="list">${keys.map(([k,d])=>`<div class="row" style="cursor:default"><span class="t" style="font-weight:400">${esc(d)}</span><span class="r"><span class="chip num">${esc(k)}</span></span></div>`).join("")}</div>
    <div class="acts" style="margin-top:14px"><span></span><span class="rt"><button class="btn" id="b-close">Close</button></span></div>
  </div></div>`;
  const ov=$("#ov"), err=$("#b-err"); ov.addEventListener("click",e=>{ if(e.target===ov) closeModal(); });
  $("#b-close").onclick=closeModal;
  $("#b-exp").onclick=async()=>{ err.textContent=""; const r=await saveFile("Life HQ backup "+todayISO()+".json",new Blob([await backupJson()],{type:"application/json"})); if(r==="failed") err.textContent="Couldn't download here. Use Copy JSON and paste it into a note or file."; };
  $("#b-copy").onclick=async()=>{ err.textContent=""; try{ await navigator.clipboard.writeText(await backupJson()); $("#b-copy").textContent="Copied"; if(window.LHQ) LHQ.markBackup(); }catch(_){ err.textContent="Clipboard isn't available in this view."; } };
  const fi=$("#b-file"); if(fi) fi.onchange=async()=>{
    err.textContent=""; const file=fi.files&&fi.files[0]; if(!file) return;
    let obj; try{ obj=JSON.parse(await file.text()); }catch(_){ err.textContent="That file isn't valid JSON."; return; }
    const cols=obj&&obj.collections&&typeof obj.collections==="object"?obj.collections:obj;
    const plan=COLS.filter(c=>Array.isArray(cols[c])).map(c=>{ const docs=cols[c].filter(d=>d&&typeof d==="object"); const have=new Set(data[c].map(x=>x.id)); return {c,docs,upd:docs.filter(d=>d.id&&have.has(d.id)).length,add:docs.filter(d=>!d.id||!have.has(d.id)).length}; }).filter(p=>p.docs.length);
    if(!plan.length){ err.textContent="No Life HQ data found in that file."; return; }
    $("#b-imp").innerHTML=`<div class="panel" style="margin-top:12px"><h3>Import ${esc(file.name)}</h3><div style="font-size:14px">${plan.map(p=>`${esc(p.c)}: ${p.add} new, ${p.upd} updated`).join("<br>")}</div><div class="acts"><span></span><span class="rt"><button class="btn" id="b-no">Cancel</button><button class="btn primary" id="b-go">Import</button></span></div></div>`;
    $("#b-no").onclick=()=>{ $("#b-imp").innerHTML=""; fi.value=""; };
    $("#b-go").onclick=async()=>{ const go=$("#b-go"); go.disabled=true; let n=0, bad=0;
      for(const p of plan){ for(const d of p.docs){ const {id,...body}=d; try{ if(id) await db.collection(p.c).doc(String(id)).set(body); else await db.collection(p.c).add(body); n++; go.textContent="Importing… "+n; }catch(_){ bad++; } } }
      if(obj.assets&&window.LHQ){ try{ await LHQ.importAssets(obj.assets); }catch(_){ bad++; } }
      $("#b-imp").innerHTML=`<div class="panel" style="margin-top:12px;font-size:14px">${n} entr${n===1?"y":"ies"} imported.${bad?` ${bad} couldn't be saved (storage may be full).`:""}</div>`; fi.value=""; };
  };
}
// ----- floating + : one action opens directly, several open an iOS-style action sheet -----
const haptic=()=>{ try{ if(navigator.vibrate) navigator.vibrate(8); }catch(_){} };
// Today has its own list; other screens use their header buttons, main action first
const fabActions=()=>{ const fa=[...document.querySelectorAll("#view .fab-acts .btn")]; return fa.length?fa:[...document.querySelectorAll("#view .sec-head .btn")].reverse(); };
function updateFab(){ const f=$("#fab"); if(f) f.hidden=readOnly||!fabActions().length; }
function openActions(acts){
  modalRefresh=null;
  const list=acts;
  $("#modal-root").innerHTML=`<div class="ov" id="ov"><div class="sheet actsheet" role="dialog" aria-label="Add"><div class="as-list"><div class="as-title">Add to ${esc(TITLE[route()]||"Life HQ")}</div>${list.map((b,i)=>`<button class="as-item" data-as="${i}">${esc(b.textContent.trim())}</button>`).join("")}</div><button class="as-item as-cancel" data-ascancel>Cancel</button></div></div>`;
  const ov=$("#ov"); ov.addEventListener("click",e=>{ const it=e.target.closest("[data-as]"); if(it){ e.stopPropagation(); const b=list[+it.dataset.as]; closeModal(); b.click(); return; } if(e.target===ov||e.target.closest("[data-ascancel]")){ e.stopPropagation(); closeModal(); } });
}
$("#fab").addEventListener("click",()=>{ haptic(); const acts=fabActions(); if(!acts.length) return; if(acts.length===1) acts[0].click(); else openActions(acts); });
document.addEventListener("click",e=>{ if(e.target.closest(".check,[data-paid],[data-invpaid],[data-checkin],[data-markdone]")) haptic(); },true);

// ----- swipe a row right to run its main action (complete, mark paid, checked in) -----
let sw=null;
const SWIPE=[["[data-task]",b=>b.classList.contains("on")?"Reopen":"Done"],["[data-done]",b=>b.classList.contains("on")?"Undo":"Done"],["[data-markdone]",()=>"Done"],["[data-paid]",()=>"Paid"],["[data-invpaid]",()=>"Paid"],["[data-checkin]",()=>"Checked in"]];
document.addEventListener("touchstart",e=>{ sw=null; if(e.touches.length!==1||readOnly) return; const row=e.target.closest("#view .row"); if(!row||e.target.closest("input,textarea,select")) return;
  for(const [sel,lab] of SWIPE){ const b=row.querySelector(sel); if(b){ sw={row,b,lab:lab(b),x:e.touches[0].clientX,y:e.touches[0].clientY,dx:0,on:false}; return; } } },{passive:true});
document.addEventListener("touchmove",e=>{ if(!sw) return; const dx=e.touches[0].clientX-sw.x, dy=e.touches[0].clientY-sw.y;
  if(!sw.on){ if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){ sw=null; return; } if(dx>14&&dx>Math.abs(dy)*1.6){ sw.on=true; sw.row.dataset.swipe=sw.lab; sw.row.classList.add("swiping"); } else return; }
  sw.dx=Math.max(0,Math.min(dx,150)); sw.row.style.transform=`translateX(${sw.dx}px)`; const armed=sw.dx>88; if(armed!==sw.row.classList.contains("armed")){ sw.row.classList.toggle("armed",armed); if(armed) haptic(); } },{passive:true});
document.addEventListener("touchend",()=>{ const s=sw; sw=null; if(!s||!s.on) return; s.row.style.transform=""; s.row.classList.remove("swiping","armed"); if(s.dx>88) setTimeout(()=>s.b.click(),60); },{passive:true});

// ----- pull a bottom sheet down to dismiss it -----
let sd=null;
document.addEventListener("touchstart",e=>{ sd=null; const sh=e.target.closest("#modal-root .sheet"); if(!sh||e.touches.length!==1||e.target.closest("input,textarea,select,.week,.filters")) return; if(sh.scrollTop>0) return; sd={sh,y:e.touches[0].clientY,dy:0}; },{passive:true});
document.addEventListener("touchmove",e=>{ if(!sd) return; const dy=e.touches[0].clientY-sd.y; if(dy<=0||sd.sh.scrollTop>0){ if(sd.dy){ sd.sh.style.transform=""; } sd.dy=0; return; } sd.dy=dy; sd.sh.classList.add("dragging"); sd.sh.style.transform=`translateY(${dy}px)`; },{passive:true});
document.addEventListener("touchend",()=>{ const d=sd; sd=null; if(!d||!d.dy) return; d.sh.classList.remove("dragging"); if(d.dy>120){ d.sh.style.transition="transform .2s ease-in"; d.sh.style.transform="translateY(110%)"; setTimeout(closeModal,190); } else { d.sh.style.transition="transform .25s cubic-bezier(.2,.8,.2,1)"; d.sh.style.transform=""; setTimeout(()=>{ if(d.sh) d.sh.style.transition=""; },260); } },{passive:true});

// ----- large title collapses into the bar as you scroll -----
const onScroll=()=>{ const tb=$("#topbar"); if(tb) tb.classList.toggle("solid",window.scrollY>36); };
window.addEventListener("scroll",onScroll,{passive:true}); onScroll();

// keep the page behind a sheet from scrolling (iPhone Safari)
new MutationObserver(()=>{ document.documentElement.style.overflow=$("#modal-root").innerHTML?"hidden":""; }).observe($("#modal-root"),{childList:true});

// ---------- boot ----------
setStatus("Loading your data…");
render();
// re-render every minute and whenever you come back to the tab, so "today", the week and Now blocks never go stale
const tick=()=>{ if(!$("#modal-root").innerHTML) render(); };
setInterval(tick,60000);
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") tick(); });
const timer=setTimeout(()=>{ if(loaded.size<COLS.length) setStatus("Your data can't be reached yet. It will appear when the connection returns.",true); },10000);
(async()=>{
  if(!window.claude||!window.claude.use){ clearTimeout(timer); setStatus("The local data store didn't start. Reload the app.",true); return; }
  claude.use("assets").then(a=>{ assets=a; }).catch(()=>{});
  db=await claude.use("db");
  if(!db){ clearTimeout(timer); readOnly=true; setStatus("Sign in as the owner to see and edit this dashboard.",true); render(); return; }
  COLS.forEach(c=>{
    db.collection(c).onSnapshot(snap=>{
      data[c]=snap.docs.map(d=>Object.assign({id:d.id},d.data())); RXC=null;
      if(!snap.metadata.fromCache) loaded.add(c);
      if(loaded.size===COLS.length){ clearTimeout(timer); setStatus(""); }
      render(); if(modalRefresh) modalRefresh();
    },err=>{
      if(err.code==="revoked"||err.code==="not_granted"){ readOnly=true; setStatus("Access to this dashboard's data has ended for this view.",true); }
      else setStatus("Couldn't load "+c+" ("+err.code+"). Reopen the page to retry.",true);
      loaded.add(c); render();
    });
  });
})();
})();
