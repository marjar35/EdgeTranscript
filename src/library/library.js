/* Transcript library: list, search, view, rename, delete, export (FR-6). */
'use strict';
(async function () {
  const { h, platformChip, formatDate, durationOf, toast } = ETUI;
  const $ = (id) => document.getElementById(id);

  let settings = await ETStorage.getSettings();
  let all = [];
  let selected = new Set();
  let currentId = location.hash.slice(1) || null;

  if (new URLSearchParams(location.search).has('welcome')) $('welcome').hidden = false;
  $('welcome-close').onclick = () => { $('welcome').hidden = true; history.replaceState(null, '', location.pathname + location.hash); };

  // ---- filtering --------------------------------------------------------

  function query() {
    return $('search').value.trim().toLowerCase();
  }

  function dayStart(v) { return v ? new Date(v + 'T00:00:00').getTime() : null; }

  function filtered() {
    const q = query();
    const platform = $('platform').value;
    const from = dayStart($('from').value);
    const to = dayStart($('to').value);
    return all.filter((t) => {
      if (platform && t.platform !== platform) return false;
      if (from && t.startedAt < from) return false;
      if (to && t.startedAt >= to + 86400000) return false;
      if (!q) return true;
      if ((t.title || '').toLowerCase().includes(q)) return true;
      return (t.entries || []).some((e) => e.text.toLowerCase().includes(q) || e.speaker.toLowerCase().includes(q));
    });
  }

  function snippetFor(t, q) {
    if (!q) return null;
    const e = (t.entries || []).find((x) => x.text.toLowerCase().includes(q));
    if (!e) return null;
    const i = e.text.toLowerCase().indexOf(q);
    const start = Math.max(0, i - 30);
    return (start ? '…' : '') + e.text.slice(start, i + q.length + 60);
  }

  function highlight(text, q) {
    if (!q) return [text];
    const out = [];
    const lower = text.toLowerCase();
    let pos = 0;
    let i;
    while ((i = lower.indexOf(q, pos)) !== -1) {
      out.push(text.slice(pos, i), h('mark', {}, text.slice(i, i + q.length)));
      pos = i + q.length;
    }
    out.push(text.slice(pos));
    return out;
  }

  // ---- list ---------------------------------------------------------------

  function renderList() {
    const items = filtered();
    const q = query();
    selected = new Set([...selected].filter((id) => all.some((t) => t.id === id)));

    $('list').replaceChildren(...(items.length ? items.map((t) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': 'Select', checked: selected.has(t.id) });
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        cb.checked ? selected.add(t.id) : selected.delete(t.id);
        renderBulk();
      });
      const snippet = snippetFor(t, q);
      return h('li', { class: t.id === currentId ? 'active' : '', onclick: () => open(t.id) },
        cb,
        h('div', { class: 'info' },
          h('div', { class: 't', title: t.title }, t.title || 'Untitled meeting'),
          h('div', { class: 'm' },
            platformChip(t.platform),
            !t.endedAt ? h('span', { class: 'live-dot', title: 'In progress' }) : null,
            `${formatDate(t.startedAt)} · ${durationOf(t)} · ${(t.entries || []).length} lines`),
          snippet ? h('div', { class: 'snippet' }, ...highlight(snippet, q)) : null));
    }) : [h('li', { class: 'empty' }, all.length ? 'No transcripts match the filters.' : 'No transcripts yet. Join a call with captions on.')]));

    renderBulk(items);
  }

  function renderBulk(items = filtered()) {
    $('count').textContent = selected.size ? `${selected.size} selected` : `${items.length} transcript${items.length === 1 ? '' : 's'}`;
    $('select-all').checked = items.length > 0 && items.every((t) => selected.has(t.id));
    $('select-all').indeterminate = selected.size > 0 && !$('select-all').checked;
    $('bulk-export').disabled = $('bulk-delete').disabled = selected.size === 0;
  }

  $('select-all').onchange = (e) => {
    for (const t of filtered()) e.target.checked ? selected.add(t.id) : selected.delete(t.id);
    renderList();
  };

  $('bulk-delete').onclick = async () => {
    if (!confirm(`Delete ${selected.size} transcript(s)? This cannot be undone.`)) return;
    await ETStorage.deleteTranscripts([...selected]);
    if (selected.has(currentId)) open(null);
    selected.clear();
    toast('Deleted');
  };

  $('bulk-export').onclick = async () => {
    for (const id of selected) {
      const t = all.find((x) => x.id === id);
      if (t) await ETUI.download(t, settings.defaultExportFormat, settings);
    }
    toast(`Exported ${selected.size} file(s) as .${settings.defaultExportFormat}`);
  };

  for (const id of ['search', 'platform', 'from', 'to']) {
    $(id).addEventListener('input', () => { renderList(); renderViewer(); });
  }

  // ---- viewer -------------------------------------------------------------

  function open(id) {
    currentId = id;
    history.replaceState(null, '', location.pathname + location.search + (id ? '#' + id : ''));
    renderList();
    renderViewer();
  }

  function stampFor(t, e) {
    return settings.timestampFormat === 'clock'
      ? ETExport.formatClock(e.ts)
      : ETExport.formatElapsed(e.ts - t.startedAt);
  }

  function renderViewer() {
    const box = $('viewer');
    const t = all.find((x) => x.id === currentId);
    if (!t) {
      box.replaceChildren(h('div', { class: 'placeholder' }, all.length ? 'Select a transcript.' : 'Your transcripts will appear here.'));
      return;
    }
    const keepScroll = box.dataset.id === t.id ? box.scrollTop : 0;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.dataset.id = t.id;

    const titleInput = h('input', { class: 'title-input', value: t.title || '', 'aria-label': 'Title', placeholder: 'Untitled meeting' });
    titleInput.addEventListener('change', async () => {
      await ETStorage.updateTranscript(t.id, { title: titleInput.value.trim() || 'Untitled meeting', titleEdited: true });
      toast('Renamed');
    });
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

    const fmtButton = (fmt, label) => h('button', { onclick: () => ETUI.download(t, fmt, settings) }, label);
    const q = query();
    const entries = settings.mergeSameSpeaker
      ? ETModel.mergeConsecutive(t.entries || [], settings.mergeGapSeconds * 1000)
      : (t.entries || []);

    box.replaceChildren(
      h('div', { class: 'viewer-head' },
        h('div', { class: 'titles' },
          titleInput,
          h('div', { class: 'meta-line' },
            platformChip(t.platform),
            h('span', {}, formatDate(t.startedAt)),
            h('span', {}, '·'),
            h('span', {}, durationOf(t)),
            !t.endedAt ? h('span', { class: 'status recording' }, 'Recording') : null,
            t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener' }, 'Meeting link') : null)),
        h('div', { class: 'toolbar' },
          h('button', { onclick: async () => { await ETUI.copy(t, settings); toast('Copied to clipboard'); } }, 'Copy'),
          fmtButton('txt', '.txt'),
          fmtButton('md', '.md'),
          fmtButton('json', '.json'),
          fmtButton('vtt', '.vtt'),
          h('button', {
            class: 'danger',
            onclick: async () => {
              if (!confirm('Delete this transcript? This cannot be undone.')) return;
              await ETStorage.deleteTranscripts([t.id]);
              open(null);
              toast('Deleted');
            }
          }, 'Delete'))),
      (t.participants || []).length ? h('div', { class: 'participants' }, 'Participants: ', t.participants.join(', ')) : null,
      h('div', { class: 'entries' }, ...(entries.length ? entries.map((e) =>
        h('div', { class: 'entry' },
          h('time', {}, stampFor(t, e)),
          h('div', {},
            h('div', { class: 'speaker' }, e.speaker),
            h('div', { class: 'text' }, ...highlight(e.text, q)))))
        : [h('div', { class: 'muted' }, 'No captions captured yet.')]))
    );
    // Follow a live transcript when the user is at the bottom; otherwise keep position.
    box.scrollTop = !t.endedAt && atBottom && keepScroll ? box.scrollHeight : keepScroll;
  }

  // ---- data -------------------------------------------------------------

  async function load() {
    all = await ETStorage.listTranscripts();
    if (currentId && !all.some((t) => t.id === currentId)) currentId = null;
    renderList();
    renderViewer();
  }

  let reloadTimer = null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = ETSettings.withDefaults(changes.settings.newValue);
    // Don't re-render under the user's cursor while they are renaming.
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      if (document.activeElement && document.activeElement.classList.contains('title-input')) return;
      load();
    }, 300);
  });

  window.addEventListener('hashchange', () => open(location.hash.slice(1) || null));

  await load();
})();
