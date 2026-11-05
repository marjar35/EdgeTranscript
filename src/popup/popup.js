/* Toolbar popup: current-call status and controls (FR-5). */
'use strict';
(async function () {
  const { h, platformChip, STATUS_LABEL, formatDate, durationOf, toast } = ETUI;
  const MEETING_URL = /^https:\/\/(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|teams\.cloud\.microsoft|([\w-]+\.)?zoom\.us\/wc\/)/i;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let settings = await ETStorage.getSettings();
  let busy = false;

  const libraryUrl = (id) => chrome.runtime.getURL('src/library/library.html') + (id ? '#' + id : '');

  document.getElementById('open-options').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('open-library').onclick = () => chrome.tabs.create({ url: libraryUrl() });

  async function getState() {
    if (!tab || !tab.id) return null;
    try {
      return await chrome.runtime.sendMessage({ type: 'getTabState', tabId: tab.id });
    } catch (_) {
      return null;
    }
  }

  async function sendToContent(state, payload) {
    return chrome.tabs.sendMessage(tab.id, { target: 'content', ...payload }, { frameId: state.frameId || 0 });
  }

  async function command(state, cmd) {
    busy = true;
    try {
      await sendToContent(state, { type: 'command', cmd });
    } catch (e) {
      toast('Could not reach the meeting tab — reload it.');
    }
    busy = false;
    render();
  }

  async function withTranscript(state, fn) {
    const t = state.transcriptId && await ETStorage.getTranscript(state.transcriptId);
    if (!t || !(t.entries || []).length) return toast('Nothing captured yet');
    await fn(t);
  }

  async function copyDebug(state) {
    try {
      const info = await sendToContent(state, { type: 'debug' });
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
      toast('Debug info copied');
    } catch (_) {
      toast('Could not read debug info');
    }
  }

  function renderCurrent(state) {
    const box = document.getElementById('current');
    box.replaceChildren();

    const onMeetingSite = tab && MEETING_URL.test(tab.url || '');
    if (!state) {
      box.append(h('div', { class: 'empty' }, onMeetingSite
        ? 'EdgeTranscript is not active in this tab yet. Reload the meeting page (it was open before the extension was installed or updated).'
        : 'Open a Google Meet, Microsoft Teams or Zoom web call. Recording starts automatically once you join and captions are on.'));
      return;
    }

    const status = state.status || 'idle';
    box.append(
      h('div', { class: 'row' },
        platformChip(state.platform),
        h('span', { class: `status ${status}` }, STATUS_LABEL[status] || status)),
      h('div', { class: 'title', title: state.title }, state.title || 'Untitled meeting'),
      h('div', { class: 'meta' },
        state.inCall ? 'In call' : 'Not in a call',
        state.transcriptId ? ` · ${state.lines} lines` : '',
        !state.enabled ? ' · platform disabled in settings' : '')
    );

    if (state.lastLine && (status === 'recording' || status === 'paused')) {
      box.append(h('div', { class: 'last' }, h('strong', {}, state.lastLine.speaker + ': '), state.lastLine.text));
    }
    if (status === 'waiting-captions') {
      box.append(h('div', { class: 'hint' }, state.captionHint,
        ' If captions are on and this persists, the page layout may have changed — use "Debug info" and update the selectors.'));
    }

    const recording = status === 'recording' || status === 'waiting-captions';
    const actions = h('div', { class: 'actions' });
    if (recording) {
      actions.append(
        h('button', { onclick: () => command(state, 'pause'), disabled: busy }, '❚❚ Pause'),
        h('button', { class: 'danger', onclick: () => command(state, 'stop'), disabled: busy }, '■ Stop'));
    } else if (status === 'paused') {
      actions.append(
        h('button', { class: 'primary', onclick: () => command(state, 'resume'), disabled: busy }, '▶ Resume'),
        h('button', { class: 'danger', onclick: () => command(state, 'stop'), disabled: busy }, '■ Stop'));
    } else {
      actions.append(h('button', { class: 'primary', onclick: () => command(state, 'start'), disabled: busy }, '● Start recording'));
    }
    actions.append(h('span', { class: 'spacer' }));
    if (state.transcriptId) {
      actions.append(
        h('button', { title: 'Copy as text', onclick: () => withTranscript(state, async (t) => { await ETUI.copy(t, settings); toast('Copied'); }) }, 'Copy'),
        h('button', {
          title: `Download as .${settings.defaultExportFormat}`,
          onclick: () => withTranscript(state, (t) => ETUI.download(t, settings.defaultExportFormat, settings))
        }, 'Download'),
        h('button', { title: 'Open in library', onclick: () => chrome.tabs.create({ url: libraryUrl(state.transcriptId) }) }, 'Open'));
    }
    box.append(actions);
    box.append(h('div', { class: 'small', style: 'margin-top:8px' },
      h('button', { class: 'link small', onclick: () => copyDebug(state) }, 'Debug info')));
  }

  async function renderRecent() {
    const list = document.getElementById('recent-list');
    const items = (await ETStorage.listTranscripts()).slice(0, 10);
    list.replaceChildren(...(items.length ? items.map((t) => h('li', {},
      h('a', { href: libraryUrl(t.id), onclick: (e) => { e.preventDefault(); chrome.tabs.create({ url: libraryUrl(t.id) }); } },
        platformChip(t.platform),
        h('span', { class: 't', title: t.title }, t.title || 'Untitled meeting'),
        h('span', { class: 'm' }, `${formatDate(t.startedAt)} · ${durationOf(t)} · ${(t.entries || []).length} lines`))))
      : [h('li', { class: 'empty' }, 'No transcripts yet.')]));
  }

  let lastStateJson = '';
  async function render(force) {
    const state = await getState();
    const json = JSON.stringify(state) + busy;
    if (force || json !== lastStateJson) {
      lastStateJson = json;
      renderCurrent(state);
    }
  }

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settings = ETSettings.withDefaults(changes.settings.newValue);
    if (Object.keys(changes).some(ETStorage.isTranscriptKey)) renderRecent();
  });

  await render(true);
  await renderRecent();
  setInterval(render, 1000);
})();
