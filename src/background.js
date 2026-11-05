/*
 * Service worker: keeps per-tab recording state reported by content scripts,
 * drives the toolbar badge (FR-1.4) and closes transcripts of tabs that were closed.
 * State is mirrored to chrome.storage.session so it survives service-worker restarts.
 */
'use strict';

const STATUS_RANK = { recording: 5, 'waiting-captions': 4, paused: 3, stopped: 2, idle: 1 };

const BADGE = {
  recording: { text: 'REC', color: '#dc2626' },
  'waiting-captions': { text: 'CC', color: '#d97706' },
  paused: { text: '❚❚', color: '#6b7280' },
  stopped: { text: '', color: '#6b7280' },
  idle: { text: '', color: '#6b7280' }
};

/** tabId -> { frameId -> state } */
let tabs = {};
const ready = chrome.storage.session.get('tabs').then((r) => { tabs = r.tabs || {}; });

function persist() {
  return chrome.storage.session.set({ tabs });
}

/** The most relevant frame state of a tab (recording beats waiting beats idle ...). */
function bestState(tabId) {
  const frames = tabs[tabId];
  if (!frames) return null;
  let best = null;
  for (const [frameId, s] of Object.entries(frames)) {
    const rank = (STATUS_RANK[s.status] || 0) * 10 + (s.inCall ? 1 : 0);
    if (!best || rank > best.rank) best = { rank, state: { ...s, frameId: Number(frameId) } };
  }
  return best && best.state;
}

async function updateBadge(tabId) {
  const s = bestState(tabId);
  const b = BADGE[(s && s.status) || 'idle'];
  try {
    await chrome.action.setBadgeText({ tabId, text: b.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: b.color });
    const title = s && s.status !== 'idle'
      ? `ET — ${s.platformName}: ${s.status.replace('-', ' ')} (${s.lines} lines)`
      : 'ET';
    await chrome.action.setTitle({ tabId, title });
  } catch (_) { /* tab gone */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    if (msg && msg.type === 'state' && sender.tab) {
      const tabId = sender.tab.id;
      tabs[tabId] = tabs[tabId] || {};
      tabs[tabId][sender.frameId || 0] = msg.state;
      await persist();
      await updateBadge(tabId);
      sendResponse({ ok: true });
    } else if (msg && msg.type === 'getTabState') {
      sendResponse(bestState(msg.tabId));
    } else {
      sendResponse(null);
    }
  })();
  return true;
});

// Navigating away resets the tab's frames (content scripts re-report on the new page).
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading' || !info.url) return;
  await ready;
  await closeTranscriptsOf(tabId);
  delete tabs[tabId];
  await persist();
  await updateBadge(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  await closeTranscriptsOf(tabId);
  delete tabs[tabId];
  await persist();
});

/** If a tab disappears mid-recording, mark its transcript as ended at its last update. */
async function closeTranscriptsOf(tabId) {
  const frames = tabs[tabId];
  if (!frames) return;
  for (const s of Object.values(frames)) {
    if (!s.transcriptId || s.status === 'stopped' || s.status === 'idle') continue;
    const key = 't:' + s.transcriptId;
    const r = await chrome.storage.local.get(key);
    const t = r[key];
    if (t && !t.endedAt) {
      t.endedAt = t.updatedAt || Date.now();
      await chrome.storage.local.set({ [key]: t });
    }
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: {} });
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/library/library.html?welcome=1') });
});
