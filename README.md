# Ledger — Finance Tracker for iPhone

A fast, offline-first PWA for tracking income, expenses, and mileage. Built with
plain HTML/CSS/JS — no build step, no frameworks, no external network calls at
runtime, so it keeps working with no internet connection at all.

## What's inside

```
index.html          App shell
css/styles.css       Design system + all styling
js/db.js              IndexedDB persistence layer
js/app.js             App logic (views, forms, reports, backup/restore)
manifest.json         PWA manifest (name, icons, standalone display)
service-worker.js     Offline caching of the app shell
icons/                App icons in all sizes iOS/Android expect
```

## Why it needs to be hosted (can't just double-click index.html)

Safari only allows a page to install to the Home Screen and register a
Service Worker (the thing that makes offline mode and "Add to Home Screen"
work) when the page is served over **HTTPS**, or from **localhost**. Opening
`index.html` directly from the Files app (a `file://` URL) will still show
the app and save data locally, but it will *not* be installable and the
Service Worker won't register. So step one is putting these files somewhere
that serves them over HTTPS.

## Fastest ways to get it online (all free)

**Option A — GitHub Pages**
1. Create a new GitHub repo and upload this whole folder.
2. Repo Settings → Pages → set the source to your main branch (root).
3. GitHub gives you a URL like `https://yourname.github.io/ledger/`.

**Option B — Netlify Drop**
1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag this whole folder onto the page.
3. Netlify gives you a live HTTPS URL instantly.

**Option C — Vercel**
1. `npm i -g vercel` (or use the Vercel dashboard's drag-and-drop import).
2. Run `vercel` inside this folder and follow the prompts.

**Option D — test locally first**
From inside this folder: `python3 -m http.server 8080`, then open
`http://localhost:8080` in Safari on your Mac, or on your iPhone if it's on
the same Wi-Fi network using your computer's local IP address (e.g.
`http://192.168.1.23:8080`) — `localhost`-equivalent origins on your own LAN
won't get Service Worker treatment on a different device, so for testing on
an actual iPhone, use Option A, B, or C above.

## Installing on your iPhone

1. Open the site's URL in **Safari** (must be Safari, not Chrome — Chrome on
   iOS can't add PWAs to the Home Screen).
2. Tap the **Share** icon (square with an arrow) in the toolbar.
3. Tap **Add to Home Screen**, then **Add**.
4. Open Ledger from your Home Screen — it launches full-screen, with no
   Safari address bar, just like a native app.

## Data & backups

All data is stored **only on the device**, in the browser's IndexedDB
database. It survives closing the app, restarting the phone, and refreshing
the page. It is *not* synced anywhere automatically.

- **To move data to a new phone or browser:** open Settings → Export as
  JSON, then AirDrop/email that file to the new device and use Settings →
  Import from JSON there.
- **Export as CSV** any time you want a spreadsheet-friendly copy for taxes
  or accounting software.
- Clearing Safari's website data for this site, or uninstalling the Home
  Screen app, **will delete the data** (this is a browser-storage limitation
  on every platform, not specific to this app) — so it's worth exporting a
  backup occasionally, especially before major iOS updates or a phone
  migration.

## Updating the app later

If you edit any file, bump `CACHE_VERSION` in `service-worker.js` (e.g.
`ledger-v1` → `ledger-v2`) so installed copies pick up the change instead of
serving a stale cached version.
