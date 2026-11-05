/*
 * Microsoft Teams (web) adapter. New Teams marks its UI with data-tid attributes,
 * which are far more stable than class names. Update SELECTORS when Teams changes.
 */
(function (root) {
  'use strict';
  const D = root.ETDom;

  const SELECTORS = {
    // Selectors only (no text matching): "Leave" buttons also exist in chats/teams outside calls.
    leaveButton: [
      '#hangup-button', '[data-tid="hangup-main-btn"]', '[data-tid="call-hangup"]',
      'button[data-tid="hangup-button"]', '[data-tid="hangup-leave-button"]'
    ],
    captionRoot: [
      '[data-tid="closed-caption-v2-window-wrapper"]',
      '[data-tid="closed-caption-renderer-wrapper"]',
      '[data-tid="closed-captions-renderer"]',
      '[data-tid="closed-caption-v2-virtual-list-content"]'
    ],
    captionText: ['[data-tid="closed-caption-text"]'],
    captionItem: '.fui-ChatMessageCompact, [data-tid="closed-caption-message"], [role="listitem"]',
    author: ['[data-tid="author"]', '.ui-chat__message__author'],
    title: ['[data-tid="call-title"]', '[data-tid="meeting-title"]', '[data-tid="calling-header-title"]']
  };

  const teams = {
    id: 'teams',
    name: 'Microsoft Teams',
    selectors: SELECTORS,
    captionHint: 'Turn on live captions (More … → Language and speech → Show live captions) so EdgeTranscript can record the transcript.',

    matches(loc) {
      return /(^|\.)teams\.(microsoft\.com|live\.com|cloud\.microsoft)$/i.test(loc.hostname);
    },

    isInCall(doc) {
      const btn = D.queryFirst(doc, SELECTORS.leaveButton);
      return !!btn && D.isVisible(btn);
    },

    findCaptionRoot(doc) {
      return D.queryFirst(doc, SELECTORS.captionRoot);
    },

    readCaptions(rootEl) {
      const out = [];
      for (const textEl of D.queryAllFirst(rootEl, SELECTORS.captionText)) {
        const item = textEl.closest(SELECTORS.captionItem) || textEl.parentElement?.parentElement || textEl;
        const speaker = D.text(D.queryFirst(item, SELECTORS.author));
        const text = D.text(textEl);
        if (text) out.push({ el: item, speaker, text });
      }
      return out;
    },

    getMeetingTitle(doc) {
      const el = D.queryFirst(doc, SELECTORS.title);
      return D.text(el) ||
        D.cleanTitle(doc.title, [/\s*\|\s*Microsoft Teams.*$/i, /^\(\d+\)\s*/, /^Microsoft Teams$/i]) ||
        'Teams meeting';
    },

    getMeetingKey(loc, doc) {
      // Meeting URLs rarely survive in new Teams; title + day is a good-enough identity for rejoin.
      const m = /19(?:%3a|:)meeting_[^/?&%]+/i.exec(loc.href);
      if (m) return `teams:${m[0].toLowerCase()}`;
      const title = this.getMeetingTitle(doc);
      const d = new Date();
      return `teams:${title.toLowerCase()}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    },

    // Captions are behind a nested menu in Teams; we only show a hint.
    enableCaptions() {
      return false;
    }
  };

  root.ETPlatforms.push(teams);
})(globalThis);
