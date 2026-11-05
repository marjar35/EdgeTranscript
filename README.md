# ET.

Browser extension (Edge / Chrome, Manifest V3) that saves transcripts of **Google Meet**, **Microsoft Teams** and **Zoom** web calls by reading the meeting's own live captions. No audio is recorded, nothing is sent anywhere — transcripts are stored in the browser's local extension storage.

Spec and requirements: [docs/SPEC.md](docs/SPEC.md).

## Install (developer mode)

1. Open `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this folder (`C:\Apps\EdgeTranscript`).
4. Pin the extension to the toolbar. Reload any meeting tab that was already open.

After editing code, press **Reload** on the extension card and reload the meeting tab.

## Use

1. Join a call in the browser:
   - Google Meet — `meet.google.com`
   - Teams — `teams.microsoft.com` / `teams.live.com` / `teams.cloud.microsoft` (web, not the desktop app)
   - Zoom — web client `app.zoom.us/wc/...` ("Join from your browser")
2. Turn on captions:
   - Meet: CC button or press `c` (ET tries this for you).
   - Teams: **More … → Language and speech → Show live captions**.
   - Zoom: **Captions → Show captions** (host must allow it). Open **View full transcript** to get speaker names.
3. The toolbar badge shows **REC** while capturing, **CC** when it is waiting for captions.
4. When you leave the call, the transcript is closed. Open it from the popup or **Open all** (library) to read, search, rename, copy or export (`.txt`, `.md`, `.json`, `.vtt`).

Rejoining the same meeting within 15 minutes (configurable) continues the same transcript.

## Please be considerate

Others in the call cannot see that you are keeping a transcript. Tell participants, and follow your organisation's rules for recording meetings.

## When a platform changes its page

Meeting apps change their HTML regularly. If the popup keeps saying *Waiting for captions* although captions are visible:

1. In the popup click **Debug info** — it copies JSON with the caption container's HTML (if found), region labels and Teams `data-tid` values.
2. Update the `SELECTORS` object at the top of the matching adapter:
   [meet.js](src/content/platforms/meet.js), [teams.js](src/content/platforms/teams.js), [zoom.js](src/content/platforms/zoom.js).

## Project layout

```
manifest.json
src/background.js               badge + per-tab state (service worker)
src/content/bootstrap.js        detects the call, auto-start, popup commands
src/content/recorder.js         MutationObserver capture loop, incremental save, captions hint
src/content/platforms/*.js      one adapter per platform (selectors + parsing)
src/lib/transcript-model.js     dedupe/merge engine for live-revised captions (pure)
src/lib/exporters.js            TXT / Markdown / JSON / WebVTT (pure)
src/lib/storage.js, settings.js chrome.storage.local wrapper and defaults
src/popup, src/library, src/options   UI pages
test/                           node:test unit tests
tools/make-icons.js             regenerates icons/
```

## Tests

```bash
npm test
```

(Requires Node 18+; no dependencies.) `npm run check` verifies every file the manifest/pages reference exists and all scripts parse.

Browser harness: serve the folder (e.g. `python -m http.server 8765`) and open
`http://localhost:8765/test/harness/harness.html` — it drives the real recorder and adapters against simulated
Meet / Teams / Zoom caption DOM and should show **ALL PASS**. It does not prove the selectors match the live sites;
only a real call does.
