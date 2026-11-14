/* The playable hero: the full-body model from SMR.heroRig, skinned to its skeleton and coloured
   per suit from the same masks as the menu bust. It moves with the clips in SMR.anim, played the
   way a game engine plays them: a base layer chosen by what the physics is doing (standing,
   running, swinging, crawling...) with its clips blended by speed, arc or direction; one-shot
   moves (punches, flips, landings, web shots) layered on top, the upper body only while he runs;
   crossfades between them; and last, a layer driven by the physics itself: the arm holding the
   web points at where the web really is, the head turns toward the camera, and he leans into
   turns. The physics decides where he goes; the animation never moves him. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const VS = `
    #include <common>
    #include <skinning_pars_vertex>
    attribute float aPart;
    varying vec2 vUv;
    varying float vPart;
    varying vec3 vN, vW;
    void main() {
      #include <beginnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * objectNormal);
      vUv = uv;
      vPart = aPart;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform sampler2D uSuitTex, uLensTex;
    uniform vec3 uMask, uBody, uWeb, uFrame, uLens, uEmblem, uRim, uFill, uKey, uSun;
    uniform float uTime, uDot, uFlash;
    ${S.GRAIN_GLSL}
    varying vec2 vUv;
    varying float vPart;
    varying vec3 vN, vW;
    void main() {
      vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
      float part = floor(vPart + 0.5); // 0 suit, 1 mask, 2 lens frame, 3 lens, 4 web-shooter
      float cloth = step(part, 1.5), lens = step(2.5, part) * step(part, 3.5), metal = 1.0 - cloth - lens;
      vec3 m = texture2D(uSuitTex, vUv).rgb * cloth;
      vec3 base = mix(mix(mix(uBody, uMask, m.r), uWeb, m.g), uEmblem, m.b);
      base = mix(base, uFrame, metal);
      float key = clamp(dot(N, uKey) * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = base * (0.24 + 0.92 * key * key);
      // screen-print dots in the shadows, as in the menu
      float shade = clamp(1.0 - key * 1.25, 0.0, 1.0);
      vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / uDot;
      float hr = 0.52 * sqrt(shade);
      float dots = (1.0 - smoothstep(hr - 0.09, hr + 0.09, length(fract(q) - 0.5))) * step(0.04, hr);
      col = mix(col, col * 0.45, dots * 0.55 * (1.0 - lens));
      // a soft sheen on the cloth, a tight one on the print and metal
      float nh = max(dot(N, normalize(uKey + V)), 0.0);
      float rub = max(max(m.g, m.b), metal);
      col += mix(0.06 * pow(nh, 8.0), 0.55 * pow(nh, 32.0), rub) * vec3(1.0, 0.95, 0.88) * (1.0 - lens);
      // lenses: pale glass over a fine mesh
      float grid = texture2D(uLensTex, vUv).r;
      vec3 lc = uLens * (0.74 + 0.32 * key) * mix(0.74, 1.0, grid) + pow(nh, 40.0) * 0.5;
      col = mix(col, lc, lens);
      // the low sun behind him lights his edges; the sky fills the rest
      float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
      col += uRim * fres * 1.2 * smoothstep(-0.3, 0.6, dot(N, uSun)) + uFill * fres * 0.35;
      col += uFlash * vec3(0.9, 0.95, 1.0) * 0.5;
      gl_FragColor = vec4(grain(applyFog(col, vW)), 1.0);
    }`;

  async function inflate(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function imageTexture(src, aniso) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const t = new T.Texture(img); t.anisotropy = aniso; t.needsUpdate = true; resolve(t); };
      img.onerror = () => reject(new Error('texture failed to decode'));
      img.src = src;
    });
  }

  const v3 = (x, y, z) => new T.Vector3(x, y, z);
  const TRICK = { 'Front flip': 'front_flip', 'Back flip': 'back_flip', Corkscrew: 'aerial_spin', Twister: 'twister', 'Barrel roll': 'barrel_roll' };
  const LOCO = ['idle', 'walk', 'run', 'sprint'], COMBO = ['punch_l', 'punch_r', 'kick_front', 'uppercut', 'kick_spin'];

  async function createHero(shared, aniso) {
    const rig = SMR.heroRig, art = SMR.heroModel, S = SMR.shaders;
    const [buf, suitTex, lensTex] = await Promise.all([inflate(rig.mesh), imageTexture(art.suit, aniso), imageTexture(art.lens, aniso)]);
    const meta = rig.meta, V = meta.V, bb = meta.bb, at = {};
    for (const [name, off, len, type] of meta.layout) at[name] = new window[type](buf.buffer, buf.byteOffset + off, len);
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2), part = new Float32Array(V);
    for (let i = 0; i < V; i++) {
      for (let a = 0; a < 3; a++) {
        pos[i * 3 + a] = bb[a] + (at.pos[i * 3 + a] / 65535) * (bb[a + 3] - bb[a]);
        nor[i * 3 + a] = at.nor[i * 4 + a] / 127;
      }
      uv[i * 2] = at.uv[i * 2] / 65535; uv[i * 2 + 1] = at.uv[i * 2 + 1] / 65535;
      part[i] = at.part[i];
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geo.setAttribute('aPart', new T.BufferAttribute(part, 1));
    geo.setAttribute('skinIndex', new T.BufferAttribute(new Uint8Array(at.skinIndex), 4));
    geo.setAttribute('skinWeight', new T.BufferAttribute(new Uint8Array(at.skinWeight), 4, true));
    geo.setIndex(new T.BufferAttribute(at.index.constructor === Uint32Array ? new Uint32Array(at.index) : new Uint16Array(at.index), 1));

    const uniforms = Object.assign({
      uSuitTex: { value: suitTex }, uLensTex: { value: lensTex },
      uMask: { value: v3() }, uBody: { value: v3() }, uWeb: { value: v3() }, uFrame: { value: v3() }, uLens: { value: v3() }, uEmblem: { value: v3() },
      uRim: { value: v3() }, uFill: { value: v3() }, uKey: { value: v3(0, 1, 0) }, uSun: { value: shared.sunDir }, uDot: { value: 6 }, uFlash: { value: 0 },
      uTime: shared.timeU, uGrain: shared.grainU,
    }, shared.fogU);
    const mat = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS(S), uniforms });
    const mesh = new T.SkinnedMesh(geo, mat);
    mesh.frustumCulled = false;

    /* ---------- skeleton ---------- */
    const A = SMR.anim, solver = A.createSolver(meta), clips = A.bake(solver);
    const n = solver.n, idx = solver.idx, parent = solver.parent, N4 = n * 4;
    const bones = [];
    for (let i = 0; i < n; i++) {
      const b = new T.Bone(); b.name = solver.names[i];
      b.position.copy(solver.restLocalPos[i]); b.quaternion.copy(solver.restLocalQ[i]);
      bones.push(b);
      if (parent[i] < 0) mesh.add(b); else bones[parent[i]].add(b);
    }
    mesh.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(bones));
    const hipsRest = solver.restPos[idx.Hips].clone();
    // the upper body, for moves layered over running legs (the lower spine only partly)
    const UPPER = new Float32Array(n);
    solver.names.forEach((nm, i) => { UPPER[i] = nm === 'Spine' ? 0.45 : nm === 'Spine1' ? 0.8 : solver.upperBody[i] ? 1 : 0; });

    /* ---------- sampling and blending baked clips ---------- */
    const out = new Float32Array(N4), outHip = new Float32Array(3);
    const base = new Float32Array(N4), baseHip = new Float32Array(3);
    const snap = new Float32Array(N4), snapHip = new Float32Array(3);
    const tq = new Float32Array(N4), th = new Float32Array(3);
    /** One clip at time t (looping or held at the ends), between baked frames. */
    function sample(b, t, q, hip) {
      let f = t * b.fps;
      if (b.loop) { f %= b.frames; if (f < 0) f += b.frames; } else f = f < 0 ? 0 : f > b.frames - 1 ? b.frames - 1 : f;
      const f0 = Math.floor(f), f1 = b.loop ? (f0 + 1) % b.frames : Math.min(f0 + 1, b.frames - 1), u = f - f0;
      const a = b.q, o0 = f0 * N4, o1 = f1 * N4;
      for (let i = 0; i < N4; i += 4) {
        const x0 = a[o0 + i], y0 = a[o0 + i + 1], z0 = a[o0 + i + 2], w0 = a[o0 + i + 3];
        let x1 = a[o1 + i], y1 = a[o1 + i + 1], z1 = a[o1 + i + 2], w1 = a[o1 + i + 3];
        if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
        const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u, z = z0 + (z1 - z0) * u, w = w0 + (w1 - w0) * u;
        const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
        q[i] = x * l; q[i + 1] = y * l; q[i + 2] = z * l; q[i + 3] = w * l;
      }
      for (let k = 0; k < 3; k++) hip[k] = b.hip[f0 * 3 + k] + (b.hip[f1 * 3 + k] - b.hip[f0 * 3 + k]) * u;
    }
    /** a toward b by k per bone (k scaled by a mask), renormalised: the blend the whole system is built on. */
    function nlerp(dst, a, b, k, mask) {
      for (let i = 0, j = 0; i < N4; i += 4, j++) {
        const kk = mask ? k * mask[j] : k;
        if (kk <= 0) { if (dst !== a) { dst[i] = a[i]; dst[i + 1] = a[i + 1]; dst[i + 2] = a[i + 2]; dst[i + 3] = a[i + 3]; } continue; }
        const s = a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3] < 0 ? -kk : kk;
        const x = a[i] * (1 - kk) + b[i] * s, y = a[i + 1] * (1 - kk) + b[i + 1] * s, z = a[i + 2] * (1 - kk) + b[i + 2] * s, w = a[i + 3] * (1 - kk) + b[i + 3] * s;
        const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
        dst[i] = x * l; dst[i + 1] = y * l; dst[i + 2] = z * l; dst[i + 3] = w * l;
      }
    }
    // the base layer: weighted clips, chosen each frame
    const ents = [];
    let entN = 0;
    function push(name, t, w) {
      if (w === undefined) w = 1;
      if (w < 1e-3 || !clips[name]) return;
      const e = ents[entN] || (ents[entN] = {});
      e.b = clips[name]; e.t = t; e.w = w; entN++;
    }
    function blendBase() {
      base.fill(0); baseHip.fill(0);
      let wsum = 0;
      for (let k = 0; k < entN; k++) {
        const e = ents[k];
        sample(e.b, e.t, tq, th);
        for (let i = 0; i < N4; i += 4) {
          const w = k && base[i] * tq[i] + base[i + 1] * tq[i + 1] + base[i + 2] * tq[i + 2] + base[i + 3] * tq[i + 3] < 0 ? -e.w : e.w;
          base[i] += tq[i] * w; base[i + 1] += tq[i + 1] * w; base[i + 2] += tq[i + 2] * w; base[i + 3] += tq[i + 3] * w;
        }
        for (let j = 0; j < 3; j++) baseHip[j] += th[j] * e.w;
        wsum += e.w;
      }
      for (let i = 0; i < N4; i += 4) {
        const l = 1 / (Math.sqrt(base[i] * base[i] + base[i + 1] * base[i + 1] + base[i + 2] * base[i + 2] + base[i + 3] * base[i + 3]) || 1);
        base[i] *= l; base[i + 1] *= l; base[i + 2] *= l; base[i + 3] *= l;
      }
      for (let j = 0; j < 3; j++) baseHip[j] /= wsum || 1;
    }

    /* ---------- one-shot moves on top ---------- */
    const actions = [];
    const KILL = 0.12;
    /**
     * Play a move. o: { mask: 'full' | 'upper' | 'auto' (the whole body when standing, the upper
     * body while running), rate, from (start time), fin / fout (fade in and out, s), weight, cancelOnMove }
     */
    function play(name, o) {
      const b = clips[name];
      if (!b) return;
      o = o || {};
      for (const a of actions) if (!a.kill) { a.kill = true; a.kw = a.w; a.kt = 0; }
      actions.push({ b, name, t: o.from || 0, rate: o.rate || 1, w: 0, fin: o.fin || 0.07, fout: o.fout || 0.16, mask: o.mask || 'full', max: o.weight || 1, cancel: !!o.cancelOnMove, kill: false, kt: 0, kw: 0 });
      if (actions.length > 4) actions.shift();
    }
    function stop(name) { for (const a of actions) if (a.name === name && !a.kill) { a.kill = true; a.kw = a.w; a.kt = 0; } }
    const playing = (name) => actions.some((a) => a.name === name && !a.kill);
    const autoMask = new Float32Array(n);
    function runActions(dt, moving) {
      for (let i = actions.length - 1; i >= 0; i--) {
        const a = actions[i];
        a.t += dt * a.rate;
        let w = Math.min(1, a.t / a.fin, (a.b.dur - a.t) / a.fout);
        if (a.cancel && moving > 0.3 && !a.kill) { a.kill = true; a.kw = a.w; a.kt = 0; }
        if (a.kill) { a.kt += dt; w = Math.min(w, a.kw * (1 - a.kt / KILL)); }
        a.w = Math.max(0, w) * a.max;
        if (a.t >= a.b.dur || (a.kill && a.kt >= KILL)) actions.splice(i, 1);
      }
      for (let j = 0; j < n; j++) autoMask[j] = Math.max(UPPER[j], 1 - moving);
      for (const a of actions) {
        if (a.w <= 0) continue;
        sample(a.b, a.t, tq, th);
        const mask = a.mask === 'upper' ? UPPER : a.mask === 'auto' ? autoMask : null;
        nlerp(out, out, tq, a.w, mask);
        const hw = a.mask === 'upper' ? 0 : a.mask === 'auto' ? a.w * (1 - moving) : a.w;
        for (let j = 0; j < 3; j++) outHip[j] += (th[j] - outHip[j]) * hw;
      }
    }

    /* ---------- the physics layer: aimed arms, head turn ---------- */
    const bq = Array.from({ length: n }, () => new T.Quaternion()), bp = Array.from({ length: n }, () => v3());
    const qa = new T.Quaternion(), qb = new T.Quaternion(), qc = new T.Quaternion(), qI = new T.Quaternion(), va = v3(), vb = v3(), Y = v3(0, 1, 0), X = v3(1, 0, 0), Z = v3(0, 0, 1);
    const ARM = [idx.LeftArm, idx.RightArm], HAND = [idx.LeftHand, idx.RightHand];
    function setWorld(i, q) { // a bone's body-space rotation -> its local rotation in the pose
      bq[i].copy(q);
      qc.copy(bq[parent[i]]).invert().multiply(bq[i]).toArray(out, i * 4);
    }
    /** Swing an arm about the shoulder so the hand points at a body-space point (w: how much). */
    function aimArm(s, at, w) {
      if (w <= 0.001) return;
      const ia = ARM[s];
      va.copy(bp[HAND[s]]).sub(bp[ia]).normalize();
      vb.copy(at).sub(bp[ia]).normalize();
      qa.setFromUnitVectors(va, vb);
      if (w < 1) qa.slerp(qI, 1 - w);
      setWorld(ia, qb.copy(qa).multiply(bq[ia]));
    }
    function turnBone(i, axis, ang) { if (ang) setWorld(i, qb.setFromAxisAngle(axis, ang).multiply(bq[i])); }

    /* ---------- body placement ---------- */
    const bodyQ = new T.Quaternion(), goalQ = new T.Quaternion(), basis = new T.Matrix4(), bank = new T.Quaternion();
    const ax = v3(), ay = v3(), az = v3();
    /** Turn the body toward an up and a forward direction in the world. */
    function face(up, fwd, rate, dt) {
      ay.copy(up).normalize();
      az.copy(fwd).addScaledVector(ay, -fwd.dot(ay));
      if (az.lengthSq() < 1e-6) az.set(0, 0, 1).addScaledVector(ay, -ay.z);
      az.normalize();
      ax.crossVectors(ay, az);
      basis.makeBasis(ax, ay, az);
      goalQ.setFromRotationMatrix(basis);
      bodyQ.slerp(goalQ, 1 - Math.exp(-rate * dt));
    }

    /* ---------- the state each frame ---------- */
    let clock = 0, baseKey = '', fade = 1, fadeRate = 8, phase = 0, crawlPh = 0, jumpT = 9, combatT = 9, lastMelee = -9, comboN = 0;
    let lean = 0, bankA = 0, lastFacing = null, lastSpeed = 0, look = 0, moving = 0;
    const wLoco = [0, 0, 0, 0];
    const shot = { t: 0, d: 0, both: false, right: true, at: v3() };
    const inv = new T.Quaternion(), local = v3(), hipWorld = v3();
    const toLocal = (p, out2) => out2.copy(p).sub(mesh.position).applyQuaternion(inv);
    const sm = (a, b, x) => { const k = U.clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

    function locomotion(v, dt) {
      wLoco.fill(0);
      if (v <= 0.15) wLoco[0] = 1;
      else if (v < 0.9) { const k = (v - 0.15) / 0.75; wLoco[0] = 1 - k; wLoco[1] = k; }
      else if (v < 2) wLoco[1] = 1;
      else if (v < 8.5) { const k = sm(2, 8.5, v); wLoco[1] = 1 - k; wLoco[2] = k; }
      else if (v < 16) { const k = (v - 8.5) / 7.5; wLoco[2] = 1 - k; wLoco[3] = k; }
      else wLoco[3] = 1;
      let stride = 0, wm = 0;
      for (let k = 1; k < 4; k++) { stride += wLoco[k] * clips[LOCO[k]].stride; wm += wLoco[k]; }
      if (wm > 0) phase = (phase + (dt * v) / (stride / wm)) % 1; // one shared phase: the feet stay in step through the blends
      push(combatT < 2.5 ? 'idle_ready' : 'idle', clock, wLoco[0]);
      for (let k = 1; k < 4; k++) push(LOCO[k], phase * clips[LOCO[k]].dur, wLoco[k]);
    }

    /**
     * Pose the hero for this frame. s: { state, speed (horizontal), vy, hip (world), up, fwd,
     * facing, webPoint, webRight, swingK, zipTo, dive, perch, look, wallMove: {x, y}, wallRun,
     * wallSide, ceilMove }
     */
    function update(dt, s) {
      clock += dt; jumpT += dt; combatT += dt;
      entN = 0;
      let key = s.state, rate = 7, orient = 10;
      const v = s.speed;
      moving = sm(0.8, 2.2, v);
      if (s.state === 'ground') {
        if (s.perch) { key = 'perch'; push('perch', clock); rate = 3; }
        else { key = 'ground'; locomotion(v, dt); }
        orient = 14;
      } else if (s.state === 'swing') {
        const side = s.webRight ? '_r' : '_l', k = U.clamp(-s.swingK, -1, 1); // -1 dropping in behind the anchor … 1 swung out past it
        key = 'swing' + side; rate = 6; orient = 7;
        push('swing_back' + side, clock, Math.max(0, -k)); push('swing_bottom' + side, clock, 1 - Math.abs(k)); push('swing_front' + side, clock, Math.max(0, k));
      } else if (s.state === 'zip') { key = 'zip'; push('web_zip', clock); rate = 10; orient = 12; }
      else if (s.state === 'wall') {
        orient = 12; rate = 9;
        if (s.wallRun === 'up') { key = 'wallrun'; phase = (phase + (dt * Math.max(v, 4)) / clips.wall_run_up.stride) % 1; push('wall_run_up', phase * clips.wall_run_up.dur); }
        else if (s.wallRun === 'side') { const nm = s.wallSide > 0 ? 'wall_run_side_r' : 'wall_run_side_l'; key = nm; phase = (phase + (dt * Math.max(v, 4)) / clips[nm].stride) % 1; push(nm, phase * clips[nm].dur); }
        else {
          key = 'crawl';
          const mx = s.wallMove.x, my = s.wallMove.y, mv = Math.hypot(mx, my), still = 1 - sm(0.15, 0.7, mv);
          crawlPh = (crawlPh + (dt * mv) / 0.42) % 1;
          const wu = Math.max(0, my), wd = Math.max(0, -my), wl = Math.max(0, mx), wr = Math.max(0, -mx), ws = wu + wd + wl + wr || 1;
          push('wall_idle', clock, still);
          const t = crawlPh * 0.8, k = (1 - still) / ws;
          push('wall_crawl_up', t, wu * k); push('wall_crawl_down', t, wd * k); push('wall_crawl_left', t, wl * k); push('wall_crawl_right', t, wr * k);
        }
      } else if (s.state === 'ceiling') {
        key = 'ceiling'; orient = 8; rate = 6;
        const still = 1 - sm(0.15, 0.7, v);
        crawlPh = (crawlPh + (dt * v) / 0.4) % 1;
        push('ceiling_idle', clock, still); push('ceiling_crawl', crawlPh * 0.95, 1 - still);
      } else if (s.dive) { key = 'dive'; push('dive', clock); rate = 5; orient = 8; }
      else { // in the air: the jump carries him up, then he spreads out to fall
        key = 'air'; orient = 6; rate = 7;
        const wf = jumpT < 1.2 ? sm(1.5, -5, s.vy) : 1;
        push('jump', Math.min(0.12 + jumpT, 0.6), 1 - wf);
        push('fall', clock, wf);
      }
      if (key !== baseKey) {
        if (baseKey) { snap.set(out); snapHip.set(outHip); fade = 0; fadeRate = rate; }
        baseKey = key;
      }
      blendBase();
      if (fade < 1) {
        fade = Math.min(1, fade + dt * fadeRate);
        const k = fade * fade * (3 - 2 * fade);
        nlerp(out, snap, base, k);
        for (let j = 0; j < 3; j++) outHip[j] = snapHip[j] + (baseHip[j] - snapHip[j]) * k;
      } else { out.set(base); outHip.set(baseHip); }
      runActions(dt, s.state === 'ground' ? moving : 0);

      // where he faces; on the ground he leans into turns and into speeding up
      face(s.up, s.fwd, orient, dt);
      let turnRate = 0;
      if (lastFacing !== null && dt > 0) { let df = s.facing - lastFacing; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2; turnRate = df / dt; }
      lastFacing = s.facing;
      const accel = dt > 0 ? (v - lastSpeed) / dt : 0;
      lastSpeed = v;
      const onGround = s.state === 'ground' && !s.perch;
      bankA += ((onGround ? U.clamp(-turnRate * v * 0.012, -0.32, 0.32) : 0) - bankA) * (1 - Math.exp(-8 * dt));
      lean += ((onGround ? U.clamp(accel * 0.012, -0.18, 0.22) : 0) - lean) * (1 - Math.exp(-6 * dt));
      mesh.quaternion.copy(bodyQ).multiply(bank.setFromAxisAngle(Z, bankA));
      hipWorld.copy(hipsRest).applyQuaternion(bodyQ);
      mesh.position.copy(s.hip).sub(hipWorld);
      inv.copy(mesh.quaternion).invert();

      // the physics layer
      solver.fk(out, outHip, bq, bp);
      if (lean) turnBone(idx.Spine1, X, lean);
      if (lean) solver.fk(out, outHip, bq, bp);
      if (s.state === 'swing' && s.webPoint) aimArm(s.webRight ? 1 : 0, toLocal(s.webPoint, local), Math.min(1, fade * 2 + 0.3));
      if (s.state === 'zip' && s.zipTo) { toLocal(s.zipTo, local); aimArm(0, local, 1); aimArm(1, local, 1); }
      if (shot.t > 0) {
        shot.t -= dt;
        const w = Math.min(U.clamp(shot.t / 0.08, 0, 1), U.clamp((shot.d - shot.t) / 0.05, 0, 1));
        toLocal(shot.at, local);
        if (shot.both) { aimArm(0, local, w); aimArm(1, local, w); } else aimArm(shot.right ? 1 : 0, local, w);
      }
      look += ((onGround && !actions.length ? U.clamp(s.look || 0, -1, 1) : 0) - look) * (1 - Math.exp(-5 * dt));
      if (Math.abs(look) > 0.002) { turnBone(idx.Neck, Y, look * 0.4); bq[idx.Head].premultiply(qa.setFromAxisAngle(Y, look * 0.4)); turnBone(idx.Head, Y, look * 0.6); }

      for (let i = 0; i < n; i++) bones[i].quaternion.fromArray(out, i * 4);
      bones[idx.Hips].position.set(outHip[0], outHip[1], outHip[2]);
      mesh.updateMatrixWorld(true);
    }
    /** What the physics did this frame, as moves. */
    function react(events, p, hs) {
      for (const e of events) {
        if (e === 'jump') jumpT = 0;
        else if (e === 'jump2') play('double_jump', { fin: 0.05 });
        else if (e === 'walljump') { jumpT = 9; play('wall_jump', { fin: 0.04 }); }
        else if (e === 'swing') play(p.webRight ? 'web_attach_r' : 'web_attach_l', { mask: 'upper', fin: 0.04 });
        else if (e === 'release') play('web_release', { fin: 0.06, fout: 0.25 });
        else if (e === 'boost' || e === 'vault') play('launch', { fin: 0.05, fout: 0.2 });
        else if (e === 'land') {
          if (hs > 12) play('land_roll', { rate: 1.15, fin: 0.04 });
          else if (p.impact > 24 && hs < 7) play('land_hero', { fin: 0.03, cancelOnMove: true });
          else play('land_soft', { mask: hs > 3 ? 'upper' : 'full', weight: hs > 3 ? 0.5 : 1, fin: 0.04 });
        } else if (e === 'trick' && p.trick) play(TRICK[p.trick.name] || 'front_flip', { rate: 0.7 / 0.62, fin: 0.05 });
        else if (e === 'dodge') {
          const f = p.facing, side = p.dodgeX * Math.cos(f) - p.dodgeZ * Math.sin(f), ahead = p.dodgeX * Math.sin(f) + p.dodgeZ * Math.cos(f);
          if (p.state !== 'ground') play(side >= 0 ? 'barrel_roll' : 'aerial_spin', { rate: 1.3, fin: 0.04 });
          else if (Math.abs(side) > Math.abs(ahead)) play(side > 0 ? 'dodge_left' : 'dodge_right', { rate: 1.25, fin: 0.04 });
          else play(ahead > 0 ? 'land_roll' : 'dodge_back', { rate: 1.3, fin: 0.04 });
          combatT = 0;
        }
      }
    }
    /** A melee hit: the next blow of the combo (jab, cross, front kick, uppercut, spinning kick). */
    function melee(inAir) {
      if (clock - lastMelee > 0.8) comboN = 0;
      const name = inAir ? (comboN % 2 ? 'kick_spin' : 'kick_front') : COMBO[comboN % COMBO.length];
      comboN++; lastMelee = clock; combatT = 0;
      play(name, { mask: inAir ? 'full' : 'auto', fin: 0.05, fout: 0.14 });
      return name;
    }
    /** Fire webs at a point: one hand, or both (a yank or a strike), aiming the arms at it. */
    function shoot(at, right, how) {
      shot.at.copy(at); shot.right = right; shot.both = how === 'both' || how === 'yank' || how === 'strike'; shot.t = shot.d = how === 'strike' ? 0.2 : 0.32;
      if (how === 'yank') play('web_yank', { mask: 'upper' });
      else if (how === 'strike') play('web_strike', { fin: 0.04 });
      else if (how === 'both') play('web_shoot_both', { mask: 'upper', fin: 0.04 });
      else play(right ? 'web_shoot_r' : 'web_shoot_l', { mask: 'upper', fin: 0.04 });
    }

    const handV = v3();
    function hand(right) { return bones[idx[right ? 'RightHand' : 'LeftHand']].getWorldPosition(handV); }

    function setSuit(suit, color) {
      uniforms.uMask.value.copy(color(suit.mask)); uniforms.uBody.value.copy(color(suit.body)); uniforms.uWeb.value.copy(color(suit.web));
      uniforms.uFrame.value.copy(color(suit.frame)); uniforms.uLens.value.copy(color(suit.lens)); uniforms.uEmblem.value.copy(color(suit.emblem));
    }
    function dispose() { geo.dispose(); mat.dispose(); suitTex.dispose(); lensTex.dispose(); }

    bodyQ.identity();
    return { mesh, uniforms, update, react, play, stop, playing, melee, shoot, hand, setSuit, dispose, clips, height: 1.8, hipHeight: hipsRest.y, legLen: solver.geo.reach };
  }

  SMR.createHero = createHero;
})();
