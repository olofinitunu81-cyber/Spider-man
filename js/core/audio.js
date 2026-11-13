/* All sound is synthesised with Web Audio: short interface sounds and a slow
   ambient bed. Nothing is loaded from disk. */
(function () {
  'use strict';
  const SMR = window.SMR;
  let ctx = null, master = null, musicBus = null, sfxBus = null, noiseBuf = null, musicTimer = null, started = false;
  // (the game's soundscape uses these too; see gameStart)
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
    // in the game
    thwip() { whoosh(5200, 1800, 0.09, 0.32, 4); whoosh(900, 300, 0.16, 0.12, 1.5, 0.03); },
    land() { tone('sine', 120, 42, 0.22, 0.4); whoosh(700, 160, 0.2, 0.22, 0.8); },
    punch() { tone('sine', 160, 55, 0.12, 0.45); whoosh(2400, 600, 0.08, 0.25, 1.2); },
    trick() { whoosh(400, 2600, 0.32, 0.22, 1.4); },
    horn() { const f = 330 + Math.random() * 90; tone('square', f, f, 0.32, 0.035); tone('square', f * 1.26, f * 1.26, 0.32, 0.03); },
    flutter() { for (let i = 0; i < 9; i++) whoosh(1800 + Math.random() * 1500, 900, 0.06, 0.07, 2.5, i * 0.045 + Math.random() * 0.02); },
    shutter() { whoosh(6000, 4000, 0.03, 0.08, 6); whoosh(5000, 3500, 0.03, 0.06, 6, 0.06); },
    siren() { const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; for (let k = 0; k < 6; k++) { o.frequency.setValueAtTime(680, t + k * 0.9); o.frequency.linearRampToValueAtTime(980, t + k * 0.9 + 0.45); o.frequency.linearRampToValueAtTime(680, t + k * 0.9 + 0.9); } g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.018, t + 0.8); g.gain.linearRampToValueAtTime(0.0001, t + 5.4); o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 5.5); },
    catch() { whoosh(600, 7000, 0.3, 0.35, 3); tone('sine', 523, 523, 0.12, 0.1, 0.12); tone('sine', 784, 784, 0.18, 0.1, 0.2); tone('sine', 1047, 1047, 0.3, 0.09, 0.28); },
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

  /* ---- the game's living soundscape: wind with speed, the city's hum, a news chopper,
     and a light groove that comes in while he is swinging ---- */
  let live = null;
  function loopNoise(type, freq, q) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true;
    f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7;
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(sfxBus);
    src.start(0, Math.random());
    return { src, f, g };
  }
  const BPM = 104, STEP = 60 / BPM / 4;
  function scheduleGroove() {
    if (!live) return;
    while (live.next < ctx.currentTime + 0.25) {
      const t = live.next, i = live.step % 16, bar = Math.floor(live.step / 16);
      const ch = CHORDS[Math.floor(bar / 2) % CHORDS.length];
      if (i % 4 === 0) { // kick
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        o.connect(g); g.connect(live.groove); o.start(t); o.stop(t + 0.26);
      }
      if (i % 8 === 4) { // snare
        const s2 = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s2.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        s2.connect(f); f.connect(g); g.connect(live.groove); s2.start(t, Math.random()); s2.stop(t + 0.18);
      }
      if (i % 2 === 0) { // hats
        const s2 = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s2.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 7000;
        const a = i % 4 === 2 ? 0.07 : 0.035;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        s2.connect(f); f.connect(g); g.connect(live.groove); s2.start(t, Math.random()); s2.stop(t + 0.06);
      }
      if ([0, 3, 6, 10, 12].includes(i)) { // bass on the chord's root
        const f0 = ch[0] / 2 * (i === 10 ? 1.5 : 1), o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f0; lp.type = 'lowpass'; lp.frequency.value = 420;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 2.2);
        o.connect(lp); lp.connect(g); g.connect(live.groove); o.start(t); o.stop(t + STEP * 2.4);
      }
      live.next += STEP; live.step++;
    }
  }

  SMR.audio = {
    /** Start the game's loops (call after unlock). */
    gameStart() {
      if (!ensure() || live) return;
      live = {
        wind: loopNoise('bandpass', 700, 0.6), wind2: loopNoise('lowpass', 260, 0.5), city: loopNoise('lowpass', 180, 0.4),
        rotor: loopNoise('lowpass', 140, 1.2), groove: ctx.createGain(), next: ctx.currentTime + 0.1, step: 0,
      };
      // the chopper's blades: the rotor noise pulses about 11 times a second
      live.lfo = ctx.createOscillator(); live.lfoG = ctx.createGain(); live.lfo.frequency.value = 11; live.lfoG.gain.value = 0;
      live.lfo.connect(live.lfoG); live.lfoG.connect(live.rotor.g.gain); live.lfo.start();
      live.groove.gain.value = 0; live.groove.connect(musicBus);
      live.timer = setInterval(scheduleGroove, 60);
    },
    /** Levels 0..1, eased: wind (speed), city (hum at street level), rotor (chopper nearby), groove (swinging). */
    gameMix(m) {
      if (!live || ctx.state !== 'running') return;
      const t = ctx.currentTime, set = (param, v, k) => param.setTargetAtTime(v, t, k || 0.25);
      set(live.wind.g.gain, 0.32 * m.wind * m.wind); set(live.wind.f.frequency, 380 + 1900 * m.wind, 0.3);
      set(live.wind2.g.gain, 0.24 * m.wind);
      set(live.city.g.gain, 0.16 * m.city, 0.8);
      set(live.rotor.g.gain, 0.06 * m.rotor, 0.5); set(live.lfoG.gain, 0.05 * m.rotor, 0.5);
      set(live.groove.gain, 0.85 * m.groove, m.groove > live.lastGroove ? 0.6 : 2.5);
      live.lastGroove = m.groove;
    },
    gameStop() {
      if (!live) return;
      clearInterval(live.timer);
      const t = ctx.currentTime;
      for (const k of ['wind', 'wind2', 'city', 'rotor']) { live[k].g.gain.setTargetAtTime(0, t, 0.1); live[k].src.stop(t + 0.5); }
      live.lfo.stop(t + 0.5);
      live.groove.gain.setTargetAtTime(0, t, 0.2);
      live = null;
    },
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
