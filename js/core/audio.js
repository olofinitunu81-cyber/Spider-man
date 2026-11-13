/* All sound is synthesised with Web Audio: short interface sounds and a slow
   ambient bed. Nothing is loaded from disk. */
(function () {
  'use strict';
  const SMR = window.SMR;
  let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null, musicTimer = null, started = false;
  const vol = { master: 0.8, music: 0.6, sfx: 0.8 };

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); sfxBus = ctx.createGain();
    musicBus.connect(master); sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    apply();
    return true;
  }
  function apply() {
    if (!ctx) return;
    master.gain.value = vol.master;
    musicBus.gain.value = vol.music * 0.5;
    sfxBus.gain.value = vol.sfx * 0.7;
  }

  function tone(type, f0, f1, dur, gain, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function whoosh(f0, f1, dur, gain, q, delay) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = 'bandpass'; f.Q.value = q || 2;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    move() { tone('triangle', 1700, 1250, 0.05, 0.11); },
    select() { whoosh(900, 4600, 0.14, 0.42, 2.4); tone('sine', 2300, 1200, 0.04, 0.1); tone('triangle', 520, 380, 0.09, 0.12, 0.11); },
    back() { whoosh(2800, 520, 0.15, 0.26, 2); },
    tab() { tone('triangle', 1250, 1250, 0.04, 0.09); tone('triangle', 1650, 1650, 0.05, 0.09, 0.05); },
    tick() { tone('triangle', 1400, 1100, 0.03, 0.07); },
    on() { tone('sine', 660, 660, 0.06, 0.12); tone('sine', 990, 990, 0.09, 0.12, 0.06); },
    off() { tone('sine', 880, 880, 0.06, 0.1); tone('sine', 587, 587, 0.09, 0.1, 0.06); },
    deny() { tone('square', 140, 110, 0.09, 0.07); tone('square', 120, 96, 0.11, 0.07, 0.1); },
    equip() { whoosh(500, 6000, 0.22, 0.3, 5); tone('sine', 784, 784, 0.1, 0.11, 0.16); tone('sine', 1175, 1175, 0.16, 0.11, 0.24); },
    web() { whoosh(1200, 5200, 0.1, 0.4, 3); tone('sine', 430, 300, 0.2, 0.1, 0.09); },
    start() { whoosh(260, 6400, 1.0, 0.5, 1.2); tone('sine', 110, 34, 0.9, 0.6, 0.85); whoosh(3000, 300, 0.8, 0.3, 0.8, 0.85); },
  };

  /* ---- ambient bed: a slow four-chord pad with a few bell notes ---- */
  const CHORDS = [[146.83, 220, 349.23, 329.63], [116.54, 233.08, 293.66, 349.23], [174.61, 261.63, 329.63, 392], [130.81, 196, 293.66, 392]];
  let chord = 0;
  function playChord() {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime, len = 8;
    CHORDS[chord % CHORDS.length].forEach((f, i) => {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = f; o.detune.value = det;
        lp.type = 'lowpass'; lp.frequency.value = 900;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(i === 0 ? 0.11 : 0.05, t + 3);
        g.gain.linearRampToValueAtTime(0.0001, t + len + 3.5);
        o.connect(lp); lp.connect(g); g.connect(musicBus);
        o.start(t); o.stop(t + len + 4);
      }
    });
    const notes = CHORDS[chord % CHORDS.length];
    for (let k = 0; k < 3; k++) {
      const when = t + 1 + k * 2.4 + Math.random() * 0.6, f = notes[1 + Math.floor(Math.random() * 3)] * 2;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.045, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);
      o.connect(g); g.connect(musicBus);
      o.start(when); o.stop(when + 2.5);
    }
    chord++;
  }

  SMR.audio = {
    /** Must be called from a key press or click: browsers block sound until then. */
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!started) { started = true; playChord(); musicTimer = setInterval(playChord, 8000); }
    },
    play(name) { if (ctx && ctx.state === 'running' && SOUNDS[name]) SOUNDS[name](); },
    setVolumes(m, mu, s) { vol.master = m / 100; vol.music = mu / 100; vol.sfx = s / 100; apply(); },
    pause(p) { if (ctx) { if (p) ctx.suspend(); else if (started) ctx.resume(); } },
  };
})();
