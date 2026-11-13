/* Chapter one's city: Midtown at first light, laid out as a grid of blocks around the start.
   Buildings are axis-aligned boxes, which keeps collision, rope anchors and the camera's line
   of sight simple and fast. They are drawn with the same sky and building shaders as the menu,
   as one instanced mesh, so the whole skyline costs a handful of draw calls. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const PITCH = 74, STREET = 18, LOT = PITCH - STREET; // metres: block spacing, street width, block size
  const SPAN = 12;                                     // blocks each side of the start
  const ORIGIN = -(SPAN + 1.5) * PITCH;                // corner of the collision grid
  const CELLS = 2 * SPAN + 3;
  const BUGLE = [4, -7];                               // the Daily Bugle's block

  const GROUND_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uRoad, uWalk, uLine;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vWorld;
    void main() {
      vec2 q = mod(vWorld.xz + ${PITCH.toFixed(1)} * 0.5, ${PITCH.toFixed(1)}) - ${PITCH.toFixed(1)} * 0.5;
      vec2 a = abs(q);
      float px = fwidth(vWorld.x) + fwidth(vWorld.z);
      float walk = 1.0 - smoothstep(${(LOT / 2 + 3.5).toFixed(1)} - px, ${(LOT / 2 + 3.5).toFixed(1)} + px, max(a.x, a.y));
      vec3 col = mix(uRoad, uWalk, walk);
      // kerb edge, then dashed centre lines down the middle of every street
      col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.25 + px, abs(max(a.x, a.y) - ${(LOT / 2 + 3.5).toFixed(1)})));
      float cx = abs(a.x - ${(PITCH / 2).toFixed(1)}), cz = abs(a.y - ${(PITCH / 2).toFixed(1)});
      float dashZ = step(0.5, fract(vWorld.z / 7.0)) * (1.0 - smoothstep(0.12, 0.12 + px, cx)) * step(${(LOT / 2 + 4).toFixed(1)}, a.y);
      float dashX = step(0.5, fract(vWorld.x / 7.0)) * (1.0 - smoothstep(0.12, 0.12 + px, cz)) * step(${(LOT / 2 + 4).toFixed(1)}, a.x);
      col = mix(col, uLine, max(dashZ, dashX) * (1.0 - walk) * (1.0 - smoothstep(0.5, 3.0, px)));
      gl_FragColor = vec4(grain(applyFog(col, vWorld)), 1.0);
    }`;

  const SIGN_VS = `
    varying vec2 vUv; varying vec3 vWorld;
    void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
  const SIGN_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform sampler2D uMap;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec2 vUv; varying vec3 vWorld;
    void main() {
      vec4 t = texture2D(uMap, vUv);
      float flick = 0.92 + 0.08 * sin(uTime * 23.0) * step(0.97, fract(uTime * 0.13));
      gl_FragColor = vec4(grain(applyFog(t.rgb * flick, vWorld)), 1.0);
    }`;

  function signTexture() {
    const c = U.makeCanvas(1024, 224), g = c.getContext('2d');
    g.fillStyle = '#f2ece0'; g.fillRect(0, 0, 1024, 224);
    g.fillStyle = '#b5121f'; g.fillRect(0, 0, 1024, 30); g.fillRect(0, 194, 1024, 30);
    g.fillStyle = '#16121a';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 120px Spinneret, Impact, sans-serif';
    g.fillText('THE DAILY BUGLE', 512, 116);
    const t = new T.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  function createWorld(scene, shared, renderer) {
    const S = SMR.shaders;
    const r = U.rng(19620801);
    const solids = [];   // x0, y0, z0, x1, y1, z1 per building part (what the hero can touch)
    const boxes = [];    // what gets drawn: centre, size and shader info
    const tanks = [];
    const tops = [];     // flat roofs worth landing on: [x0, z0, x1, z1, y]

    function addBox(x0, y0, z0, x1, y1, z1, info, solid) {
      boxes.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, info[0], info[1], info[2]]);
      if (solid !== false) solids.push([x0, y0, z0, x1, y1, z1]);
    }

    function roofProps(x0, z0, x1, z1, y, seed) {
      const w = x1 - x0, d = z1 - z0;
      if (w < 14 || d < 14) return;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const ax = r.range(x0 + 3, x1 - 6), az = r.range(z0 + 3, z1 - 6), aw = r.range(2, 4.5), ad = r.range(2, 4.5);
        addBox(ax, y, az, ax + aw, y + r.range(1.2, 2.6), az + ad, [seed + i * 0.13, 1, 0]);
      }
      if (r() < 0.45 && y < 150) {
        const tx = r.range(x0 + 5, x1 - 5), tz = r.range(z0 + 5, z1 - 5), tr = r.range(2.2, 3.2);
        addBox(tx - tr * 0.8, y, tz - tr * 0.8, tx + tr * 0.8, y + 3, tz + tr * 0.8, [seed + 0.5, 1, 0]); // the stand
        tanks.push([tx, y + 3, tz, tr, r.range(3.6, 5)]);
        solids.push([tx - tr, y + 3, tz - tr, tx + tr, y + 8.5, tz + tr]);
      }
    }

    // a building, maybe stepped back in tiers the way old Midtown towers are
    function building(x0, z0, x1, z1, h, seed, lit) {
      const tiers = h > 95 && r() < 0.7 ? (h > 170 ? 3 : 2) : 1;
      let y = 0;
      for (let t = 0; t < tiers; t++) {
        const top = t === tiers - 1 ? h : h * (t === 0 ? r.range(0.5, 0.66) : r.range(0.78, 0.88));
        addBox(x0, y, z0, x1, top, z1, [seed + t * 0.37, 0, lit]);
        const ins = t === tiers - 1 ? 0 : r.range(3, 7);
        if (t < tiers - 1) {
          tops.push([x0, z0, x1, z1, top]);
          x0 += ins; z0 += ins; x1 -= ins; z1 -= ins;
        }
        y = top;
      }
      tops.push([x0, z0, x1, z1, h]);
      roofProps(x0, z0, x1, z1, h, seed);
      if (h > 150 && r() < 0.6) addBox((x0 + x1) / 2 - 0.6, h, (z0 + z1) / 2 - 0.6, (x0 + x1) / 2 + 0.6, h + r.range(14, 30), (z0 + z1) / 2 + 0.6, [seed, 1, 0]);
    }

    for (let bi = -SPAN; bi <= SPAN; bi++) for (let bj = -SPAN; bj <= SPAN; bj++) {
      const cx = bi * PITCH, cz = bj * PITCH;
      const x0 = cx - LOT / 2, z0 = cz - LOT / 2, x1 = cx + LOT / 2, z1 = cz + LOT / 2;
      const seed = r() * 1000;
      const lit = r.range(0.14, 0.34);
      if (bi === 0 && bj === 0) { // the start: a plain mid-height roof with room to run
        building(x0 + 2, z0 + 2, x1 - 2, z1 - 2, 46, seed, lit);
        continue;
      }
      if (bi === BUGLE[0] && bj === BUGLE[1]) continue; // built below
      // taller toward Midtown's heart, which sits a few blocks toward the Bugle
      const d = Math.hypot(bi - 2, bj + 3) / SPAN;
      const base = U.lerp(150, 26, U.smooth(U.clamp(d, 0, 1))) * (0.75 + 0.5 * U.noise1(bi * 0.37 + bj * 0.71 + 3.3));
      const k = r();
      if (k < 0.05 && Math.abs(bi) + Math.abs(bj) > 2) { // a low plaza
        building(x0 + 6, z0 + 6, x1 - 6, z1 - 6, r.range(8, 14), seed, lit);
      } else if (k < 0.4) {
        building(x0 + r.range(1, 3), z0 + r.range(1, 3), x1 - r.range(1, 3), z1 - r.range(1, 3), U.clamp(base * r.range(0.7, 1.4), 16, 245), seed, lit);
      } else if (k < 0.72) {
        const along = r() < 0.5, m = r.range(0.38, 0.62), gap = 1.5;
        if (along) {
          const xm = U.lerp(x0, x1, m);
          building(x0 + 1, z0 + 1, xm - gap, z1 - 1, U.clamp(base * r.range(0.55, 1.35), 14, 230), seed, lit);
          building(xm + gap, z0 + 1, x1 - 1, z1 - 1, U.clamp(base * r.range(0.55, 1.35), 14, 230), seed + 7, lit);
        } else {
          const zm = U.lerp(z0, z1, m);
          building(x0 + 1, z0 + 1, x1 - 1, zm - gap, U.clamp(base * r.range(0.55, 1.35), 14, 230), seed, lit);
          building(x0 + 1, zm + gap, x1 - 1, z1 - 1, U.clamp(base * r.range(0.55, 1.35), 14, 230), seed + 7, lit);
        }
      } else {
        const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, gap = 1.2;
        building(x0 + 1, z0 + 1, xm - gap, zm - gap, U.clamp(base * r.range(0.4, 1.2), 12, 200), seed, lit);
        building(xm + gap, z0 + 1, x1 - 1, zm - gap, U.clamp(base * r.range(0.4, 1.2), 12, 200), seed + 3, lit);
        building(x0 + 1, zm + gap, xm - gap, z1 - 1, U.clamp(base * r.range(0.4, 1.2), 12, 200), seed + 5, lit);
        building(xm + gap, zm + gap, x1 - 1, z1 - 1, U.clamp(base * r.range(0.4, 1.2), 12, 200), seed + 9, lit);
      }
    }

    // the Daily Bugle: a stepped tower with its sign on the roof
    const bx = BUGLE[0] * PITCH, bz = BUGLE[1] * PITCH;
    addBox(bx - 26, 0, bz - 26, bx + 26, 120, bz + 26, [41.3, 0, 0.3]);
    addBox(bx - 20, 120, bz - 20, bx + 20, 178, bz + 20, [41.7, 0, 0.3]);
    addBox(bx - 15, 178, bz - 15, bx + 15, 212, bz + 15, [42.1, 0, 0.3]);
    tops.push([bx - 26, bz - 26, bx + 26, bz + 26, 120], [bx - 20, bz - 20, bx + 20, bz + 20, 178], [bx - 15, bz - 15, bx + 15, bz + 15, 212]);
    addBox(bx - 0.8, 212, bz - 0.8, bx + 0.8, 262, bz + 0.8, [42.4, 1, 0]); // mast
    addBox(bx - 14, 212, bz + 6, bx - 12.6, 219, bz + 7.4, [42.5, 1, 0]); // sign posts
    addBox(bx + 12.6, 212, bz + 6, bx + 14, 219, bz + 7.4, [42.5, 1, 0]);
    const bugleTop = new T.Vector3(bx, 212, bz);

    /* ---------- drawing ---------- */
    const cityU = Object.assign({
      uWallA: { value: new T.Vector3() }, uWallB: { value: new T.Vector3() }, uRimC: { value: new T.Vector3() }, uFillC: { value: new T.Vector3() },
      uWin0: { value: new T.Vector3() }, uWin1: { value: new T.Vector3() }, uWin2: { value: new T.Vector3() }, uTime: shared.timeU, uGrain: shared.grainU,
    }, shared.fogU);
    const cityMat = new T.ShaderMaterial({ vertexShader: S.CITY_VS, fragmentShader: S.CITY_FS, uniforms: cityU });

    const boxGeo = new T.BoxGeometry(1, 1, 1);
    const city = new T.InstancedMesh(boxGeo, cityMat, boxes.length);
    const info = new Float32Array(boxes.length * 4);
    const m4 = new T.Matrix4(), qI = new T.Quaternion(), v1 = new T.Vector3(), v2 = new T.Vector3();
    function writeBoxes(order) {
      order.forEach((b, i) => {
        m4.compose(v1.set(b[0], b[1], b[2]), qI, v2.set(b[3], b[4], b[5]));
        city.setMatrixAt(i, m4);
        info[i * 4] = b[6]; info[i * 4 + 1] = b[7]; info[i * 4 + 2] = b[8]; info[i * 4 + 3] = 0;
      });
      city.instanceMatrix.needsUpdate = true;
      infoAttr.needsUpdate = true;
    }
    const infoAttr = new T.InstancedBufferAttribute(info, 4);
    boxGeo.setAttribute('aInfo', infoAttr);
    writeBoxes(boxes);
    city.frustumCulled = false;
    scene.add(city);

    // water tanks: an open cylinder with a cone hat
    const tankGeo = (() => {
      const body = new T.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
      const hat = new T.ConeGeometry(1.08, 0.45, 10, 1, true).translate(0, 1.2, 0);
      const pos = [...body.toNonIndexed().attributes.position.array, ...hat.toNonIndexed().attributes.position.array];
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return g;
    })();
    const tankInfo = new Float32Array(Math.max(1, tanks.length) * 4);
    tankGeo.setAttribute('aInfo', new T.InstancedBufferAttribute(tankInfo, 4));
    const tankMesh = new T.InstancedMesh(tankGeo, cityMat, Math.max(1, tanks.length));
    tanks.forEach((t, i) => {
      m4.compose(v1.set(t[0], t[1], t[2]), qI, v2.set(t[3], t[4], t[3]));
      tankMesh.setMatrixAt(i, m4);
      tankInfo[i * 4] = 77.7 + i; tankInfo[i * 4 + 1] = 1;
    });
    tankMesh.frustumCulled = false;
    scene.add(tankMesh);

    // streets
    const groundMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: GROUND_FS(S),
      uniforms: Object.assign({ uRoad: { value: new T.Vector3() }, uWalk: { value: new T.Vector3() }, uLine: { value: new T.Vector3() }, uTime: shared.timeU, uGrain: shared.grainU }, shared.fogU),
    });
    const ground = new T.Mesh(new T.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), groundMat);
    ground.frustumCulled = false;
    scene.add(ground);

    // the Bugle's sign, readable from both sides
    const signMat = new T.ShaderMaterial({
      vertexShader: SIGN_VS, fragmentShader: SIGN_FS(S), side: T.DoubleSide,
      uniforms: Object.assign({ uMap: { value: signTexture() }, uTime: shared.timeU, uGrain: shared.grainU }, shared.fogU),
    });
    const sign = new T.Mesh(new T.PlaneGeometry(30, 6.6), signMat);
    sign.position.set(bx, 222.5, bz + 6.7);
    scene.add(sign);
    if (document.fonts && document.fonts.load) document.fonts.load('900 1rem Spinneret').then(() => { signMat.uniforms.uMap.value.dispose(); signMat.uniforms.uMap.value = signTexture(); }).catch(() => {});

    // sky dome
    const skyMat = new T.ShaderMaterial({
      vertexShader: S.SKY_VS, fragmentShader: S.SKY_FS, side: T.BackSide, depthTest: true, depthWrite: false,
      uniforms: {
        uLut: { value: shared.lut }, uSunDir: { value: shared.sunDir }, uCore: { value: new T.Vector3() }, uMid: { value: new T.Vector3() },
        uEdge: { value: new T.Vector3() }, uSunGlow: { value: new T.Vector3() }, uHalo: { value: new T.Vector3() },
        uRays: { value: new T.Vector4() }, uSunPx: { value: new T.Vector2() }, uSunRpx: { value: 200 },
        uTime: shared.timeU, uStars: { value: 1 }, uMotion: { value: 1 }, uGrain: shared.grainU,
      },
    });
    const sky = new T.Mesh(new T.SphereGeometry(1, 24, 16), skyMat);
    sky.frustumCulled = false; sky.renderOrder = 10; sky.scale.setScalar(4000);
    scene.add(sky);

    function applyPalette(pal, color) {
      const g = shared.lut.image.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 256, 0);
      pal.sky.forEach(([stop, c]) => grad.addColorStop(stop, c));
      g.fillStyle = grad; g.fillRect(0, 0, 256, 2);
      shared.lut.needsUpdate = true;
      const su = skyMat.uniforms;
      su.uCore.value.copy(color(pal.orb.core)); su.uMid.value.copy(color(pal.orb.mid)); su.uEdge.value.copy(color(pal.orb.edge));
      su.uSunGlow.value.copy(color(pal.orb.glow)); su.uHalo.value.copy(color(pal.orb.halo));
      su.uRays.value.set(pal.rays[0] / 255, pal.rays[1] / 255, pal.rays[2] / 255, pal.rays[3]);
      su.uStars.value = pal.stars;
      cityU.uWallA.value.copy(color(U.mix(pal.near[0], pal.mid[0], 0.35)));
      cityU.uWallB.value.copy(color(U.mix(pal.near[0], pal.mid[1], 0.55)));
      cityU.uRimC.value.copy(color(pal.rim)); cityU.uFillC.value.copy(color(pal.fill));
      cityU.uWin0.value.copy(color(pal.windows[0])); cityU.uWin1.value.copy(color(pal.windows[2])); cityU.uWin2.value.copy(color(pal.windows[4]));
      groundMat.uniforms.uRoad.value.copy(color(U.mix(pal.front, pal.near[0], 0.5)));
      groundMat.uniforms.uWalk.value.copy(color(U.mix(pal.near[0], pal.mid[0], 0.45)));
      groundMat.uniforms.uLine.value.copy(color(U.mix(pal.windows[0], pal.near[1], 0.4)));
    }

    // Each frame: the sun's place on screen for the sky shader, and (now and then) the
    // buildings re-sorted nearest-first so hidden walls are skipped early.
    let sortedAt = new T.Vector3(1e9, 0, 0);
    const sp = new T.Vector3();
    function update(camera, pxW, pxH, glScale) {
      sky.position.copy(camera.position);
      sp.copy(shared.sunDir).multiplyScalar(3000).add(camera.position).project(camera);
      skyMat.uniforms.uSunPx.value.set((sp.x * 0.5 + 0.5) * pxW, (sp.y * 0.5 + 0.5) * pxH);
      skyMat.uniforms.uSunRpx.value = 70 * glScale * (60 / camera.fov);
      if (sortedAt.distanceToSquared(camera.position) > 60 * 60) {
        sortedAt.copy(camera.position);
        const c = camera.position;
        const order = boxes.slice().sort((a, b) => ((a[0] - c.x) ** 2 + (a[2] - c.z) ** 2) - ((b[0] - c.x) ** 2 + (b[2] - c.z) ** 2));
        writeBoxes(order);
      }
    }

    /* ---------- collision ---------- */
    const grid = Array.from({ length: CELLS * CELLS }, () => []);
    const cellOf = (x) => Math.max(0, Math.min(CELLS - 1, Math.floor((x - ORIGIN) / PITCH)));
    solids.forEach((s, i) => {
      for (let cx = cellOf(s[0]); cx <= cellOf(s[3]); cx++) for (let cz = cellOf(s[2]); cz <= cellOf(s[5]); cz++) grid[cx + cz * CELLS].push(i);
    });
    const stamp = new Uint32Array(solids.length);
    let stampN = 1;

    /** Calls fn(box) once for every solid near the footprint [x0, x1] × [z0, z1]. */
    function near(x0, z0, x1, z1, fn) {
      stampN++;
      for (let cx = cellOf(x0); cx <= cellOf(x1); cx++) for (let cz = cellOf(z0); cz <= cellOf(z1); cz++) {
        const list = grid[cx + cz * CELLS];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (stamp[i] === stampN) continue;
          stamp[i] = stampN;
          if (fn(solids[i], i) === false) return;
        }
      }
    }

    /**
     * Pushes a standing box (feet at p, half width hw, height h) out of the buildings.
     * Returns what it touched: ground (standing on something) and the last wall's normal.
     */
    const hit = { ground: false, wall: false, nx: 0, nz: 0, top: 0, roofY: 0 };
    function collide(p, v, hw, h) {
      hit.ground = false; hit.wall = false; hit.nx = 0; hit.nz = 0;
      near(p.x - hw, p.z - hw, p.x + hw, p.z + hw, (s) => {
        if (p.x + hw <= s[0] || p.x - hw >= s[3] || p.z + hw <= s[2] || p.z - hw >= s[5] || p.y >= s[4] || p.y + h <= s[1]) return;
        const ox = Math.min(p.x + hw - s[0], s[3] - (p.x - hw)), oz = Math.min(p.z + hw - s[2], s[5] - (p.z - hw));
        const up = s[4] - p.y;
        if (up <= Math.min(ox, oz) + 0.05 || up < 0.55) { // on top (or a small step up)
          p.y = s[4];
          if (v.y < 0) v.y = 0;
          hit.ground = true; hit.roofY = s[4];
        } else if (ox < oz) {
          const sx = p.x < (s[0] + s[3]) / 2 ? -1 : 1;
          p.x += sx * ox;
          if (v.x * sx < 0) v.x = 0;
          hit.wall = true; hit.nx = sx; hit.nz = 0; hit.top = s[4];
        } else {
          const sz = p.z < (s[2] + s[5]) / 2 ? -1 : 1;
          p.z += sz * oz;
          if (v.z * sz < 0) v.z = 0;
          hit.wall = true; hit.nx = 0; hit.nz = sz; hit.top = s[4];
        }
      });
      if (p.y <= 0) { p.y = 0; if (v.y < 0) v.y = 0; hit.ground = true; hit.roofY = 0; }
      return hit;
    }

    /** The roof height under a point, if something is there (else 0, the street). */
    function floorAt(x, z, below) {
      let y = 0;
      near(x, z, x, z, (s) => { if (x > s[0] && x < s[3] && z > s[2] && z < s[5] && s[4] <= below + 0.01 && s[4] > y) y = s[4]; });
      return y;
    }

    /** Nearest hit of a ray against the buildings and the street, or null. */
    const ray = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, box: -1 };
    function raycast(ox, oy, oz, dx, dy, dz, maxT) {
      let best = maxT, found = false;
      if (dy < -1e-6) { const t = -oy / dy; if (t > 0 && t < best) { best = t; found = true; ray.nx = 0; ray.ny = 1; ray.nz = 0; ray.box = -1; } }
      const ex = ox + dx * maxT, ez = oz + dz * maxT;
      near(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), (s, i) => {
        let t0 = 0, t1 = best, n = -1, sgn = 0;
        for (let a = 0; a < 3; a++) {
          const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz;
          const lo = s[a], hi = s[a + 3];
          if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return; continue; }
          let ta = (lo - o) / d, tb = (hi - o) / d, sg = -1;
          if (ta > tb) { const q = ta; ta = tb; tb = q; sg = 1; }
          if (ta > t0) { t0 = ta; n = a; sgn = sg; }
          if (tb < t1) t1 = tb;
          if (t0 > t1) return;
        }
        if (n < 0 || t0 >= best) return;
        best = t0; found = true; ray.box = i;
        ray.nx = n === 0 ? sgn : 0; ray.ny = n === 1 ? sgn : 0; ray.nz = n === 2 ? sgn : 0;
      });
      if (!found) return null;
      ray.t = best; ray.x = ox + dx * best; ray.y = oy + dy * best; ray.z = oz + dz * best;
      return ray;
    }

    /**
     * Somewhere to hang a web: a building wall or roof edge above and ahead of the hero.
     * Rays fan out forward and up; the one landing nearest a comfortable rope length wins.
     */
    const anchor = new T.Vector3();
    function findAnchor(px, py, pz, hx, hz, speed) {
      const ideal = U.clamp(26 + speed * 0.7, 26, 48);
      let bestScore = -1e9, ok = false;
      const yaw0 = Math.atan2(hx, hz);
      for (const el of [0.62, 0.82, 1.02, 1.2]) for (const az of [0, -0.32, 0.32, -0.62, 0.62]) {
        const yaw = yaw0 + az, c = Math.cos(el);
        const dx = Math.sin(yaw) * c, dy = Math.sin(el), dz = Math.cos(yaw) * c;
        const h = raycast(px, py, pz, dx, dy, dz, 90);
        if (!h || h.box < 0 || h.y < py + 8) continue;
        const score = -Math.abs(h.t - ideal) - Math.abs(az) * 14 - Math.abs(el - 0.9) * 8;
        if (score > bestScore) { bestScore = score; ok = true; anchor.set(h.x - h.nx * 0.05, h.y, h.z - h.nz * 0.05); }
      }
      return ok ? anchor : null;
    }

    /**
     * Where a web-zip along the camera's aim should end: the top edge of the wall it meets,
     * or the spot on a roof. Returns { point, edge } or null.
     */
    const perch = { point: new T.Vector3(), edge: false, nx: 0, nz: 0 };
    function findPerch(ox, oy, oz, dx, dy, dz) {
      const h = raycast(ox, oy, oz, dx, dy, dz, 95);
      if (!h || h.box < 0) return null;
      const s = solids[h.box];
      if (h.ny > 0.5) { perch.point.set(h.x, h.y, h.z); perch.edge = false; return perch; }
      if (s[4] - h.y < 55) { // close enough to the top: land on the edge
        perch.point.set(h.x - h.nx * 0.7, s[4], h.z - h.nz * 0.7);
        perch.edge = true; perch.nx = h.nx; perch.nz = h.nz;
      } else {
        perch.point.set(h.x + h.nx * 0.3, h.y - 1, h.z + h.nz * 0.3);
        perch.edge = false; perch.nx = h.nx; perch.nz = h.nz;
      }
      return perch;
    }

    function dispose() {
      [boxGeo, tankGeo, ground.geometry, sky.geometry, sign.geometry].forEach((g) => g.dispose());
      [cityMat, groundMat, skyMat, signMat].forEach((m) => m.dispose());
      signMat.uniforms.uMap.value.dispose();
    }

    return {
      PITCH, LOT, SPAN, bugleTop, tops, solids, cityU, groundMat,
      applyPalette, update, collide, floorAt, raycast, findAnchor, findPerch, near, dispose,
      start: new T.Vector3(0, 46, 0),
    };
  }

  SMR.createWorld = createWorld;
})();
