/* Settings and the save file, kept in the browser's localStorage. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const KEY = 'smr.rebirth.v1';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEFAULTS = {
    master: 80, music: 60, sfx: 80,
    sky: 'dawn', quality: 'auto', grain: true, parallax: true, fps: false,
    difficulty: 'crawler', subtitles: true, vibration: true,
    motion: !reduce, textSize: 100, contrast: false,
    suit: 'rebirth',
  };

  let data = { settings: Object.assign({}, DEFAULTS), save: null };
  const listeners = [];

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') {
        data.settings = Object.assign({}, DEFAULTS, raw.settings || {});
        data.save = raw.save || null;
      }
    } catch (e) { /* private mode or corrupt data: fall back to defaults */ }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  SMR.store = {
    DEFAULTS,
    load,
    get: (k) => data.settings[k],
    all: () => data.settings,
    set(k, v) { data.settings[k] = v; persist(); listeners.forEach((fn) => fn(k, v)); },
    reset() { const suit = data.settings.suit; data.settings = Object.assign({}, DEFAULTS, { suit }); persist(); listeners.forEach((fn) => fn(null)); },
    onChange(fn) { listeners.push(fn); },
    getSave: () => data.save,
    setSave(s) { data.save = s; persist(); },
  };
})();
