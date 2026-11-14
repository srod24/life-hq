#!/workspace/lhq/pw/bin/python
"""Life HQ assistant CLI: read and write Sean's Life HQ data in Supabase (synced to his app).
Docs: /home/box/lifehq/README.md.  Secrets: /home/box/.config/lifehq/secrets.env (never print them)."""
import argparse, base64, datetime as dt, http.server, json, os, random, re, string, sys, threading, time, urllib.error, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

SECRETS = "/home/box/.config/lifehq/secrets.env"
APP_DIR = os.environ.get("LHQ_APP_DIR", "/workspace/lifehq-app")
TZ = ZoneInfo("America/New_York")
COLS = ["films","settings","goals","blocks","tasks","workouts","accounts","tints","people","money","budgets","ideas","designs"]

def load_env():
    env = {}
    for line in open(SECRETS):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k] = v
    return env
ENV = load_env()
URL, KEY = ENV["SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_KEY"]
OWNER = os.environ.get("LHQ_OWNER") or ENV["SEAN_USER_ID"]

# ---------- time / ids (same formats as the app) ----------
def now_iso():  # JS new Date().toISOString()
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def today(): return dt.datetime.now(TZ).date().isoformat()
def local_dt(d=None): d = d or dt.datetime.now(TZ); return d.strftime("%Y-%m-%dT%H:%M")
def add_days(s, n): return (dt.date.fromisoformat(s[:10]) + dt.timedelta(days=n)).isoformat()
def fmt_date(s):
    if not s: return ""
    d = dt.date.fromisoformat(s[:10]); return f"{d:%b} {d.day}"
def b36(n):
    a = string.digits + string.ascii_lowercase; out = ""
    while n: n, r = divmod(n, 36); out = a[r] + out
    return out or "0"
def new_id(): return b36(int(time.time() * 1000)) + "".join(random.choice(string.digits + string.ascii_lowercase) for _ in range(8))
def ms(u):
    if not u: return 0
    return int(dt.datetime.fromisoformat(u.replace("Z", "+00:00")).timestamp() * 1000)

