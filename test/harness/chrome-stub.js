/* Minimal in-memory stand-in for the chrome.* APIs the content scripts use. */
(function () {
  const data = {};
  const listeners = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  window.chrome = {
    runtime: { id: 'harness', getManifest: () => ({ version: 'harness' }), sendMessage: async () => ({}) },
    storage: {
      onChanged: { addListener: (fn) => listeners.push(fn) },
      local: {
        async get(keys) {
          if (keys === null) return clone(data);
          const out = {};
          for (const k of [].concat(keys)) if (k in data) out[k] = clone(data[k]);
          return out;
        },
        async set(obj) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
            data[k] = clone(v);
          }
          listeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete data[k];
        }
      }
    }
  };
  window.__stubData = data;
})();
