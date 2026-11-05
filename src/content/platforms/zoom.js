/*
 * Zoom web client adapter (app.zoom.us/wc/...). The "View full transcript" panel has
 * speaker names; the floating subtitle only has text, so the panel is preferred.
 * Captions must be enabled by the host. Update SELECTORS when Zoom changes.
 */
(function (root) {
  'use strict';
  const D = root.ETDom;

  const SELECTORS = {
    leaveButton: ['.footer__leave-btn', 'button.leave-meeting-options__btn', '[aria-label="Leave"]'],
    leavePatterns: [/^leave\b/i, /^end\b/i, /^odejít/i, /^opustit/i],
    fullTranscriptRoot: ['.lt-full-transcript__list', '.lt-full-transcript', '[class*="full-transcript"][class*="list"]'],
    fullItem: ['.lt-full-transcript__item', '[class*="full-transcript__item"]'],
    fullName: ['.lt-full-transcript__display-name', '[class*="display-name"]'],
    fullMessage: ['.lt-full-transcript__message', '[class*="transcript__message"]'],
    subtitleRoot: ['.live-transcription-subtitle__box', '#live-transcription-subtitle', '[class*="live-transcription-subtitle"]'],
    subtitleItem: ['.live-transcription-subtitle__item', '[class*="subtitle__item"]'],
    subtitleName: ['[class*="subtitle__name"]', '[class*="subtitle__speaker"]'],
    title: ['.meeting-info-container__topic', '[class*="meeting-topic"]', '.meeting-title']
  };

  const ID_RE = /\/wc\/(?:join\/)?(\d{9,12})/;

  const zoom = {
    id: 'zoom',
    name: 'Zoom',
    selectors: SELECTORS,
    captionHint: 'Turn on captions (Captions → Show captions). For speaker names also open "View full transcript".',

    matches(loc) {
      return /(^|\.)zoom\.us$/i.test(loc.hostname) && /\/wc\//.test(loc.pathname);
    },

    isInCall(doc) {
      const btn = D.queryFirst(doc, SELECTORS.leaveButton) || D.findButton(doc, SELECTORS.leavePatterns);
      return !!btn && D.isVisible(btn);
    },

    findCaptionRoot(doc) {
      return D.queryFirst(doc, SELECTORS.fullTranscriptRoot) || D.queryFirst(doc, SELECTORS.subtitleRoot);
    },

    readCaptions(rootEl) {
      const out = [];
      const items = D.queryAllFirst(rootEl, SELECTORS.fullItem);
      if (items.length) {
        let lastSpeaker = '';
        for (const item of items) {
          const name = D.text(D.queryFirst(item, SELECTORS.fullName));
          if (name) lastSpeaker = name; // consecutive messages may omit the name
          const msg = D.queryFirst(item, SELECTORS.fullMessage);
          const text = msg ? D.text(msg) : '';
          if (text) out.push({ el: item, speaker: name || lastSpeaker, text });
        }
        return out;
      }
      const subs = D.queryAllFirst(rootEl, SELECTORS.subtitleItem);
      for (const item of subs.length ? subs : [rootEl]) {
        const speaker = D.text(D.queryFirst(item, SELECTORS.subtitleName));
        let text = D.text(item);
        if (speaker && text.startsWith(speaker)) text = text.slice(speaker.length).replace(/^[:\s]+/, '');
        if (text) out.push({ el: item, speaker, text });
      }
      return out;
    },

    getMeetingTitle(doc, loc) {
      const el = D.queryFirst(doc, SELECTORS.title);
      const t = D.text(el) || D.cleanTitle(doc.title, [/^Zoom$/i, /\s*-\s*Zoom$/i]);
      const id = (ID_RE.exec(loc.pathname) || [])[1];
      return t || (id ? `Zoom meeting ${id}` : 'Zoom meeting');
    },

    getMeetingKey(loc) {
      const id = (ID_RE.exec(loc.pathname) || [])[1];
      return id ? `zoom:${id}` : null;
    },

    enableCaptions() {
      return false;
    }
  };

  root.ETPlatforms.push(zoom);
})(globalThis);