# ---------- Supabase REST (service role, always scoped to OWNER) ----------
def rest(method, path, params=None, body=None, prefer=None, headers=None):
    q = ("?" + urllib.parse.urlencode(params, safe=",.*()")) if params else ""
    h = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
    if prefer: h["Prefer"] = prefer
    if headers: h.update(headers)
    req = urllib.request.Request(URL + path + q, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read().decode(); return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase error {e.code}: {e.read().decode()[:400]}")

def rows(collection=None, deleted=False):
    out, off = [], 0
    while True:
        p = {"owner": f"eq.{OWNER}", "select": "collection,id,data,updated_at,deleted", "order": "collection,id", "limit": 1000, "offset": off}
        if collection: p["collection"] = f"eq.{collection}"
        if not deleted: p["deleted"] = "is.false"
        part = rest("GET", "/rest/v1/lifehq_docs", p); out += part
        if len(part) < 1000: return out
        off += 1000

def docs(collection):
    return [dict(id=r["id"], **r["data"]) for r in rows(collection)]

def get_row(collection, id_):
    r = rest("GET", "/rest/v1/lifehq_docs", {"owner": f"eq.{OWNER}", "collection": f"eq.{collection}", "id": f"eq.{id_}", "select": "data,updated_at,deleted"})
    return r[0] if r else None

def put(collection, id_, data, deleted=False):
    assert collection in COLS, collection
    prev = get_row(collection, id_)
    u = now_iso()
    if prev and ms(u) <= ms(prev["updated_at"]):  # last-write-wins: must be newer
        u = dt.datetime.fromtimestamp((ms(prev["updated_at"]) + 1) / 1000, dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    data = {k: v for k, v in data.items() if k != "id"}
    rest("POST", "/rest/v1/lifehq_docs", {"on_conflict": "owner,collection,id"},
         [{"owner": OWNER, "collection": collection, "id": id_, "data": {} if deleted else data, "updated_at": u, "deleted": deleted}],
         prefer="resolution=merge-duplicates,return=minimal")
    return id_

# ---------- schemas (mirror app-v2.js `S`) ----------
DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
SCHEMA = {
  "tasks":    {"fields": ["title","goal","area","priority","due","status","notes"], "req": ["title"], "num": [],
               "opts": {"area": ["PerformCore","SJR","Personal","Home","Other"], "priority": ["High","Medium","Low"], "status": ["To do","Doing","Done"]},
               "defaults": {"area": "PerformCore", "priority": "Medium", "status": "To do"}},
  "workouts": {"fields": ["title","day","time","type","duration","details"], "req": ["title","day"], "num": ["duration"],
               "opts": {"day": DAYS, "type": ["Strength","Cardio","Mobility","Sport","Rest"]}, "defaults": {"type": "Strength"}, "extra": {"doneDates": []}},
  "accounts": {"fields": ["name","division","type","terms","contact","phone","email","address","rates","notes"], "req": ["name"], "num": ["terms"],
               "opts": {"division": ["Automotive","Residential","Commercial"]}, "defaults": {"division": "Automotive"}},
  "people":   {"fields": ["name","circle","cadence","last","how","next","notes"], "req": ["name"], "num": [],
               "opts": {"circle": ["Family","Friend","Business","Client","Mentor"], "cadence": ["7","14","30","60","90"]}, "defaults": {"circle": "Friend", "cadence": "30"}},
  "ideas":    {"fields": ["title","area","stage","score","notes"], "req": ["title"], "num": ["score"],
               "opts": {"area": ["PerformCore","SJR","New venture","Content","Personal"], "stage": ["Raw","Exploring","Building","Parked"], "score": [1,2,3,4,5]},
               "defaults": {"area": "PerformCore", "stage": "Raw", "score": 3}},
  "goals":    {"fields": ["title","area","status","target","deadline","next","why"], "req": ["title"], "num": [],
               "opts": {"status": ["Active","Ongoing","Next","Parked","Done"]}, "defaults": {"area": "PerformCore", "status": "Active"}},
  "blocks":   {"fields": ["focus","day","area","start","end","goal"], "req": ["focus","day","start","end"], "num": [], "opts": {"day": DAYS}, "defaults": {}},
  "films":    {"fields": ["name","category","rate","divisions","notes"], "req": ["name","rate"], "num": ["rate"], "opts": {}, "defaults": {"category": "Solar control", "divisions": "Residential & Commercial"}},
  "budgets":  {"fields": ["category","limit"], "req": ["category","limit"], "num": ["limit"], "opts": {}, "defaults": {}},
  "money":    {"fields": ["kind","amount","party","entity","category","date","due","status","notes"], "req": ["kind","amount","party","date"], "num": ["amount"],
               "opts": {"kind": ["Expense","Income"], "entity": ["PerformCore","SJR Wealth Group","Personal","Other"]}, "defaults": {"entity": "PerformCore", "kind": "Expense"}},
  "designs":  {"fields": ["title","project","status","link","image","notes"], "req": ["title"], "num": [], "opts": {"status": ["Concept","In progress","Final"]}, "defaults": {"status": "Concept"}},
}
ACCT_TYPES = {"Automotive": ["Detail shop","Dealership","Body shop","Fleet","Wholesale","Other"], "Residential": ["Builder","Homeowner","HOA","Property manager","Other"],
              "Commercial": ["Property manager","General contractor","Business owner","Building owner","Other"]}
SERVICES = {"Automotive": ["Auto tint","PPF","Ceramic coating","Flat glass","Other"], "Residential": ["Solar control","Privacy / decorative","Security / safety","Removal","Other"],
            "Commercial": ["Solar control","Security / safety","Privacy / decorative","Anti-graffiti","Removal","Other"]}

def parse_kv(pairs):
    out = {}
    for p in pairs:
        if ":=" in p: k, v = p.split(":=", 1); out[k] = json.loads(v)
        elif "=" in p: k, v = p.split("=", 1); out[k] = v
        else: sys.exit(f"Expected key=value, got {p!r}")
    return out

def build_doc(col, vals, existing=None):
    sc = SCHEMA.get(col)
    if not sc: sys.exit(f"Use the dedicated command for {col} (job/invoice) or one of: {', '.join(SCHEMA)}")
    d = dict(existing) if existing else {f: "" for f in sc["fields"]}
    if not existing:
        d.update(sc.get("defaults", {})); d.update(json.loads(json.dumps(sc.get("extra", {}))))
    for k, v in vals.items():
        if k in sc["num"] and v != "" and not isinstance(v, (int, float)): v = float(v) if "." in str(v) else int(v)
        if k in sc["opts"] and v != "" and v not in sc["opts"][k]: sys.exit(f"{col}.{k} must be one of {sc['opts'][k]}")
        d[k] = v
    if col == "accounts":
        div = d.get("division") or "Automotive"
        if not d.get("type"): d["type"] = ACCT_TYPES[div][0]
        if d.get("terms") in ("", None): d["terms"] = 7 if div == "Automotive" else 15
    miss = [f for f in sc["req"] if d.get(f) in ("", None)]
    if miss: sys.exit(f"Missing: {', '.join(miss)}")
    n = now_iso(); d["updated"] = n
    if not existing: d["created"] = n
    return d

# ---------- lookups ----------
def find_account(ref):
    acc = docs("accounts")
    for a in acc:
        if a["id"] == ref: return a
    m = [a for a in acc if ref.lower() in (a.get("name") or "").lower()]
    if len(m) == 1: return m[0]
    sys.exit(f"Account {ref!r}: {'no match' if not m else 'ambiguous: ' + ', '.join(a['name'] for a in m)}")
def inv_settings():
    s = {"bizName": "PerformCore", "prefix": "PC-", "terms": 7}
    r = get_row("settings", "invoice")
    if r and not r["deleted"]: s.update(r["data"])
    return s
def next_inv_number():
    p = inv_settings().get("prefix") or ""; mx = 1000
    for m in docs("money"):
        num = str(m.get("number") or "")
        if num.startswith(p):
            mm = re.match(r"\d+", num[len(p):])
            if mm: mx = max(mx, int(mm.group()))
    return p + str(mx + 1)
def find_invoice(ref):
    for m in docs("money"):
        if m.get("kind") == "Invoice" and (m["id"] == ref or m.get("number") == ref): return m
    sys.exit(f"No invoice {ref!r}")

def job_lines(a):  # mirrors jobLines()/jobLine() in app-v2.js
    flat = (a.get("division") or "Automotive") != "Automotive"
    when = a.get("completedAt") or a.get("when")
    if flat and a.get("lines"):
        w = f" ({fmt_date(when)})" if when else ""
        return [{"desc": " · ".join(x for x in [a.get("job"), l.get("area"), l.get("film")] if x) + w, "filmId": l.get("filmId") or "",
                 "sqft": l.get("sqft") or "", "rate": l.get("rate") or "", "amount": float(l.get("amount") or 0)} for l in a["lines"]]
    if flat:
        d = " · ".join(x for x in [a.get("job"), a.get("service"), a.get("film")] if x) + (f" ({fmt_date(when)})" if when else "")
        return [{"desc": d, "sqft": a.get("sqft") or "", "rate": a.get("rate") or "", "amount": float(a.get("price") or 0)}]
    bits = " · ".join(x for x in [a.get("job"), a.get("service")] if x)
    extra = re.sub(r"\s*\n\s*", "; ", a.get("notes") or "").strip() or a.get("film") or ""
    return [{"desc": bits + (f" — {extra}" if extra else "") + (f" ({fmt_date(a['when'])})" if a.get("when") else ""), "vin": a.get("vin") or "", "amount": float(a.get("price") or 0)}]

def num(x):
    x = float(x or 0); return int(x) if x == int(x) else round(x, 2)

# ---------- commands ----------
def show(items, as_json):
    if as_json: print(json.dumps(items, indent=1, ensure_ascii=False)); return
    for d in items:
        label = d.get("title") or d.get("name") or d.get("number") or d.get("job") or d.get("focus") or d.get("category") or ""
        extra = [str(d[k]) for k in ("client","party","status","due","when","amount","price","division") if d.get(k) not in (None, "")]
        print(f"{d['id']:<22} {label[:60]:<60} {' · '.join(extra)[:90]}")
    print(f"({len(items)})", file=sys.stderr)

def cmd_list(a):
    items = docs(a.collection)
    for w in a.where or []:
        k, v = w.split("=", 1); items = [d for d in items if str(d.get(k, "")) == v]
    show(items, a.json)
def cmd_get(a):
    r = get_row(a.collection, a.id)
    if not r: sys.exit("Not found")
    print(json.dumps({"id": a.id, **r["data"], "_updated_at": r["updated_at"], "_deleted": r["deleted"]}, indent=1, ensure_ascii=False))
def cmd_search(a):
    q = a.text.lower(); hits = []
    for r in rows(a.collection):
        if q in json.dumps(r["data"], ensure_ascii=False).lower(): hits.append({"_col": r["collection"], "id": r["id"], **r["data"]})
    if a.json: print(json.dumps(hits, indent=1, ensure_ascii=False))
    else:
        for h in hits: print(f"{h['_col']:<9}", end=" "); show([h], False)
def cmd_add(a):
    d = build_doc(a.collection, parse_kv(a.pairs)); i = put(a.collection, new_id(), d); print(i)
def cmd_update(a):
    r = get_row(a.collection, a.id)
    if not r or r["deleted"]: sys.exit("Not found")
    vals = parse_kv(a.pairs)
    d = build_doc(a.collection, vals, r["data"]) if a.collection in SCHEMA else {**r["data"], **vals, "updated": now_iso()}
    put(a.collection, a.id, d); print(a.id)
def cmd_delete(a):
    if not a.yes: sys.exit("Deleting removes it from every device. Re-run with --yes.")
    put(a.collection, a.id, {}, deleted=True); print("deleted", a.id)

def cmd_job(a):
    div = a.division
    if a.service and a.service not in SERVICES[div]: sys.exit(f"service must be one of {SERVICES[div]}")
    acct = find_account(a.account) if a.account else None
    if acct and (acct.get("division") or "Automotive") != div: sys.exit(f"{acct['name']} is a {acct.get('division')} account")
    client = acct["name"] if acct else (a.client or "")
    if not client: sys.exit("Give --account or --client")
    if not a.when: sys.exit("--when is required (YYYY-MM-DDTHH:MM, Eastern)")
    d = {"division": div, "accountId": acct["id"] if acct else "", "client": client, "phone": a.phone or "", "when": a.when, "job": a.vehicle or a.job or "",
         "service": a.service or SERVICES[div][0], "status": a.status, "completedAt": a.completed or "", "tech": a.tech or "", "notes": a.notes or ""}
    if div == "Automotive":
        vin = re.sub(r"[^A-Z0-9]", "", (a.vin or "").upper())
        if vin and (len(vin) != 17 or re.search(r"[IOQ]", vin)): sys.exit("VIN must be 17 characters with no I, O or Q")
        d.update({"vin": vin, "film": a.film or "", "price": num(a.price) if a.price not in (None, "") else ""})
    else:
        films = {f["id"]: f for f in docs("films")}; lines = []
        for spec in a.line or []:   # "film|sqft|rate|area"   film = film id or name; rate optional if film has one
            p = (spec.split("|") + ["", "", "", ""])[:4]
            f = films.get(p[0]) or next((x for x in films.values() if x.get("name", "").lower() == p[0].lower()), None)
            rate = float(p[2]) if p[2] else float((f or {}).get("rate") or 0); sq = float(p[1] or 0)
            if not (sq > 0 and rate > 0): sys.exit(f"Line {spec!r} needs square feet and a rate")
            lines.append({"filmId": f["id"] if f else "", "film": f["name"] if f else p[0], "area": p[3], "sqft": num(sq), "rate": num(rate), "amount": num(round(sq * rate, 2))})
        if not lines: sys.exit("Residential/Commercial jobs need at least one --line 'film|sqft|rate|area'")
        d["lines"] = lines; d["sqft"] = num(sum(l["sqft"] for l in lines)); d["price"] = num(round(sum(l["amount"] for l in lines), 2))
        d["rate"] = num(round(d["price"] / d["sqft"], 2)) if d["sqft"] else 0; d["film"] = ", ".join(dict.fromkeys(l["film"] for l in lines))
    if d["status"] in ("Done", "Paid") and not d["completedAt"]: d["completedAt"] = local_dt()
    if d["status"] == "Paid": d["paidDate"] = today()
    n = now_iso(); d["updated"] = n; d["created"] = n
    print(put("tints", new_id(), d))

def cmd_inv_next(a): print(next_inv_number())
def cmd_inv_create(a):
    st = inv_settings(); jobs = []
    if a.jobs:
        allj = {j["id"]: j for j in docs("tints")}
        for jid in a.jobs.split(","):
            j = allj.get(jid.strip()) or sys.exit(f"No job {jid}")
            if j.get("invoiceId") and not a.force: sys.exit(f"Job {jid} is already on invoice {j.get('invoiceNumber')}")
            jobs.append(j)
        if len({j.get("division") or "Automotive" for j in jobs}) > 1: sys.exit("Jobs are from different divisions")
    acct = find_account(a.account) if a.account else (next((x for x in docs("accounts") if x["id"] == jobs[0].get("accountId")), None) if jobs and jobs[0].get("accountId") else None)
    party = a.party or (acct["name"] if acct else (jobs[0].get("client") if jobs else ""))
    if not party: sys.exit("Need --jobs, --account or --party")
    lines = [l for j in jobs for l in job_lines(j)]
    if len(jobs) == 1 and jobs[0].get("vin") and (jobs[0].get("division") or "Automotive") == "Automotive":
        for l in lines:
            if not l.get("vin"): l["vin"] = jobs[0]["vin"]
    for spec in a.line or []:  # "desc|amount[|vin]"  negative amount = deposit/payment
        p = (spec.split("|") + ["", "", ""])[:3]; lines.append({"desc": p[0], "vin": p[2], "amount": float(p[1] or 0)})
    if not lines: sys.exit("No lines: give --jobs and/or --line 'desc|amount'")
    for l in lines:
        if l.get("sqft") and l.get("rate") and float(l.get("amount") or 0) >= 0: l["amount"] = round(float(l["sqft"]) * float(l["rate"]), 2)
    number = a.number or next_inv_number()
    if any(m.get("number") == number for m in docs("money")): sys.exit(f"Invoice {number} already exists")
    date = a.date or today(); due = a.due or add_days(date, int((acct or {}).get("terms") or st.get("terms") or 7))
    division = a.division or (jobs[0].get("division") or "Automotive" if jobs else (acct or {}).get("division", ""))
    n = now_iso()
    body = {"kind": "Invoice", "number": number, "party": party,
            "billTo": a.bill_to if a.bill_to is not None else ("\n".join(x for x in [acct.get("contact"), acct.get("phone"), acct.get("email"), acct.get("address")] if x) if acct else ""),
            "entity": "PerformCore", "category": division, "amount": num(sum(float(l.get("amount") or 0) for l in lines)), "date": date, "due": due, "status": a.status,
            "lines": [{"desc": str(l.get("desc", "")), "vin": str(l.get("vin") or ""), "filmId": str(l.get("filmId") or ""), "sqft": num(l.get("sqft") or 0), "rate": num(l.get("rate") or 0), "amount": num(l.get("amount") or 0)} for l in lines],
            "division": division, "jobIds": [j["id"] for j in jobs], "accountId": (acct or {}).get("id", ""), "notes": a.notes or "", "updated": n, "created": n}
    iid = put("money", new_id(), body)
    for j in jobs:
        put("tints", j["id"], {**j, "invoiceId": iid, "invoiceNumber": number, "invoicedAt": local_dt(), "updated": n})
    print(json.dumps({"id": iid, "number": number, "amount": body["amount"], "party": party, "due": due, "jobs": body["jobIds"]}))
    if a.pdf: make_pdf(iid, a.out)
def cmd_inv_paid(a):
    inv = find_invoice(a.ref); d = today(); n = now_iso()
    put("money", inv["id"], {**inv, "status": "Paid", "paidDate": d, "updated": n})
    allj = {j["id"]: j for j in docs("tints")}
    for jid in inv.get("jobIds") or []:
        j = allj.get(jid)
        if j and j.get("status") != "Paid": put("tints", jid, {**j, "status": "Paid", "paidDate": d, "updated": n})
    print("paid", inv.get("number"))

def make_pdf(ref, out_dir="/workspace/invoices"):
    """Render with the app's own buildPdf() in headless Chromium, so the PDF is identical to the app's."""
    from playwright.sync_api import sync_playwright
    inv = find_invoice(ref); os.makedirs(out_dir, exist_ok=True)
    cols = {c: docs(c) for c in ("settings", "films", "accounts", "tints", "money")}
    class Q(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *x, **k): super().__init__(*x, directory=APP_DIR, **k)
        def log_message(s, *x): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Q); threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
            ctx = b.new_context(timezone_id="America/New_York", service_workers="block", accept_downloads=True); pg = ctx.new_page()
            pg.goto(f"http://127.0.0.1:{srv.server_port}/"); pg.wait_for_function("window.LHQ && window.LHQ_PDF && window.jspdf")
            pg.evaluate("t=>LHQ.importBackup(t)", json.dumps({"collections": cols}))
            pg.wait_for_function("id=>!!LHQ_PDF.build(id)", arg=inv["id"], timeout=10000)
            b64 = pg.evaluate("""id=>new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result.split(",")[1]); fr.readAsDataURL(LHQ_PDF.build(id)); })""", inv["id"])
            b.close()
    finally: srv.shutdown()
    path = os.path.join(out_dir, f"{inv['number']}.pdf"); open(path, "wb").write(base64.b64decode(b64)); print(path); return path
def cmd_inv_pdf(a): make_pdf(a.ref, a.out)

# ---------- invoice email (Edge Function send-invoice, SMTPS via PerformCore's mail server) ----------
SELF = "hello@performcoregroup.com"
def fmt_long(s):
    if not s: return ""
    d = dt.date.fromisoformat(s[:10]); return f"{d:%b} {d.day}, {d.year}"
def money2(x): return "${:,.2f}".format(float(x or 0))
SIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "email")
def _sig(name): return open(os.path.join(SIG_DIR, name)).read().strip()
def sig_placeholder(): return os.path.exists(os.path.join(SIG_DIR, "confidentiality-notice.PLACEHOLDER"))
def add_signature(text, html=None):
    """Every hello@ email ends with Sean's signature card + confidentiality notice (Sean, Nov 13, 2026).
    Adds them to the plain text and the HTML part (HTML is built from the text if none was given). Skips anything already present."""
    import html as H
    card_t, card_h, notice = _sig("signature-card.txt"), _sig("signature-card.html"), _sig("confidentiality-notice.txt")
    text = text.rstrip()
    has_card_t = "296-9853" in text and "Owner" in text
    if not has_card_t: text += "\n\n" + card_t
    has_notice = lambda x: notice[:40] in x or ("confidential" in x.lower() and "intended only for" in x.lower())
    if not has_notice(text): text += "\n\n" + notice
    text += "\n"
    if html is None:
        body = text[: text.find(card_t)] if not has_card_t and card_t in text else text
        body = body.replace(notice, "").rstrip()
        p = 'font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#1E1E1E;margin:0 0 14px 0;'
        html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;background:#ffffff;">' + "".join(
            f'<p style="{p}">' + "<br>".join(H.escape(l) for l in para.split("\n")) + "</p>" for para in body.split("\n\n") if para.strip()) + "</body></html>"
    has_card_h = any(k in html for k in ("logo-p.png", "logo-sig.png", "BUILDING PERFORMANCE COMPANY"))
    add = ""
    if not has_card_h: add += '<div style="margin-top:22px;">' + card_h + "</div>"
    if not has_notice(html + add):
        add += ('<p style="font-family:Helvetica,Arial,sans-serif;font-size:10px;line-height:14px;color:#8A918B;margin:18px 0 0 0;max-width:560px;">'
                + H.escape(notice) + "</p>")
    if add: html = html.replace("</body>", add + "</body>", 1) if "</body>" in html else html + add
    return text, html
