/* Options page (FR-7): every control saves immediately. */
'use strict';
(async function () {
  let settings = await ETStorage.getSettings();

  const keyed = document.querySelectorAll('[data-key]');
  const platforms = document.querySelectorAll('[data-platform]');

  function fill() {
    for (const el of keyed) {
      const v = settings[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
    }
    for (const el of platforms) el.checked = !!settings.platforms[el.dataset.platform];
  }

  async function save() {
    for (const el of keyed) {
      const k = el.dataset.key;
      if (el.type === 'checkbox') settings[k] = el.checked;
      else if (el.type === 'number') settings[k] = Math.max(Number(el.min) || 0, Math.min(Number(el.max) || 1e9, Number(el.value) || 0));
      else settings[k] = el.value;
    }
    settings.platforms = {};
    for (const el of platforms) settings.platforms[el.dataset.platform] = el.checked;
    await ETStorage.saveSettings(settings);
    ETUI.toast('Saved');
  }

  for (const el of [...keyed, ...platforms]) el.addEventListener('change', save);

  document.getElementById('delete-all').onclick = async () => {
    const list = await ETStorage.listTranscripts();
    if (!list.length) return ETUI.toast('No transcripts to delete');
    if (!confirm(`Delete all ${list.length} transcripts? This cannot be undone.`)) return;
    await ETStorage.deleteTranscripts(list.map((t) => t.id));
    ETUI.toast('All transcripts deleted');
  };

  fill();
})();
