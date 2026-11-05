/*
 * Google Meet adapter. Selectors are ordered by preference; Meet's class names are
 * obfuscated and change, so stable attributes (jsname, role, aria) come first and a
 * structural fallback is used when nothing matches. Update SELECTORS when Meet changes.
 */
(function (root) {
  'use strict';
  const D = root.ETDom;

  const SELECTORS = {
    leaveButton: ['button[jsname="CQylAd"]', '[data-tooltip-id="tt-c13"] button'],
    leavePatterns: [/leave call/i, /opustit hovor/i, /odejít z hovoru/i, /hang ?up/i],
    captionRoot: [
      'div[role="region"][jsname="dsyhDe"]',
      'div[role="region"][aria-label*="aption" i]',
      'div[role="region"][aria-label*="titulk" i]',
      '.a4cQT',
      '[jsname="dsyhDe"]'
    ],
    block: ['.nMcdL', '.TBMuR', '.iOzk7'],
    speaker: ['.NWpY1d', '.KcIKyf', '.zs7s8d'],
    text: ['.ygicle', '.bh44bd', '.iTTPOb', '[jsname="tgaKEf"]'],
    captionsButton: ['button[jsname="r8qRAd"]'],
    captionsOnPatterns: [/turn on captions/i, /zapnout titulky/i],
    title: ['[data-meeting-title]', '.u6vdEc', '[jsname="NeC6gb"]']
  };

  const CODE_RE = /^\/([a-z]{3,4}-[a-z]{4}-[a-z]{3,4})(?:$|[/?#])/i;

  /** Structural fallback: every avatar <img> in the caption region marks a speaker block. */
  function fallbackBlocks(rootEl) {
    const blocks = new Set();
    for (const img of rootEl.querySelectorAll('img')) {
      let el = img.parentElement;
      while (el && el !== rootEl) {
        const t = D.text(el);
        const nameOnly = D.text(img.parentElement);
        if (t.length > nameOnly.length + 1) break;
        el = el.parentElement;
      }
      if (el && el !== rootEl) blocks.add(el);
    }
    return [...blocks];
  }

  function parseFallbackBlock(block) {
    // Leaf elements with text: first is the speaker name, the rest is the caption.
    const leaves = [...block.querySelectorAll('*')].filter((e) => e.children.length === 0 && D.text(e));
    if (!leaves.length) return null;
    const speaker = D.text(leaves[0]);
    const full = D.text(block);
    const text = full.startsWith(speaker) ? full.slice(speaker.length).trim() : full;
    return { speaker, text };
  }

  const meet = {
    id: 'meet',
    name: 'Google Meet',
    selectors: SELECTORS,
    captionHint: 'Turn on captions (CC button or press "c") so EdgeTranscript can record the transcript.',

    matches(loc) {
      return loc.hostname === 'meet.google.com';
    },

    isInCall(doc) {
      const btn = D.queryFirst(doc, SELECTORS.leaveButton) || D.findButton(doc, SELECTORS.leavePatterns);
      return !!btn && D.isVisible(btn);
    },

    findCaptionRoot(doc) {
      return D.queryFirst(doc, SELECTORS.captionRoot);
    },

    readCaptions(rootEl) {
      let blocks = D.queryAllFirst(rootEl, SELECTORS.block);
      const known = blocks.length > 0;
      if (!known) blocks = fallbackBlocks(rootEl);
      const out = [];
      for (const block of blocks) {
        let speaker;
        let text;
        if (known) {
          speaker = D.text(D.queryFirst(block, SELECTORS.speaker));
          const textEl = D.queryFirst(block, SELECTORS.text);
          text = textEl ? D.text(textEl) : '';
          if (!textEl) {
            const p = parseFallbackBlock(block);
            if (p) { speaker = speaker || p.speaker; text = p.text; }
          }
        } else {
          const p = parseFallbackBlock(block);
          if (!p) continue;
          ({ speaker, text } = p);
        }
        if (text) out.push({ el: block, speaker, text });
      }
      return out;
    },

    getMeetingCode(loc) {
      const m = CODE_RE.exec(loc.pathname);
      return m ? m[1].toLowerCase() : null;
    },

    getMeetingTitle(doc, loc) {
      const el = D.queryFirst(doc, SELECTORS.title);
      const fromEl = el && (el.getAttribute('data-meeting-title') || D.text(el));
      const fromTitle = D.cleanTitle(doc.title, [/^Meet\s*[-–—:]\s*/i, /\s*[-–—]\s*Google Meet$/i, /^Google Meet$/i]);
      return fromEl || fromTitle || this.getMeetingCode(loc) || 'Google Meet call';
    },

    getMeetingKey(loc) {
      const code = this.getMeetingCode(loc);
      return code ? `meet:${code}` : null;
    },

    enableCaptions(doc) {
      const btn = D.queryFirst(doc, SELECTORS.captionsButton) || D.findButton(doc, SELECTORS.captionsOnPatterns);
      if (!btn) return false;
      const pressed = btn.getAttribute('aria-pressed');
      const label = btn.getAttribute('aria-label') || '';
      if (pressed === 'true' || /turn off|vypnout/i.test(label)) return false;
      btn.click();
      return true;
    }
  };

  root.ETPlatforms.push(meet);
})(globalThis);
