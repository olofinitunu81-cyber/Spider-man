/* The city's life: traffic on the streets around the hero (headlights on at dawn), people on
   the sidewalks who stop, look up, wave and take photos when he swings past, pigeons that burst
   off the roofs as he comes near, steam from the vents, slow clouds, and the Bugle's news
   chopper circling with its searchlight. Everything is instanced (one draw call per kind) and
   only the patch of city around the hero is populated, so it stays cheap at 100 fps. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const LIT_VS = `
    attribute vec3 aColor;
    attribute float aKind;
    varying vec3 vC, vN, vW;
    varying float vK;
    void main() {
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vC = aColor; vK = aKind; vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const LIT_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uRimC;
    varying vec3 vC, vN, vW;
    varying float vK;
    void main() {
      vec3 N = normalize(vN);
      float k = clamp(dot(N, normalize(vec3(-0.3, 0.8, 0.45))) * 0.5 + 0.5, 0.0, 1.0);
      float sun = max(dot(N, uSunDir), 0.0);
      vec3 c = vC * (0.3 + 0.8 * k) + uRimC * sun * 0.35 * vC;
      if (vK > 0.5 && vK < 1.5) c = vec3(1.0, 0.93, 0.75) * 2.2;       // headlight
      else if (vK > 1.5 && vK < 2.5) c = vec3(1.0, 0.12, 0.08) * 1.7;  // tail light
      else if (vK > 2.5) c = vec3(0.07, 0.09, 0.13) + pow(1.0 - abs(N.y), 3.0) * uRimC * 0.25; // glass
      gl_FragColor = vec4(applyFog(c, vW), 1.0);
    }`;

  // people: legs and arms swing about the hip and shoulder; arms go up when they cheer
  const PED_VS = `
    attribute vec3 aShirt, aSkin;
    attribute vec4 aAnim;   // phase, walk amount, cheer, camera flash
    attribute float aPart;  // 0/1 legs, 2 torso, 3 head, 4/5 arms
    varying vec3 vC, vN, vW;
    varying float vFlash;
    uniform float uTime;
    vec3 rotX(vec3 p, float a, float py) { p.y -= py; float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s + py, p.y * s + p.z * c); }
    vec3 rotZ(vec3 p, float a, float px, float py) { p.x -= px; p.y -= py; float c = cos(a), s = sin(a); return vec3(p.x * c - p.y * s + px, p.x * s + p.y * c + py, p.z); }
    void main() {
      vec3 p = position, n = normal;
      float ph = aAnim.x + uTime * 7.0, walk = aAnim.y, cheer = aAnim.z;
      if (aPart < 1.5) { float a = sin(ph + aPart * 3.14159) * 0.6 * walk; p = rotX(p, a, 0.9); n = rotX(n, a, 0.0); }
      if (aPart > 3.5) {
        float side = aPart > 4.5 ? -1.0 : 1.0;
        float swingA = sin(ph + (aPart - 4.0) * 3.14159 + 3.14159) * 0.5 * walk;
        float up = cheer * (2.6 + 0.35 * sin(uTime * 9.0 + aAnim.x * 3.0));
        p = rotX(p, swingA * (1.0 - cheer), 1.42);
        p = rotZ(p, side * up, side * 0.22, 1.42);
      }
      vC = aPart < 1.5 ? vec3(0.12, 0.13, 0.18) + aShirt * 0.15 : aPart > 2.5 && aPart < 3.5 ? aSkin : aPart > 3.5 ? mix(aShirt, aSkin, step(1.1, position.y < 1.0 ? 1.2 : 0.0)) : aShirt;
      vFlash = aAnim.w * step(3.5, aPart);
      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const PED_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uRimC;
    varying vec3 vC, vN, vW;
    varying float vFlash;
    void main() {
      vec3 N = normalize(vN);
      float k = clamp(dot(N, normalize(vec3(-0.3, 0.8, 0.45))) * 0.5 + 0.5, 0.0, 1.0);
      vec3 c = vC * (0.3 + 0.8 * k) + uRimC * max(dot(N, uSunDir), 0.0) * 0.3 * vC + vFlash * 3.0;
      gl_FragColor = vec4(applyFog(c, vW), 1.0);
    }`;

  // pigeons: a body and two wings that flap
  const BIRD_VS = `
    attribute vec2 aBird; // phase, flap (0 folded … 1 flying)
    attribute float aWing;
    uniform float uTime;
    varying vec3 vW;
    void main() {
      vec3 p = position;
      float f = sin(uTime * 22.0 + aBird.x * 6.28) * aBird.y;
      p.y += abs(p.x) * (f * 1.1 + (1.0 - aBird.y) * -0.2) * abs(aWing);
      p.x *= mix(0.35, 1.0, aBird.y) * (aWing == 0.0 ? 1.0 : 1.0);
      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const BIRD_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    varying vec3 vW;
    void main() { gl_FragColor = vec4(applyFog(vec3(0.16, 0.16, 0.2), vW), 1.0); }`;

  // soft puffs: steam, dust and clouds, always facing the camera
  const PUFF_VS = `
    attribute vec4 aPuff;  // centre xyz, size
    attribute vec3 aLook;  // alpha, kind (0 steam, 1 dust, 2 cloud), seed
    varying vec2 vUv;
    varying float vA, vKind, vSeed;
    varying vec3 vW;
    void main() {
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 wp = aPuff.xyz + (right * position.x + up * position.y) * aPuff.w;
      vUv = position.xy; vA = aLook.x; vKind = aLook.y; vSeed = aLook.z; vW = wp;
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const PUFF_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uCloudA, uCloudB, uDust;
    varying vec2 vUv;
    varying float vA, vKind, vSeed;
    varying vec3 vW;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      float r = length(vUv) * 2.0;
      float n = noise(vUv * 3.0 + vSeed * 17.0) * 0.6 + noise(vUv * 7.0 - vSeed * 9.0) * 0.4;
      float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7) * vA;
      if (a < 0.01) discard;
      vec3 c;
      if (vKind > 1.5) { c = mix(uCloudB, uCloudA, smoothstep(-0.4, 0.6, vUv.y + n * 0.3)); c = mix(c, uHazeHigh, 0.35); }
      else { c = vKind > 0.5 ? uDust : vec3(0.92, 0.9, 0.95); c *= 0.75 + 0.35 * n; c = applyFog(c, vW); }
      gl_FragColor = vec4(c, a);
    }`;

  const SHIRTS = ['#c0392b', '#2c3e70', '#e6e1d6', '#3d5a40', '#8e5a2b', '#1e1e24', '#d9a441', '#6b2d5c', '#2f7f8a', '#b8b2a7', '#38323f', '#9c2f3c'];
  const SKINS = ['#f1c7a5', '#d9a07a', '#a96f4c', '#7c4a2f', '#5a3522', '#e8b896'];
  const CARS = ['#f2c21b', '#f2c21b', '#f2c21b', '#1f2430', '#d8d6d0', '#5d1d24', '#2a3b5c', '#7d8287', '#3b4a3c', '#151517', '#b04a2a'];
  const SHOUTS = ['"Spidey!"', '"Hey, he\'s back!"', '"Look, up there!"', '"Is that a new suit?"', '"Go get \'em!"', '"Did you see that?"', '"Nice one, web-head!"', '"My kid is never going to believe this."', '"Is that thing filming us?"', '"Morning, Spidey!"'];

  /** Merge boxes into one geometry with a per-vertex attribute. parts: [w, h, d, x, y, z, attr] */
  function boxes(parts, attrName) {
    const geos = parts.map(([w, h, d, x, y, z, k]) => {
      const g = new T.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
      g.setAttribute(attrName, new T.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
      return g;
    });
    const n = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), at = new Float32Array(n);
    let o = 0;
    for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); at.set(g.attributes[attrName].array, o); o += g.attributes.position.count; }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute(attrName, new T.BufferAttribute(at, 1));
    return out;
  }

  function createLife(scene, world, shared, pal) {
    const S = SMR.shaders;
    const P = world.PITCH, HALF = world.LOT / 2;
    const r = U.rng(7311);
    const rgb = (hex) => { const c = U.hexToRgb(hex); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
    const m4 = new T.Matrix4(), q = new T.Quaternion(), v1 = new T.Vector3(), v2 = new T.Vector3(), Y = new T.Vector3(0, 1, 0), ONE = new T.Vector3(1, 1, 1);
    const rimU = { value: new T.Color(pal.rim) };
    const disposables = [];
    const lim = (world.SPAN - 0.5) * P;

    /* ---------- traffic ---------- */
    const NCARS = 200, CAR_R = 330;
    const carGeo = boxes([
      [1.9, 0.78, 4.5, 0, 0.62, 0, 0], [1.7, 0.62, 2.3, 0, 1.3, -0.15, 3],
      [0.42, 0.16, 0.06, 0.65, 0.78, 2.26, 1], [0.42, 0.16, 0.06, -0.65, 0.78, 2.26, 1],
      [0.4, 0.14, 0.06, 0.66, 0.82, -2.26, 2], [0.4, 0.14, 0.06, -0.66, 0.82, -2.26, 2],
    ], 'aKind');
    const carColor = new Float32Array(NCARS * 3);
    carGeo.setAttribute('aColor', new T.InstancedBufferAttribute(carColor, 3));
    const carMat = new T.ShaderMaterial({ vertexShader: LIT_VS, fragmentShader: LIT_FS(S), uniforms: Object.assign({ uRimC: rimU }, shared.fogU) });
    const carMesh = new T.InstancedMesh(carGeo, carMat, NCARS);
    carMesh.frustumCulled = false; carMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(carMesh); disposables.push(carGeo, carMat);
    const cars = [];
    function placeCar(c, near, ahead) {
      c.axis = r() < 0.5 ? 0 : 1;
      c.dir = r() < 0.5 ? 1 : -1;
      const across = c.axis === 0 ? near.z : near.x, along = c.axis === 0 ? near.x : near.z;
      c.line = Math.round((across + r.range(-CAR_R, CAR_R) - P / 2) / P) * P + P / 2 + c.dir * 3.3;
      if (c.axis === 1 && c.line > world.RIVER_X - 60) c.line -= Math.ceil((c.line - (world.RIVER_X - 60)) / P) * P; // no avenues on the river
      c.s = ahead ? along - c.dir * CAR_R * r.range(0.8, 1) : along + r.range(-CAR_R, CAR_R);
      c.speed = r.range(7, 15);
    }
    for (let i = 0; i < NCARS; i++) {
      const c = {}; placeCar(c, world.start, false); cars.push(c);
      carColor.set(rgb(CARS[i % CARS.length]), i * 3);
    }

    /* ---------- people ---------- */
    const NPED = 240, PED_R = 170;
    const pedGeo = (() => {
      const parts = [[0.17, 0.9, 0.2, 0.1, 0.45, 0, 0], [0.17, 0.9, 0.2, -0.1, 0.45, 0, 1], [0.44, 0.62, 0.26, 0, 1.2, 0, 2], [0.22, 0.25, 0.23, 0, 1.66, 0.01, 3],
        [0.12, 0.62, 0.14, 0.29, 1.18, 0, 4], [0.12, 0.62, 0.14, -0.29, 1.18, 0, 5]];
      return boxes(parts, 'aPart');
    })();
    const pedShirt = new Float32Array(NPED * 3), pedSkin = new Float32Array(NPED * 3), pedAnim = new Float32Array(NPED * 4);
    pedGeo.setAttribute('aShirt', new T.InstancedBufferAttribute(pedShirt, 3));
    pedGeo.setAttribute('aSkin', new T.InstancedBufferAttribute(pedSkin, 3));
    const animAttr = new T.InstancedBufferAttribute(pedAnim, 4).setUsage(T.DynamicDrawUsage);
    pedGeo.setAttribute('aAnim', animAttr);
    const pedMat = new T.ShaderMaterial({ vertexShader: PED_VS, fragmentShader: PED_FS(S), uniforms: Object.assign({ uRimC: rimU, uTime: shared.timeU }, shared.fogU) });
    const pedMesh = new T.InstancedMesh(pedGeo, pedMat, NPED);
    pedMesh.frustumCulled = false; pedMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(pedMesh); disposables.push(pedGeo, pedMat);
    const peds = [];
    function placePed(p, near) {
      p.bi = Math.round((near.x + r.range(-PED_R, PED_R)) / P); p.bj = Math.round((near.z + r.range(-PED_R, PED_R)) / P);
      p.bi = U.clamp(p.bi, -world.SPAN, Math.floor((world.RIVER_X - 30) / P)); p.bj = U.clamp(p.bj, -world.SPAN, world.SPAN);
      p.u = r.range(0, 4); p.dir = r() < 0.5 ? 1 : -1; p.speed = r.range(1.1, 1.7); p.off = r.range(0.9, 3); p.cheer = 0; p.flashT = 0;
    }
    for (let i = 0; i < NPED; i++) {
      const p = {}; placePed(p, world.start); p.phase = r.range(0, 6.28); peds.push(p);
      pedShirt.set(rgb(SHIRTS[i % SHIRTS.length]), i * 3); pedSkin.set(rgb(SKINS[Math.floor(r() * SKINS.length)]), i * 3);
    }
    const pedPos = new T.Vector3();
    function pedSpot(p, out) { // walk around the block: u in [0, 4), one unit per side
      const side = Math.floor(p.u) % 4, t = p.u - Math.floor(p.u), e = HALF + p.off, cx = p.bi * P, cz = p.bj * P;
      const a = -e + 2 * e * t;
      if (side === 0) out.set(cx + a, 0, cz - e); else if (side === 1) out.set(cx + e, 0, cz + a);
      else if (side === 2) out.set(cx - a, 0, cz + e); else out.set(cx - e, 0, cz - a);
      return [side, out];
    }

    /* ---------- pigeons ---------- */
    const FLOCKS = 7, PER = 14, NB = FLOCKS * PER;
    const birdGeo = (() => {
      const g = new T.BufferGeometry();
      const pos = [0, 0, 0.18, 0.04, 0.02, -0.12, -0.04, 0.02, -0.12, 0, 0, 0.05, 0.36, 0.02, -0.04, 0, 0, -0.1, 0, 0, 0.05, -0.36, 0.02, -0.04, 0, 0, -0.1];
      const wing = [0, 0, 0, 1, 1, 1, -1, -1, -1];
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('aWing', new T.Float32BufferAttribute(wing, 1));
      return g;
    })();
    const birdAttr = new Float32Array(NB * 2);
    const birdAttrB = new T.InstancedBufferAttribute(birdAttr, 2).setUsage(T.DynamicDrawUsage);
    birdGeo.setAttribute('aBird', birdAttrB);
    const birdMat = new T.ShaderMaterial({ vertexShader: BIRD_VS, fragmentShader: BIRD_FS(S), side: T.DoubleSide, uniforms: Object.assign({ uTime: shared.timeU }, shared.fogU) });
    const birdMesh = new T.InstancedMesh(birdGeo, birdMat, NB);
    birdMesh.frustumCulled = false; birdMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(birdMesh); disposables.push(birdGeo, birdMat);
    const flocks = [];
    const birdP = new Float32Array(NB * 3), birdV = new Float32Array(NB * 3), birdPh = new Float32Array(NB);
    function perchFlock(f, near) {
      const cands = world.tops.filter((t) => t[4] > 12 && Math.abs((t[0] + t[2]) / 2 - near.x) < 150 && Math.abs((t[1] + t[3]) / 2 - near.z) < 150);
      const t = cands.length ? cands[Math.floor(r() * cands.length)] : world.tops[Math.floor(r() * world.tops.length)];
      const alongX = r() < 0.5, edge = r() < 0.5;
      f.state = 'perched'; f.t = 0;
      for (let k = 0; k < PER; k++) {
        const i = f.i0 + k, s = r.range(0.15, 0.85);
        birdP[i * 3] = alongX ? U.lerp(t[0], t[2], s) : (edge ? t[0] + 0.3 : t[2] - 0.3);
        birdP[i * 3 + 1] = t[4] + 0.05;
        birdP[i * 3 + 2] = alongX ? (edge ? t[1] + 0.3 : t[3] - 0.3) : U.lerp(t[1], t[3], s);
        birdPh[i] = r.range(0, 6.28);
      }
    }
    for (let k = 0; k < FLOCKS; k++) { const f = { i0: k * PER }; perchFlock(f, world.start); flocks.push(f); }

    /* ---------- steam, dust and clouds ---------- */
    const NPUFF = 260;
    const puffGeo = new T.InstancedBufferGeometry();
    puffGeo.setAttribute('position', new T.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    puffGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const puffA = new Float32Array(NPUFF * 4), puffB = new Float32Array(NPUFF * 3);
    const puffAttrA = new T.InstancedBufferAttribute(puffA, 4).setUsage(T.DynamicDrawUsage), puffAttrB = new T.InstancedBufferAttribute(puffB, 3).setUsage(T.DynamicDrawUsage);
    puffGeo.setAttribute('aPuff', puffAttrA); puffGeo.setAttribute('aLook', puffAttrB);
    puffGeo.instanceCount = NPUFF;
    const puffMat = new T.ShaderMaterial({
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS(S), transparent: true, depthWrite: false,
      uniforms: Object.assign({ uCloudA: { value: new T.Color(pal.cloud[1]) }, uCloudB: { value: new T.Color(pal.cloud[0]) }, uDust: { value: new T.Color('#b9a48c') } }, shared.fogU),
    });
    const puffMesh = new T.Mesh(puffGeo, puffMat);
    puffMesh.frustumCulled = false; puffMesh.renderOrder = 20;
    scene.add(puffMesh); disposables.push(puffGeo, puffMat);
    const puffs = Array.from({ length: NPUFF }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 2, a: 0.5, kind: 0, seed: r() }));
    const CLOUDS = 70; // the first 70 puffs are the clouds and never expire
    for (let i = 0; i < CLOUDS; i++) {
      const c = Math.floor(i / 5), ang = (c / 14) * Math.PI * 2 + r.range(-0.15, 0.15), rad = r.range(2300, 3000);
      const p = puffs[i];
      p.kind = 2; p.life = 1; p.max = 1e9; p.a = r.range(0.55, 0.85);
      p.x = Math.sin(ang) * rad + r.range(-260, 260); p.y = r.range(380, 820) + (i % 5) * 24; p.z = Math.cos(ang) * rad + r.range(-200, 200);
      p.s0 = p.s1 = r.range(260, 520); p.vx = r.range(1.5, 3); p.vz = 0.6;
    }
    let puffCursor = CLOUDS;
    function emit(x, y, z, vx, vy, vz, s0, s1, a, kind, max) {
      const p = puffs[puffCursor];
      puffCursor = puffCursor + 1 >= NPUFF ? CLOUDS : puffCursor + 1;
      Object.assign(p, { x, y, z, vx, vy, vz, s0, s1, a, kind, life: 0, max });
    }
    // vents: manholes at some street corners and chimneys on some roofs
    const vents = [];
    for (let i = 0; i < 40; i++) {
      if (r() < 0.55) vents.push({ x: Math.round(r.range(-12, 8)) * P + P / 2 + r.range(-6, 6), y: 0.1, z: Math.round(r.range(-12, 12)) * P + P / 2 + r.range(-6, 6), rate: r.range(0.18, 0.32), t: 0 });
      else { const t = world.tops[Math.floor(r() * world.tops.length)]; vents.push({ x: U.lerp(t[0], t[2], r.range(0.2, 0.8)), y: t[4] + 0.5, z: U.lerp(t[1], t[3], r.range(0.2, 0.8)), rate: r.range(0.25, 0.45), t: 0 }); }
    }

    /* ---------- the Bugle's news chopper ---------- */
    const chopper = new T.Group();
    const heliGeo = boxes([
      [1.9, 1.7, 4.2, 0, 0, 0, 0], [1.6, 0.9, 1.2, 0, 0.25, 2.2, 3], [0.42, 0.42, 5.4, 0, 0.35, -4.4, 0], [0.12, 1.5, 0.9, 0, 0.9, -6.9, 0],
      [0.12, 0.12, 3.6, 0.8, -1.15, 0.2, 0], [0.12, 0.12, 3.6, -0.8, -1.15, 0.2, 0], [0.3, 0.3, 0.3, 0, -0.9, 2.4, 1], [0.22, 0.22, 0.22, 0, 1.0, -7.3, 2],
    ], 'aKind');
    heliGeo.setAttribute('aColor', new T.InstancedBufferAttribute(new Float32Array([0.85, 0.83, 0.8]), 3));
    const heliMesh = new T.InstancedMesh(heliGeo, carMat, 1);
    heliMesh.setMatrixAt(0, new T.Matrix4());
    heliMesh.frustumCulled = false;
    const rotorGeo = new T.BoxGeometry(11, 0.06, 0.32);
    rotorGeo.setAttribute('aKind', new T.BufferAttribute(new Float32Array(rotorGeo.attributes.position.count), 1));
    rotorGeo.setAttribute('aColor', new T.InstancedBufferAttribute(new Float32Array([0.12, 0.12, 0.14, 0.12, 0.12, 0.14]), 3));
    const rotor = new T.InstancedMesh(rotorGeo, carMat, 2);
    rotor.frustumCulled = false; rotor.position.y = 1.1;
    const beamGeo = new T.CylinderGeometry(0.4, 9, 70, 20, 1, true).translate(0, -35, 0);
    const beamMat = new T.ShaderMaterial({
      vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
      fragmentShader: 'precision highp float; varying float vY; void main(){ float a = smoothstep(-70.0, 0.0, vY) * 0.16; gl_FragColor = vec4(vec3(1.0, 0.95, 0.8) * a, 1.0); }',
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    });
    const beam = new T.Mesh(beamGeo, beamMat);
    beam.position.set(0, -1, 2.2); beam.rotation.x = 0.5;
    chopper.add(heliMesh, rotor, beam);
    scene.add(chopper); disposables.push(heliGeo, rotorGeo, beamGeo, beamMat);
    const heli = { ang: 0, pos: chopper.position, aimAt: null };

    /* ---------- per frame ---------- */
    let shoutCool = 4, hornCool = 3, sirenT = 18, shutterCool = 0;
    const out = { shout: null, sounds: [], rotorLevel: 0, cityLevel: 0 };
    function update(dt, time, heroHip, heroState, heroSpeed) {
      out.shout = null; out.sounds.length = 0;
      const hx = heroHip.x, hz = heroHip.z;
      // cars
      for (let i = 0; i < NCARS; i++) {
        const c = cars[i];
        c.s += c.dir * c.speed * dt;
        const along = c.axis === 0 ? hx : hz;
        if ((c.s - along) * c.dir > CAR_R || c.s < -lim - 40 || (c.axis === 0 && c.s > world.RIVER_X - 40) || (c.axis === 1 && Math.abs(c.s) > lim + 40)) placeCar(c, heroHip, true);
        const x = c.axis === 0 ? c.s : c.line, z = c.axis === 0 ? c.line : c.s;
        q.setFromAxisAngle(Y, c.axis === 0 ? (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.dir > 0 ? 0 : Math.PI));
        m4.compose(v1.set(x, 0, z), q, ONE);
        carMesh.setMatrixAt(i, m4);
      }
      carMesh.instanceMatrix.needsUpdate = true;
      // people: walk the blocks; look up and cheer when he goes by
      let cheering = 0;
      const airborne = heroState !== 'ground';
      for (let i = 0; i < NPED; i++) {
        const p = peds[i];
        const [, pos] = pedSpot(p, pedPos);
        const dx = hx - pos.x, dz = hz - pos.z, d2 = dx * dx + dz * dz;
        if (d2 > PED_R * PED_R * 1.3) { placePed(p, heroHip); continue; }
        const near = d2 < (airborne ? 34 * 34 : 14 * 14) && heroHip.y < 90;
        p.cheer = U.lerp(p.cheer, near ? 1 : 0, 1 - Math.exp(-(near ? 6 : 1.5) * dt));
        if (p.cheer < 0.4) p.u = (p.u + (p.dir * p.speed * dt) / (2 * (HALF + p.off)) + 4) % 4;
        else cheering++;
        p.flashT = Math.max(0, p.flashT - dt);
        if (p.cheer > 0.8 && Math.random() < dt * 0.5) { p.flashT = 0.07; if (shutterCool <= 0) { out.sounds.push('shutter'); shutterCool = 0.6; } }
        const [side] = pedSpot(p, pedPos);
        let yaw = (side === 0 ? Math.PI / 2 : side === 1 ? 0 : side === 2 ? -Math.PI / 2 : Math.PI) * (p.dir > 0 ? 1 : -1) + (p.dir > 0 ? 0 : 0);
        if (p.dir < 0) yaw += Math.PI;
        if (p.cheer > 0.3) yaw = Math.atan2(dx, dz);
        q.setFromAxisAngle(Y, yaw);
        m4.compose(pedPos, q, ONE);
        pedMesh.setMatrixAt(i, m4);
        pedAnim[i * 4] = p.phase; pedAnim[i * 4 + 1] = (1 - p.cheer) * p.speed / 1.4; pedAnim[i * 4 + 2] = p.cheer; pedAnim[i * 4 + 3] = p.flashT > 0 ? 1 : 0;
      }
      pedMesh.instanceMatrix.needsUpdate = true; animAttr.needsUpdate = true;
      shoutCool -= dt; shutterCool -= dt;
      if (cheering >= 3 && shoutCool <= 0) { out.shout = SHOUTS[Math.floor(Math.random() * SHOUTS.length)]; shoutCool = r.range(7, 12); }
      // pigeons: scatter when he comes close, then settle somewhere else nearby
      for (const f of flocks) {
        const i0 = f.i0;
        if (f.state === 'perched') {
          const dx = birdP[i0 * 3] - heroHip.x, dy = birdP[i0 * 3 + 1] - heroHip.y, dz = birdP[i0 * 3 + 2] - heroHip.z;
          if (dx * dx + dy * dy + dz * dz < 22 * 22) {
            f.state = 'flying'; f.t = 0;
            for (let k = 0; k < PER; k++) { const i = i0 + k, a = r.range(0, 6.28); birdV[i * 3] = Math.cos(a) * r.range(4, 9) - dx * 0.1; birdV[i * 3 + 1] = r.range(5, 9); birdV[i * 3 + 2] = Math.sin(a) * r.range(4, 9) - dz * 0.1; }
            out.sounds.push('flutter');
          } else if (dx * dx + dz * dz > 260 * 260) perchFlock(f, heroHip);
        } else {
          f.t += dt;
          for (let k = 0; k < PER; k++) {
            const i = i0 + k;
            birdV[i * 3 + 1] = U.lerp(birdV[i * 3 + 1], 2.5, dt * 0.5);
            birdV[i * 3] += Math.sin(time * 1.3 + k) * dt * 3; birdV[i * 3 + 2] += Math.cos(time * 1.1 + k) * dt * 3;
            birdP[i * 3] += birdV[i * 3] * dt; birdP[i * 3 + 1] += birdV[i * 3 + 1] * dt; birdP[i * 3 + 2] += birdV[i * 3 + 2] * dt;
          }
          if (f.t > 9) perchFlock(f, heroHip);
        }
        for (let k = 0; k < PER; k++) {
          const i = i0 + k, flying = f.state === 'flying';
          const yaw = flying ? Math.atan2(birdV[i * 3], birdV[i * 3 + 2]) : birdPh[i];
          q.setFromAxisAngle(Y, yaw);
          m4.compose(v1.set(birdP[i * 3], birdP[i * 3 + 1] + (flying ? 0 : 0.12), birdP[i * 3 + 2]), q, v2.set(1.4, 1.4, 1.4));
          birdMesh.setMatrixAt(i, m4);
          birdAttr[i * 2] = birdPh[i]; birdAttr[i * 2 + 1] = flying ? 1 : 0;
        }
      }
      birdMesh.instanceMatrix.needsUpdate = true; birdAttrB.needsUpdate = true;
      // steam
      for (const v of vents) {
        if (Math.abs(v.x - hx) > 260 || Math.abs(v.z - hz) > 260) continue;
        v.t += dt;
        if (v.t > v.rate) { v.t = 0; emit(v.x + r.range(-0.6, 0.6), v.y, v.z + r.range(-0.6, 0.6), r.range(-0.3, 0.3) + 0.6, r.range(1.6, 2.6), r.range(-0.3, 0.3), 1.2, 6, 0.32, 0, r.range(2.6, 3.6)); }
      }
      for (let i = 0; i < NPUFF; i++) {
        const p = puffs[i];
        if (p.kind === 2) { p.x += p.vx * dt; if (p.x > 3400) p.x = -3400; }
        else if (p.life < p.max) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 1 - dt * 0.6; p.vz *= 1 - dt * 0.6; if (p.kind === 1) p.vy -= dt * 0.8; }
        const k = p.kind === 2 ? 0.5 : Math.min(1, p.life / p.max);
        puffA[i * 4] = p.x; puffA[i * 4 + 1] = p.y; puffA[i * 4 + 2] = p.z; puffA[i * 4 + 3] = U.lerp(p.s0, p.s1, Math.sqrt(k));
        puffB[i * 3] = p.kind === 2 ? p.a : p.life < p.max ? p.a * Math.sin(Math.PI * Math.min(1, k * 1.15)) : 0; puffB[i * 3 + 1] = p.kind; puffB[i * 3 + 2] = p.seed;
      }
      puffAttrA.needsUpdate = true; puffAttrB.needsUpdate = true;
      // the chopper circles the Bugle, or hangs over a point it is told to film
      const bt = world.bugleTop;
      heli.ang += dt * 0.12;
      const goal = heli.aimAt ? v2.set(heli.aimAt.x + 60, heli.aimAt.y + 55, heli.aimAt.z + 40) : v2.set(bt.x + Math.cos(heli.ang) * 170, 285, bt.z + Math.sin(heli.ang) * 170);
      chopper.position.lerp(goal, 1 - Math.exp(-0.6 * dt));
      const look = heli.aimAt || bt;
      chopper.rotation.set(0.08, Math.atan2(look.x - chopper.position.x, look.z - chopper.position.z), 0.04 * Math.sin(time * 0.7));
      rotor.rotation.y = time * 38;
      m4.makeRotationY(0); rotor.setMatrixAt(0, m4); m4.makeRotationY(Math.PI / 2); rotor.setMatrixAt(1, m4); rotor.instanceMatrix.needsUpdate = true;
      const hd = chopper.position.distanceTo(heroHip);
      out.rotorLevel = U.clamp(1 - hd / 420, 0, 1);
      out.cityLevel = U.clamp(1 - heroHip.y / 140, 0.15, 1);
      // horns now and then, a siren far off
      hornCool -= dt; sirenT -= dt;
      if (hornCool <= 0) { hornCool = r.range(5, 12); if (heroHip.y < 60) out.sounds.push('horn'); }
      if (sirenT <= 0) { sirenT = r.range(30, 55); out.sounds.push('siren'); }
      return out;
    }

    /** A burst of dust where he lands hard. */
    function dust(x, y, z, k) {
      const n = Math.round(6 + 10 * k);
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; emit(x + Math.cos(a) * 0.3, y + 0.2, z + Math.sin(a) * 0.3, Math.cos(a) * (3 + 4 * k), 0.6 + Math.random(), Math.sin(a) * (3 + 4 * k), 0.6, 2.6 + 2 * k, 0.45, 1, 0.9 + Math.random() * 0.4); }
    }

    function dispose() {
      [carMesh, pedMesh, birdMesh, puffMesh, chopper].forEach((o) => scene.remove(o));
      disposables.forEach((d) => d.dispose());
    }

    return { update, dust, dispose, heli };
  }

  SMR.createLife = createLife;
})();
