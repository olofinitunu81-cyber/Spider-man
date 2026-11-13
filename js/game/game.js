/* Chapter one, playable. The game owns its own canvas and WebGL renderer, reads the keyboard,
   mouse and controller directly, runs the chase camera and the HUD, and draws every frame the
   screen can show: no frame cap. To hold a smooth 100 fps (or the screen's own rate when that is
   lower) it watches its frame times and trims or restores the render resolution to fit.
   The menu's 3D stage sleeps while this runs. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const TARGET_MS = 10; // 100 fps
  const HUD = `
    <canvas class="game-gl"></canvas>
    <div class="hud">
      <div class="hud-obj"><div class="hud-chapter"></div><div class="hud-goal"></div><div class="hud-detail"><span></span><b></b></div></div>
      <div class="hud-marker"><i></i><span></span></div>
      <div class="hud-aim"></div>
      <div class="hud-speed"><b>0</b><span>km/h</span></div>
      <div class="hud-say"></div>
      <div class="hud-tip"></div>
      <div class="hud-keys"></div>
      <div class="hud-fps"></div>
    </div>
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
    renderer.autoClear = true;
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(64, 16 / 9, 0.1, 5200);

    // shared look: the same palette, haze and grain as the menu
    const pal = SMR.palettes.dawn;
    const sunDir = new T.Vector3(0.5, 0.075, -0.86).normalize();
    const lut = new T.CanvasTexture(U.makeCanvas(256, 2));
    lut.minFilter = lut.magFilter = T.LinearFilter; lut.generateMipmaps = false;
    const shared = {
      lut, sunDir, timeU: { value: 0 }, grainU: { value: store.get('grain') ? 0.09 : 0 },
      fogU: { uHazeLow: { value: vec(pal.far[1]) }, uHazeHigh: { value: vec(pal.far[0]) }, uGlow: { value: vec(pal.orb.mid) }, uSunDir: { value: sunDir }, uFog: { value: 0.0011 } },
    };

    const world = SMR.createWorld(scene, shared, renderer);
    world.applyPalette(pal, vec);
    const aniso = soft ? 1 : Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const hero = await SMR.createHero(shared, aniso);
    hero.setSuit(opts.suit, vec);
    hero.uniforms.uRim.value.copy(vec(pal.rim)); hero.uniforms.uFill.value.copy(vec(pal.fill));
    scene.add(hero.mesh);

    const player = SMR.createPlayer(world);
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

    /* ---------- HUD ---------- */
    const hud = {
      chapter: $('.hud-chapter'), goal: $('.hud-goal'), detail: $('.hud-detail span'), prog: $('.hud-detail b'), obj: $('.hud-obj'),
      marker: $('.hud-marker'), markerD: $('.hud-marker span'), aim: $('.hud-aim'), speed: $('.hud-speed b'), speedBox: $('.hud-speed'),
      say: $('.hud-say'), tip: $('.hud-tip'), keys: $('.hud-keys'), fps: $('.hud-fps'), card: $('.game-card'),
    };
    let sayT = 0, tipT = 0;
    function say(text, secs, tip) {
      if (tip) { hud.tip.textContent = text; hud.tip.classList.add('on'); tipT = secs; }
      else { hud.say.textContent = text; hud.say.classList.add('on'); sayT = secs; }
    }
    function objectiveChanged() {
      const s = chapter.state;
      hud.chapter.textContent = s.title; hud.goal.textContent = s.objective; hud.detail.textContent = s.detail; hud.prog.textContent = s.progress;
      hud.obj.classList.remove('bump'); void hud.obj.offsetWidth; hud.obj.classList.add('bump');
    }
    function sound(name) { audio.play(name); }

    /* ---------- input ---------- */
    const keys = new Set(), hit = new Set();
    let mouseShot = false, mouseZip = false, locked = false, device = 'keyboard';
    const padPrev = [];
    const look = { yaw: Math.PI, pitch: 0.2, idle: 0 };
    const sens = 0.0023 * ({ slow: 0.6, normal: 1, fast: 1.6 }[store.get('lookSpeed')] || 1);
    const invY = store.get('invertY') ? -1 : 1;
    const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'ShiftLeft', 'ShiftRight', 'KeyP', 'Escape', 'Enter'];
    const onKeyDown = (e) => {
      if (GAME_KEYS.includes(e.code)) e.preventDefault();
      if (!e.repeat) hit.add(e.code);
      keys.add(e.code);
      device = 'keyboard';
    };
    const onKeyUp = (e) => { keys.delete(e.code); };
    const onMouseMove = (e) => {
      if (!G || !locked || G.paused || G.done) return;
      look.yaw -= e.movementX * sens;
      look.pitch = U.clamp(look.pitch + e.movementY * sens * invY, -0.95, 1.2);
      look.idle = 0;
    };
    const onMouseDown = (e) => {
      if (!G || G.paused || G.done) return;
      if (!locked) { lockPointer(); return; }
      if (e.button === 0) mouseShot = true;
      if (e.button === 2) mouseZip = true;
      device = 'keyboard';
    };
    const onContext = (e) => e.preventDefault();
    const onLockChange = () => {
      locked = document.pointerLockElement === canvas;
      if (!locked && G && !G.paused && !G.done && G.playing) pause(true);
    };
    const onBlur = () => { if (G && !G.paused && !G.done) pause(true); };
    const onVis = () => { if (document.hidden && G && !G.paused && !G.done) pause(true); };
    function lockPointer() {
      if (!canvas.requestPointerLock) return;
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed here */ }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
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
    const input = { x: 0, y: 0, sprint: false, jump: false, jumpPressed: false, zipPressed: false, shotPressed: false, pause: false, zipAim: null, up: false, down: false, confirm: false, back: false };
    const aim = { o: new T.Vector3(), d: new T.Vector3() };
    function gather(dt) {
      const k = (c) => keys.has(c), h = (c) => hit.has(c);
      let x = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      let y = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
      let sprint = k('ShiftLeft') || k('ShiftRight'), jump = k('Space');
      let jumpPressed = h('Space'), zipPressed = h('KeyE') || mouseZip, shotPressed = h('KeyF') || mouseShot;
      let pauseP = h('Escape') || h('KeyP'), up = h('ArrowUp') || h('KeyW'), down = h('ArrowDown') || h('KeyS'), confirm = h('Enter') || h('Space'), back = h('Escape');
      const pad = readPad();
      if (pad) {
        const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4));
        const pb = (i) => b(i) && !padPrev[i];
        const lx = dz(pad.axes[0] || 0), ly = dz(pad.axes[1] || 0), rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
        if (lx || ly || rx || ry || pad.buttons.some((bt) => bt.pressed)) device = 'pad';
        x += lx; y -= ly;
        if (G && !G.paused && !G.done) {
          look.yaw -= rx * 2.7 * dt * (sens / 0.0023);
          look.pitch = U.clamp(look.pitch + ry * 2.0 * dt * invY * (sens / 0.0023), -0.95, 1.2);
          if (rx || ry) look.idle = 0;
        }
        sprint = sprint || b(10) || b(6);
        jump = jump || b(0) || b(7);
        jumpPressed = jumpPressed || pb(0) || pb(7);
        zipPressed = zipPressed || pb(2) || pb(5);
        shotPressed = shotPressed || pb(3) || pb(4);
        pauseP = pauseP || pb(9);
        up = up || pb(12) || (ly < -0.6 && !padPrev.stickUp); down = down || pb(13) || (ly > 0.6 && !padPrev.stickDown);
        confirm = confirm || pb(0); back = back || pb(1) || pb(9);
        padPrev.stickUp = ly < -0.6; padPrev.stickDown = ly > 0.6;
        for (let i = 0; i < pad.buttons.length; i++) padPrev[i] = b(i);
      }
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      Object.assign(input, { x, y, sprint, jump, jumpPressed, zipPressed, shotPressed, pause: pauseP, up, down, confirm, back });
      hit.clear(); mouseShot = false; mouseZip = false;
    }

    /* ---------- camera ---------- */
    const camT = new T.Vector3(), camP = new T.Vector3(), lookDir = new T.Vector3(), camRight = new T.Vector3(), hipNow = new T.Vector3();
    const camState = { dist: 4.6, fov: 64, shake: 0 };
    let camYawSmooth = look.yaw;
    function updateCamera(dt) {
      const pl = player.p, motion = store.get('motion');
      player.hipPoint(hipNow);
      const sp = pl.vel.length(), hs = Math.hypot(pl.vel.x, pl.vel.z);
      // drift behind him when he is moving and the player is not steering the camera
      look.idle += dt;
      if (look.idle > 1.1 && hs > 4 && pl.state !== 'wall') {
        let dd = Math.atan2(pl.vel.x, pl.vel.z) - look.yaw;
        while (dd > Math.PI) dd -= Math.PI * 2;
        while (dd < -Math.PI) dd += Math.PI * 2;
        look.yaw += dd * Math.min(1, dt * 1.3 * Math.min(1, hs / 14));
      }
      camYawSmooth = look.yaw;
      const airy = pl.state === 'swing' || pl.state === 'air' || pl.state === 'zip';
      const wantDist = (airy ? U.lerp(5.4, 8.2, U.clamp(sp / 40, 0, 1)) : pl.state === 'wall' ? 6.2 : 4.4 + (Math.hypot(pl.vel.x, pl.vel.z) > 10 ? 0.6 : 0));
      camState.dist = U.damp(camState.dist, wantDist, 3, dt);
      const wantFov = 64 + (motion ? Math.min(20, sp * 0.42) : 0);
      camState.fov = U.damp(camState.fov, wantFov, 4, dt);
      const cp = Math.cos(look.pitch);
      lookDir.set(Math.sin(camYawSmooth) * cp, -Math.sin(look.pitch), Math.cos(camYawSmooth) * cp);
      camRight.set(-Math.cos(camYawSmooth), 0, Math.sin(camYawSmooth));
      camT.copy(hipNow).add(wtmp.set(0, 0.55, 0));
      camP.copy(camT).addScaledVector(lookDir, -camState.dist).addScaledVector(camRight, 0.55);
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
      $('.stats').innerHTML = [['Time', mm + ':' + String(ss).padStart(2, '0')], ['Top speed', Math.round(ps.top * 3.6) + ' km/h'], ['Swings', ps.swings], ['Web-zips', ps.zips], ['Drones caught', '3 / 3']]
        .map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('');
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      setTimeout(() => { root.classList.add('finished'); focusBtn($('.game-done nav'), 0); }, 1200);
      if (opts.onComplete) opts.onComplete({ time: t, top: ps.top, swings: ps.swings, zips: ps.zips });
    }
    buildMenu('.game-done nav', [
      ['Keep swinging', () => { root.classList.remove('finished'); G.done = false; G.free = true; chapter.state.title = 'Free roam'; chapter.state.objective = 'Midtown is yours'; chapter.state.detail = 'Chapter two is on its way'; chapter.state.progress = ''; objectiveChanged(); lockPointer(); }],
      ['Back to menu', () => opts.onQuit && opts.onQuit()],
    ]);

    function newChapter() {
      if (chapter) chapter.dispose();
      chapter = SMR.createChapter1({ scene, world, shared, difficulty: opts.difficulty, say, sound, objectiveChanged, complete });
      player.reset(chapter.start.pos, chapter.start.facing);
      look.yaw = chapter.start.facing; look.pitch = 0.22;
      objectiveChanged();
    }
    function restart() {
      G.done = false; G.free = false; root.classList.remove('finished');
      Object.assign(player.p.stats, { top: 0, swings: 0, zips: 0, dist: 0, walls: 0 });
      newChapter();
      showCard();
    }
    function showCard() {
      hud.card.classList.remove('on'); void hud.card.offsetWidth; hud.card.classList.add('on');
      setTimeout(() => say('Okay. Let\'s see if I still remember how this goes.', 3.5), 2600);
      setTimeout(() => say(device === 'pad' ? 'Left stick to move. A to jump; keep holding A in the air to swing.' : 'WASD to move, Space to jump. Keep holding Space in the air to swing.', 6, true), 3600);
    }

    /* ---------- the frame ---------- */
    let last = performance.now(), raf = 0, fpsAcc = 0, fpsN = 0, hudT = 0, firstAir = true, swingHintDone = false;
    const shotPt = new T.Vector3();
    const projV = new T.Vector3();
    function frame(now) {
      if (!G) return;
      raf = requestAnimationFrame(frame);
      const gap = now - last; last = now;
      const dt = Math.min(0.05, gap / 1000 || 0.016);
      gather(dt);
      if (G.paused) { if (input.back) pause(false); else menuNav($('.game-pause nav')); if (G) adapt(gap, dt); return; }
      if (root.classList.contains('finished')) { menuNav($('.game-done nav')); if (!G) return; }
      else if (input.pause) { pause(true); return; }
      shared.timeU.value += dt;
      const pl = player.p;

      // aim for web-zips: the centre of the screen
      aim.o.copy(camera.position); camera.getWorldDirection(aim.d);
      input.zipAim = aim;
      if (!G.done) player.update(dt, input, look.yaw);
      for (const e of pl.events) {
        if (e === 'swing' || e === 'zip') sound('web');
        if (e === 'land' && pl.landT > 0.15) camState.shake = Math.min(1, pl.landT * 3);
        if (e === 'noAnchor') say('Nothing to swing from up there. Get closer to the buildings.', 2.5, true);
        if (e === 'swing' && !swingHintDone && pl.stats.swings === 2) { swingHintDone = true; say('Let go near the top of a swing to fly further.', 4, true); }
      }
      if (pl.state === 'air' && firstAir && pl.airT > 0.6 && pl.stats.swings === 0) { firstAir = false; say(device === 'pad' ? 'Hold A in the air to swing.' : 'Hold Space in the air to swing.', 4, true); }

      // webbing a drone
      if (input.shotPressed && !G.done) {
        player.hipPoint(hipNow);
        const at = chapter.tryShoot(aim.o, aim.d, hipNow);
        if (at) { shotPt.copy(at); player.shoot(shotPt); sound('web'); }
        else if (chapter.state.stage === 'drones') say('Get closer, and keep it in the middle of the screen.', 2, true);
      }
      if (!G.done || G.free) chapter.update(dt, player);

      // pose the hero
      player.hipPoint(hipNow);
      const lookOff = (() => { let dd = look.yaw - pl.facing; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; return pl.state === 'ground' && Math.abs(dd) < 1.6 ? dd * 0.5 : 0; })();
      const hs = Math.hypot(pl.vel.x, pl.vel.z);
      const st = {
        state: pl.state === 'ground' && hs < 0.6 ? 'ground' : pl.state, speed: hs, sprint: U.clamp((hs - 8.5) / 7.5, 0, 1), vy: pl.vel.y,
        landT: pl.landT, webPoint: pl.webEnd, webRight: pl.webRight, swingK: pl.swingK,
        aimPoint: pl.shotT > 0 ? pl.shotAt : null, aimRight: pl.shotRight, hip: hipNow, look: lookOff,
        up: wtmp.set(0, 1, 0), fwd: new T.Vector3(Math.sin(pl.facing), 0, Math.cos(pl.facing)),
      };
      if (pl.state === 'swing') st.up = new T.Vector3().copy(pl.anchor).sub(hipNow).normalize().lerp(new T.Vector3(0, 1, 0), 0.25).normalize();
      else if (pl.state === 'wall') { st.up = pl.wallN.clone(); st.fwd = new T.Vector3(0, 1, 0); st.hip = hipNow.clone().addScaledVector(pl.wallN, 0.75).add(new T.Vector3(0, -0.2, 0)); }
      else if (pl.state === 'zip') st.up = new T.Vector3(0, 1, 0).lerp(new T.Vector3().copy(pl.zipTo).sub(hipNow).normalize(), 0.45).normalize();
      else if (pl.state === 'air') st.up = new T.Vector3(0, 1, 0).addScaledVector(st.fwd, U.clamp(hs / 60, 0, 0.45)).normalize();
      hero.update(dt, st);

      updateCamera(dt);

      // webs
      if (pl.state === 'swing') setWeb(0, wa.copy(hero.hand(pl.webRight)), pl.webEnd, 0.035); else clearWeb(0);
      if (pl.state === 'zip') { setWeb(1, wa.copy(hero.hand(true)), pl.zipTo, 0.03); setWeb(2, wb.copy(hero.hand(false)), pl.zipTo, 0.03); } else { clearWeb(1); clearWeb(2); }
      if (pl.shotT > 0) setWeb(3, wa.copy(hero.hand(pl.shotRight)), pl.shotAt, 0.04); else clearWeb(3);
      webGeo.attributes.position.needsUpdate = true;

      world.update(camera, renderer.domElement.width, renderer.domElement.height, renderer.domElement.height / 1080);
      renderer.render(scene, camera);
      adapt(gap, dt);

      // HUD
      if (sayT > 0) { sayT -= dt; if (sayT <= 0) hud.say.classList.remove('on'); }
      if (tipT > 0) { tipT -= dt; if (tipT <= 0) hud.tip.classList.remove('on'); }
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
        hudT -= dt;
        if (hudT <= 0) { hud.markerD.textContent = Math.round(m.distanceTo(hipNow)) + ' m'; }
      } else hud.marker.style.display = 'none';
      if (hudT <= 0) {
        hudT = 0.1;
        hud.speed.textContent = Math.round(pl.vel.length() * 3.6);
        hud.speedBox.classList.toggle('on', pl.vel.length() > 6);
        hud.aim.classList.toggle('lock', chapter.canShoot(aim.o, aim.d, hipNow));
        const pad = device === 'pad';
        const keysTxt = pl.state === 'swing' ? (pad ? 'Release A · Let go' : 'Release Space · Let go')
          : pl.state === 'wall' ? (pad ? 'A · Jump off   Stick away · Drop' : 'Space · Jump off   S · Drop')
          : (pad ? 'X · Web-zip   Y · Web a drone' : 'E · Web-zip   F / Click · Web a drone   Shift · Sprint');
        if (hud.keys.textContent !== keysTxt) hud.keys.textContent = keysTxt;
        hud.keys.classList.toggle('dim', !locked && device !== 'pad');
        if (!locked && device !== 'pad' && !G.done) { if (hud.keys.dataset.lock !== '1') { hud.keys.dataset.lock = '1'; } } else hud.keys.dataset.lock = '';
      }
      fpsAcc += gap; fpsN++;
      if (fpsAcc > 500) {
        if (store.get('fps')) hud.fps.textContent = Math.round((fpsN * 1000) / fpsAcc) + ' FPS · ' + renderer.domElement.height + 'p';
        else hud.fps.textContent = '';
        fpsAcc = 0; fpsN = 0;
      }
    }

    G = { paused: false, done: false, free: false, playing: true, root, renderer, world, hero, player, perf, resize, stop: null,
      cleanup() {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('blur', onBlur);
        window.removeEventListener('resize', resize);
        document.removeEventListener('pointerlockchange', onLockChange); document.removeEventListener('visibilitychange', onVis);
        if (document.pointerLockElement === canvas) document.exitPointerLock();
        if (chapter) chapter.dispose();
        world.dispose(); hero.dispose(); webGeo.dispose(); webMat.dispose(); lut.dispose();
        renderer.dispose(); renderer.forceContextLoss();
        root.remove();
      },
      debug: { look, input, camera, chapter: () => chapter, keys, perf },
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

  SMR.game = { start, stop, get current() { return G; } };
})();
