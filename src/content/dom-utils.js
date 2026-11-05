/* Small DOM helpers shared by the platform adapters. */
(function (root) {
  'use strict';

  /** First element matching any selector in the list (in order of preference). */
  function queryFirst(scope, selectors) {
    for (const sel of selectors) {
      try {
        const el = scope.querySelector(sel);
        if (el) return el;
      } catch (_) { /* invalid selector in an old browser — skip */ }
    }
    return null;
  }

  /** All elements matching the first selector in the list that matches anything. */
  function queryAllFirst(scope, selectors) {
    for (const sel of selectors) {
      try {
        const els = scope.querySelectorAll(sel);
        if (els.length) return [...els];
      } catch (_) { /* skip */ }
    }
    return [];
  }

  function text(el) {
    return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /** Find a button whose aria-label/title/text matches one of the regexes. */
  function findButton(scope, patterns) {
    const buttons = scope.querySelectorAll('button, [role="button"]');
    for (const b of buttons) {
      const label = [b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-tooltip'), text(b)]
        .filter(Boolean).join(' ');
      if (patterns.some((p) => p.test(label))) return b;
    }
    return null;
  }

  function cleanTitle(title, patterns) {
    let t = String(title || '');
    for (const p of patterns) t = t.replace(p, '');
    return t.replace(/\s+/g, ' ').trim();
  }

  root.ETDom = { queryFirst, queryAllFirst, text, isVisible, findButton, cleanTitle };
  root.ETPlatforms = root.ETPlatforms || [];
})(globalThis);
