/* Chapter one's city: Midtown at golden hour, laid out as a grid of blocks around the start,
   with parks, tree-lined streets, two Art Deco towers, the Daily Bugle, and a river on the east
   side with a promenade, piers, boats, a far shore and a suspension bridge.

   Buildings are axis-aligned boxes, which keeps collision, rope anchors and the camera's line
   of sight simple and fast. They are drawn as one instanced mesh with a facade shader that
   gives each building a material (brick, limestone, glass, dark stone, Art Deco) and puts a
   room behind every window ("interior mapping": each window works out, per pixel, which wall,
   floor or ceiling of an imaginary room the view ray would hit), so the city has depth without
   any extra geometry. Trees, lamps and traffic lights are instanced too. */
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
  const RIVER_X = 700, WATER_Y = -1.5;                 // the river starts here, east of the last avenue
  const RIVER_BLOCK = 9;                               // blocks from here east are promenade and water
  const PARKS = [[-2, 2], [-3, 2], [3, 3], [-6, -3], [6, -2]];
  const DECO = [[-3, -6], [1, -11]];                   // the two Art Deco towers
  const MAT = { brick: 0, stone: 1, glass: 2, dark: 3, deco: 4, steel: 5 };

  // Facades: material, windows and the rooms behind them.
  const CITY_VS = `
    attribute vec4 aInfo; // seed, plain (no windows), share of lit rooms, material
    uniform vec3 uSunDir, uHazeLow, uHazeHigh, uGlow;
    uniform float uFog;
    varying vec3 vLocal, vSize, vNl, vW, vN, vFogC;
    varying vec4 vInfo;
    varying float vFogF;
    void main() {
      vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vLocal = position * sc; vSize = sc; vNl = normal; vInfo = aInfo;
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(instanceMatrix) * (normal / sc));
      vec3 ray = wp.xyz - cameraPosition;
      float dist = length(ray);
      vFogF = (1.0 - exp(-dist * uFog)) * mix(1.0, 0.68, clamp(wp.y / 420.0, 0.0, 1.0));
      float toward = pow(max(dot(ray / dist, uSunDir), 0.0), 6.0);
      vFogC = mix(mix(uHazeLow, uHazeHigh, clamp(wp.y / 320.0, 0.0, 1.0)), uGlow, toward * 0.85);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const CITY_FS = (S) => `
    precision highp float;
    uniform sampler2D uLut;
    uniform vec3 uSunDir, uSunC, uSkyC, uWin0, uWin1, uWin2;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vLocal, vSize, vNl, vW, vN, vFogC;
    varying vec4 vInfo;
    varying float vFogF;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec3 material(float m, float s) {
      if (m < 0.5) return mix(vec3(0.43, 0.21, 0.15), vec3(0.58, 0.31, 0.21), s);   // brick
      if (m < 1.5) return mix(vec3(0.66, 0.58, 0.47), vec3(0.8, 0.74, 0.62), s);    // limestone
      if (m < 2.5) return mix(vec3(0.12, 0.17, 0.23), vec3(0.2, 0.27, 0.32), s);    // glass
      if (m < 3.5) return mix(vec3(0.17, 0.16, 0.17), vec3(0.27, 0.25, 0.25), s);   // dark stone
      if (m < 4.5) return mix(vec3(0.74, 0.68, 0.57), vec3(0.66, 0.61, 0.54), s);   // Art Deco
      return vec3(0.34, 0.36, 0.4);                                                  // steel
    }
    vec3 skyAt(vec3 r) { return texture2D(uLut, vec2(clamp(0.74 - max(r.y, -0.2) * 0.85, 0.02, 0.98), 0.5)).rgb; }
    void main() {
      float seed = hash(vec2(vInfo.x, 3.7)), mat = vInfo.w;
      vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
      float sun = max(dot(N, uSunDir), 0.0);
      float ao = mix(0.5, 1.0, smoothstep(0.0, 45.0, vW.y));
      vec3 light = uSkyC * (0.42 + 0.3 * N.y) + uSunC * sun * 1.15;
      vec3 base = material(mat, seed);
      vec3 col;
      if (N.y > 0.5) { // roofs: tar and gravel
        float g = hash(floor(vW.xz * 2.0));
        col = mix(vec3(0.24, 0.23, 0.22), vec3(0.32, 0.3, 0.28), g) * light;
      } else if (vInfo.y > 0.5) { // plain parts: props, water towers, the bridge
        col = base * light * ao;
      } else {
        vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), N));
        float faceW = abs(vNl.x) > 0.5 ? vSize.z : vSize.x;
        float glass = step(1.5, mat) * step(mat, 2.5);
        vec2 bay = glass > 0.5 ? vec2(1.7, 3.6) : vec2(3.2, 3.7);
        vec2 fc = vec2(dot(vLocal, Tw) + faceW * 0.5, vW.y);
        vec2 cell = floor(fc / bay), f = fract(fc / bay);
        float store = 1.0 - step(4.6, vW.y);
        vec2 lo = glass > 0.5 ? vec2(0.05, 0.07) : vec2(0.22, 0.2), hi = glass > 0.5 ? vec2(0.95, 0.94) : vec2(0.78, 0.82);
        if (store > 0.5) { lo = vec2(0.07, 0.08); hi = vec2(0.93, 0.95); bay.y = 4.6; f.y = vW.y / 4.6; }
        float top = vW.y - vLocal.y + vSize.y * 0.5; // this part's roof line, in the world
        float inWin = step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y);
        inWin *= step(bay.x * 0.35, fc.x) * step(fc.x, faceW - bay.x * 0.35) * step(vW.y, top - 1.6);
        // the wall: floor bands, deco piers, a darker cornice under the roof line
        vec3 wall = base;
        wall *= 0.92 + 0.08 * step(0.92, f.y);
        if (mat > 3.5 && mat < 4.5) wall *= 0.86 + 0.18 * step(0.42, abs(f.x - 0.5));
        wall *= 1.0 - 0.22 * step(top - 1.1, vW.y) + 0.12 * step(top - 1.6, vW.y) * step(vW.y, top - 1.1);
        col = wall * light * ao;
        float detail = 1.0 - smoothstep(0.18, 0.5, fwidth(fc.x) / bay.x);
        float lit = step(hash(cell * 1.31 + vInfo.x * 7.1), vInfo.z + store * 0.5);
        vec3 wc = mix(uWin0, uWin1, hash(cell + 2.2));
        if (inWin > 0.5 && detail > 0.01) {
          // interior mapping: the room behind this window, in bay units (x across, y up, z inward)
          vec3 rd = vec3(dot(V, Tw) / bay.x, V.y / bay.y, dot(V, -N) / bay.x);
          vec3 ro = vec3(f.x, f.y, 0.0);
          float depth = store > 0.5 ? 1.6 : 1.1;
          float tx = ((rd.x > 0.0 ? 1.0 : 0.0) - ro.x) / rd.x;
          float ty = ((rd.y > 0.0 ? 1.0 : 0.0) - ro.y) / rd.y;
          float tz = depth / max(rd.z, 1e-4);
          float t = min(min(tx, ty), tz);
          vec3 hp = ro + rd * t;
          float hr = hash(cell + vInfo.x * 3.3);
          vec3 wallIn = mix(vec3(0.78, 0.72, 0.62), mix(vec3(0.56, 0.62, 0.68), vec3(0.7, 0.55, 0.48), step(0.5, hash(cell + 5.1))), hr * 0.8);
          vec3 c;
          if (t == ty) c = rd.y > 0.0 ? vec3(0.86, 0.84, 0.8) : mix(vec3(0.32, 0.22, 0.16), vec3(0.4, 0.38, 0.36), hash(cell + 8.8));
          else if (t == tx) c = wallIn * 0.82;
          else c = wallIn;
          // furniture: a dark block on the floor against the back wall, sometimes a desk lamp glow
          float furn = step(t, tz + 0.001) * step(hp.y, 0.38) * step(0.35, hash(cell + 6.6)) * step(abs(hp.x - 0.3 - 0.4 * hash(cell + 1.9)), 0.22);
          c = mix(c, vec3(0.12, 0.1, 0.09), furn);
          c *= mix(1.0, 0.5, clamp(hp.z / depth, 0.0, 1.0));
          // light: lit rooms glow warm from the ceiling; dark rooms show the dusk
          float ceilGlow = 0.65 + 0.55 * clamp(hp.y, 0.0, 1.0);
          c *= lit > 0.5 ? wc * 1.35 * ceilGlow : vec3(0.1, 0.11, 0.14) + skyAt(vec3(0.0, 0.2, 0.0)) * 0.08;
          // blinds in some windows
          float blinds = step(0.72, hash(cell + 9.1)) * step(1.0 - 0.6 * hash(cell + 4.4), f.y);
          c = mix(c, (lit > 0.5 ? wc * 0.9 : vec3(0.28, 0.27, 0.26)) * (0.85 + 0.15 * step(0.5, fract(f.y * 30.0))), blinds);
          // the glass itself: the sky in reflection, stronger at grazing angles and on glass towers
          vec3 R = reflect(V, N);
          float fres = pow(1.0 - abs(dot(V, N)), 3.0);
          float rk = glass > 0.5 ? mix(0.35, 0.92, fres) : mix(0.12, 0.6, fres);
          c = mix(c, skyAt(R) * (0.75 + 0.5 * sun), rk * (lit > 0.5 ? 0.7 : 1.0));
          c += uSunC * pow(max(dot(R, uSunDir), 0.0), 60.0) * 1.5 * glass;
          col = mix(col, c, detail);
        }
        // far away, windows blend into an even glow
        float share = (hi.x - lo.x) * (hi.y - lo.y);
        col = mix(col, mix(col, mix(base * light * 0.45, wc * 0.8, vInfo.z) + skyAt(reflect(V, N)) * 0.25 * glass, share), (1.0 - detail) * (1.0 - store));
      }
      gl_FragColor = vec4(grain(mix(col, vFogC, vFogF)), 1.0);
    }`;

  const GROUND_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uRoad, uWalk, uLine, uGrass;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 q = mod(vWorld.xz + ${PITCH.toFixed(1)} * 0.5, ${PITCH.toFixed(1)}) - ${PITCH.toFixed(1)} * 0.5;
      vec2 a = abs(q);
      float px = fwidth(vWorld.x) + fwidth(vWorld.z);
      float edge = ${(LOT / 2 + 3.5).toFixed(1)};
      float walk = 1.0 - smoothstep(edge - px, edge + px, max(a.x, a.y));
      vec3 col = mix(uRoad * (0.92 + 0.08 * hash(floor(vWorld.xz * 0.5))), uWalk, walk);
      // paving slabs on the sidewalks
      vec2 slab = abs(fract(vWorld.xz / 1.6) - 0.5);
      col *= 1.0 - 0.08 * walk * (1.0 - smoothstep(0.0, 0.05 + px, 0.5 - max(slab.x, slab.y)));
      col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.25 + px, abs(max(a.x, a.y) - edge)));
      float cx = abs(a.x - ${(PITCH / 2).toFixed(1)}), cz = abs(a.y - ${(PITCH / 2).toFixed(1)});
      float dashZ = step(0.5, fract(vWorld.z / 7.0)) * (1.0 - smoothstep(0.12, 0.12 + px, cx)) * step(edge + 0.5, a.y);
      float dashX = step(0.5, fract(vWorld.x / 7.0)) * (1.0 - smoothstep(0.12, 0.12 + px, cz)) * step(edge + 0.5, a.x);
      // zebra crossings at the corners
      float zebraX = step(edge + 0.6, a.x) * step(a.y, edge - 0.8) * step(edge - 4.2, a.y) * step(0.5, fract(vWorld.x / 1.3));
      float zebraZ = step(edge + 0.6, a.y) * step(a.x, edge - 0.8) * step(edge - 4.2, a.x) * step(0.5, fract(vWorld.z / 1.3));
      float marks = max(max(dashZ, dashX) * (1.0 - walk), max(zebraX, zebraZ) * 0.85);
      col = mix(col, uLine, marks * (1.0 - smoothstep(0.5, 3.0, px)));
      gl_FragColor = vec4(grain(applyFog(col, vWorld)), 1.0);
    }`;

  const GRASS_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uGrass;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vWorld;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    void main() {
      float n = noise(vWorld.xz * 0.15) * 0.6 + noise(vWorld.xz * 0.9) * 0.4;
      vec3 col = uGrass * (0.8 + 0.4 * n);
      // gravel paths crossing the park
      float path = 1.0 - smoothstep(1.2, 1.6, min(abs(vWorld.x - floor(vWorld.x / ${PITCH.toFixed(1)} + 0.5) * ${PITCH.toFixed(1)}), abs(vWorld.z - floor(vWorld.z / ${PITCH.toFixed(1)} + 0.5) * ${PITCH.toFixed(1)})));
      col = mix(col, vec3(0.62, 0.55, 0.45), path);
      gl_FragColor = vec4(grain(applyFog(col, vWorld)), 1.0);
    }`;

  const WATER_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform sampler2D uLut;
    uniform vec3 uSunC, uDeep;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vWorld;
    void main() {
      vec2 p = vWorld.xz;
      vec2 g = vec2(cos(p.x * 0.11 + uTime * 0.9), sin(p.y * 0.13 - uTime * 0.7)) * 0.05;
      g += vec2(cos((p.x + p.y) * 0.37 + uTime * 1.7), cos((p.x - p.y) * 0.31 - uTime * 1.3)) * 0.035;
      g += vec2(sin(p.x * 1.3 + uTime * 2.9 + sin(p.y * 0.7)), cos(p.y * 1.1 - uTime * 2.3 + sin(p.x * 0.6))) * 0.014;
      g *= 1.0 - smoothstep(300.0, 1400.0, length(vWorld - cameraPosition)) * 0.7;
      vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
      vec3 V = normalize(vWorld - cameraPosition);
      vec3 R = reflect(V, N);
      vec3 sky = texture2D(uLut, vec2(clamp(0.74 - max(R.y, 0.0) * 0.85, 0.02, 0.98), 0.5)).rgb;
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 6.0);
      vec3 c = mix(uDeep, sky * 0.78, fres * 0.85);
      c += uSunC * pow(max(dot(R, uSunDir), 0.0), 240.0) * 4.0;
      c += uSunC * pow(max(dot(R, uSunDir), 0.0), 18.0) * 0.18;
      gl_FragColor = vec4(grain(applyFog(c, vWorld)), 1.0);
    }`;

  // trees, lamps and traffic lights: instanced props with a little sway and their own lights
  const PROP_VS = `
    attribute vec3 aColor;
    attribute float aKind;  // 0 wood/metal, 1 leaves, 2 warm lamp, 3 red light, 4 green light
    uniform float uTime;
    varying vec3 vC, vN, vW;
    varying float vK, vOn;
    void main() {
      vec3 p = position;
      vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float ph = base.x * 0.13 + base.z * 0.07;
      if (aKind > 0.5 && aKind < 1.5) p.x += sin(uTime * 1.3 + ph) * 0.12 * max(p.y - 2.0, 0.0) * 0.25;
      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vC = aColor; vK = aKind; vW = wp.xyz;
      float cyc = fract(uTime / 24.0 + fract(ph * 3.7));
      vOn = aKind > 3.5 ? step(cyc, 0.5) : aKind > 2.5 ? step(0.5, cyc) : 1.0;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const PROP_FS = (S) => `
    precision highp float;
    ${S.FOG_GLSL}
    uniform vec3 uSunC, uSkyC;
    uniform float uTime;
    ${S.GRAIN_GLSL}
    varying vec3 vC, vN, vW;
    varying float vK, vOn;
    float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
    void main() {
      vec3 N = normalize(vN);
      vec3 light = uSkyC * (0.45 + 0.3 * N.y) + uSunC * max(dot(N, uSunDir), 0.0);
      vec3 c;
      if (vK < 0.5) c = vec3(0.22, 0.2, 0.19) * light;
      else if (vK < 1.5) {
        vec3 V = normalize(vW - cameraPosition);
        float wrap = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        float through = pow(max(dot(V, uSunDir), 0.0), 4.0) * 0.9;
        c = vC * (0.78 + 0.44 * hash(floor(vW * 1.6))) * (uSkyC * (0.62 + 0.25 * N.y) + uSunC * (wrap * wrap * 0.95 + through));
      }
      else if (vK < 2.5) c = vec3(1.0, 0.86, 0.6) * 1.6;
      else c = (vK < 3.5 ? vec3(1.0, 0.12, 0.08) : vec3(0.2, 1.0, 0.45)) * (0.15 + 1.6 * vOn);
      gl_FragColor = vec4(grain(applyFog(c, vW)), 1.0);
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

  /** Merge boxes and icosahedra into one geometry with a per-vertex kind. parts: [geometry, x, y, z, kind] */
  function merged(parts) {
    const geos = parts.map(([g, x, y, z, k, round]) => {
      g = g.index ? g.toNonIndexed() : g;
      if (round) { // normals point out from the blob's centre: soft, rounded shading
        const pa = g.attributes.position, na = g.attributes.normal;
        for (let i = 0; i < pa.count; i++) { const l = Math.hypot(pa.getX(i), pa.getY(i), pa.getZ(i)) || 1; na.setXYZ(i, pa.getX(i) / l, pa.getY(i) / l, pa.getZ(i) / l); }
      }
      g.translate(x, y, z);
      g.setAttribute('aKind', new T.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
      return g;
    });
    const n = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), kind = new Float32Array(n);
    let o = 0;
    for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); kind.set(g.attributes.aKind.array, o); o += g.attributes.position.count; }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('aKind', new T.BufferAttribute(kind, 1));
    return out;
  }

  function createWorld(scene, shared, renderer) {
    const S = SMR.shaders;
    const r = U.rng(19620801);
    const solids = [];   // x0, y0, z0, x1, y1, z1 per building part (what the hero can touch)
    const boxes = [];    // what gets drawn: centre, size and shader info
    const tanks = [];
    const tops = [];     // flat roofs worth landing on: [x0, z0, x1, z1, y]
    const trees = [], lamps = [], lights = [];
    const isIn = (list, i, j) => list.some((b) => b[0] === i && b[1] === j);

    function addBox(x0, y0, z0, x1, y1, z1, info, solid) {
      boxes.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, info[0], info[1], info[2], info[3] || 0]);
      if (solid !== false) solids.push([x0, y0, z0, x1, y1, z1]);
    }

    function roofProps(x0, z0, x1, z1, y, seed) {
      const w = x1 - x0, d = z1 - z0;
      if (w < 14 || d < 14) return;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const ax = r.range(x0 + 3, x1 - 6), az = r.range(z0 + 3, z1 - 6), aw = r.range(2, 4.5), ad = r.range(2, 4.5);
        addBox(ax, y, az, ax + aw, y + r.range(1.2, 2.6), az + ad, [seed + i * 0.13, 1, 0, MAT.steel]);
      }
      if (r() < 0.45 && y < 150) {
        const tx = r.range(x0 + 5, x1 - 5), tz = r.range(z0 + 5, z1 - 5), tr = r.range(2.2, 3.2);
        addBox(tx - tr * 0.8, y, tz - tr * 0.8, tx + tr * 0.8, y + 3, tz + tr * 0.8, [seed + 0.5, 1, 0, MAT.dark]);
        tanks.push([tx, y + 3, tz, tr, r.range(3.6, 5)]);
        solids.push([tx - tr, y + 3, tz - tr, tx + tr, y + 8.5, tz + tr]);
      }
    }
    function pickMat(h) {
      const k = r();
      if (h > 140) return k < 0.45 ? MAT.glass : k < 0.75 ? MAT.deco : MAT.stone;
      if (h > 60) return k < 0.35 ? MAT.stone : k < 0.65 ? MAT.brick : k < 0.85 ? MAT.glass : MAT.dark;
      return k < 0.55 ? MAT.brick : k < 0.8 ? MAT.stone : MAT.dark;
    }

    // a building, maybe stepped back in tiers the way old Midtown towers are
    function building(x0, z0, x1, z1, h, seed, lit) {
      const mat = pickMat(h);
      const tiers = h > 95 && r() < 0.7 ? (h > 170 ? 3 : 2) : 1;
      let y = 0;
      for (let t = 0; t < tiers; t++) {
        const top = t === tiers - 1 ? h : h * (t === 0 ? r.range(0.5, 0.66) : r.range(0.78, 0.88));
        addBox(x0, y, z0, x1, top, z1, [seed + t * 0.37, 0, lit, mat]);
        if (t < tiers - 1) {
          const ins = r.range(3, 7);
          tops.push([x0, z0, x1, z1, top]);
          x0 += ins; z0 += ins; x1 -= ins; z1 -= ins;
        }
        y = top;
      }
      tops.push([x0, z0, x1, z1, h]);
      roofProps(x0, z0, x1, z1, h, seed);
      if (h > 150 && r() < 0.6) addBox((x0 + x1) / 2 - 0.6, h, (z0 + z1) / 2 - 0.6, (x0 + x1) / 2 + 0.6, h + r.range(14, 30), (z0 + z1) / 2 + 0.6, [seed, 1, 0, MAT.steel]);
    }

    /** An Art Deco tower: tiers stepping in, then a crown and a spire. */
    function decoTower(cx, cz, kind) {
      const L = [41.3 + cx, 0, 0.3, MAT.deco];
      if (kind === 0) { // the tall one: broad base, long shaft, a crown and a mast
        const tiers = [[27, 0, 26], [22, 26, 88], [18, 88, 300], [13, 300, 318], [9, 318, 336], [5.5, 336, 352]];
        for (const [h2, y0, y1] of tiers) { addBox(cx - h2, y0, cz - h2, cx + h2, y1, cz + h2, [L[0] + y0, 0, 0.32, MAT.deco]); tops.push([cx - h2, cz - h2, cx + h2, cz + h2, y1]); }
        addBox(cx - 3, 352, cz - 3, cx + 3, 372, cz + 3, [L[0], 1, 0, MAT.deco]);
        addBox(cx - 0.8, 372, cz - 0.8, cx + 0.8, 420, cz + 0.8, [L[0], 1, 0, MAT.steel]);
      } else { // the slender one: a terraced metal crown and a needle
        addBox(cx - 20, 0, cz - 20, cx + 20, 60, cz + 20, [L[0] + 1, 0, 0.3, MAT.deco]);
        addBox(cx - 15, 60, cz - 15, cx + 15, 228, cz + 15, [L[0] + 2, 0, 0.3, MAT.deco]);
        tops.push([cx - 20, cz - 20, cx + 20, cz + 20, 60], [cx - 15, cz - 15, cx + 15, cz + 15, 228]);
        for (let k = 0; k < 6; k++) { const h2 = 13 - k * 2; addBox(cx - h2, 228 + k * 7, cz - h2, cx + h2, 235 + k * 7, cz + h2, [L[0] + 3 + k, 1, 0, MAT.steel]); }
        addBox(cx - 0.6, 270, cz - 0.6, cx + 0.6, 312, cz + 0.6, [L[0], 1, 0, MAT.steel]);
      }
    }

    for (let bi = -SPAN; bi <= SPAN; bi++) for (let bj = -SPAN; bj <= SPAN; bj++) {
      const cx = bi * PITCH, cz = bj * PITCH;
      const x0 = cx - LOT / 2, z0 = cz - LOT / 2, x1 = cx + LOT / 2, z1 = cz + LOT / 2;
      const seed = r() * 1000;
      const lit = r.range(0.1, 0.24);
      if (bi >= RIVER_BLOCK) continue;                             // promenade and river
      if (bi === BUGLE[0] && bj === BUGLE[1]) continue;           // built below
      if (isIn(PARKS, bi, bj)) {                                  // a park: grass, paths and trees
        for (let k = 0; k < 34; k++) { const tx = r.range(x0 + 3, x1 - 3), tz = r.range(z0 + 3, z1 - 3); if (Math.abs(tx - cx) > 2 && Math.abs(tz - cz) > 2) trees.push([tx, tz, r.range(0.9, 1.5)]); }
        continue;
      }
      const deco = DECO.findIndex((b) => b[0] === bi && b[1] === bj);
      if (deco >= 0) { decoTower(cx, cz, deco); continue; }
      if (bi === 0 && bj === 0) { building(x0 + 2, z0 + 2, x1 - 2, z1 - 2, 46, seed, lit); }
      else {
        // taller toward Midtown's heart, which sits a few blocks toward the Bugle
        const d = Math.hypot(bi - 2, bj + 3) / SPAN;
        const base = U.lerp(150, 26, U.smooth(U.clamp(d, 0, 1))) * (0.75 + 0.5 * U.noise1(bi * 0.37 + bj * 0.71 + 3.3));
        const k = r();
        if (k < 0.05 && Math.abs(bi) + Math.abs(bj) > 2) building(x0 + 6, z0 + 6, x1 - 6, z1 - 6, r.range(8, 14), seed, lit);
        else if (k < 0.4) building(x0 + r.range(1, 3), z0 + r.range(1, 3), x1 - r.range(1, 3), z1 - r.range(1, 3), U.clamp(base * r.range(0.7, 1.4), 16, 245), seed, lit);
        else if (k < 0.72) {
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
      // street trees along the sidewalks, lamps at the kerb, a traffic light at each corner
      if (Math.abs(bi) <= 9 && Math.abs(bj) <= 11) {
        const e = LOT / 2 + 2.3;
        for (let side = 0; side < 4; side++) for (const t of [-0.6, 0.0, 0.6]) {
          if (r() < 0.35 || Math.abs(bi) + Math.abs(bj) > 14) continue;
          const a = t * LOT / 2;
          const [tx, tz] = side === 0 ? [cx + a, cz - e] : side === 1 ? [cx + e, cz + a] : side === 2 ? [cx - a, cz + e] : [cx - e, cz - a];
          trees.push([tx, tz, r.range(0.8, 1.2)]);
        }
        const k2 = LOT / 2 + 3.1;
        for (let side = 0; side < 4; side++) for (const t of [-0.9, 0.0]) {
          const a = t * LOT / 2;
          const [lx, lz, yaw] = side === 0 ? [cx + a, cz - k2, Math.PI] : side === 1 ? [cx + k2, cz + a, Math.PI / 2] : side === 2 ? [cx - a, cz + k2, 0] : [cx - k2, cz - a, -Math.PI / 2];
          lamps.push([lx, lz, yaw]);
        }
        lights.push([cx + LOT / 2 + 3.4, cz + LOT / 2 + 3.4, Math.PI / 4]);
      }
    }

    // the Daily Bugle: a stepped tower with its sign on the roof
    const bx = BUGLE[0] * PITCH, bz = BUGLE[1] * PITCH;
    addBox(bx - 26, 0, bz - 26, bx + 26, 120, bz + 26, [41.3, 0, 0.3, MAT.stone]);
    addBox(bx - 20, 120, bz - 20, bx + 20, 178, bz + 20, [41.7, 0, 0.3, MAT.stone]);
    addBox(bx - 15, 178, bz - 15, bx + 15, 212, bz + 15, [42.1, 0, 0.3, MAT.stone]);
    tops.push([bx - 26, bz - 26, bx + 26, bz + 26, 120], [bx - 20, bz - 20, bx + 20, bz + 20, 178], [bx - 15, bz - 15, bx + 15, bz + 15, 212]);
    addBox(bx - 0.8, 212, bz - 0.8, bx + 0.8, 262, bz + 0.8, [42.4, 1, 0, MAT.steel]);
    addBox(bx - 14, 212, bz + 6, bx - 12.6, 219, bz + 7.4, [42.5, 1, 0, MAT.steel]);
    addBox(bx + 12.6, 212, bz + 6, bx + 14, 219, bz + 7.4, [42.5, 1, 0, MAT.steel]);
    const bugleTop = new T.Vector3(bx, 212, bz);

    // the waterfront: a promenade with trees and lamps, railings, piers, and the river
    const PROM0 = RIVER_BLOCK * PITCH - PITCH / 2 + STREET / 2; // just past the last avenue
    for (let z = -880; z <= 880; z += 16) {
      trees.push([PROM0 + 14 + r.range(-1, 1), z + r.range(-3, 3), r.range(0.9, 1.3)]);
      if (Math.abs(z % 32) < 1) lamps.push([RIVER_X - 3, z, -Math.PI / 2]);
    }
    addBox(RIVER_X - 0.3, 0, -900, RIVER_X + 0.3, 1.1, 900, [5.5, 1, 0, MAT.steel]); // railing
    for (const pz of [-650, -430, -210, 30, 250, 470, 690]) {
      addBox(RIVER_X, WATER_Y - 0.5, pz - 8, RIVER_X + 95, 0.3, pz + 8, [pz, 1, 0, MAT.dark]);
      tops.push([RIVER_X, pz - 8, RIVER_X + 95, pz + 8, 0.3]);
      if (r() < 0.6) { addBox(RIVER_X + 30, 0.3, pz - 6, RIVER_X + 70, 9, pz + 6, [pz + 0.5, 0, 0.2, MAT.brick]); tops.push([RIVER_X + 30, pz - 6, RIVER_X + 70, pz + 6, 9]); }
    }
    // the far shore: lower buildings across the water
    for (let k = 0; k < 170; k++) {
      const fx = r.range(1650, 2500), fz = r.range(-2200, 2200), w = r.range(18, 48), d = r.range(18, 48), h = r.range(10, 70) * (fx < 1900 ? 1 : 0.7);
      addBox(fx, 0, fz, fx + w, h, fz + d, [k * 1.7, 0, r.range(0.1, 0.25), r() < 0.6 ? MAT.brick : MAT.stone], false);
    }
    // a suspension bridge to the south, across the river
    const BZ = -1150, DY = 46, T1 = 880, T2 = 1420, TOWER = 150;
    addBox(PROM0 - 40, DY - 3, BZ - 14, 1700, DY, BZ + 14, [9.1, 1, 0, MAT.steel]);
    for (const tx of [T1, T2]) for (const s of [-1, 1]) {
      addBox(tx - 4, 0, BZ + s * 13 - 4, tx + 4, TOWER, BZ + s * 13 + 4, [9.2, 1, 0, MAT.stone]);
      addBox(tx - 3, TOWER - 20, BZ - 13, tx + 3, TOWER - 14, BZ + 13, [9.3, 1, 0, MAT.stone], false);
    }
    for (const s of [-1, 1]) for (let k = 0; k < 40; k++) { // main cables, in short straight runs
      const xa = U.lerp(PROM0, 1700, k / 40), xb = U.lerp(PROM0, 1700, (k + 1) / 40);
      const cable = (x) => { if (x < T1) return DY + (TOWER - DY) * Math.pow(Math.max(0, (x - PROM0) / (T1 - PROM0)), 1.6); if (x > T2) return DY + (TOWER - DY) * Math.pow(Math.max(0, (1700 - x) / (1700 - T2)), 1.6); const m = (x - T1) / (T2 - T1); return DY + 4 + (TOWER - DY - 4) * Math.pow(2 * m - 1, 2); };
      const ya = cable(xa), yb = cable(xb);
      addBox(xa, Math.min(ya, yb) - 0.5, BZ + s * 13 - 0.5, xb, Math.max(ya, yb) + 0.5, BZ + s * 13 + 0.5, [9.4, 1, 0, MAT.steel], false);
      if (k % 2 === 0) addBox((xa + xb) / 2 - 0.15, DY, BZ + s * 13 - 0.15, (xa + xb) / 2 + 0.15, ya, BZ + s * 13 + 0.15, [9.5, 1, 0, MAT.steel], false);
    }

    /* ---------- drawing ---------- */
    const sunC = new T.Color('#ffd9a2'), skyC = new T.Color('#9fb6d4');
    const cityU = Object.assign({
      uLut: { value: shared.lut }, uSunC: { value: new T.Vector3(sunC.r, sunC.g, sunC.b) }, uSkyC: { value: new T.Vector3(skyC.r, skyC.g, skyC.b) },
      uWin0: { value: new T.Vector3() }, uWin1: { value: new T.Vector3() }, uWin2: { value: new T.Vector3() }, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU,
    }, shared.fogU);
    const cityMat = new T.ShaderMaterial({ vertexShader: CITY_VS, fragmentShader: CITY_FS(S), uniforms: cityU });

    const boxGeo = new T.BoxGeometry(1, 1, 1);
    const city = new T.InstancedMesh(boxGeo, cityMat, boxes.length);
    const info = new Float32Array(boxes.length * 4);
    const infoAttr = new T.InstancedBufferAttribute(info, 4);
    boxGeo.setAttribute('aInfo', infoAttr);
    const m4 = new T.Matrix4(), qI = new T.Quaternion(), v1 = new T.Vector3(), v2 = new T.Vector3(), Y = new T.Vector3(0, 1, 0);
    function writeBoxes(order) {
      order.forEach((b, i) => {
        m4.compose(v1.set(b[0], b[1], b[2]), qI, v2.set(b[3], b[4], b[5]));
        city.setMatrixAt(i, m4);
        info[i * 4] = b[6]; info[i * 4 + 1] = b[7]; info[i * 4 + 2] = b[8]; info[i * 4 + 3] = b[9];
      });
      city.instanceMatrix.needsUpdate = true;
      infoAttr.needsUpdate = true;
    }
    writeBoxes(boxes);
    city.frustumCulled = false;
    scene.add(city);

    // water towers: an open cylinder with a cone hat
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
      tankInfo[i * 4] = 77.7 + i; tankInfo[i * 4 + 1] = 1; tankInfo[i * 4 + 3] = MAT.brick;
    });
    tankMesh.frustumCulled = false;
    scene.add(tankMesh);

    // streets
    const groundMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: GROUND_FS(S),
      uniforms: Object.assign({ uRoad: { value: new T.Vector3() }, uWalk: { value: new T.Vector3() }, uLine: { value: new T.Vector3() }, uGrass: { value: new T.Vector3() }, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU }, shared.fogU),
    });
    const groundW = RIVER_X + 2400;
    const ground = new T.Mesh(new T.PlaneGeometry(groundW, 9000).rotateX(-Math.PI / 2).translate(RIVER_X - groundW / 2, 0, 0), groundMat);
    ground.frustumCulled = false;
    scene.add(ground);
    // the far shore's ground, the parks' grass, and the river
    const farGround = new T.Mesh(new T.PlaneGeometry(2400, 9000).rotateX(-Math.PI / 2).translate(1600 + 1200, 0.02, 0), groundMat);
    farGround.frustumCulled = false; scene.add(farGround);
    const grassMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: GRASS_FS(S),
      uniforms: Object.assign({ uGrass: { value: new T.Vector3(0.33, 0.42, 0.2) }, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU }, shared.fogU),
    });
    const parkGeos = PARKS.map(([i, j]) => new T.PlaneGeometry(LOT + 6, LOT + 6).rotateX(-Math.PI / 2).translate(i * PITCH, 0.04, j * PITCH));
    const parkGeo = (() => { const pos = []; parkGeos.forEach((g) => pos.push(...g.toNonIndexed().attributes.position.array)); const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); return g; })();
    const parks = new T.Mesh(parkGeo, grassMat);
    parks.frustumCulled = false; scene.add(parks);
    const waterMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: WATER_FS(S),
      uniforms: Object.assign({ uLut: { value: shared.lut }, uSunC: cityU.uSunC, uDeep: { value: new T.Vector3(0.05, 0.13, 0.17) }, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU }, shared.fogU),
    });
    const water = new T.Mesh(new T.PlaneGeometry(1000, 9000).rotateX(-Math.PI / 2).translate(RIVER_X + 500 - 50, WATER_Y, 0), waterMat);
    water.frustumCulled = false; scene.add(water);

    // trees, lamps and traffic lights
    const propMat = new T.ShaderMaterial({
      vertexShader: PROP_VS, fragmentShader: PROP_FS(S),
      uniforms: Object.assign({ uSunC: cityU.uSunC, uSkyC: cityU.uSkyC, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU }, shared.fogU),
    });
    const treeGeo = merged([
      [new T.CylinderGeometry(0.16, 0.24, 3.2, 5, 1, true), 0, 1.6, 0, 0],
      [new T.IcosahedronGeometry(2.4, 0), 0, 4.7, 0, 1, true], [new T.IcosahedronGeometry(1.8, 0), 1.0, 5.8, 0.4, 1, true], [new T.IcosahedronGeometry(1.6, 0), -0.9, 5.3, -0.7, 1, true],
    ]);
    const LEAVES = ['#c86a2c', '#e09a35', '#d4b33e', '#8a9a3a', '#5f7d34', '#b2452a', '#e5c35a', '#6f8f3f'];
    const treeColor = new Float32Array(trees.length * 3);
    treeGeo.setAttribute('aColor', new T.InstancedBufferAttribute(treeColor, 3));
    const treeMesh = new T.InstancedMesh(treeGeo, propMat, trees.length);
    trees.forEach(([x, z, s], i) => {
      m4.compose(v1.set(x, 0, z), qI.setFromAxisAngle(Y, r.range(0, 6.28)), v2.set(s, s * r.range(0.9, 1.15), s));
      treeMesh.setMatrixAt(i, m4);
      const c = new T.Color(LEAVES[Math.floor(r() * LEAVES.length)]);
      treeColor.set([c.r, c.g, c.b], i * 3);
    });
    treeMesh.frustumCulled = false; scene.add(treeMesh);
    const lampGeo = merged([
      [new T.BoxGeometry(0.16, 6.4, 0.16), 0, 3.2, 0, 0], [new T.BoxGeometry(0.12, 0.12, 1.5), 0, 6.35, 0.7, 0], [new T.BoxGeometry(0.42, 0.18, 0.62), 0, 6.25, 1.35, 2],
    ]);
    lampGeo.setAttribute('aColor', new T.InstancedBufferAttribute(new Float32Array(lamps.length * 3), 3));
    const lampMesh = new T.InstancedMesh(lampGeo, propMat, lamps.length);
    lamps.forEach(([x, z, yaw], i) => { m4.compose(v1.set(x, 0, z), qI.setFromAxisAngle(Y, yaw), v2.set(1, 1, 1)); lampMesh.setMatrixAt(i, m4); });
    lampMesh.frustumCulled = false; scene.add(lampMesh);
    const lightGeo = merged([
      [new T.BoxGeometry(0.2, 4.8, 0.2), 0, 2.4, 0, 0], [new T.BoxGeometry(0.42, 1.25, 0.36), 0, 4.4, 0.25, 0],
      [new T.BoxGeometry(0.22, 0.22, 0.05), 0, 4.78, 0.44, 3], [new T.BoxGeometry(0.22, 0.22, 0.05), 0, 4.02, 0.44, 4],
    ]);
    lightGeo.setAttribute('aColor', new T.InstancedBufferAttribute(new Float32Array(lights.length * 3), 3));
    const lightMesh = new T.InstancedMesh(lightGeo, propMat, lights.length);
    lights.forEach(([x, z, yaw], i) => { m4.compose(v1.set(x, 0, z), qI.setFromAxisAngle(Y, yaw), v2.set(1, 1, 1)); lightMesh.setMatrixAt(i, m4); });
    lightMesh.frustumCulled = false; scene.add(lightMesh);

    // only draw the props near the camera (the haze hides the rest): re-picked as it moves
    function culler(mesh, pts, radius, colAttr) {
      const mats = mesh.instanceMatrix.array.slice(), cols = colAttr ? colAttr.array.slice() : null, r2 = radius * radius;
      return (c) => {
        const arr = mesh.instanceMatrix.array;
        let n = 0;
        for (let i = 0; i < pts.length; i++) {
          const dx = pts[i][0] - c.x, dz = pts[i][1] - c.z;
          if (dx * dx + dz * dz > r2) continue;
          arr.set(mats.subarray(i * 16, i * 16 + 16), n * 16);
          if (cols) colAttr.array.set(cols.subarray(i * 3, i * 3 + 3), n * 3);
          n++;
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (cols) colAttr.needsUpdate = true;
      };
    }
    const cullers = [culler(treeMesh, trees, 520, treeGeo.attributes.aColor), culler(lampMesh, lamps, 380), culler(lightMesh, lights, 380)];

    // boats on the river
    const boatGeo = merged([[new T.BoxGeometry(5, 1.6, 16), 0, 0.3, 0, 0], [new T.BoxGeometry(3.6, 1.8, 6), 0, 1.9, -1.5, 0], [new T.BoxGeometry(3.2, 0.5, 0.06), 0, 2.2, 1.56, 2]]);
    const NBOAT = 9;
    const boatColor = new Float32Array(NBOAT * 3);
    boatGeo.setAttribute('aColor', new T.InstancedBufferAttribute(boatColor, 3));
    const boatMesh = new T.InstancedMesh(boatGeo, propMat, NBOAT);
    boatMesh.frustumCulled = false; scene.add(boatMesh);
    const boats = Array.from({ length: NBOAT }, (_, i) => ({ x: r.range(RIVER_X + 130, 1450), z: r.range(-2000, 2000), v: r.range(4, 9) * (r() < 0.5 ? -1 : 1), s: r.range(0.7, 1.6) }));

    // the Bugle's sign, readable from both sides
    const signMat = new T.ShaderMaterial({
      vertexShader: SIGN_VS, fragmentShader: SIGN_FS(S), side: T.DoubleSide,
      uniforms: Object.assign({ uMap: { value: signTexture() }, uTime: shared.timeU, uGrain: shared.grainU, uMuted: shared.mutedU }, shared.fogU),
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
        uTime: shared.timeU, uStars: { value: 1 }, uMotion: { value: 1 }, uGrain: shared.grainU, uMuted: shared.mutedU,
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
      cityU.uWin0.value.copy(color(pal.windows[0])); cityU.uWin1.value.copy(color(pal.windows[2])); cityU.uWin2.value.copy(color(pal.windows[4]));
      groundMat.uniforms.uRoad.value.copy(color('#3a3638'));
      groundMat.uniforms.uWalk.value.copy(color('#8f877e'));
      groundMat.uniforms.uLine.value.copy(color('#e8d9b0'));
    }

    // Each frame: the sun's place on screen for the sky shader, boats on the river, and (now and
    // then) the buildings re-sorted nearest-first so hidden walls are skipped early.
    let sortedAt = new T.Vector3(1e9, 0, 0);
    const sp = new T.Vector3();
    function update(camera, pxW, pxH, glScale, dt) {
      sky.position.copy(camera.position);
      sp.copy(shared.sunDir).multiplyScalar(3000).add(camera.position).project(camera);
      skyMat.uniforms.uSunPx.value.set((sp.x * 0.5 + 0.5) * pxW, (sp.y * 0.5 + 0.5) * pxH);
      skyMat.uniforms.uSunRpx.value = 70 * glScale * (60 / camera.fov);
      boats.forEach((b, i) => {
        b.z += b.v * (dt || 0);
        if (b.z > 2200) b.z = -2200; if (b.z < -2200) b.z = 2200;
        m4.compose(v1.set(b.x, WATER_Y + 0.2 + Math.sin(performance.now() / 900 + i) * 0.12, b.z), qI.setFromAxisAngle(Y, b.v > 0 ? 0 : Math.PI), v2.set(b.s, b.s, b.s));
        boatMesh.setMatrixAt(i, m4);
        boatColor.set(i % 3 === 0 ? [0.85, 0.2, 0.15] : [0.9, 0.9, 0.88], i * 3);
      });
      boatMesh.instanceMatrix.needsUpdate = true;
      if (sortedAt.distanceToSquared(camera.position) > 50 * 50) {
        sortedAt.copy(camera.position);
        const c = camera.position;
        cullers.forEach((f) => f(c));
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
     * Returns what it touched: ground (standing on something), water, and the last wall's normal.
     */
    const hit = { ground: false, water: false, wall: false, nx: 0, nz: 0, top: 0, roofY: 0 };
    function collide(p, v, hw, h) {
      hit.ground = false; hit.water = false; hit.wall = false; hit.nx = 0; hit.nz = 0;
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
      const floor = p.x > RIVER_X && p.x < 1600 ? WATER_Y : 0;
      if (p.y <= floor) { p.y = floor; if (v.y < 0) v.y = 0; if (floor < 0) hit.water = true; else { hit.ground = true; hit.roofY = 0; } }
      return hit;
    }

    /** The roof height under a point, if something is there (else the street or the water). */
    function floorAt(x, z, below) {
      let y = x > RIVER_X && x < 1600 ? WATER_Y : 0;
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
      [boxGeo, tankGeo, ground.geometry, farGround.geometry, parkGeo, water.geometry, sky.geometry, sign.geometry, treeGeo, lampGeo, lightGeo, boatGeo].forEach((g) => g.dispose());
      [cityMat, groundMat, grassMat, waterMat, propMat, skyMat, signMat].forEach((m) => m.dispose());
      signMat.uniforms.uMap.value.dispose();
    }

    return {
      PITCH, LOT, SPAN, RIVER_X, WATER_Y, bugleTop, tops, solids, cityU, groundMat, extent: (SPAN + 0.5) * PITCH, promenade: PROM0 + 20,
      applyPalette, update, collide, floorAt, raycast, findAnchor, findPerch, near, dispose,
      start: new T.Vector3(0, 46, 0),
    };
  }

  SMR.createWorld = createWorld;
})();
