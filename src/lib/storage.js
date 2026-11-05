/*
 * chrome.storage.local wrapper (FR-4). Each transcript is stored under its own key
 * `t:<id>` so incremental saves only rewrite one meeting. Settings live under `settings`.
 *
 * Transcript shape:
 * { id, platform, title, meetingKey, url, startedAt, updatedAt, endedAt|null,
 *   participants: string[], entries: [{speaker, text, ts, updatedTs}] }
 */
(function (root) {
  'use strict';

  const PREFIX = 't:';
  const area = () => chrome.storage.local;

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  async function getSettings() {
    const { settings } = await area().get('settings');
    return root.ETSettings.withDefaults(settings);
  }

  async function saveSettings(settings) {
    await area().set({ settings: root.ETSettings.withDefaults(settings) });
  }

  async function listTranscripts() {
    const all = await area().get(null);
    return Object.keys(all)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => all[k])
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  async function getTranscript(id) {
    const key = PREFIX + id;
    const res = await area().get(key);
    return res[key] || null;
  }

  async function saveTranscript(t) {
    await area().set({ [PREFIX + t.id]: t });
  }

  async function updateTranscript(id, patch) {
    const t = await getTranscript(id);
    if (!t) return null;
    const next = { ...t, ...patch };
    await saveTranscript(next);
    return next;
  }

  async function deleteTranscripts(ids) {
    await area().remove(ids.map((id) => PREFIX + id));
  }

  /** FR-4.4: most recent transcript of the same meeting touched within the rejoin window. */
  async function findRejoinCandidate(meetingKey, windowMs) {
    if (!meetingKey) return null;
    const now = Date.now();
    const list = await listTranscripts();
    return list.find((t) => t.meetingKey === meetingKey && now - (t.updatedAt || 0) <= windowMs) || null;
  }

  function isTranscriptKey(key) {
    return key.startsWith(PREFIX);
  }

  root.ETStorage = {
    newId, getSettings, saveSettings, listTranscripts, getTranscript,
    saveTranscript, updateTranscript, deleteTranscripts, findRejoinCandidate, isTranscriptKey
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
