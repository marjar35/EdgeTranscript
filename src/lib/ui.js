/* Helpers shared by the popup, library and options pages. */
(function (root) {
  'use strict';

  const PLATFORM = {
    meet: { name: 'Google Meet', short: 'Meet', color: '#188038' },
    teams: { name: 'Microsoft Teams', short: 'Teams', color: '#5b5fc7' },
    zoom: { name: 'Zoom', short: 'Zoom', color: '#0b5cff' }
  };

  const STATUS_LABEL = {
    recording: 'Recording',
    'waiting-captions': 'Waiting for captions',
    paused: 'Paused',
    stopped: 'Stopped',
    idle: 'Not recording'
  };

  /** Tiny element builder: h('div', {class: 'x', onclick}, 'text', child) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function platformChip(id) {
    const p = PLATFORM[id] || { short: id, color: '#6b7280' };
    return h('span', { class: 'chip', style: `--chip:${p.color}` }, p.short);
  }

  function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const today = new Date();
    const y = new Date(Date.now() - 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === today.toDateString()) return `Today ${time}`;
    if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} ${time}`;
  }

  function durationOf(t) {
    const end = t.endedAt || t.updatedAt || t.startedAt;
    return root.ETExport.formatDuration(end - t.startedAt);
  }

  function exportOptions(settings) {
    return {
      mergeSameSpeaker: settings.mergeSameSpeaker,
      mergeGapSeconds: settings.mergeGapSeconds,
      timestampFormat: settings.timestampFormat
    };
  }

  async function download(t, format, settings) {
    const { content, filename, mime } = root.ETExport.render(t, format, exportOptions(settings));
    const url = `data:${mime};charset=utf-8,` + encodeURIComponent(content);
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  }

  async function copy(t, settings) {
    await navigator.clipboard.writeText(root.ETExport.toTxt(t, exportOptions(settings)));
  }

  function toast(message) {
    let box = document.querySelector('.toast');
    if (!box) {
      box = h('div', { class: 'toast', role: 'status' });
      document.body.append(box);
    }
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(box._t);
    box._t = setTimeout(() => box.classList.remove('show'), 1800);
  }

  root.ETUI = { PLATFORM, STATUS_LABEL, h, platformChip, formatDate, durationOf, exportOptions, download, copy, toast };
})(globalThis);
