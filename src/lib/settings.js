/* Default settings shared by content scripts, popup, library, options and tests. */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = Object.freeze({
    autoStart: true,            // FR-3.1 start capturing as soon as a call is detected
    autoEnableCaptions: true,   // FR-2.4 try to click the platform's CC button
    platforms: { meet: true, teams: true, zoom: true }, // FR-3.3
    mergeSameSpeaker: true,     // FR-2.3 merge consecutive lines of one speaker on view/export
    mergeGapSeconds: 20,
    rejoinWindowMinutes: 15,    // FR-4.4 append to previous transcript when rejoining
    timestampFormat: 'elapsed', // 'elapsed' (00:12:05) | 'clock' (14:03:22)
    defaultExportFormat: 'md',  // 'txt' | 'md' | 'json' | 'vtt'
    showInPageHint: true
  });

  function withDefaults(stored) {
    const s = stored || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      platforms: { ...DEFAULT_SETTINGS.platforms, ...(s.platforms || {}) }
    };
  }

  const api = { DEFAULT_SETTINGS, withDefaults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ETSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
