/* Chapter one, playable. The game owns its own canvas and WebGL renderer, reads the keyboard,
   mouse and controller directly, runs the chase camera, the HUD, the map and photo mode, and
   draws every frame the screen can show: no frame cap. To hold a smooth 100 fps (or the screen's
   own rate when that is lower) it watches its frame times and trims or restores the render
   resolution to fit. The menu's 3D stage sleeps while this runs.

   Keyboard and mouse follow the familiar PC layout for this kind of game: WASD and the mouse,
   Shift swings or sprints, Space jumps (hold for height) or web-zips in the air, C zips to a
   point, X perches or dives, T throws air tricks, Ctrl dodges, left click strikes, F web-strikes,
   right mouse aims and Q yanks, 1 heals, 2 finishes, E fires the gadget, Tab opens the map,
   V scans, P is photo mode and G toggles high contrast. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const TARGET_MS = 10; // 100 fps
  // what each action is called on the keyboard and on a controller, for the HUD and the tips
  const KEYS = {
    move: ['W A S D', 'Left stick'], walk: ['Left Alt', 'L3'], swing: ['Left Shift', 'RT'], jump: ['Space', 'A'],
    zip: ['C', 'RB'], perch: ['X', 'LB'], trick: ['T', 'R3'], melee: ['Left click', 'X'], strike: ['F', 'Y'],
    dodge: ['Left Ctrl', 'B'], aim: ['right mouse', 'LT'], yank: ['Q', 'RB'], heal: ['1', 'D-pad up'],
    finisher: ['2', 'D-pad down'], gadget: ['E', 'D-pad left'], map: ['Tab', 'View'], scan: ['V', 'D-pad right'],
    pause: ['Esc', 'Start'], photo: ['P', ''], contrast: ['G', ''],
  };
  const HUD = `
    <canvas class="game-gl"></canvas>
    <div class="hud">
      <div class="hud-obj"><div class="hud-chapter"></div><div class="hud-goal"></div><div class="hud-detail"><span></span><b></b></div></div>
      <div class="hud-marker"><i></i><span></span></div>
      <div class="hud-aim"></div>
      <div class="hud-speed"><b>0</b><span>km/h</span></div>
      <div class="hud-pop"></div>
      <div class="hud-say"></div>
      <div class="hud-tip"></div>
      <div class="hud-bars"><div class="bar hp"><i></i></div><div class="bar fo"><i></i></div><div class="gadget">Web bomb <b></b></div></div>
      <div class="hud-keys"></div>
      <div class="hud-fps"></div>
    </div>
    <div class="game-map"><div class="panel"><div class="kicker">Midtown</div><canvas width="760" height="760"></canvas><p>Tab or Esc to close</p></div></div>
    <div class="game-photo">Photo mode · mouse to frame · scroll to zoom · P to leave</div>
    <div class="game-card"><div class="kicker">Chapter one</div><div class="big">Stitches</div><p>Dawn over Midtown. The suit held together overnight.<br>Time to find out if you did.</p></div>
    <div class="game-over game-pause"><div class="panel"><div class="kicker">Chapter one · Stitches</div><h2>Paused</h2><nav></nav></div></div>
    <div class="game-over game-done"><div class="panel"><div class="kicker">Chapter one</div><h2>Stitches</h2><p class="done-line">Complete</p><dl class="stats"></dl><nav></nav></div></div>`;

  let G = null;

  const vec = (hex) => { const c = U.hexToRgb(hex); return new T.Vector3(c[0] / 255, c[1] / 255, c[2] / 255); };

  function softwareGL() {
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl2');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }

  async function start(opts) {
    if (G) stop();
    const store = SMR.store, audio = SMR.audio;
    const app = document.getElementById('app');
    const root = document.createElement('div');
    root.className = 'game';
    root.innerHTML = HUD;
    app.appendChild(root);
    const $ = (s) => root.querySelector(s);
    const canvas = $('.game-gl');

    const soft = softwareGL();
    const renderer = new T.WebGLRenderer({ canvas, antialias: !soft, alpha: false, stencil: false, powerPreference: 'high-performance' });
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(64, 16 / 9, 0.1, 5200);

    // shared look: the same palette, haze and grain as the menu
    const pal = SMR.palettes.dawn;
    const sunDir = new T.Vector3(0.5, 0.075, -0.86).normalize();
    const lut = new T.CanvasTexture(U.makeCanvas(256, 2));
    lut.minFilter = lut.magFilter = T.LinearFilter; lut.generateMipmaps = false;
    const shared = {
      lut, sunDir, timeU: { value: 0 }, grainU: { value: store.get('grain') ? 0.09 : 0 }, mutedU: { value: 0 },
      fogU: { uHazeLow: { value: vec(pal.far[1]) }, uHazeHigh: { value: vec(pal.far[0]) }, uGlow: { value: vec(pal.orb.mid) }, uSunDir: { value: sunDir }, uFog: { value: 0.0011 } },
    };

    const world = SMR.createWorld(scene, shared, renderer);
    world.applyPalette(pal, vec);
    const aniso = soft ? 1 : Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const hero = await SMR.createHero(shared, aniso);
    hero.setSuit(opts.suit, vec);
    hero.uniforms.uRim.value.copy(vec(pal.rim)); hero.uniforms.uFill.value.copy(vec(pal.fill));
    scene.add(hero.mesh);

    const hardMode = opts.difficulty === 'menace' || opts.difficulty === 'nonet';
    const player = SMR.createPlayer(world, { fallDamage: hardMode });
    let chapter = null;

    // web lines: camera-facing ribbons from his hand to whatever the web is stuck to
    const WEBS = 4;
    const webPos = new Float32Array(WEBS * 4 * 3), webIdx = [];
    for (let i = 0; i < WEBS; i++) webIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    const webGeo = new T.BufferGeometry();
    webGeo.setAttribute('position', new T.BufferAttribute(webPos, 3).setUsage(T.DynamicDrawUsage));
    webGeo.setIndex(webIdx);
    const webMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'precision highp float;' + SMR.shaders.FOG_GLSL + 'varying vec3 vW; void main(){ gl_FragColor = vec4(applyFog(vec3(0.96, 0.95, 0.92), vW), 1.0); }',
      uniforms: shared.fogU, side: T.DoubleSide,
    });
    const webMesh = new T.Mesh(webGeo, webMat);
    webMesh.frustumCulled = false;
    scene.add(webMesh);
    const wa = new T.Vector3(), wb = new T.Vector3(), wside = new T.Vector3(), wtmp = new T.Vector3();
    function setWeb(i, a, b, w) {
      wside.copy(b).sub(a).cross(wtmp.copy(camera.position).sub(a)).normalize().multiplyScalar(w);
      const o = i * 12;
      webPos[o] = a.x - wside.x; webPos[o + 1] = a.y - wside.y; webPos[o + 2] = a.z - wside.z;
      webPos[o + 3] = a.x + wside.x; webPos[o + 4] = a.y + wside.y; webPos[o + 5] = a.z + wside.z;
      webPos[o + 6] = b.x - wside.x; webPos[o + 7] = b.y - wside.y; webPos[o + 8] = b.z - wside.z;
      webPos[o + 9] = b.x + wside.x; webPos[o + 10] = b.y + wside.y; webPos[o + 11] = b.z + wside.z;
    }
    function clearWeb(i) { webPos.fill(0, i * 12, i * 12 + 12); }

    // the web bomb gadget: a sticky ball that bursts into a net
    const bombMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vW; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: 'precision highp float; uniform float uA; varying vec3 vW; void main(){ gl_FragColor = vec4(vec3(0.95, 0.94, 0.9) * uA, 1.0); }',
      uniforms: { uA: { value: 1 } }, wireframe: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
    });
    const bomb = new T.Mesh(new T.IcosahedronGeometry(1, 1), bombMat);
    bomb.visible = false; scene.add(bomb);
    const gadget = { charges: 3, recharge: 0, flying: false, burstT: -1, pos: new T.Vector3(), vel: new T.Vector3(), life: 0 };

    /* ---------- HUD ---------- */
    const hud = {
      chapter: $('.hud-chapter'), goal: $('.hud-goal'), detail: $('.hud-detail span'), prog: $('.hud-detail b'), obj: $('.hud-obj'),
      marker: $('.hud-marker'), markerD: $('.hud-marker span'), aim: $('.hud-aim'), speed: $('.hud-speed b'), speedBox: $('.hud-speed'),
      say: $('.hud-say'), tip: $('.hud-tip'), keys: $('.hud-keys'), fps: $('.hud-fps'), card: $('.game-card'), pop: $('.hud-pop'),
      hp: $('.bar.hp i'), fo: $('.bar.fo i'), foBar: $('.bar.fo'), bombs: $('.gadget b'),
    };
    let sayT = 0, tipT = 0, popT = 0;
    function say(text, secs, tip) {
      if (tip) { hud.tip.textContent = text; hud.tip.classList.add('on'); tipT = secs; }
      else { hud.say.textContent = text; hud.say.classList.add('on'); sayT = secs; }
    }
    function pop(text) { hud.pop.textContent = text; hud.pop.classList.remove('on'); void hud.pop.offsetWidth; hud.pop.classList.add('on'); popT = 1.1; }
    function objectiveChanged() {
      const s = chapter.state;
      hud.chapter.textContent = s.title; hud.goal.textContent = s.objective; hud.detail.textContent = s.detail; hud.prog.textContent = s.progress;
      hud.obj.classList.remove('bump'); void hud.obj.offsetWidth; hud.obj.classList.add('bump');
    }
    function sound(name) { audio.play(name); }

    /* ---------- input ---------- */
    const keys = new Set(), hit = new Set(), mouseHeld = new Set(), mouseHit = new Set();
    let locked = false, device = 'keyboard', wheel = 0;
    const key = (name) => KEYS[name][device === 'pad' ? 1 : 0];
    const padPrev = [];
    const look = { yaw: Math.PI, pitch: 0.2, idle: 0 };
    const sens = 0.0023 * ({ slow: 0.6, normal: 1, fast: 1.6 }[store.get('lookSpeed')] || 1);
    const invY = store.get('invertY') ? -1 : 1;
    const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyX', 'KeyT', 'KeyF', 'KeyQ', 'KeyE', 'KeyV', 'KeyP', 'KeyG',
      'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'ControlLeft', 'Tab', 'Digit1', 'Digit2', 'Escape', 'Enter'];
    const onKeyDown = (e) => {
      if (GAME_KEYS.includes(e.code)) e.preventDefault();
      if (!e.repeat) hit.add(e.code);
      keys.add(e.code);
      device = 'keyboard';
    };
    const onKeyUp = (e) => { keys.delete(e.code); if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); };
    const onMouseMove = (e) => {
      if (!G || !locked || G.paused || G.done || G.mapOpen) return;
      look.yaw -= e.movementX * sens * (G.aiming ? 0.6 : 1);
      look.pitch = U.clamp(look.pitch + e.movementY * sens * invY * (G.aiming ? 0.6 : 1), -0.95, 1.2);
      look.idle = 0;
    };
    const onMouseDown = (e) => {
      if (!G || G.paused || G.done || G.mapOpen) return;
      if (e.button === 3 || e.button === 4) e.preventDefault(); // side buttons: never navigate away
      if (!locked) { lockPointer(); return; }
      mouseHeld.add(e.button); mouseHit.add(e.button);
      device = 'keyboard';
    };
    const onMouseUp = (e) => { mouseHeld.delete(e.button); if (e.button === 3 || e.button === 4) e.preventDefault(); };
    const onWheel = (e) => { if (G && G.photo) { wheel += Math.sign(e.deltaY); e.preventDefault(); } };
    const onContext = (e) => e.preventDefault();
    const onLockChange = () => {
      locked = document.pointerLockElement === canvas;
      if (!locked) mouseHeld.clear();
      if (!locked && G && !G.paused && !G.done && !G.mapOpen && !G.photo) pause(true);
    };
    const onBlur = () => { keys.clear(); mouseHeld.clear(); if (G && !G.paused && !G.done) pause(true); };
    const onVis = () => { if (document.hidden && G && !G.paused && !G.done) pause(true); };
    function lockPointer() {
      if (!canvas.requestPointerLock) return;
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed here */ }
      // in fullscreen, also keep Ctrl+W and friends for the game (Left Ctrl dodges)
      if (document.fullscreenElement && navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(() => {});
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('auxclick', onContext);
    canvas.addEventListener('contextmenu', onContext);
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);

    function readPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected && p.mapping === 'standard') return p;
      for (const p of pads) if (p && p.connected) return p;
      return null;
    }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const input = {};
    const aim = { o: new T.Vector3(), d: new T.Vector3() };
    function gather(dt) {
      const k = (c) => keys.has(c), h = (c) => hit.has(c);
      let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      let y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
      const a = {
        walk: k('AltLeft') || k('AltRight'), swing: k('ShiftLeft') || k('ShiftRight'), jump: k('Space'), jumpPressed: h('Space'),
        zipPressed: h('KeyC'), perchPressed: h('KeyX'), trickPressed: h('KeyT'), meleePressed: mouseHit.has(0), strikePressed: h('KeyF'),
        dodgePressed: h('ControlLeft') || mouseHit.has(3), aiming: mouseHeld.has(2), yankPressed: h('KeyQ'), healPressed: h('Digit1'),
        finisherPressed: h('Digit2'), gadgetPressed: h('KeyE'), mapPressed: h('Tab'), scanPressed: h('KeyV'), pause: h('Escape'),
        photoPressed: h('KeyP'), contrastPressed: h('KeyG'),
        up: h('ArrowUp') || h('KeyW'), down: h('ArrowDown') || h('KeyS'), confirm: h('Enter') || h('Space'), back: h('Escape'),
      };
      const pad = readPad();
      if (pad) {
        const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
        const pb = (i) => b(i) && !padPrev[i];
        const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0), rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
        if (lx || ly || rx || ry || pad.buttons.some((bt) => bt.pressed)) device = 'pad';
        x += lx; y -= ly;
        if (G && !G.paused && !G.done && !G.mapOpen) {
          const s = (sens / 0.0023) * (b(6) ? 0.6 : 1);
          look.yaw -= rx * 2.7 * dt * s;
          look.pitch = U.clamp(look.pitch + ry * 2.0 * dt * invY * s, -0.95, 1.2);
          if (rx || ry) look.idle = 0;
        }
        a.walk = a.walk || b(10); a.swing = a.swing || b(7); a.jump = a.jump || b(0); a.jumpPressed = a.jumpPressed || pb(0);
        a.aiming = a.aiming || b(6);
        a.zipPressed = a.zipPressed || (pb(5) && !b(6)); a.yankPressed = a.yankPressed || (pb(5) && b(6));
        a.perchPressed = a.perchPressed || pb(4); a.trickPressed = a.trickPressed || pb(11);
        a.meleePressed = a.meleePressed || pb(2); a.strikePressed = a.strikePressed || pb(3); a.dodgePressed = a.dodgePressed || pb(1);
        a.healPressed = a.healPressed || pb(12); a.finisherPressed = a.finisherPressed || pb(13); a.gadgetPressed = a.gadgetPressed || pb(14);
        a.scanPressed = a.scanPressed || pb(15); a.mapPressed = a.mapPressed || pb(8); a.pause = a.pause || pb(9);
        a.up = a.up || pb(12) || (ly < -0.6 && !padPrev.stickUp); a.down = a.down || pb(13) || (ly > 0.6 && !padPrev.stickDown);
        a.confirm = a.confirm || pb(0); a.back = a.back || pb(1) || pb(9);
        padPrev.stickUp = ly < -0.6; padPrev.stickDown = ly > 0.6;
        for (let i = 0; i < pad.buttons.length; i++) padPrev[i] = b(i);
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      Object.assign(input, a, { x, y, aim });
      hit.clear(); mouseHit.clear();
    }

    /* ---------- camera ---------- */
    const camT = new T.Vector3(), camP = new T.Vector3(), lookDir = new T.Vector3(), camRight = new T.Vector3(), hipNow = new T.Vector3();
    const camState = { dist: 4.6, fov: 64, shake: 0, photoDist: 4.5 };
    function updateCamera(dt) {
      const pl = player.p, motion = store.get('motion');
      player.hipPoint(hipNow);
      const sp = pl.vel.length(), hs = Math.hypot(pl.vel.x, pl.vel.z);
      // drift behind him when he is moving and the player is not steering the camera
      look.idle += dt;
      if (!G.photo && !G.aiming && look.idle > 1.1 && hs > 4 && pl.state !== 'wall') {
        let dd = Math.atan2(pl.vel.x, pl.vel.z) - look.yaw;
        while (dd > Math.PI) dd -= Math.PI * 2;
        while (dd < -Math.PI) dd += Math.PI * 2;
        look.yaw += dd * Math.min(1, dt * 1.3 * Math.min(1, hs / 14));
      }
      const airy = pl.state === 'swing' || pl.state === 'air' || pl.state === 'zip' || pl.state === 'boost';
      let wantDist = airy ? U.lerp(5.4, 8.2, U.clamp(sp / 40, 0, 1)) : pl.state === 'wall' ? 6.2 : 4.4 + (hs > 10 ? 0.6 : 0);
      let wantFov = 64 + (motion ? Math.min(20, sp * 0.42) : 0), shoulder = 0.55;
      if (G.aiming) { wantDist = 2.9; wantFov -= 14; shoulder = 0.85; }
      if (G.photo) { camState.photoDist = U.clamp(camState.photoDist + wheel * 0.6, 1.6, 14); wheel = 0; wantDist = camState.photoDist; shoulder = 0; }
      camState.dist = U.damp(camState.dist, wantDist, G.photo ? 8 : 3, dt);
      camState.fov = U.damp(camState.fov, wantFov, 4, dt);
      const cp = Math.cos(look.pitch);
      lookDir.set(Math.sin(look.yaw) * cp, -Math.sin(look.pitch), Math.cos(look.yaw) * cp);
      camRight.set(-Math.cos(look.yaw), 0, Math.sin(look.yaw));
      camT.copy(hipNow).add(wtmp.set(0, 0.55, 0));
      camP.copy(camT).addScaledVector(lookDir, -camState.dist).addScaledVector(camRight, shoulder);
      // keep a wall from coming between the camera and him
      const dir = wtmp.copy(camP).sub(camT), dl = dir.length();
      dir.multiplyScalar(1 / dl);
      const hitC = world.raycast(camT.x, camT.y, camT.z, dir.x, dir.y, dir.z, dl + 0.4);
      if (hitC) camP.copy(camT).addScaledVector(dir, Math.max(0.6, hitC.t - 0.4));
      if (camP.y < 0.4) camP.y = 0.4;
      if (motion && camState.shake > 0) {
        camState.shake = Math.max(0, camState.shake - dt * 2.5);
        camP.x += (Math.random() - 0.5) * camState.shake * 0.25; camP.y += (Math.random() - 0.5) * camState.shake * 0.25;
      }
      camera.position.copy(camP);
      camera.lookAt(wtmp.copy(camP).add(lookDir));
      camera.fov = camState.fov;
      camera.updateProjectionMatrix();
      // the hero is lit from just behind the camera, so he always reads; the sun rims him
      hero.uniforms.uKey.value.copy(camRight).multiplyScalar(0.35).add(wtmp.set(0, 0.62, 0)).addScaledVector(lookDir, -0.7).normalize();
    }

    /* ---------- resolution: hold 100 fps ---------- */
    const quality = store.get('quality') || 'auto';
    const maxRes = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5);
    const perf = { res: soft ? 0.45 : quality === 'low' ? Math.min(0.75, maxRes) : Math.min(1, maxRes), min: soft ? 0.3 : 0.5, ema: TARGET_MS, gaps: [], refresh: 0, slow: 0, fast: 0, cool: 0 };
    let cssW = 0, cssH = 0;
    function resize() {
      cssW = window.innerWidth; cssH = window.innerHeight;
      renderer.setPixelRatio(perf.res);
      renderer.setSize(cssW, cssH, false);
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
      hero.uniforms.uDot.value = Math.max(4, 6.5 * (renderer.domElement.height / 1080));
    }
    function adapt(gap, dt) {
      if (perf.gaps.length < 90) { perf.gaps.push(gap); if (perf.gaps.length === 90) { const s = perf.gaps.slice().sort((a, b) => a - b); perf.refresh = s[Math.floor(s.length * 0.2)]; } return; }
      perf.ema += (gap - perf.ema) * 0.08;
      if (quality !== 'auto') return;
      const target = Math.max(TARGET_MS, perf.refresh) * 1.12; // the screen may simply be slower than 100 Hz
      perf.cool -= dt;
      if (perf.ema > target) { perf.slow += dt; perf.fast = 0; } else if (perf.ema < Math.max(TARGET_MS, perf.refresh) * 1.03) { perf.fast += dt; perf.slow = 0; } else { perf.slow = 0; perf.fast = 0; }
      if (perf.cool <= 0 && perf.slow > 0.45 && perf.res > perf.min) { perf.res = Math.max(perf.min, perf.res * 0.86); perf.cool = 0.6; perf.slow = 0; resize(); }
      else if (perf.cool <= 0 && perf.fast > 3 && perf.res < maxRes) { perf.res = Math.min(maxRes, perf.res * 1.08); perf.cool = 1.2; perf.fast = 0; resize(); }
    }

    /* ---------- menus inside the game ---------- */
    function buildMenu(navSel, items) {
      const nav = $(navSel);
      nav.innerHTML = '';
      items.forEach(([label, fn], i) => {
        const b = document.createElement('button');
        b.className = 'gbtn' + (i === 0 ? ' on' : '');
        b.textContent = label;
        b.addEventListener('mouseenter', () => focusBtn(nav, i));
        b.addEventListener('click', () => { audio.play('select'); fn(); });
        nav.appendChild(b);
      });
    }
    function focusBtn(nav, i) { [...nav.children].forEach((b, k) => b.classList.toggle('on', k === i)); }
    function menuNav(nav) {
      const btns = [...nav.children]; let i = btns.findIndex((b) => b.classList.contains('on'));
      if (input.up) { i = (i + btns.length - 1) % btns.length; focusBtn(nav, i); audio.play('move'); }
      if (input.down) { i = (i + 1) % btns.length; focusBtn(nav, i); audio.play('move'); }
      if (input.confirm && btns[i]) btns[i].click();
    }

    function pause(on) {
      if (!G || G.done) return;
      G.paused = on;
      root.classList.toggle('paused', on);
      if (on) { if (document.pointerLockElement === canvas) document.exitPointerLock(); focusBtn($('.game-pause nav'), 0); }
      else lockPointer();
    }
    buildMenu('.game-pause nav', [
      ['Resume', () => pause(false)],
      ['Restart chapter', () => { restart(); pause(false); }],
      ['Quit to menu', () => opts.onQuit && opts.onQuit()],
    ]);

    function complete() {
      G.done = true;
      const st = chapter.state, ps = player.p.stats;
      const t = st.time, mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      $('.stats').innerHTML = [['Time', mm + ':' + String(ss).padStart(2, '0')], ['Top speed', Math.round(ps.top * 3.6) + ' km/h'], ['Swings', ps.swings], ['Web-zips', ps.zips], ['Air tricks', ps.tricks], ['Drones caught', '3 / 3']]
        .map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      setTimeout(() => { root.classList.add('finished'); focusBtn($('.game-done nav'), 0); }, 1200);
      if (opts.onComplete) opts.onComplete({ time: t, top: ps.top, swings: ps.swings, zips: ps.zips });
    }
    buildMenu('.game-done nav', [
      ['Keep swinging', () => { root.classList.remove('finished'); G.done = false; G.free = true; chapter.state.title = 'Free roam'; chapter.state.objective = 'Midtown is yours'; chapter.state.detail = 'Chapter two is on its way'; chapter.state.progress = ''; objectiveChanged(); lockPointer(); }],
      ['Back to menu', () => opts.onQuit && opts.onQuit()],
    ]);

    /* ---------- the map ---------- */
    const mapCanvas = $('.game-map canvas'), mapG = mapCanvas.getContext('2d');
    const MAPSZ = mapCanvas.width, ext = world.extent;
    const toMap = (x, z) => [(x + ext) / (2 * ext) * MAPSZ, (z + ext) / (2 * ext) * MAPSZ];
    const mapBase = U.makeCanvas(MAPSZ, MAPSZ);
    (function drawBase() {
      const g = mapBase.getContext('2d');
      g.fillStyle = '#0d0f1d'; g.fillRect(0, 0, MAPSZ, MAPSZ);
      const sorted = world.solids.filter((s) => s[4] - s[1] > 6).sort((a, b) => a[4] - b[4]);
      for (const s of sorted) {
        const [x0, y0] = toMap(s[0], s[2]), [x1, y1] = toMap(s[3], s[5]);
        const t = U.clamp(s[4] / 220, 0, 1);
        g.fillStyle = `rgb(${Math.round(60 + 120 * t)}, ${Math.round(40 + 50 * t)}, ${Math.round(90 + 60 * t)})`;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      const b = world.bugleTop, [bx, by] = toMap(b.x, b.z);
      g.fillStyle = '#e5162d'; g.font = '900 15px Spinneret, sans-serif'; g.textAlign = 'center';
      g.fillText('DAILY BUGLE', bx, by - 22);
    })();
    function drawMap() {
      mapG.drawImage(mapBase, 0, 0);
      const pl = player.p, st = chapter.state;
      if (chapter.rings) for (const r of chapter.rings) if (!r.done) { const [x, y] = toMap(r.c.x, r.c.z); mapG.strokeStyle = '#ffd27a'; mapG.lineWidth = 2; mapG.beginPath(); mapG.arc(x, y, 5, 0, Math.PI * 2); mapG.stroke(); }
      const d = chapter.activeDrone && chapter.activeDrone();
      if (d) { const [x, y] = toMap(d.pos.x, d.pos.z); mapG.fillStyle = '#ff5a3a'; mapG.beginPath(); mapG.arc(x, y, 6, 0, Math.PI * 2); mapG.fill(); }
      if (st.marker) { const [x, y] = toMap(st.marker.x, st.marker.z); mapG.strokeStyle = '#ffc46b'; mapG.lineWidth = 3; mapG.save(); mapG.translate(x, y); mapG.rotate(Math.PI / 4); mapG.strokeRect(-8, -8, 16, 16); mapG.restore(); }
      const [px, py] = toMap(pl.pos.x, pl.pos.z);
      mapG.save(); mapG.translate(px, py); mapG.rotate(-pl.facing + Math.PI);
      mapG.fillStyle = '#f4efe6'; mapG.beginPath(); mapG.moveTo(0, -11); mapG.lineTo(7, 8); mapG.lineTo(0, 4); mapG.lineTo(-7, 8); mapG.closePath(); mapG.fill();
      mapG.restore();
    }
    function setMap(on) {
      G.mapOpen = on;
      root.classList.toggle('mapping', on);
      if (on) { drawMap(); sound('tab'); if (document.pointerLockElement === canvas) document.exitPointerLock(); }
      else lockPointer();
    }

    function newChapter() {
      if (chapter) chapter.dispose();
      chapter = SMR.createChapter1({ scene, world, shared, difficulty: opts.difficulty, say, sound, objectiveChanged, complete, keys: key });
      player.reset(chapter.start.pos, chapter.start.facing);
      look.yaw = chapter.start.facing; look.pitch = 0.22;
      objectiveChanged();
    }
    function restart() {
      G.done = false; G.free = false; root.classList.remove('finished');
      Object.assign(player.p.stats, { top: 0, swings: 0, zips: 0, dist: 0, walls: 0, tricks: 0 });
      player.p.focus = 0;
      newChapter();
      showCard();
    }
    function showCard() {
      hud.card.classList.remove('on'); void hud.card.offsetWidth; hud.card.classList.add('on');
      setTimeout(() => say('Okay. Let\'s see if I still remember how this goes.', 3.5), 2600);
      setTimeout(() => say(key('move') + ' to move. ' + key('jump') + ' jumps (hold it to go higher). Hold ' + key('swing') + ' to sprint, and in the air to swing.', 6.5, true), 3600);
    }

    /* ---------- actions on the drones ---------- */
    function inCone(target, maxAng) {
      wtmp.copy(target).sub(aim.o);
      const along = wtmp.dot(aim.d);
      if (along <= 0) return false;
      return Math.atan2(wtmp.addScaledVector(aim.d, -along).length(), along) < maxAng;
    }
    function caught(how) {
      if (!chapter.catchActive()) return false;
      pop(how + '!');
      player.gainFocus(22);
      camState.shake = 0.35;
      if (store.get('vibration')) SMR.input.rumble(140, 0.6);
      return true;
    }
    let striking = null;
    function actions() {
      const pl = player.p, d = chapter.activeDrone();
      player.hipPoint(hipNow);
      const dist = d ? d.pos.distanceTo(hipNow) : Infinity;
      if (input.meleePressed) {
        player.punch(); sound('back');
        if (d && dist < 4.5) caught('Punch');
      }
      if (input.strikePressed) {
        if (d && dist < 32 && inCone(d.pos, 0.55)) { player.shoot(d.pos); player.strike(d.pos.clone()); striking = d; sound('web'); }
        else if (chapter.state.stage === 'drones') say('No drone in range. Get within about 30 m, with it near the middle of the screen.', 2.6, true);
      }
      if (striking) {
        if (striking.state !== 'flying') striking = null;
        else {
          pl.zipTo.copy(striking.pos);
          if (striking.pos.distanceTo(hipNow) < 3 || pl.state !== 'zip') { caught('Web-strike'); striking = null; pl.state = 'air'; pl.airT = 0; pl.vel.set(pl.vel.x * 0.2, 9, pl.vel.z * 0.2); }
        }
      }
      if (input.yankPressed) {
        if (d && dist < (G.aiming ? 42 : 30) && inCone(d.pos, G.aiming ? 0.42 : 0.3)) { player.shoot(d.pos); sound('web'); caught('Yanked'); }
        else if (chapter.state.stage === 'drones') say('Aim with ' + key('aim') + ', then ' + key('yank') + ' to yank a drone in.', 2.6, true);
      }
      if (input.finisherPressed) {
        if (pl.focus < 100) say('Focus isn\'t full yet. Air tricks and catches fill it.', 2.4, true);
        else if (d && dist < 95) { player.shoot(d.pos); pl.focus = 0; sound('start'); caught('Finisher'); }
        else say('Nothing to finish here.', 2, true);
      }
      if (input.healPressed) {
        if (pl.health >= 100) say('Health is full.', 1.8, true);
        else if (pl.focus < 40) say('Not enough Focus to heal.', 1.8, true);
        else { pl.health = Math.min(100, pl.health + 50); pl.focus -= 40; pop('Healed'); sound('on'); }
      }
      if (input.gadgetPressed) {
        if (gadget.charges > 0 && !gadget.flying) {
          gadget.charges--; gadget.flying = true; gadget.life = 0; gadget.burstT = -1;
          gadget.pos.copy(hero.hand(true)); gadget.vel.copy(aim.d).multiplyScalar(40).add(wtmp.set(0, 4, 0)).add(pl.vel);
          bomb.visible = true; bomb.scale.setScalar(0.25); bombMat.uniforms.uA.value = 1; sound('web');
        } else if (!gadget.charges) say('Web bombs are recharging.', 1.8, true);
      }
      if (input.scanPressed) {
        const st = chapter.state;
        root.classList.remove('scanning'); void root.offsetWidth; root.classList.add('scanning');
        if (st.marker) {
          const dx = st.marker.x - hipNow.x, dzz = st.marker.z - hipNow.z;
          const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
          const ang = Math.atan2(dx, -dzz), dirName = dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
          say(st.detail + ' · ' + Math.round(st.marker.distanceTo(hipNow)) + ' m ' + dirName, 3.2, true);
        } else say(st.objective, 2.5, true);
        sound('tab');
      }
    }
    function updateGadget(dt) {
      if (gadget.charges < 3) { gadget.recharge += dt; if (gadget.recharge > 15) { gadget.recharge = 0; gadget.charges++; } }
      if (gadget.flying) {
        gadget.life += dt;
        gadget.vel.y -= 18 * dt;
        const step = gadget.vel.length() * dt;
        const hitB = world.raycast(gadget.pos.x, gadget.pos.y, gadget.pos.z, gadget.vel.x / (step / dt), gadget.vel.y / (step / dt), gadget.vel.z / (step / dt), step);
        gadget.pos.addScaledVector(gadget.vel, dt);
        const d = chapter.activeDrone();
        if (hitB || gadget.life > 1.1 || (d && d.pos.distanceTo(gadget.pos) < 6)) { gadget.flying = false; gadget.burstT = 0; if (d && d.pos.distanceTo(gadget.pos) < 10) caught('Web bomb'); }
        bomb.position.copy(gadget.pos); bomb.rotation.y += dt * 8;
      } else if (gadget.burstT >= 0) {
        gadget.burstT += dt;
        bomb.scale.setScalar(0.3 + gadget.burstT * 26);
        bombMat.uniforms.uA.value = Math.max(0, 1 - gadget.burstT / 0.4);
        if (gadget.burstT > 0.4) { gadget.burstT = -1; bomb.visible = false; }
      }
    }

    /* ---------- the frame ---------- */
    let last = performance.now(), raf = 0, fpsAcc = 0, fpsN = 0, hudT = 0, firstAir = true, swingHintDone = false;
    const projV = new T.Vector3(), up = new T.Vector3(0, 1, 0);
    const st = { up: new T.Vector3(), fwd: new T.Vector3(), hip: new T.Vector3(), spin: { axis: new T.Vector3(), angle: 0 } };
    function frame(now) {
      if (!G) return;
      raf = requestAnimationFrame(frame);
      const gap = now - last; last = now;
      const dt = Math.min(0.05, gap / 1000 || 0.016);
      gather(dt);
      if (G.paused) { if (input.back) pause(false); else menuNav($('.game-pause nav')); if (G) adapt(gap, dt); return; }
      if (G.mapOpen) { if (input.mapPressed || input.back) setMap(false); else drawMap(); return; }
      if (root.classList.contains('finished')) { menuNav($('.game-done nav')); if (!G) return; }
      else if (input.pause) { if (G.photo) { G.photo = false; root.classList.remove('photo'); } else { pause(true); return; } }
      if (input.contrastPressed) { shared.mutedU.value = shared.mutedU.value ? 0 : 1; root.classList.toggle('contrast', !!shared.mutedU.value); say('High contrast ' + (shared.mutedU.value ? 'on' : 'off'), 1.6, true); }
      if (input.mapPressed && !G.done) { setMap(true); return; }
      if (input.photoPressed) { G.photo = !G.photo; root.classList.toggle('photo', G.photo); sound('tab'); }
      const pl = player.p;
      G.aiming = !!input.aiming && !G.done && !G.photo;

      if (!G.photo) {
        // a moment of slow motion while aiming in the air
        const gdt = G.aiming && (pl.state === 'air' || pl.state === 'swing' || pl.state === 'boost') ? dt * 0.45 : dt;
        shared.timeU.value += gdt;
        aim.o.copy(camera.position); camera.getWorldDirection(aim.d);
        if (!G.done) player.update(gdt, input, look.yaw);
        for (const e of pl.events) {
          if (e === 'swing' || e === 'zip' || e === 'boost') sound('web');
          if (e === 'land' && pl.landT > 0.15) camState.shake = Math.min(1, pl.landT * 3);
          if (e === 'noAnchor') say('Nothing to swing from up there. Get closer to the buildings.', 2.5, true);
          if (e === 'swing' && !swingHintDone && pl.stats.swings === 2) { swingHintDone = true; say('Let go of ' + key('swing') + ' near the top to fly further. ' + key('jump') + ' mid-swing web-zips you on. ' + key('trick') + ' does tricks.', 5, true); }
          if (e === 'trick') pop(pl.trick.name + (pl.combo > 1 ? ' ×' + pl.combo : ''));
          if (e === 'sloppy') pop('Sloppy landing');
          if (e === 'dodge') sound('back');
          if (e === 'perch') pop('Perch');
          if (e === 'hurt') { camState.shake = 1; say('Ow. That one hurt.', 2); }
          if (e === 'down') {
            camState.shake = 1;
            if (opts.difficulty === 'nonet') { say('No safety net. Back to the start.', 3); restart(); return; }
            say('Too hard a landing. Back on your feet.', 3);
            player.reset(chapter.start.pos, chapter.start.facing);
          }
        }
        if (pl.state === 'air' && firstAir && pl.airT > 0.6 && pl.stats.swings === 0) { firstAir = false; say('Hold ' + key('swing') + ' in the air to swing. ' + key('jump') + ' in the air web-zips you forward.', 4.5, true); }
        if (!G.done) actions();
        if (!G) return;
        if (!G.done || G.free) chapter.update(gdt, player);
        updateGadget(gdt);
      }

      // pose the hero
      player.hipPoint(hipNow);
      let lookOff = look.yaw - pl.facing;
      while (lookOff > Math.PI) lookOff -= Math.PI * 2;
      while (lookOff < -Math.PI) lookOff += Math.PI * 2;
      lookOff = pl.state === 'ground' && Math.abs(lookOff) < 1.6 ? lookOff * 0.5 : 0;
      const hs = Math.hypot(pl.vel.x, pl.vel.z);
      st.state = pl.state === 'ground' && hs < 0.6 ? 'ground' : pl.state;
      st.speed = hs; st.sprint = U.clamp((hs - 8.5) / 7.5, 0, 1); st.vy = pl.vel.y; st.landT = pl.landT;
      st.webPoint = pl.webEnd; st.webRight = pl.webRight; st.swingK = pl.swingK;
      st.aimPoint = pl.shotT > 0 ? pl.shotAt : null; st.aimRight = pl.shotRight; st.look = lookOff;
      st.dive = pl.dive && pl.state === 'air'; st.punch = pl.punchT; st.punchRight = pl.punchRight;
      st.hip.copy(hipNow); st.up.set(0, 1, 0); st.fwd.set(Math.sin(pl.facing), 0, Math.cos(pl.facing));
      if (pl.state === 'swing') st.up.copy(pl.anchor).sub(hipNow).normalize().lerp(up, 0.25).normalize();
      else if (pl.state === 'wall') { st.up.copy(pl.wallN); st.fwd.set(0, 1, 0); st.hip.addScaledVector(pl.wallN, 0.75).y -= 0.2; }
      else if (pl.state === 'zip') st.up.lerp(wtmp.copy(pl.zipTo).sub(hipNow).normalize(), 0.45).normalize();
      else if (st.dive && pl.vel.lengthSq() > 4) { st.up.copy(pl.vel).normalize(); st.fwd.set(0, -1, 0); }
      else if (pl.state === 'air' || pl.state === 'boost') st.up.addScaledVector(st.fwd, U.clamp(hs / 60, 0, 0.45)).normalize();
      st.spin = null;
      if (pl.trickT > 0 && pl.trick) {
        const k = 1 - pl.trickT / 0.62, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        st.spin = { axis: pl.trick.axis, angle: pl.trick.dir * Math.PI * 2 * e };
      } else if (pl.dodgeT > 0 && pl.state === 'ground') {
        const f = pl.facing, xb = pl.dodgeX * Math.cos(f) - pl.dodgeZ * Math.sin(f), zb = pl.dodgeX * Math.sin(f) + pl.dodgeZ * Math.cos(f);
        const k = 1 - pl.dodgeT / 0.3;
        st.spin = { axis: new T.Vector3(zb, 0, -xb).normalize(), angle: Math.PI * 2 * (1 - Math.pow(1 - k, 2)) };
      }
      hero.update(G.photo ? 0 : dt, st);

      updateCamera(dt);

      // webs
      if (pl.state === 'swing' || pl.state === 'boost') setWeb(0, wa.copy(hero.hand(pl.webRight)), pl.webEnd, 0.035); else clearWeb(0);
      if (pl.state === 'zip' && !striking) { setWeb(1, wa.copy(hero.hand(true)), pl.zipTo, 0.03); setWeb(2, wb.copy(hero.hand(false)), pl.zipTo, 0.03); } else { clearWeb(1); clearWeb(2); }
      if (pl.shotT > 0) setWeb(3, wa.copy(hero.hand(pl.shotRight)), striking ? striking.pos : pl.shotAt, 0.04); else clearWeb(3);
      webGeo.attributes.position.needsUpdate = true;

      world.update(camera, renderer.domElement.width, renderer.domElement.height, renderer.domElement.height / 1080);
      renderer.render(scene, camera);
      adapt(gap, dt);

      // HUD
      if (sayT > 0) { sayT -= dt; if (sayT <= 0) hud.say.classList.remove('on'); }
      if (tipT > 0) { tipT -= dt; if (tipT <= 0) hud.tip.classList.remove('on'); }
      if (popT > 0) { popT -= dt; if (popT <= 0) hud.pop.classList.remove('on'); }
      const m = chapter.state.marker;
      if (m && !G.done) {
        projV.copy(m).project(camera);
        let sx = projV.x, sy = projV.y;
        const behind = projV.z > 1;
        if (behind) { sx = -sx; sy = -sy; }
        const off = behind || Math.abs(sx) > 0.92 || Math.abs(sy) > 0.86;
        if (off) { const k = 1 / Math.max(Math.abs(sx) / 0.9, Math.abs(sy) / 0.82, 1e-3); sx *= k; sy *= k; }
        hud.marker.style.transform = `translate(${((sx * 0.5 + 0.5) * cssW).toFixed(1)}px, ${((-sy * 0.5 + 0.5) * cssH).toFixed(1)}px)`;
        hud.marker.classList.toggle('edge', off);
        hud.marker.style.setProperty('--ang', Math.atan2(-sy, sx) + 'rad');
        hud.marker.style.display = '';
        if (hudT <= dt) hud.markerD.textContent = Math.round(m.distanceTo(hipNow)) + ' m';
      } else hud.marker.style.display = 'none';
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        hud.speed.textContent = Math.round(pl.vel.length() * 3.6);
        hud.speedBox.classList.toggle('on', pl.vel.length() > 6);
        const d = chapter.activeDrone();
        hud.aim.classList.toggle('lock', !!(d && d.pos.distanceTo(hipNow) < 32 && inCone(d.pos, 0.55)));
        hud.aim.classList.toggle('aiming', !!G.aiming);
        hud.hp.style.transform = 'scaleX(' + (pl.health / 100).toFixed(3) + ')';
        hud.fo.style.transform = 'scaleX(' + (pl.focus / 100).toFixed(3) + ')';
        hud.foBar.classList.toggle('full', pl.focus >= 100);
        hud.bombs.textContent = '●'.repeat(gadget.charges) + '○'.repeat(3 - gadget.charges);
        const K = (n) => key(n) + ' · ';
        const drones = chapter.state.stage === 'drones';
        const keysTxt = pl.state === 'swing' ? 'Release ' + key('swing') + ' · Let go   ' + K('jump') + 'Web-zip   ' + K('trick') + 'Trick'
          : pl.state === 'wall' ? K('jump') + 'Jump off   ' + K('dodge') + 'Push away'
          : pl.state === 'air' || pl.state === 'boost' ? 'Hold ' + K('swing') + 'Swing   ' + K('jump') + 'Web-zip   ' + K('perch') + 'Perch / dive   ' + K('trick') + 'Trick'
          : 'Hold ' + K('swing') + 'Sprint   ' + K('jump') + 'Jump   ' + K('zip') + 'Zip   ' + K('walk') + 'Walk   ' + K('map') + 'Map';
        const full = drones ? keysTxt + '\n' + K('strike') + 'Web-strike   Hold ' + key('aim') + ' + ' + K('yank') + 'Yank   ' + K('melee') + 'Strike   ' + K('gadget') + 'Web bomb' : keysTxt;
        if (hud.keys.textContent !== full) hud.keys.textContent = full;
        hud.keys.classList.toggle('dim', !locked && device !== 'pad' && !G.done);
      }
      fpsAcc += gap; fpsN++;
      if (fpsAcc > 500) {
        if (store.get('fps')) hud.fps.textContent = Math.round((fpsN * 1000) / fpsAcc) + ' FPS · ' + renderer.domElement.height + 'p';
        else hud.fps.textContent = '';
        fpsAcc = 0; fpsN = 0;
      }
    }

    G = { paused: false, done: false, free: false, playing: true, photo: false, mapOpen: false, aiming: false, root, renderer, world, hero, player, perf, resize,
      cleanup() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('wheel', onWheel); window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', resize);
        document.removeEventListener('pointerlockchange', onLockChange); document.removeEventListener('visibilitychange', onVis);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
        if (chapter) chapter.dispose();
        world.dispose(); hero.dispose(); webGeo.dispose(); webMat.dispose(); lut.dispose(); bomb.geometry.dispose(); bombMat.dispose();
        renderer.dispose(); renderer.forceContextLoss();
        root.remove();
      },
      debug: { look, input, camera, chapter: () => chapter, keys, mouseHeld, perf, gadget },
    };
    window.addEventListener('resize', resize);
    newChapter();
    resize();
    requestAnimationFrame((t) => { last = t; root.classList.add('on'); showCard(); frame(t); });
    return G;
  }

  function stop() {
    if (!G) return;
    const g = G; G = null;
    g.cleanup();
  }

  SMR.game = { start, stop, KEYS, get current() { return G; } };
})();
