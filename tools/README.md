# Life HQ assistant CLI (lhq)

`tools/lhq.py` is the box CLI for Sean's Life HQ data and email. It reads secrets from a local file outside this repo; none are committed here.

## Non-invoice email: `lhq email` (added Nov 13, 2026)
**RULE (COO/CEO, Nov 13, 2026): agents send non-invoice email (quotes, letters, intros) ONLY through `lhq email`; never call the
send-invoice function directly.** Sean must approve the exact email (recipients, subject, body, attachment) in chat first, and
tests go only to hello@performcoregroup.com.
```
lhq email --to a@b.com [--cc ...] [--bcc hello@performcoregroup.com] --subject "..." --body-file body.txt [--html-file body.html] [--pdf file.pdf --attach-name "Q-1002 Client.pdf"]
#   -> prints a full PREVIEW and a 12-char token. Nothing is sent.
lhq email ...same args... --confirm <token>
#   -> sends exactly that email through send-invoice. Token = sha256 of to, cc, bcc, subject, text body, HTML part, and the
#      attachment filename + bytes (or "none"), so any change gives a new preview instead of a send.
```
Bcc is not added automatically here (unlike email-invoice); pass `--bcc hello@performcoregroup.com` for Sean's copy.
The send-invoice function accepts an optional attachment since Nov 13, 2026 (v3, commit c0c665d); with one it validates exactly as before.

**Signature card (Sean, Nov 13, 2026):** `lhq email` and `lhq email-invoice` automatically end every email with Sean's signature
card and confidentiality notice, in both the plain text and the HTML part (HTML is built from the text when no --html-file is
given). Card/notice already present are not added twice. Sources: `email/signature-card.html`, `email/signature-card.txt`,
`email/confidentiality-notice.txt`. While `email/confidentiality-notice.PLACEHOLDER` exists, the notice is Marketing's draft
wording pending Sean's exact text (previews say so); replace the text and delete that file once he approves it.
