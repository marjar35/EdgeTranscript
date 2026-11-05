# EdgeTranscript — Plan & Functional Requirements

## Context
You want a browser extension (inspired by Scribbl) that saves transcripts of Google Meet, Microsoft Teams and Zoom calls. Decisions so far:
- **Capture method:** scrape the platform's own live captions from the page DOM (no audio, no server, no API keys).
- **Targets:** one Manifest V3 extension for Edge + Chrome; web clients only.
- **Output:** store locally, export (TXT / Markdown / JSON / clipboard). No AI summary, no cloud sync in v1.
- **Audience:** personal use, loaded unpacked (developer mode).

`C:\Apps\EdgeTranscript` is empty — greenfield. Plain JavaScript, no build step, so "Load unpacked" works straight from the folder.

---

## 1. Functional requirements

### FR-1 Meeting detection
- FR-1.1 Detect an active call on:
  - Google Meet — `https://meet.google.com/*` (meeting code in URL, e.g. `abc-defg-hij`)
  - Teams — `https://teams.microsoft.com/*`, `https://teams.live.com/*`, `https://teams.cloud.microsoft/*`
  - Zoom web client — `https://app.zoom.us/wc/*`, `https://*.zoom.us/wc/*`
- FR-1.2 "In call" = the platform's in-call UI is present (e.g. leave/hang-up button), not just the lobby/pre-join page.
- FR-1.3 Detect call end (leave button gone, tab closed, navigated away) and finalize the transcript.
- FR-1.4 Toolbar badge shows state: grey = no call, amber = in call but captions off, red "REC" = capturing.

### FR-2 Caption capture
- FR-2.1 Watch the caption container with a `MutationObserver`; capture **speaker name**, **text**, **timestamp** (wall clock + offset from meeting start).
- FR-2.2 Handle live revisions: platforms rewrite the current caption line as recognition improves. Keep one "open" utterance per speaker block, update it in place, and finalize it when the block is removed, the speaker changes, or it has been idle ~3 s. No duplicated or half-sentence lines in the final transcript.
- FR-2.3 Merge consecutive utterances from the same speaker within a short gap into one paragraph (configurable, default on).
- FR-2.4 If captions are off, show an in-page hint ("Turn on captions to record the transcript") and, if the option is enabled, try to switch captions on automatically by clicking the platform's CC button.
- FR-2.5 Capture continues if the caption panel is hidden and re-shown, and survives the content script re-attaching after an SPA navigation.
- FR-2.6 Per-platform selectors live in one config object per platform so they can be fixed quickly when Microsoft/Google/Zoom change their DOM.

### FR-3 Recording control
- FR-3.1 Auto-start capture when a call is detected (option; default on).
- FR-3.2 Manual Start / Pause / Stop from the popup.
- FR-3.3 Per-platform enable/disable in options (e.g. record Meet and Teams but not Zoom).

### FR-4 Storage
- FR-4.1 Every transcript stored in `chrome.storage.local` (with `unlimitedStorage`), keyed by a generated id.
- FR-4.2 Saved **incrementally** (debounced ~2 s) during the call so a crash or closed tab loses at most a few seconds.
- FR-4.3 Metadata per transcript: platform, meeting title, meeting URL/code, start time, end time, duration, participant list (speakers seen in captions), entry count.
- FR-4.4 Rejoining the same meeting within a configurable window (default 15 min) appends to the existing transcript instead of creating a new one.
- FR-4.5 Nothing leaves the machine; no network requests by the extension.

### FR-5 Popup (toolbar)
- FR-5.1 Current-tab status: platform, meeting title, recording state, live line count, last captured line.
- FR-5.2 Start / Pause / Stop buttons; quick "Copy transcript" and "Download" for the current call.
- FR-5.3 List of the 10 most recent transcripts with open link; "Open all transcripts" button.

### FR-6 Transcript library (full-page view)
- FR-6.1 List all transcripts, newest first, with platform icon, title, date, duration.
- FR-6.2 Search across titles and transcript text; filter by platform and date.
- FR-6.3 Open a transcript: readable view with speaker, timestamp, text; inline rename of title.
- FR-6.4 Delete one / delete selected (with confirm).
- FR-6.5 Export: **TXT**, **Markdown**, **JSON**, **SRT-like VTT** optional (stretch), copy to clipboard. Filename `YYYY-MM-DD HHmm - <title>.<ext>`.
- FR-6.6 Bulk export of selected transcripts as separate downloads.

