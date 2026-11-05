/* Pure export helpers: TXT, Markdown, JSON, WebVTT and file names (FR-6.5). */
(function (root) {
  'use strict';

  const Model = (typeof module !== 'undefined' && module.exports)
    ? require('./transcript-model.js')
    : root.ETModel;

  const PLATFORM_NAMES = { meet: 'Google Meet', teams: 'Microsoft Teams', zoom: 'Zoom' };

  function pad(n, w = 2) {
    return String(n).padStart(w, '0');
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  }

  function formatClock(epochMs) {
    const d = new Date(epochMs);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatDateTime(epochMs) {
    const d = new Date(epochMs);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDuration(ms) {
    const mins = Math.round(Math.max(0, ms) / 60000);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  }

  function stamp(t, entry, opts) {
    return opts.timestampFormat === 'clock'
      ? formatClock(entry.ts)
      : formatElapsed(entry.ts - (t.startedAt || entry.ts));
  }

  function prepare(t, opts = {}) {
    const o = { mergeSameSpeaker: true, mergeGapSeconds: 20, timestampFormat: 'elapsed', ...opts };
    const entries = o.mergeSameSpeaker
      ? Model.mergeConsecutive(t.entries || [], o.mergeGapSeconds * 1000)
      : (t.entries || []).slice();
    return { o, entries };
  }

  function endOf(t) {
    return t.endedAt || t.updatedAt || t.startedAt;
  }

  function header(t) {
    return {
      title: t.title || 'Untitled meeting',
      platform: PLATFORM_NAMES[t.platform] || t.platform || '',
      date: t.startedAt ? formatDateTime(t.startedAt) : '',
      duration: t.startedAt ? formatDuration(endOf(t) - t.startedAt) : '',
      participants: (t.participants || []).join(', ')
    };
  }

  function toTxt(t, opts) {
    const { o, entries } = prepare(t, opts);
    const h = header(t);
    const lines = [
      h.title,
      `${h.platform} · ${h.date} · ${h.duration}`,
      h.participants ? `Participants: ${h.participants}` : null,
      t.url ? `Link: ${t.url}` : null,
      ''
    ].filter((l) => l !== null);
    for (const e of entries) {
      lines.push(`[${stamp(t, e, o)}] ${e.speaker}: ${e.text}`);
    }
    return lines.join('\n') + '\n';
  }

  function mdEscape(s) {
    return String(s).replace(/([\\`*_[\]<>#|])/g, '\\$1');
  }

  function toMarkdown(t, opts) {
    const { o, entries } = prepare(t, opts);
    const h = header(t);
    const lines = [
      `# ${mdEscape(h.title)}`,
      '',
      `- **Platform:** ${h.platform}`,
      `- **Date:** ${h.date}`,
      `- **Duration:** ${h.duration}`
    ];
    if (h.participants) lines.push(`- **Participants:** ${mdEscape(h.participants)}`);
    if (t.url) lines.push(`- **Link:** <${t.url}>`);
    lines.push('', '## Transcript', '');
    for (const e of entries) {
      lines.push(`**${mdEscape(e.speaker)}** \`${stamp(t, e, o)}\`  `, mdEscape(e.text), '');
    }
    return lines.join('\n');
  }

  function toJson(t) {
    const out = {
      id: t.id,
      title: t.title,
      platform: t.platform,
      url: t.url,
      meetingKey: t.meetingKey,
      startedAt: t.startedAt ? new Date(t.startedAt).toISOString() : null,
      endedAt: endOf(t) ? new Date(endOf(t)).toISOString() : null,
      participants: t.participants || [],
      entries: (t.entries || []).map((e) => ({
        speaker: e.speaker,
        text: e.text,
        time: new Date(e.ts).toISOString(),
        offsetSeconds: Math.round((e.ts - (t.startedAt || e.ts)) / 1000)
      }))
    };
    return JSON.stringify(out, null, 2) + '\n';
  }

  function vttTime(ms) {
    const total = Math.max(0, ms);
    const h = Math.floor(total / 3600000);
    const m = Math.floor((total % 3600000) / 60000);
    const s = Math.floor((total % 60000) / 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
  }

  function toVtt(t, opts) {
    const { entries } = prepare(t, { ...opts, mergeSameSpeaker: false });
    const base = t.startedAt || (entries[0] && entries[0].ts) || 0;
    const lines = ['WEBVTT', ''];
    entries.forEach((e, i) => {
      const start = e.ts - base;
      const next = entries[i + 1];
      let end = Math.max((e.updatedTs || e.ts) - base, start + 1500);
      if (next) end = Math.min(end, Math.max(start + 500, next.ts - base));
      lines.push(String(i + 1), `${vttTime(start)} --> ${vttTime(end)}`, `<v ${e.speaker.replace(/>/g, '')}>${e.text}`, '');
    });
    return lines.join('\n');
  }

  function sanitizeFileName(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'Untitled meeting';
  }

  /** `YYYY-MM-DD HHmm - <title>.<ext>` */
  function buildFilename(t, ext) {
    const d = new Date(t.startedAt || Date.now());
    const prefix = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    return `${prefix} - ${sanitizeFileName(t.title)}.${ext}`;
  }

  const FORMATS = {
    txt: { ext: 'txt', mime: 'text/plain', render: toTxt },
    md: { ext: 'md', mime: 'text/markdown', render: toMarkdown },
    json: { ext: 'json', mime: 'application/json', render: toJson },
    vtt: { ext: 'vtt', mime: 'text/vtt', render: toVtt }
  };

  function render(t, format, opts) {
    const f = FORMATS[format] || FORMATS.txt;
    return { content: f.render(t, opts), filename: buildFilename(t, f.ext), mime: f.mime };
  }

  const api = {
    PLATFORM_NAMES, formatElapsed, formatClock, formatDateTime, formatDuration,
    toTxt, toMarkdown, toJson, toVtt, buildFilename, sanitizeFileName, render, FORMATS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ETExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
