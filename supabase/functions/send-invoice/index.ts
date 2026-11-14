// send-invoice: emails one invoice PDF (attachment optional since Nov 13, 2026) from hello@performcoregroup.com through PerformCore's own mail server (SMTPS 465).
// Only callable with the shared secret (header x-lhq-secret), which lives in Supabase function secrets and on the
// assistant's box. Never logs credentials or message bodies.
import nodemailer from "npm:nodemailer@6.9.16";

const env = (k: string) => Deno.env.get(k) ?? "";
const FROM = { name: "PerformCore", address: "hello@performcoregroup.com" };
const EMAIL = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[A-Za-z]{2,}$/;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((s) => String(s).trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });
  const secret = env("LHQ_FN_SECRET");
  if (!secret || !safeEqual(req.headers.get("x-lhq-secret") ?? "", secret)) return json(401, { ok: false, error: "unauthorized" });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "body must be JSON" }); }
  const to = list(b.to), cc = list(b.cc), bcc = list(b.bcc);
  const all = [...to, ...cc, ...bcc];
  if (!to.length) return json(400, { ok: false, error: "to is required" });
  if (all.length > 10) return json(400, { ok: false, error: "at most 10 recipients" });
  const bad = all.filter((e) => !EMAIL.test(e));
  if (bad.length) return json(400, { ok: false, error: "invalid address: " + bad.join(", ") });
  const subject = String(b.subject ?? "").trim();
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) return json(400, { ok: false, error: "subject: 1-200 chars, one line" });
  const text = String(b.text ?? "");
  if (!text.trim() || text.length > 20000) return json(400, { ok: false, error: "text body: 1-20000 chars" });
  const html = b.html == null ? undefined : String(b.html);
  if (html && html.length > 200000) return json(400, { ok: false, error: "html too long" });

  // Attachment is optional. When present it is validated exactly as before (PDF only, simple filename, max 8 MB).
  const att = (b.attachment ?? null) as { filename?: string; contentBase64?: string } | null;
  let pdf: { filename: string; bytes: Uint8Array } | null = null;
  if (att) {
    if (!att.contentBase64 || !att.filename) return json(400, { ok: false, error: "attachment {filename, contentBase64} required" });
    const filename = String(att.filename);
    if (!/^[\w\- .&()#]{1,120}\.pdf$/i.test(filename)) return json(400, { ok: false, error: "attachment must be a .pdf with a simple filename" });
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(String(att.contentBase64)), (c) => c.charCodeAt(0)); } catch { return json(400, { ok: false, error: "attachment is not base64" }); }
    if (bytes.length > 8 * 1024 * 1024) return json(400, { ok: false, error: "attachment over 8 MB" });
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return json(400, { ok: false, error: "attachment is not a PDF" });
    pdf = { filename, bytes };
  }

  const summary = { to, cc, bcc, subject, attachment: pdf ? { filename: pdf.filename, bytes: pdf.bytes.length } : null };
  if (b.dryRun === true) return json(200, { ok: true, dryRun: true, ...summary });

  const host = env("SMTP_HOST"), user = env("SMTP_USER"), pass = env("SMTP_PASS"), port = Number(env("SMTP_PORT") || 465);
  if (!host || !user || !pass) return json(500, { ok: false, error: "SMTP not configured" });
  const tx = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass },
    connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 30000 });
  try {
    const info = await tx.sendMail({
      from: FROM, replyTo: FROM.address, to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, subject, text, html,
      attachments: pdf ? [{ filename: pdf.filename, content: pdf.bytes, contentType: "application/pdf" }] : [],
    });
    console.log("send-invoice sent", JSON.stringify({ recipients: all.length, filename: pdf?.filename ?? null, bytes: pdf?.bytes.length ?? 0, response: info.response }));
    return json(200, { ok: true, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response, ...summary });
  } catch (e) {
    const err = e as { message?: string; code?: string; responseCode?: number; command?: string };
    console.error("send-invoice failed", JSON.stringify({ code: err.code, responseCode: err.responseCode, command: err.command, message: (err.message ?? "").slice(0, 300) }));
    return json(502, { ok: false, error: (err.message ?? "send failed").slice(0, 300), code: err.code, responseCode: err.responseCode, command: err.command });
  } finally { tx.close(); }
});
