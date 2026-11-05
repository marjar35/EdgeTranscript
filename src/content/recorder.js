/*
 * CaptionRecorder: platform-independent capture loop (FR-2, FR-3, FR-4).
 *  - observes the platform's caption container with a MutationObserver
 *  - turns caption snapshots into entries via ETModel.TranscriptTracker
 *  - saves incrementally (debounced) to chrome.storage.local
 *  - detects missing captions, tries to switch them on, shows an in-page hint
 */
(function (root) {
  'use strict';

  const SAVE_DEBOUNCE_MS = 2000;
  const READ_THROTTLE_MS = 250;
  const ENABLE_CAPTIONS_AFTER_MS = 3000;
  const HINT_AFTER_MS = 8000;
  const MAX_ENABLE_ATTEMPTS = 5;

  class CaptionRecorder {
    constructor(adapter, settings, onState) {
      this.adapter = adapter;
      this.settings = settings;
      this.onState = onState || (() => {});
      this.status = 'idle'; // idle | waiting-captions | recording | paused | stopped
      this.transcript = null;
      this.tracker = null;
      this.ids = new WeakMap();
      this.nextId = 1;
      this.observer = null;
      this.observedRoot = null;
      this.readTimer = null;
      this.saveTimer = null;
      this.captionsMissingSince = null;
      this.enableAttempts = 0;
      this.hint = null;
      this.hintDismissed = false;
    }

    get active() {
      return this.status === 'recording' || this.status === 'waiting-captions' || this.status === 'paused';
    }

    // ---- lifecycle -------------------------------------------------------

    async start() {
      if (this.active) {
        if (this.status === 'paused') this.resume();
        return;
      }
      const now = Date.now();
      const loc = root.location;
      const doc = root.document;
      const meetingKey = this.adapter.getMeetingKey(loc, doc);
      const windowMs = this.settings.rejoinWindowMinutes * 60000;
      const previous = windowMs > 0 ? await root.ETStorage.findRejoinCandidate(meetingKey, windowMs) : null;

      this.transcript = previous
        ? { ...previous, endedAt: null, updatedAt: now }
        : {
            id: root.ETStorage.newId(),
            platform: this.adapter.id,
            title: this.adapter.getMeetingTitle(doc, loc),
            titleEdited: false,
            meetingKey,
            url: loc.href,
            startedAt: now,
            updatedAt: now,
            endedAt: null,
            participants: [],
            entries: []
          };
      this.tracker = new root.ETModel.TranscriptTracker({ entries: this.transcript.entries });
      this.transcript.entries = this.tracker.entries;
      this.status = 'waiting-captions';
      this.captionsMissingSince = null;
      this.enableAttempts = 0;
      this.hintDismissed = false;
      await this.flush();
      this.tick();
      this.emit();
    }

    pause() {
      if (!this.active || this.status === 'paused') return;
      this.readNow();
      this.detach();
      this.tracker.reset();
      this.status = 'paused';
      this.hideHint();
      this.flush();
      this.emit();
    }

    resume() {
      if (this.status !== 'paused') return;
      this.status = 'waiting-captions';
      this.tick();
      this.emit();
    }

    async stop() {
      if (!this.transcript) return;
      if (this.status === 'recording') this.readNow();
      this.detach();
      this.hideHint();
      this.status = 'stopped';
      this.transcript.endedAt = Date.now();
      await this.flush();
      this.emit();
    }

    /** Called when the transcript was deleted from the library while recording. */
    abandon() {
      this.detach();
      this.hideHint();
      clearTimeout(this.saveTimer);
      this.transcript = null;
      this.tracker = null;
      this.status = 'stopped';
      this.emit();
    }

    // ---- periodic work (called every second by bootstrap) ----------------

    tick() {
      if (this.status !== 'recording' && this.status !== 'waiting-captions') return;
      const doc = root.document;
      const now = Date.now();

      if (!this.transcript.titleEdited) {
        const title = this.adapter.getMeetingTitle(doc, root.location);
        if (title && title !== this.transcript.title) {
          this.transcript.title = title;
          this.scheduleSave();
        }
      }

      const captionRoot = this.adapter.findCaptionRoot(doc);
      if (captionRoot) {
        if (captionRoot !== this.observedRoot || !this.observedRoot.isConnected) this.attach(captionRoot);
        if (this.status !== 'recording') {
          this.status = 'recording';
          this.emit();
        }
        this.captionsMissingSince = null;
        this.hideHint();
        this.readNow(); // safety net in case a mutation was missed
        return;
      }

      // No caption container: captions are off (or our selectors are outdated, NFR-4).
      if (this.observedRoot) this.detach();
      if (this.status !== 'waiting-captions') {
        this.status = 'waiting-captions';
        this.emit();
      }
      if (!this.captionsMissingSince) this.captionsMissingSince = now;
      const missingFor = now - this.captionsMissingSince;

      if (this.settings.autoEnableCaptions && missingFor >= ENABLE_CAPTIONS_AFTER_MS &&
          this.enableAttempts < MAX_ENABLE_ATTEMPTS && missingFor >= ENABLE_CAPTIONS_AFTER_MS * (this.enableAttempts + 1)) {
        this.enableAttempts++;
        try {
          if (this.adapter.enableCaptions(doc)) this.enableAttempts = MAX_ENABLE_ATTEMPTS;
        } catch (e) {
          console.debug('[ET] enableCaptions failed', e);
        }
      }
      if (this.settings.showInPageHint && missingFor >= HINT_AFTER_MS) this.showHint();
    }

    // ---- caption reading -------------------------------------------------

    attach(captionRoot) {
      this.detach();
      this.observedRoot = captionRoot;
      this.observer = new MutationObserver(() => this.scheduleRead());
      this.observer.observe(captionRoot, { childList: true, subtree: true, characterData: true });
      this.scheduleRead();
    }

    detach() {
      if (this.observer) this.observer.disconnect();
      this.observer = null;
      this.observedRoot = null;
      clearTimeout(this.readTimer);
      this.readTimer = null;
    }

    scheduleRead() {
      if (this.readTimer) return;
      this.readTimer = setTimeout(() => {
        this.readTimer = null;
        this.readNow();
      }, READ_THROTTLE_MS);
    }

    keyFor(el) {
      let id = this.ids.get(el);
      if (!id) {
        id = this.nextId++;
        this.ids.set(el, id);
      }
      return id;
    }

    readNow() {
      if (this.status !== 'recording' || !this.observedRoot) return;
      let blocks;
      try {
        blocks = this.adapter.readCaptions(this.observedRoot);
      } catch (e) {
        console.debug('[ET] readCaptions failed', e);
        return;
      }
      const snapshot = blocks.map((b) => ({ key: this.keyFor(b.el), speaker: b.speaker, text: b.text }));
      if (this.tracker.update(snapshot, Date.now())) {
        this.transcript.participants = [...new Set([...(this.transcript.participants || []), ...this.tracker.speakers()])];
        this.transcript.updatedAt = Date.now();
        this.scheduleSave();
        this.emit();
      }
    }

    // ---- persistence -----------------------------------------------------

    scheduleSave() {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
    }

    async flush() {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (!this.transcript) return;
      try {
        await root.ETStorage.saveTranscript(this.transcript);
      } catch (e) {
        console.debug('[ET] save failed', e);
      }
    }

    /** A change made elsewhere (library rename) must not be overwritten by our next save. */
    applyExternalChange(stored) {
      if (!this.transcript) return;
      if (!stored) {
        this.abandon();
        return;
      }
      if (stored.title !== this.transcript.title && stored.titleEdited) {
        this.transcript.title = stored.title;
        this.transcript.titleEdited = true;
        this.emit();
      }
    }

    // ---- state / UI ------------------------------------------------------

    state() {
      const t = this.transcript;
      const entries = t ? t.entries : [];
      const last = entries[entries.length - 1];
      return {
        platform: this.adapter.id,
        platformName: this.adapter.name,
        status: this.status,
        title: t ? t.title : this.adapter.getMeetingTitle(root.document, root.location),
        transcriptId: t ? t.id : null,
        lines: entries.length,
        lastLine: last ? { speaker: last.speaker, text: last.text } : null,
        captionHint: this.adapter.captionHint
      };
    }

    emit() {
      this.onState(this.state());
    }

    showHint() {
      if (this.hint || this.hintDismissed) return;
      const host = root.document.createElement('div');
      host.setAttribute('data-edgetranscript-hint', '');
      host.style.cssText = 'position:fixed;left:16px;bottom:96px;z-index:2147483647;';
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = `
        <style>
          .box{font:13px/1.4 system-ui,sans-serif;background:#1f2937;color:#f9fafb;border-radius:10px;
               padding:10px 12px;max-width:320px;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px}
          .dot{width:10px;height:10px;border-radius:50%;background:#f59e0b;margin-top:4px;flex:none}
          b{display:block;margin-bottom:2px}
          button{all:unset;cursor:pointer;opacity:.7;font-size:16px;line-height:1;align-self:flex-start}
          button:hover{opacity:1}
        </style>
        <div class="box" role="status">
          <span class="dot"></span>
          <div><b>ET is waiting for captions</b><span class="msg"></span></div>
          <button aria-label="Dismiss">×</button>
        </div>`;
      shadow.querySelector('.msg').textContent = this.adapter.captionHint;
      shadow.querySelector('button').addEventListener('click', () => {
        this.hintDismissed = true;
        this.hideHint();
      });
      (root.document.body || root.document.documentElement).appendChild(host);
      this.hint = host;
    }

    hideHint() {
      if (this.hint) this.hint.remove();
      this.hint = null;
    }

    debugInfo() {
      const doc = root.document;
      const captionRoot = this.adapter.findCaptionRoot(doc);
      const regions = [...doc.querySelectorAll('[role="region"]')].map((r) => r.getAttribute('aria-label') || '(no label)');
      const dataTids = [...new Set([...doc.querySelectorAll('[data-tid]')].map((e) => e.getAttribute('data-tid')))]
        .filter((t) => /caption|hangup|title|transcript/i.test(t));
      let parsed = null;
      try { parsed = captionRoot ? this.adapter.readCaptions(captionRoot).map((b) => ({ speaker: b.speaker, text: b.text })) : null; } catch (e) { parsed = String(e); }
      return {
        extension: 'ET',
        version: chrome.runtime.getManifest().version,
        platform: this.adapter.id,
        url: root.location.href,
        frame: root.top === root ? 'top' : 'iframe',
        userAgent: navigator.userAgent,
        state: this.state(),
        inCall: this.adapter.isInCall(doc),
        captionRootFound: !!captionRoot,
        parsedCaptions: parsed,
        regions,
        dataTids,
        captionRootHtml: captionRoot ? captionRoot.outerHTML.slice(0, 20000) : null
      };
    }
  }

  root.ETRecorder = { CaptionRecorder };
})(globalThis);