def default_email(inv, acct, st):
    who = ((acct or {}).get("contact") or "").split(" ")[0] or "there"
    paid = inv.get("status") == "Paid"
    lines = [f"Hi {who},", "",
             f"Attached is invoice {inv['number']} from PerformCore for {money2(inv.get('amount'))}" + ("." if paid else f", due {fmt_long(inv.get('due'))}."), ""]
    if not paid and st.get("payment"): lines += ["How to pay:", st["payment"], ""]
    lines += [("Thank you for your business." if paid else f"Please reference {inv['number']} with your payment. Thank you!"), "",
              "Sean Rodriguez"]  # contact details come from the signature card (add_signature)
    return f"Invoice {inv['number']} from PerformCore", "\n".join(lines)
def confirm_token(payload):
    import hashlib
    keep = {k: payload[k] for k in ("to", "cc", "bcc", "subject", "text")}; keep["html"] = payload.get("html")
    keep["attachment"] = payload["attachment"]["filename"]; keep["inv"] = payload["_inv"]
    return hashlib.sha256(json.dumps(keep, sort_keys=True).encode()).hexdigest()[:10]
def cmd_email_invoice(a):
    import tempfile
    inv = find_invoice(a.ref); st = inv_settings()
    acct = next((x for x in docs("accounts") if x["id"] == inv.get("accountId")), None) if inv.get("accountId") else None
    to = [x.strip() for t in a.to for x in t.split(",") if x.strip()]; cc = [x.strip() for t in (a.cc or []) for x in t.split(",") if x.strip()]
    bcc = [] if a.no_bcc_self or SELF in to + cc else [SELF]
    subj, body = default_email(inv, acct, st)
    if a.subject: subj = a.subject
    if a.body_file: body = open(a.body_file).read().rstrip() + "\n"
    body, ihtml = add_signature(body)
    tmp = tempfile.mkdtemp(prefix="lhq-mail-"); path = make_pdf(inv["id"], tmp) if not a.pdf else a.pdf
    data = open(path, "rb").read(); fname = f"{inv['number']} {inv.get('party') or ''}".strip()
    fname = re.sub(r"[^\w\- &]+", "", fname).strip() + ".pdf"
    payload = {"to": to, "cc": cc, "bcc": bcc, "subject": subj, "text": body, "html": ihtml, "attachment": {"filename": fname, "contentBase64": base64.b64encode(data).decode()},
               "_inv": [inv["id"], inv.get("number"), inv.get("amount"), inv.get("updated")]}
    token = confirm_token(payload)
    if a.confirm != token:
        print("=== PREVIEW (not sent) ===")
        print(f"From:       PerformCore <{SELF}>"); print(f"To:         {', '.join(to)}")
        if cc: print(f"Cc:         {', '.join(cc)}")
        if bcc: print(f"Bcc:        {', '.join(bcc)}  (copy to Sean's inbox for his records)")
        print(f"Subject:    {subj}"); print(f"Attachment: {fname} ({len(data)/1024:.1f} KB, {inv['number']}, {money2(inv.get('amount'))}, status {inv.get('status')})")
        if acct and acct.get("email") and acct["email"] not in to: print(f"Note:       the account's email on file is {acct['email']}")
        print("HTML part:  built from the text + signature card + notice")
        if sig_placeholder(): print("NOTE:       confidentiality notice wording is a PLACEHOLDER pending Sean's exact text")
        print("--- body ---"); print(body); print("------------")
        if a.confirm: print(f"The --confirm token doesn't match this exact email (something changed). Expected {token}.")
        print(f"To send EXACTLY this email, after Sean approves it in chat: lhq email-invoice {a.ref} ... --confirm {token}")
        return
    payload.pop("_inv")
    req = urllib.request.Request(URL + "/functions/v1/send-invoice", method="POST", data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "x-lhq-secret": ENV["LHQ_FN_SECRET"]})
    try:
        with urllib.request.urlopen(req, timeout=90) as r: res = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("NOT SENT: " + e.read().decode()[:500])
    print(json.dumps({k: res.get(k) for k in ("ok", "accepted", "rejected", "response", "messageId")}))
    if res.get("ok") and not a.no_log:
        cur = get_row("money", inv["id"])["data"]
        log = (cur.get("emailLog") or []) + [{"at": now_iso(), "to": to, "cc": cc, "subject": subj, "messageId": res.get("messageId")}]
        put("money", inv["id"], {**cur, "emailLog": log, **({"status": "Sent"} if cur.get("status") == "Draft" else {}), "updated": now_iso()})

