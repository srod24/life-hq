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

## Version 2 (redesign)
- New look: iPhone-style tab bar (Today, Tasks, Jobs, Money, More), sidebar on desktop, large titles, bottom-sheet forms, a + button, swipe right on a row to complete/mark paid, automatic dark mode.
- Same data: storage code (store.js) is unchanged, so everything in IndexedDB "lifehq" carries over. No import needed.
- Files renamed to app-v2.js / app-v2.css so the v1 offline cache can't serve old code with the new page.
- sw.js VERSION is "lifehq-v2". Code files load network-first (cache when offline); fonts/icons/jsPDF are cache-first. Old lifehq-* caches are deleted.
- To deploy: replace the repo contents with this folder (delete the old app.js/app.css and IBM Plex fonts), commit, push. Phones pick it up on the next launch.

## Cloud sync (optional)
- More → Sync (or the cloud pill at the top) → enter your email → enter the 6-digit code (or paste the sign-in link) → done. One time per device.
- This device stays the main copy: everything saves here first and works offline. Changes go up in the background and come down live from your other devices.
- Conflicts: the newest edit of each item wins. Deletes sync. The first sync after signing in never deletes anything; it merges both sides and uploads everything here.
- Signed out, the app works exactly as before and makes no network calls (the sync library only loads after you sign in).
- Backend: Supabase project "life-hq" (table `lifehq_docs`, Row Level Security: each account only sees its own rows; private image bucket `lifehq-assets`). The key in store.js is the public publishable key.
