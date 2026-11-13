/* Spider-Man: Rebirth — shared helpers.
   Everything hangs off one global namespace (window.SMR) so the game runs
   from a plain file:// double-click as well as from a web server. */
(function () {
  'use strict';

  const SMR = (window.SMR = window.SMR || {});
  const TAU = Math.PI * 2;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const smoothstep = (a, b, v) => smooth((v - a) / (b - a));

  /** Frame-rate independent approach: move `cur` toward `target`. */
  const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  };

  /** Small seeded PRNG (mulberry32) so the city is the same city every launch. */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
    next.pick = (list) => list[Math.floor(next() * list.length)];
    next.chance = (p) => next() < p;
    return next;
  }

  /* ---- colour ---- */
  function hexToRgb(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (hex, a) => { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  const darken = (hex, t) => mix(hex, '#000000', t);
  const lighten = (hex, t) => mix(hex, '#ffffff', t);
  /** Perceived brightness 0..1 — used to pick readable ink on a colour. */
  function luma(hex) {
    const c = hexToRgb(hex);
    return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** Cheap, smooth 1-D value noise in [-1, 1]. */
  function noise1(x) {
    const i = Math.floor(x), f = x - i;
    const h = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };
    return lerp(h(i), h(i + 1), smooth(f));
  }

  SMR.util = {
    TAU, clamp, lerp, smooth, smoothstep, damp, ease, rng,
    hexToRgb, rgba, mix, darken, lighten, luma, makeCanvas, noise1,
  };
})();