def email_token(payload):
    import hashlib
    h = hashlib.sha256()
    keep = {k: payload.get(k) for k in ("to", "cc", "bcc", "subject", "text", "html")}
    h.update(json.dumps(keep, sort_keys=True).encode())
    att = payload.get("attachment")
    h.update(b"\x00ATT:" + ((att["filename"].encode() + b"\x00" + base64.b64decode(att["contentBase64"])) if att else b"none"))
    return h.hexdigest()[:12]
def cmd_email(a):
    """Non-invoice email (quotes, letters). Preview + token; sends only with --confirm <matching token>."""
    split = lambda v: [x.strip() for t in (v or []) for x in t.split(",") if x.strip()]
    to, cc, bcc = split(a.to), split(a.cc), split(a.bcc)
    body = open(a.body_file).read().rstrip() + "\n"
    html = open(a.html_file).read() if a.html_file else None
    body, html = add_signature(body, html)
    payload = {"to": to, "cc": cc, "bcc": bcc, "subject": a.subject, "text": body, "html": html}
    data = None
    if a.pdf:
        data = open(a.pdf, "rb").read()
        if data[:5] != b"%PDF-": sys.exit("NOT SENT: --pdf is not a PDF")
        fname = a.attach_name or os.path.basename(a.pdf)
        payload["attachment"] = {"filename": fname, "contentBase64": base64.b64encode(data).decode()}
    token = email_token(payload)
    if a.confirm != token:
        print("=== PREVIEW (not sent) ===")
        print(f"From:       PerformCore <{SELF}>"); print(f"To:         {', '.join(to)}")
        if cc: print(f"Cc:         {', '.join(cc)}")
        if bcc: print(f"Bcc:        {', '.join(bcc)}")
        print(f"Subject:    {a.subject}")
        print(f"Attachment: {payload['attachment']['filename']} ({len(data)/1024:.1f} KB)" if data is not None else "Attachment: none")
        print(f"HTML part:  {a.html_file or 'built from the text'} + signature card + notice ({len(html)} chars)")
        if sig_placeholder(): print("NOTE:       confidentiality notice wording is a PLACEHOLDER pending Sean's exact text")
        print("--- body (plain text) ---"); print(body); print("------------")
        if a.confirm: print(f"The --confirm token doesn't match this exact email (something changed). Expected {token}. NOT SENT.")
        print(f"To send EXACTLY this email, after Sean approves it in chat: rerun the same command with --confirm {token}")
        return
    req = urllib.request.Request(URL + "/functions/v1/send-invoice", method="POST", data=json.dumps(payload).encode(),
                                 headers={"content-type": "application/json", "x-lhq-secret": ENV["LHQ_FN_SECRET"]})
    try:
        with urllib.request.urlopen(req, timeout=90) as r: res = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("NOT SENT: " + e.read().decode()[:500])
    print(json.dumps({k: res.get(k) for k in ("ok", "accepted", "rejected", "response", "messageId", "attachment")}))

