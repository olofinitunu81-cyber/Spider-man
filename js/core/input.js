/* Turns keyboard, gamepad and touch into the same few menu actions:
   up, down, left, right, confirm, back, prev, next, hide, any. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const listeners = [];
  let device = 'keyboard';
  const deviceListeners = [];

  const KEYS = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', Escape: 'back', Backspace: 'back',
    KeyQ: 'prev', BracketLeft: 'prev', KeyE: 'next', BracketRight: 'next', KeyH: 'hide',
  };
  const IGNORE = ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Tab', 'CapsLock'];

  function setDevice(d) {
    if (d === device) return;
    device = d;
    deviceListeners.forEach((fn) => fn(d));
  }
  function emit(action) { listeners.forEach((fn) => fn(action)); }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || IGNORE.includes(e.code) || /^F\d+$/.test(e.code)) return;
    setDevice('keyboard');
    const action = KEYS[e.code];
    if (action) e.preventDefault();
    emit(action || 'any');
  });

  /* ---- gamepad: polled, with key-repeat on the directions ---- */
  const PAD = { 0: 'confirm', 1: 'back', 4: 'prev', 5: 'next', 9: 'confirm', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  const held = {};
  function poll(now) {
    requestAnimationFrame(poll);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const down = {};
    for (const p of pads) {
      if (!p || !p.connected) continue;
      p.buttons.forEach((b, i) => { if (b.pressed) down[PAD[i] || 'any'] = true; });
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (ay < -0.55) down.up = true; else if (ay > 0.55) down.down = true;
      if (ax < -0.55) down.left = true; else if (ax > 0.55) down.right = true;
    }
    for (const a of Object.keys(down)) {
      const repeat = a === 'up' || a === 'down' || a === 'left' || a === 'right';
      if (!held[a]) { held[a] = now + 380; setDevice('gamepad'); emit(a); }
      else if (repeat && now > held[a]) { held[a] = now + 120; emit(a); }
    }
    for (const a of Object.keys(held)) if (!down[a]) delete held[a];
  }
  requestAnimationFrame(poll);

  window.addEventListener('touchstart', () => setDevice('touch'), { passive: true });
  window.addEventListener('mousemove', () => { if (device === 'touch' || device === 'gamepad') setDevice('keyboard'); });

  SMR.input = {
    on(fn) { listeners.push(fn); },
    onDevice(fn) { deviceListeners.push(fn); },
    device: () => device,
    /** A short rumble on pads that support it. */
    rumble(ms, strength) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (p && p.vibrationActuator && p.vibrationActuator.playEffect) {
          p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength * 0.5, weakMagnitude: strength }).catch(() => {});
        }
      }
    },
  };
})();
