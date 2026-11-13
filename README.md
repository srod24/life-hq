# Life HQ (standalone)

Static web app. No build step, no server code, no external CDNs.

## Put it on your iPhone
1. Host this folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages). Any subpath works.
2. Open the URL in **Safari**, tap **Share**, then **Add to Home Screen**.
3. On first launch, tap **Import backup file** (or **Paste JSON**) and use the backup from the Claude version
   (Claude version: Backup → Download backup / Copy JSON). Or choose **Start fresh**.

## Where the data lives
On the device, in IndexedDB (database `lifehq`), or localStorage if IndexedDB is unavailable. Nothing is uploaded.
The Safari tab and the Home Screen app keep **separate** storage on iPhone, so import inside the Home Screen app.
Use **Backup** regularly. The app reminds you after 7 days without one.

## Updating
Change the files, bump `VERSION` in `sw.js`, and redeploy. The app picks up the new version on its next launch.
