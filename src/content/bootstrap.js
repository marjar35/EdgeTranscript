/*
 * Content-script entry point. Picks the platform adapter for this page, watches for
 * the call starting/ending (FR-1), auto-starts the recorder (FR-3.1) and answers
 * commands from the popup (FR-3.2). Runs in every frame; frames that never see a
 * call stay silent.
 */
(function (root) {
  'use strict';

  if (root.__edgeTranscriptLoaded) return;
  root.__edgeTranscriptLoaded = true;

  const adapter = (root.ETPlatforms || []).find((p) => p.matches(root.location));
  if (!adapter) return;

  const TICK_MS = 1000;
  const HEARTBEAT_MS = 5000;

  let settings = null;
  let recorder = null;
  let inCall = false;
  let manualStop = false; // user pressed Stop: don't auto-restart until the call ends
  let lastSent = '';
  let lastSentAt = 0;
  let timer = null;

  function alive() {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  }

  function enabled() {
    return !!settings.platforms[adapter.id];
  }

  function fullState() {
    return { ...recorder.state(), inCall, enabled: enabled(), autoStart: settings.autoStart, isTop: root.top === root };
  }

  function report(force) {
    if (!alive()) return shutdown();
    // Frames that are not in a call and not recording only report from the top frame.
    if (!inCall && !recorder.transcript && root.top !== root) return;
    const s = fullState();
    const json = JSON.stringify(s);
    const now = Date.now();
    if (!force && json === lastSent && now - lastSentAt < HEARTBEAT_MS) return;
    lastSent = json;
    lastSentAt = now;
    chrome.runtime.sendMessage({ type: 'state', state: s }).catch(() => {});
  }

  async function tick() {
    if (!alive()) return shutdown();
    let nowInCall = false;
    try {
      nowInCall = adapter.isInCall(root.document);
    } catch (e) {
      console.debug('[ET] isInCall failed', e);
    }

    if (nowInCall && !inCall) console.info(`[ET] ${adapter.name} call detected`);
    if (!nowInCall && inCall) {
      console.info(`[ET] ${adapter.name} call ended`);
      manualStop = false;
      if (recorder.active) await recorder.stop();
    }
    inCall = nowInCall;

    if (inCall && !recorder.active && !manualStop && settings.autoStart && enabled()) {
      await recorder.start();
    }
    recorder.tick();
    report(false);
  }

  function shutdown() {
    clearInterval(timer);
    timer = null;
    if (recorder) {
      recorder.detach();
      recorder.hideHint();
    }
  }

  async function handleCommand(cmd) {
    switch (cmd) {
      case 'start':
        manualStop = false;
        if (recorder.status === 'paused') recorder.resume();
        else await recorder.start();
        break;
      case 'pause':
        recorder.pause();
        break;
      case 'resume':
        recorder.resume();
        break;
      case 'stop':
        manualStop = true;
        await recorder.stop();
        break;
    }
    report(true);
    return fullState();
  }

  async function init() {
    settings = await root.ETStorage.getSettings();
    recorder = new root.ETRecorder.CaptionRecorder(adapter, settings, () => report(false));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) {
        settings = root.ETSettings.withDefaults(changes.settings.newValue);
        recorder.settings = settings;
        if (!enabled() && recorder.active) recorder.stop();
      }
      const t = recorder.transcript;
      if (t && changes['t:' + t.id]) recorder.applyExternalChange(changes['t:' + t.id].newValue);
    });

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.target !== 'content') return false;
      // Only the frame that owns the call answers.
      if (!inCall && !recorder.transcript && root.top !== root) return false;
      if (msg.type === 'command') {
        handleCommand(msg.cmd).then(sendResponse);
        return true;
      }
      if (msg.type === 'getState') {
        sendResponse(fullState());
        return false;
      }
      if (msg.type === 'debug') {
        sendResponse(recorder.debugInfo());
        return false;
      }
      return false;
    });

    // Best-effort final save when the tab closes or navigates away (FR-4.2).
    root.addEventListener('pagehide', () => {
      if (recorder.active) {
        recorder.transcript.endedAt = Date.now();
        recorder.flush();
      }
    });

    timer = setInterval(tick, TICK_MS);
    tick();
  }

  init().catch((e) => console.warn('[ET] init failed', e));
})(globalThis);
