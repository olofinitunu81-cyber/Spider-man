/* Chapter one: "Stitches". Dawn over Midtown, the suit mended overnight.
   1. Get your swing back: six rings down the avenue.
   2. Runaway cameras: three of the Bugle's drones broke loose; web them.
   3. Special delivery: land on the Daily Bugle's roof.                               */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const RING_VS = `
    varying vec3 vN, vW;
    void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const RING_FS = `
    precision highp float;
    uniform vec3 uColor;
    uniform float uGlow, uTime;
    varying vec3 vN, vW;
    void main() {
      vec3 V = normalize(cameraPosition - vW);
      float f = pow(1.0 - abs(dot(normalize(vN), V)), 1.5);
      float pulse = 0.75 + 0.25 * sin(uTime * 5.0);
      gl_FragColor = vec4(uColor * (0.55 + 0.9 * f) * mix(0.35, pulse * 1.3, uGlow), 1.0);
    }`;
  const BEAM_VS = `
    varying float vY; varying vec2 vUv;
    void main() { vY = position.y; vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
  const BEAM_FS = `
    precision highp float;
    uniform vec3 uColor; uniform float uTime, uOn;
    varying float vY; varying vec2 vUv;
    void main() {
      float edge = sin(vUv.x * 3.14159);
      float a = edge * edge * (1.0 - smoothstep(0.0, 1.0, vUv.y)) * (0.55 + 0.45 * sin(vUv.y * 40.0 - uTime * 6.0));
      gl_FragColor = vec4(uColor * a * 0.85 * uOn, 1.0);
    }`;
  const DRONE_VS = `
    attribute vec3 aColor;
    varying vec3 vC, vN, vW;
    void main() { vC = aColor; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const DRONE_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uKey, uRim;
    uniform float uBlink, uWeb;
    varying vec3 vC, vN, vW;
    void main() {
      vec3 N = normalize(vN);
      float k = clamp(dot(N, uKey) * 0.5 + 0.5, 0.0, 1.0);
      vec3 c = vC;
      float lamp = step(1.5, vC.r); // the red light is marked with r > 1
      c = lamp > 0.5 ? vec3(1.0, 0.15, 0.1) * (0.4 + 1.6 * uBlink) : c * (0.25 + 0.95 * k * k);
      c += uRim * pow(1.0 - abs(dot(N, normalize(cameraPosition - vW))), 2.5) * 0.6 * (1.0 - lamp);
      c = mix(c, vec3(0.93, 0.93, 0.9) * (0.6 + 0.5 * k), uWeb);
      gl_FragColor = vec4(applyFog(c, vW), 1.0);
    }`;

  /** The drone: a flat body, four arms with rotor guards, a camera pod and a red light. */
  function droneGeometry() {
    const parts = [];
    const add = (geo, col, x, y, z, ry) => {
      geo = geo.toNonIndexed();
      if (ry) geo.rotateY(ry);
      geo.translate(x, y, z);
      const n = geo.attributes.position.count, c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.set(col, i * 3);
      geo.setAttribute('aColor', new T.BufferAttribute(c, 3));
      parts.push(geo);
    };
    const body = [0.09, 0.09, 0.11], arm = [0.16, 0.16, 0.19], rotor = [0.6, 0.62, 0.66], lens = [0.03, 0.04, 0.07];
    add(new T.BoxGeometry(0.9, 0.28, 1.1), body, 0, 0, 0);
    add(new T.BoxGeometry(0.5, 0.12, 0.5), [0.85, 0.85, 0.82], 0, 0.2, 0); // the Bugle's white lid
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, x = Math.sin(a) * 0.95, z = Math.cos(a) * 0.95;
      add(new T.BoxGeometry(0.12, 0.08, 1.3), arm, x / 2, 0.02, z / 2, a);
      add(new T.CylinderGeometry(0.5, 0.5, 0.05, 16, 1, true), arm, x, 0.08, z);
      add(new T.CylinderGeometry(0.44, 0.44, 0.015, 16), rotor, x, 0.1, z);
    }
    add(new T.SphereGeometry(0.22, 12, 8), lens, 0, -0.22, 0.38);
    add(new T.SphereGeometry(0.07, 8, 6), [2, 0, 0], 0, 0.06, -0.58);
    const count = parts.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); col.set(g.attributes.aColor.array, o); o += g.attributes.position.array.length; }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('aColor', new T.BufferAttribute(col, 3));
    return out;
  }

  const DIFF = { easy: { speed: 0.8, reach: 30 }, crawler: { speed: 1, reach: 24 }, menace: { speed: 1.15, reach: 20 }, nonet: { speed: 1.25, reach: 18 } };

  function createChapter1(ctx) {
    const { scene, world, shared, difficulty } = ctx;
    const S = SMR.shaders;
    const diff = DIFF[difficulty] || DIFF.crawler;
    const P = world.PITCH;
    const objects = [];
    const say = ctx.say, sound = ctx.sound;

    /* ---------- rings down the avenue ---------- */
    const ringSpots = [[37, 33, -46], [35.5, 27, -128], [38.5, 35, -212], [36, 25, -296], [38, 32, -378], [37, 29, -456]];
    const ringGeo = new T.TorusGeometry(5, 0.32, 10, 48);
    const rings = ringSpots.map((s, i) => {
      const mat = new T.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: { uColor: { value: new T.Color('#ffd27a') }, uGlow: { value: i === 0 ? 1 : 0 }, uTime: shared.timeU } });
      const m = new T.Mesh(ringGeo, mat);
      m.position.set(s[0], s[1], s[2]);
      scene.add(m); objects.push(m);
      return { mesh: m, mat, c: m.position, n: new T.Vector3(0, 0, -1), done: false, pop: 0 };
    });
    let ringN = 0;

    /* ---------- the drones ---------- */
    const droneGeo = droneGeometry();
    const droneMats = [], drones = [];
    for (let i = 0; i < 3; i++) {
      const mat = new T.ShaderMaterial({
        vertexShader: DRONE_VS, fragmentShader: DRONE_FS(S),
        uniforms: Object.assign({ uKey: { value: new T.Vector3(0.3, 0.8, -0.5).normalize() }, uRim: { value: new T.Color('#ff9a4a') }, uBlink: { value: 0 }, uWeb: { value: 0 } }, shared.fogU),
      });
      const m = new T.Mesh(droneGeo, mat);
      m.visible = false; m.scale.setScalar(1.3);
      scene.add(m); objects.push(m); droneMats.push(mat);
      drones.push({ mesh: m, mat, state: 'idle', from: new T.Vector3(), to: new T.Vector3(), t: 0, seg: 1, dir: [1, 0], node: [0, 0], alt: 40, altTo: 40, pos: m.position, vel: new T.Vector3(), wT: 0 });
    }
    const webBall = new T.Mesh(new T.IcosahedronGeometry(1, 1), new T.ShaderMaterial({
      vertexShader: RING_VS, fragmentShader: RING_FS, uniforms: { uColor: { value: new T.Color('#f4f1ea') }, uGlow: { value: 0.6 }, uTime: shared.timeU }, wireframe: true,
    }));
    webBall.visible = false; scene.add(webBall); objects.push(webBall);
    let caught = 0, active = null, spawnIn = 0;

    const nodeX = (i) => i * P + P / 2;
    function spawnDrone(d, near, heading) {
      // the intersection a little ahead of the hero
      const ax = near.x + Math.sin(heading) * 70, az = near.z + Math.cos(heading) * 70;
      const lim = world.SPAN - 2;
      const i = U.clamp(Math.round((ax - P / 2) / P), -lim, lim), j = U.clamp(Math.round((az - P / 2) / P), -lim, lim);
      d.node = [i, j];
      d.dir = Math.abs(Math.sin(heading)) > Math.abs(Math.cos(heading)) ? [Math.sign(Math.sin(heading)) || 1, 0] : [0, Math.sign(Math.cos(heading)) || 1];
      d.alt = d.altTo = U.clamp(near.y + 12, 28, 70);
      d.pos.set(nodeX(i), d.alt, nodeX(j));
      d.from.copy(d.pos); nextLeg(d);
      d.state = 'flying'; d.mesh.visible = true; d.mat.uniforms.uWeb.value = 0; d.mesh.scale.setScalar(1.3);
      active = d;
    }
    function nextLeg(d) {
      const lim = world.SPAN - 2;
      const opts = [];
      const straight = [d.dir[0], d.dir[1]], left = [-d.dir[1], d.dir[0]], right = [d.dir[1], -d.dir[0]];
      for (const [w, dd] of [[3, straight], [1.4, left], [1.4, right]]) {
        const ni = d.node[0] + dd[0], nj = d.node[1] + dd[1];
        if (Math.abs(ni) <= lim && Math.abs(nj) <= lim) opts.push([w, dd]);
      }
      if (!opts.length) opts.push([1, [-d.dir[0], -d.dir[1]]]);
      let total = opts.reduce((s, o) => s + o[0], 0), pick = Math.random() * total, ch = opts[0][1];
      for (const o of opts) { pick -= o[0]; if (pick <= 0) { ch = o[1]; break; } }
      d.dir = ch; d.node = [d.node[0] + ch[0], d.node[1] + ch[1]];
      d.from.copy(d.pos);
      d.altTo = U.clamp(d.alt + (Math.random() - 0.45) * 26, 26, 72);
      d.to.set(nodeX(d.node[0]), d.altTo, nodeX(d.node[1]));
      d.seg = d.from.distanceTo(d.to); d.t = 0;
    }

    /* ---------- the Bugle and its beacon ---------- */
    const beam = new T.Mesh(new T.CylinderGeometry(4, 4, 360, 24, 1, true).translate(0, 180, 0), new T.ShaderMaterial({
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { uColor: { value: new T.Color('#ff6a3d') }, uTime: shared.timeU, uOn: { value: 0 } },
    }));
    beam.position.copy(world.bugleTop);
    beam.visible = false;
    scene.add(beam); objects.push(beam);

    /* ---------- flow ---------- */
    const state = {
      stage: 'rings', time: 0, done: false,
      title: 'Chapter one · Stitches', objective: 'Get your swing back', detail: 'Swing through the rings', progress: '0 / 6',
      marker: rings[0].c.clone(), markerLabel: '',
    };
    const prevHip = new T.Vector3(), hip = new T.Vector3(), cross = new T.Vector3();
    let started = false;

    function setObjective(objective, detail, progress) {
      state.objective = objective; state.detail = detail; state.progress = progress;
      ctx.objectiveChanged();
    }

    function update(dt, player) {
      if (!started) { started = true; player.hipPoint(prevHip); }
      if (!state.done) state.time += dt;
      player.hipPoint(hip);
      const pl = player.p;

      if (state.stage === 'rings') {
        const r = rings[ringN];
        const s0 = prevHip.clone().sub(r.c).dot(r.n), s1 = hip.clone().sub(r.c).dot(r.n);
        if ((s0 < 0) !== (s1 < 0)) {
          cross.copy(prevHip).lerp(hip, s0 / (s0 - s1));
          if (cross.distanceTo(r.c) < 5.4) {
            r.done = true; r.pop = 1; r.mat.uniforms.uGlow.value = 0;
            ringN++;
            sound('select');
            if (ringN === 1) say('Okay. The stitches are holding. So am I.', 3.5);
            if (ringN === 3) say('Tap E to web-zip to whatever you are looking at.', 4, true);
            if (ringN < rings.length) { rings[ringN].mat.uniforms.uGlow.value = 1; state.marker.copy(rings[ringN].c); setObjective('Get your swing back', 'Swing through the rings', ringN + ' / 6'); }
            else {
              state.stage = 'drones';
              say('The Bugle\'s camera drones, loose over Midtown. They are going to blame me for this.', 5);
              setObjective('Runaway cameras', 'Catch the Bugle\'s drones', '0 / 3');
              spawnIn = 2.2;
            }
          }
        }
      }
      rings.forEach((r) => { if (r.pop > 0) { r.pop -= dt * 2.2; r.mesh.scale.setScalar(1 + (1 - Math.max(0, r.pop)) * 0.6); if (r.pop <= 0) r.mesh.visible = false; } });

      if (state.stage === 'drones') {
        if (!active && spawnIn > 0) { spawnIn -= dt; if (spawnIn <= 0) { spawnDrone(drones[caught], hip, pl.facing); if (caught === 0) say('F or left click: web a drone when you are close.', 4.5, true); } }
        if (active) state.marker.copy(active.pos);
      }

      // drones fly the streets, faster when he is close, waiting when he falls behind
      for (const d of drones) {
        if (d.state === 'flying') {
          const dist = d.pos.distanceTo(hip);
          const want = (dist < 45 ? 23 : dist > 150 ? 6 : 15) * diff.speed;
          d.speed = U.lerp(d.speed || want, want, 1 - Math.exp(-2.5 * dt));
          d.t += (d.speed * dt) / Math.max(1, d.seg);
          if (d.t >= 1) { d.pos.copy(d.to); d.alt = d.altTo; nextLeg(d); }
          const k = U.smooth(U.clamp(d.t, 0, 1));
          d.pos.lerpVectors(d.from, d.to, d.t);
          d.pos.y = U.lerp(d.from.y, d.to.y, k) + Math.sin(state.time * 2.3 + d.alt) * 0.6;
          const yaw = Math.atan2(d.to.x - d.from.x, d.to.z - d.from.z);
          d.mesh.rotation.set(0.25, yaw, Math.sin(state.time * 3) * 0.08);
          d.mat.uniforms.uBlink.value = Math.sin(state.time * 9) > 0.6 ? 1 : 0;
        } else if (d.state === 'webbed') {
          d.wT += dt;
          webBall.position.copy(d.pos); webBall.visible = true;
          webBall.scale.setScalar(Math.min(1, d.wT / 0.25) * 1.7);
          webBall.rotation.y += dt * 2;
          d.mat.uniforms.uWeb.value = Math.min(1, d.wT / 0.3);
          d.mesh.rotation.y += dt * 6;
          if (d.wT > 0.9) { // reeled off to be handed in later
            d.state = 'gone'; d.mesh.visible = false; webBall.visible = false;
            caught++;
            sound('equip');
            if (caught < 3) { say(caught === 1 ? 'One down.' : 'Two. One more.', 2.5); setObjective('Runaway cameras', 'Catch the Bugle\'s drones', caught + ' / 3'); spawnIn = 2.5; active = null; }
            else {
              active = null;
              state.stage = 'bugle';
              say('That is all of them. Special delivery for the Daily Bugle.', 4);
              setObjective('Special delivery', 'Land on the Daily Bugle\'s roof', '');
              state.marker.copy(world.bugleTop).add(new T.Vector3(0, 2, 0));
              beam.visible = true;
            }
          }
        }
      }

      if (state.stage === 'bugle') {
        beam.material.uniforms.uOn.value = Math.min(1, beam.material.uniforms.uOn.value + dt);
        const b = world.bugleTop;
        if (pl.state === 'ground' && pl.pos.y > b.y - 1 && Math.abs(pl.pos.x - b.x) < 16 && Math.abs(pl.pos.z - b.z) < 16) {
          state.stage = 'done'; state.done = true; state.marker = null;
          beam.visible = false;
          sound('start');
          ctx.complete();
        }
      }
      prevHip.copy(hip);
    }

    /** Is there a drone where the camera points? Returns its position to aim the web at. */
    function tryShoot(o, dir, from) {
      if (!active || active.state !== 'flying') return null;
      const to = active.pos.clone().sub(o);
      const along = to.dot(dir);
      if (along <= 0) return null;
      const off = to.clone().addScaledVector(dir, -along).length();
      if (Math.atan2(off, along) > 0.38 || active.pos.distanceTo(from) > diff.reach) return null;
      active.state = 'webbed'; active.wT = 0;
      return active.pos;
    }
    /** For the HUD: is a drone close enough and on screen to web right now? */
    function canShoot(o, dir, from) {
      if (!active || active.state !== 'flying') return false;
      const to = active.pos.clone().sub(o), along = to.dot(dir);
      if (along <= 0) return false;
      return Math.atan2(to.clone().addScaledVector(dir, -along).length(), along) < 0.38 && active.pos.distanceTo(from) < diff.reach;
    }

    function dispose() {
      objects.forEach((o) => { scene.remove(o); if (o.material) o.material.dispose(); });
      ringGeo.dispose(); droneGeo.dispose(); webBall.geometry.dispose(); beam.geometry.dispose();
    }

    return { state, update, tryShoot, canShoot, dispose, start: { pos: new T.Vector3(21, 46, 12), facing: Math.PI }, rings, drones };
  }

  SMR.createChapter1 = createChapter1;
})();