def cmd_export(a):
    out = {"app": "Sean's Life HQ", "format": 1, "exportedAt": now_iso(), "collections": {c: docs(c) for c in COLS}}
    s = json.dumps(out, indent=1, ensure_ascii=False)
    if a.out: open(a.out, "w").write(s); print(a.out)
    else: print(s)
def cmd_import(a):  # merge by id; never deletes; existing docs untouched unless --overwrite
    obj = json.load(open(a.file)); cols = obj.get("collections", obj); have = {(r["collection"], r["id"]) for r in rows(deleted=True)}; n = 0
    for c in COLS:
        for d in cols.get(c) or []:
            i = str(d.get("id") or new_id())
            if (c, i) in have and not a.overwrite: continue
            put(c, i, d); n += 1
    print(f"imported {n}")
def cmd_signin_code(a):
    email = a.email or "hello@performcoregroup.com"
    r = rest("POST", "/auth/v1/admin/generate_link", body={"type": "magiclink", "email": email})
    print(r.get("email_otp") or r.get("properties", {}).get("email_otp"))
    print(f"6-digit sign-in code for {email}, valid 15 minutes, works once. Give it only to Sean.", file=sys.stderr)
def cmd_whoami(a):
    print(json.dumps({"owner": OWNER, "is_sean": OWNER == ENV["SEAN_USER_ID"], "project": ENV["SUPABASE_PROJECT_REF"], "app_dir": APP_DIR}))