### FR-7 Options
- Auto-start on/off; auto-enable captions on/off; per-platform toggles; merge-same-speaker on/off; rejoin window; timestamp format (wall clock vs. elapsed); default export format.

### Non-functional
- NFR-1 Manifest V3, works in current Edge and Chrome stable.
- NFR-2 Minimal permissions: `storage`, `unlimitedStorage`, `downloads`, `tabs` (badge/status), host permissions only for the three meeting domains.
- NFR-3 No measurable lag in the call: observer work throttled, no full-DOM scans on every mutation.
- NFR-4 Selector breakage fails loudly but safely: if the caption container is not found for N seconds while captions should be on, the badge and popup show "Captions not detected — selectors may be outdated".
- NFR-5 Ethics note in README: tell participants you are keeping a transcript; the extension shows nothing to others.

### Out of scope (v1)
Desktop Teams/Zoom apps, audio recording / own speech-to-text, AI summaries, cloud sync, Firefox, store publishing.

---

## 2. Architecture

```
manifest.json
src/
  background.js            service worker: badge state, message routing, downloads
  lib/
    storage.js             CRUD for transcripts + settings (chrome.storage.local)
    transcript-model.js    utterance merge/dedupe engine (pure, unit-testable)
    exporters.js           toTxt / toMarkdown / toJson / filename (pure)
  content/
    recorder.js            generic CaptionRecorder: observer, open-utterance tracking, debounced save
    platforms/meet.js      selectors + parse(captionNode) -> {speaker, text, key}
    platforms/teams.js
    platforms/zoom.js
    bootstrap.js           picks platform by hostname, starts recorder, reports state
  popup/  popup.html/.css/.js
  library/ library.html/.css/.js   (full-page transcript list + viewer)
  options/ options.html/.js
icons/
test/
  transcript-model.test.js   node:test, no dependencies
  exporters.test.js
README.md
```

Data flow: content script (per meeting tab, `all_frames: true` for Teams/Zoom iframes) → parses caption DOM → `transcript-model` merges → writes to storage directly (debounced) and posts state to background → background updates badge; popup/library read from storage and listen to `storage.onChanged` for live updates.

Platform adapter contract (each `platforms/*.js`):
`{ id, matches(location), isInCall(doc), findCaptionRoot(doc), readCaptions(root) -> [{blockKey, speaker, text}], getMeetingTitle(doc), captionsToggle(doc) }`

Starting selectors (to be verified live and kept in the adapter config):
- Meet: captions region `div[role="region"][aria-label*="aption"]`, speaker name + text blocks inside it.
- Teams: `[data-tid="closed-caption-renderer-wrapper"]`, author `[data-tid="author"]`, text `[data-tid="closed-caption-text"]`.
- Zoom web: `.live-transcription-subtitle__box` / full-transcript panel items `.lt-full-transcript__item` (has speaker names).

## 3. Implementation phases
1. **Skeleton** — manifest, icons, background badge, storage + settings, popup shell. Loadable in Edge.
2. **Core engine** — `transcript-model.js` + `exporters.js` with node unit tests (revisions, duplicates, speaker change, merge, export formats).
3. **Google Meet adapter** — easiest to test (free, captions available to everyone). End-to-end: capture → store → export.
4. **Teams adapter** — test in a Teams web meeting with live captions on.
5. **Zoom adapter** — web client; captions must be enabled by the host.
6. **Library page + options** — search, rename, delete, bulk export.
7. **Hardening** — "selectors outdated" warning, rejoin-append, README with install + privacy note.

## 4. Verification
- `node --test test/` — engine and exporter unit tests pass.
- Load unpacked: `edge://extensions` → Developer mode → Load unpacked → `C:\Apps\EdgeTranscript`. Service worker shows no errors.
- Per platform: start a test meeting (Meet with a second browser profile; Teams web; Zoom web client), turn captions on, speak a few known sentences with two speakers, then leave. Check: badge went REC; popup showed live lines; library has one transcript with correct speakers, no duplicated/partial lines; TXT/MD/JSON exports open correctly.
- Close the tab mid-call → transcript is still in the library up to the last few seconds.
- Rejoin within 15 min → appended to the same transcript.
