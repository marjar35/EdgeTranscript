/*
 * Pure transcript engine (no DOM, no chrome APIs) — unit-tested in test/.
 *
 * Platforms render live captions as "blocks" (one per speaker turn) whose text is
 * rewritten in place while speech recognition refines it, and which disappear once
 * they scroll away. The recorder reads every visible block on each change and calls
 * tracker.update(blocks, now). Each block carries an opaque, stable `key` (the
 * recorder maps DOM elements to numeric ids). The tracker turns that stream of
 * snapshots into a clean list of entries without duplicates or half sentences.
 */
(function (root) {
  'use strict';

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function words(text) {
    const t = normalize(text);
    return t ? t.split(' ') : [];
  }

  function cmpWord(w) {
    return w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  /**
   * Combine the previously stored text of a block with its newly observed text.
   *  - growth / revision (same beginning)      -> take the new text
   *  - platform trimmed the start of a long block, new text continues it
   *    (suffix of prev overlaps prefix of next) -> prev + new remainder
   *  - new text is a fragment already contained -> keep prev
   *  - otherwise (rewrite)                      -> take the new text
   */
  function mergeText(prev, next) {
    const p = normalize(prev);
    const n = normalize(next);
    if (!p) return n;
    if (!n || p === n) return p;

    const pw = words(p);
    const nw = words(n);
    const pc = pw.map(cmpWord);
    const nc = nw.map(cmpWord);

    // Same beginning (first up to 3 words, ignoring punctuation/case) => revision or growth.
    const head = Math.min(3, pc.length, nc.length);
    let sameHead = head > 0;
    for (let i = 0; i < head; i++) if (pc[i] !== nc[i]) { sameHead = false; break; }
    if (sameHead) {
      // A shorter text with the same head that is fully contained is a display trim, keep prev.
      if (nc.length < pc.length && p.toLowerCase().startsWith(n.toLowerCase())) return p;
      return n;
    }

    // Suffix(prev) == prefix(next) overlap of at least 3 words (or all of next when shorter).
    const maxOverlap = Math.min(pc.length, nc.length);
    for (let len = maxOverlap; len >= 1; len--) {
      if (len < 3 && len < nc.length) break;
      let match = true;
      for (let i = 0; i < len; i++) {
        if (pc[pc.length - len + i] !== nc[i]) { match = false; break; }
      }
      if (match) {
        const rest = nw.slice(len).join(' ');
        return rest ? p + ' ' + rest : p;
      }
    }

    // Next is just a fragment of prev (e.g. only the last line still visible).
    if (p.toLowerCase().includes(n.toLowerCase())) return p;

    return n;
  }

  function sameOrPrefix(a, b) {
    const x = normalize(a).toLowerCase();
    const y = normalize(b).toLowerCase();
    if (!x || !y) return false;
    return x === y || x.startsWith(y) || y.startsWith(x);
  }

  const REBIND_LOOKBACK = 30;      // entries searched when a block re-appears
  const REBIND_RECENT_MS = 15000;  // short texts are only re-bound if this recent
  const REBIND_MIN_CHARS = 20;

  class TranscriptTracker {
    /**
     * @param {object} [opts]
     * @param {Array}  [opts.entries] existing entries to continue (rejoin / resume)
     */
    constructor(opts = {}) {
      this.entries = Array.isArray(opts.entries) ? opts.entries.map((e) => ({ ...e })) : [];
      this.live = new Map(); // block key -> entry index
    }

    /**
     * @param {Array<{key:any, speaker:string, text:string}>} blocks every caption block currently visible
     * @param {number} now epoch ms
     * @returns {boolean} whether entries changed
     */
    update(blocks, now) {
      let changed = false;
      // Drop bindings of blocks that are gone *before* matching, so a list that was
      // re-rendered in one go (all new nodes) can re-bind to its existing entries.
      const present = new Set((blocks || []).map((b) => b.key));
      for (const key of [...this.live.keys()]) {
        if (!present.has(key)) this.live.delete(key);
      }

      for (const b of blocks || []) {
        const text = normalize(b.text);
        if (!text || b.key === undefined || b.key === null) continue;
        const speaker = normalize(b.speaker) || 'Unknown';

        let idx = this.live.get(b.key);
        if (idx === undefined) {
          idx = this._findRebind(speaker, text, now);
          if (idx === -1) {
            this.entries.push({ speaker, text, ts: now, updatedTs: now });
            idx = this.entries.length - 1;
            changed = true;
          }
          this.live.set(b.key, idx);
        }

        const entry = this.entries[idx];
        const merged = mergeText(entry.text, text);
        if (merged !== entry.text) {
          entry.text = merged;
          entry.updatedTs = now;
          changed = true;
        }
        if (entry.speaker === 'Unknown' && speaker !== 'Unknown') {
          entry.speaker = speaker;
          changed = true;
        }
      }
      return changed;
    }

    /** A block re-rendered with a new DOM node (panel re-opened, virtualized list) maps back to its entry. */
    _findRebind(speaker, text, now) {
      const bound = new Set(this.live.values());
      const start = Math.max(0, this.entries.length - REBIND_LOOKBACK);
      for (let i = this.entries.length - 1; i >= start; i--) {
        if (bound.has(i)) continue;
        const e = this.entries[i];
        if (e.speaker !== speaker && e.speaker !== 'Unknown') continue;
        if (!sameOrPrefix(e.text, text)) continue;
        const longEnough = Math.min(normalize(e.text).length, text.length) >= REBIND_MIN_CHARS;
        if (longEnough || now - e.updatedTs <= REBIND_RECENT_MS) return i;
      }
      return -1;
    }

    /** Forget live bindings (e.g. after pause) without touching entries. */
    reset() {
      this.live.clear();
    }

    speakers() {
      return [...new Set(this.entries.map((e) => e.speaker).filter((s) => s && s !== 'Unknown'))];
    }
  }

  /** FR-2.3: merge consecutive entries of the same speaker separated by less than gapMs. */
  function mergeConsecutive(entries, gapMs) {
    const out = [];
    for (const e of entries || []) {
      const last = out[out.length - 1];
      if (last && last.speaker === e.speaker && e.ts - (last.updatedTs || last.ts) <= gapMs) {
        last.text = normalize(last.text + ' ' + e.text);
        last.updatedTs = Math.max(last.updatedTs || last.ts, e.updatedTs || e.ts);
      } else {
        out.push({ ...e });
      }
    }
    return out;
  }

  const api = { normalize, mergeText, TranscriptTracker, mergeConsecutive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ETModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