def main():
    ap = argparse.ArgumentParser(prog="lhq", description=__doc__)
    ap.add_argument("--owner", help="act as another user id (scratch testing). Default: Sean")
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("list"); s.add_argument("collection", choices=COLS); s.add_argument("--where", action="append"); s.add_argument("--json", action="store_true"); s.set_defaults(f=cmd_list)
    s = sp.add_parser("get"); s.add_argument("collection", choices=COLS); s.add_argument("id"); s.set_defaults(f=cmd_get)
    s = sp.add_parser("search"); s.add_argument("text"); s.add_argument("--collection", choices=COLS); s.add_argument("--json", action="store_true"); s.set_defaults(f=cmd_search)
    s = sp.add_parser("add"); s.add_argument("collection", choices=list(SCHEMA)); s.add_argument("pairs", nargs="*"); s.set_defaults(f=cmd_add)
    s = sp.add_parser("update"); s.add_argument("collection", choices=COLS); s.add_argument("id"); s.add_argument("pairs", nargs="+"); s.set_defaults(f=cmd_update)
    s = sp.add_parser("delete"); s.add_argument("collection", choices=COLS); s.add_argument("id"); s.add_argument("--yes", action="store_true"); s.set_defaults(f=cmd_delete)
    s = sp.add_parser("job", help="book a job (tints collection)")
    s.add_argument("--division", default="Automotive", choices=["Automotive","Residential","Commercial"]); s.add_argument("--account"); s.add_argument("--client")
    s.add_argument("--when", help="YYYY-MM-DDTHH:MM Eastern"); s.add_argument("--vehicle"); s.add_argument("--job", help="property/address (Res/Com)"); s.add_argument("--vin")
    s.add_argument("--service"); s.add_argument("--film"); s.add_argument("--price"); s.add_argument("--line", action="append", help="Res/Com: 'film|sqft|rate|area'")
    s.add_argument("--status", default="Booked", choices=["Booked","Confirmed","Done","Paid","Cancelled"]); s.add_argument("--completed"); s.add_argument("--phone"); s.add_argument("--tech"); s.add_argument("--notes"); s.set_defaults(f=cmd_job)
    s = sp.add_parser("invoice"); isp = s.add_subparsers(dest="icmd", required=True)
    x = isp.add_parser("next-number"); x.set_defaults(f=cmd_inv_next)
    x = isp.add_parser("create"); x.add_argument("--jobs", help="job ids, comma separated"); x.add_argument("--account"); x.add_argument("--party"); x.add_argument("--bill-to")
    x.add_argument("--line", action="append", help="'desc|amount[|vin]' (negative = deposit)"); x.add_argument("--number"); x.add_argument("--date"); x.add_argument("--due"); x.add_argument("--division")
    x.add_argument("--status", default="Sent", choices=["Draft","Sent","Paid"]); x.add_argument("--notes"); x.add_argument("--force", action="store_true"); x.add_argument("--pdf", action="store_true"); x.add_argument("--out", default="/workspace/invoices"); x.set_defaults(f=cmd_inv_create)
    x = isp.add_parser("pdf"); x.add_argument("ref", help="invoice number or id"); x.add_argument("--out", default="/workspace/invoices"); x.set_defaults(f=cmd_inv_pdf)
    x = isp.add_parser("paid"); x.add_argument("ref"); x.set_defaults(f=cmd_inv_paid)
    s = sp.add_parser("email-invoice", help="preview, or with --confirm TOKEN send, an invoice PDF by email (ONLY after Sean approves the exact email)")
    s.add_argument("ref", help="invoice number or id"); s.add_argument("--to", action="append", required=True); s.add_argument("--cc", action="append")
    s.add_argument("--subject"); s.add_argument("--body-file"); s.add_argument("--pdf", help="use this PDF instead of rendering"); s.add_argument("--no-bcc-self", action="store_true")
    s.add_argument("--no-log", action="store_true", help="don't record the send on the invoice"); s.add_argument("--confirm", metavar="TOKEN", help="token printed by the preview")
    s.set_defaults(f=cmd_email_invoice)
    s = sp.add_parser("email", help="preview, or with --confirm TOKEN send, a NON-invoice email (optional PDF). ONLY after Sean approves the exact email")
    s.add_argument("--to", action="append", required=True); s.add_argument("--cc", action="append"); s.add_argument("--bcc", action="append")
    s.add_argument("--subject", required=True); s.add_argument("--body-file", required=True); s.add_argument("--html-file", help="optional HTML part")
    s.add_argument("--pdf", help="optional PDF attachment"); s.add_argument("--attach-name", help="attachment filename (default: the PDF's name)")
    s.add_argument("--confirm", metavar="TOKEN", help="token printed by the preview"); s.set_defaults(f=cmd_email)
    s = sp.add_parser("export"); s.add_argument("--out"); s.set_defaults(f=cmd_export)
    s = sp.add_parser("import"); s.add_argument("file"); s.add_argument("--overwrite", action="store_true"); s.set_defaults(f=cmd_import)
    s = sp.add_parser("signin-code"); s.add_argument("--email"); s.set_defaults(f=cmd_signin_code)
    s = sp.add_parser("whoami"); s.set_defaults(f=cmd_whoami)
    a = ap.parse_args()
    global OWNER
    if a.owner: OWNER = a.owner
    a.f(a)
if __name__ == "__main__": main()
