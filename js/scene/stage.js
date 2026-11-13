/* The 3D stage: a WebGL city at first light with the hero in front of it, plus a thin
   2D layer on top for silk, dust and one idle spider. A camera reframes the shot for
   each menu screen. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;
  const DEG = Math.PI / 180;

  // camera shots: where the city camera looks, and where the hero sits on screen
  const SHOTS = {
    title: { yaw: 0, pitch: 8.6, fwd: 0, fov: 38, hx: 0, hy: 0, hs: 1 },
    main: { yaw: -1.2, pitch: 8.6, fwd: 0, fov: 38, hx: 36, hy: 0, hs: 1 },
    panel: { yaw: -3.5, pitch: 8.6, fwd: 0, fov: 38, hx: 270, hy: 30, hs: 1 },
    suits: { yaw: -2, pitch: 8.6, fwd: 40, fov: 38, hx: -60, hy: 44, hs: 1.14 },
    credits: { yaw: 0, pitch: 40, fwd: 0, fov: 38, hx: 0, hy: 760, hs: 1 },
    launch: { yaw: 0, pitch: 4, fwd: 1100, fov: 66, hx: 760, hy: 360, hs: 1.5 },
  };
  const MOODS = { neutral: 0.05, wide: 0, focus: 0.3, narrow: 0.64 };
  const CAM_HEIGHT = 92;
  const HERO_DIST = 9.2, HERO_FOV = 26;

  // Pixel budgets for the 3D view, in device pixels. "Auto" quality moves between them.
  const BUDGET = { floor: 0.45e6, low: 0.9e6, start: 2.1e6, high: 3.7e6 };
  const MIN_GAP = 10.5; // ms between drawn frames: about 60 fps on 120 Hz screens, 72 on 144 Hz

  // Film grain, added at the end of every shader (cheaper than a blended CSS layer).
  const GRAIN_GLSL = `
    uniform float uGrain;
    vec3 grain(vec3 c) {
      vec2 p = gl_FragCoord.xy + fract(uTime * 7.31) * vec2(397.0, 211.0);
      float n = fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      return c * (1.0 + n * uGrain) + n * uGrain * 0.08;
    }`;

  const FOG_GLSL = `
    uniform vec3 uHazeLow, uHazeHigh, uGlow, uSunDir;
    uniform float uFog;
    vec3 applyFog(vec3 col, vec3 world) {
      vec3 ray = world - cameraPosition;
      float dist = length(ray);
      float f = 1.0 - exp(-dist * uFog);
      f *= mix(1.0, 0.72, clamp(world.y / 420.0, 0.0, 1.0));
      vec3 haze = mix(uHazeLow, uHazeHigh, clamp(world.y / 320.0, 0.0, 1.0));
      float toward = pow(max(dot(ray / dist, uSunDir), 0.0), 7.0);
      return mix(col, mix(haze, uGlow, toward * 0.75), f);
    }`;

  const SKY_VS = `
    varying vec3 vDir;
    void main() {
      vDir = position;
      vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
      gl_Position = vec4(p.xy, p.w * 0.99999, p.w); // just inside the far plane: hidden wherever the city is drawn
    }`;
  const SKY_FS = `
    precision highp float;
    uniform sampler2D uLut;
    uniform vec3 uSunDir, uCore, uMid, uEdge, uSunGlow, uHalo;
    uniform vec4 uRays;
    uniform vec2 uSunPx;
    uniform float uSunRpx, uTime, uStars, uMotion;
    varying vec3 vDir;
    ${GRAIN_GLSL}
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 d = normalize(vDir);
      float el = asin(clamp(d.y, -1.0, 1.0));
      float v = el >= 0.0 ? 0.74 * (1.0 - el / 0.48) : 0.74 + (-el / 0.16) * 0.26;
      vec3 col = texture2D(uLut, vec2(clamp(v, 0.002, 0.998), 0.5)).rgb;

      // stars
      vec2 sc = vec2(atan(d.x, -d.z), el) * 110.0;
      vec2 id = floor(sc), f = fract(sc) - 0.5;
      float h = hash(id);
      vec2 jitter = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
      float star = step(0.9, h) * smoothstep(0.13 + 0.1 * hash(id + 1.3), 0.0, length(f - jitter));
      float tw = 0.62 + 0.38 * sin(uTime * (0.5 + h * 2.2) * uMotion + h * 60.0);
      col += vec3(0.88, 0.92, 1.0) * star * tw * uStars * smoothstep(0.1, 0.42, el);

      // sun: rays, glow, printed halo, disc — all measured in screen pixels
      vec2 sp = gl_FragCoord.xy - uSunPx;
      float rf = length(sp) / uSunRpx;
      float a = atan(sp.y, sp.x);
      float ray = smoothstep(0.47, 0.5, abs(fract(a * 16.0 / 6.2831853 + uTime * 0.004 * uMotion) - 0.5) * 2.0 * 0.5 + 0.25);
      col += uRays.rgb * uRays.a * ray * smoothstep(5.4, 0.9, rf) * 1.5;
      col = 1.0 - (1.0 - col) * (1.0 - uSunGlow * 0.6 * smoothstep(3.4, 0.5, rf));
      vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * sp / (uSunRpx * 0.072);
      float hv = clamp(1.0 - (rf - 1.0) / 0.62, 0.0, 1.0);
      float hr = 0.42 * pow(hv, 1.35);
      float dots = (1.0 - smoothstep(hr - 0.07, hr + 0.07, length(fract(q) - 0.5))) * step(0.03, hr) * step(0.9, rf);
      col = mix(col, uHalo, dots * 0.5);
      float disc = 1.0 - smoothstep(uSunRpx - 1.2, uSunRpx + 1.2, length(sp));
      vec3 dc = mix(mix(uCore, uMid, smoothstep(0.0, 0.62, rf)), uEdge, smoothstep(0.62, 1.0, rf));
      col = mix(col, dc, disc);
      gl_FragColor = vec4(grain(col), 1.0);
    }`;

  // Buildings are flat-sided boxes, so their lighting and haze are worked out once per corner
  // here; only the windows are drawn per pixel.
  const CITY_VS = `
    attribute vec4 aInfo;
    uniform vec3 uWallA, uWallB, uRimC, uFillC, uHazeLow, uHazeHigh, uGlow, uSunDir;
    uniform float uFog;
    varying vec3 vLocal, vSize, vNl, vBase, vFogC;
    varying vec4 vInfo;
    varying vec2 vPitch;
    varying float vRoof, vFogF, vY;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vLocal = position * sc;
      vSize = sc;
      vNl = normal;
      vInfo = aInfo;
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 N = normalize(mat3(instanceMatrix) * (normal / sc));
      vec3 wall = mix(uWallA, uWallB, hash(vec2(aInfo.x, 1.7)));
      float roof = step(0.5, N.y);
      float fill = clamp(dot(N, normalize(vec3(-0.62, 0.42, 0.66))) * 0.5 + 0.5, 0.0, 1.0);
      float sun = pow(clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0), 2.0);
      vec3 col = wall * (0.5 + 1.0 * fill) + uFillC * 0.07 * fill + uRimC * 0.55 * sun;
      vBase = mix(col, wall * 1.5 + uRimC * 0.16, roof);
      vRoof = roof;
      vY = wp.y;
      vPitch = vec2(3.6, 3.9) * (0.9 + 0.35 * hash(vec2(aInfo.x, 5.1)));
      vec3 ray = wp.xyz - cameraPosition;
      float dist = length(ray);
      vFogF = (1.0 - exp(-dist * uFog)) * mix(1.0, 0.72, clamp(wp.y / 420.0, 0.0, 1.0));
      float toward = pow(max(dot(ray / dist, uSunDir), 0.0), 7.0);
      vFogC = mix(mix(uHazeLow, uHazeHigh, clamp(wp.y / 320.0, 0.0, 1.0)), uGlow, toward * 0.75);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const CITY_FS = `
    precision highp float;
    uniform vec3 uWin0, uWin1, uWin2;
    uniform float uTime;
    ${GRAIN_GLSL}
    varying vec3 vLocal, vSize, vNl, vBase, vFogC;
    varying vec4 vInfo;
    varying vec2 vPitch;
    varying float vRoof, vFogF, vY;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 col = vBase * mix(0.7, 1.08, clamp(vY / 160.0, 0.0, 1.0));
      bool xFace = abs(vNl.x) > 0.5;
      vec2 fc = xFace ? vec2(vLocal.z + vSize.z * 0.5, vLocal.y) : vec2(vLocal.x + vSize.x * 0.5, vLocal.y);
      float faceW = xFace ? vSize.z : vSize.x;
      float detail = 1.0 - smoothstep(0.22, 0.55, fwidth(fc.x) / vPitch.x);
      vec2 cell = floor(fc / vPitch), f = fract(fc / vPitch);
      float wall = (1.0 - vRoof) * (1.0 - step(0.5, vInfo.y));
      float inWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.26, f.y) * step(f.y, 0.82);
      inWin *= step(vPitch.x * 0.4, fc.x) * step(fc.x, faceW - vPitch.x * 0.4) * step(fc.y, vSize.y - 1.5) * wall;
      float h = hash(cell + vInfo.x * 13.7);
      float reroll = step(0.94, h) * floor(uTime * 0.07 + h * 40.0);
      float lit = step(1.0 - vInfo.z, hash(cell * 1.31 + vInfo.x * 7.1 + reroll));
      vec3 wc = h < 0.6 ? uWin0 : (h < 0.88 ? uWin1 : uWin2);
      col = mix(col, col * 0.62, inWin * (1.0 - lit) * detail);
      col = mix(col, wc * (0.75 + 0.5 * fract(h * 17.31)), inWin * lit * detail);
      col += wc * vInfo.z * 0.22 * (1.0 - detail) * wall;
      gl_FragColor = vec4(grain(mix(col, vFogC, vFogF)), 1.0);
    }`;

  const GROUND_FS = `
    precision highp float;
    ${FOG_GLSL}
    uniform vec3 uInk;
    uniform float uTime;
    ${GRAIN_GLSL}
    varying vec3 vWorld;
    void main() { gl_FragColor = vec4(grain(applyFog(uInk, vWorld)), 1.0); }`;

  const LIGHT_VS = `
    attribute float aPhase;
    uniform float uTime, uPx;
    varying float vOn;
    void main() {
      float c = mod(uTime * 0.75 + aPhase, 2.2);
      vOn = c < 0.55 ? sin(c / 0.55 * 3.14159) : 0.0;
      vec4 mv = viewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uPx * (0.6 + 0.6 * vOn) * clamp(900.0 / -mv.z, 0.35, 1.6);
    }`;
  const LIGHT_FS = `
    precision highp float;
    varying float vOn;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      float a = (1.0 - smoothstep(0.0, 1.0, d));
      gl_FragColor = vec4(vec3(1.0, 0.23, 0.18) * a * a * (0.3 + 0.9 * vOn), 1.0);
    }`;

  const HERO_VS = `
    uniform float uYaw, uPitch, uWiden;
    attribute vec3 aWide;
    attribute float aPart;
    varying vec3 vObj, vN, vV, vW;
    varying vec2 vUv;
    varying float vPart;
    mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
    mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
    void main() {
      // startled: the model's own shape key opens the lenses a little
      vec3 pos = position + aWide * (uWiden * 0.35);
      vObj = pos;
      vUv = uv;
      vPart = aPart;
      float w = smoothstep(-1.55, -0.85, pos.y);
      mat3 R = rotY(uYaw * w) * rotX(uPitch * w);
      vec3 pivot = vec3(0.0, -1.1, -0.2);
      vec3 p = pivot + R * (pos - pivot);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * (R * normal));
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const HERO_FS = `
    precision highp float;
    uniform vec3 uMask, uBody, uWeb, uFrame, uLens, uEmblem, uThread, uRim, uFill, uSun;
    uniform sampler2D uSuitTex, uDetailTex, uLensTex, uSeamTex, uSeamRel, uLut;
    uniform vec2 uSeamK;
    uniform float uSeam, uSheen, uDot, uFade, uTime, uScale, uSquint;
    uniform vec4 uSeamRect;
    uniform vec2 uLensUvC, uLensUvAx, uLensUvUp; // the lens artwork: centre, long axis, toward the top lid
    varying vec3 vObj, vN, vV, vW;
    varying vec2 vUv;
    varying float vPart;
    ${GRAIN_GLSL}

    // How far the raised parts stand off the suit, in model units (the head is 2 units tall).
    const float WEB_H = 0.0045, MARK_H = 0.007, FOLD_H = 0.022, SEAM_H = 0.008;
    const float TX = 1.0 / 2048.0;                 // one texel of the suit masks
    const vec3 KEY = vec3(0.3487, 0.4483, 0.8235); // key light, front right and above
    const vec2 KEY2 = vec2(0.6139, 0.7894);        // the same light's direction on screen

    // Slope (per unit of texture coordinate), height and contact shadow from a relief map.
    vec4 relief(sampler2D t, vec2 uv, vec2 k) {
      vec4 r = texture2D(t, uv);
      return vec4((r.rg * 255.0 - 128.0) / 127.0 * k, r.b, r.a);
    }
    float inBox(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }

    // Fabric weave: shallow ribs along directions a and b, worked out in 3D so it wraps the
    // body without seams. Returns the height change per pixel; fades out before it can shimmer.
    vec2 weave(vec3 p, vec3 oX, vec3 oY, float period, vec3 a, vec3 b, float px) {
      float k = 6.2831853 / period;
      vec3 grad = (cos(k * dot(p, a)) * a + cos(k * dot(p, b)) * b) * (0.5 * k);
      return vec2(dot(grad, oX), dot(grad, oY)) * (1.0 - smoothstep(period * 0.16, period * 0.36, px));
    }

    // Height of the printed web and chest mark at uv.
    float print(vec2 uv) { vec3 m = texture2D(uSuitTex, uv).rgb; return m.g * WEB_H + m.b * MARK_H; }

    void main() {
      vec3 p = vObj;
      vec2 f2 = vec2(p.x, -p.y); // face plane, y down
      vec3 N = normalize(vN), V = normalize(vV);
      vec3 fw = fwidth(p);
      float px = (fw.x + fw.y + fw.z) * 0.6;
      float part = floor(vPart + 0.5);       // 0 suit, 1 mask, 2 lens frame, 3 lens
      float cloth = step(part, 1.5), frame = step(1.5, part) * step(part, 2.5), lens = step(2.5, part);
      float front = smoothstep(0.0, 0.25, p.z) * step(-1.0, p.y) * cloth;

      // derivatives first, outside any branch
      vec2 uvX = dFdx(vUv), uvY = dFdy(vUv);
      vec3 wX = dFdx(vW), wY = dFdy(vW), oX = dFdx(p), oY = dFdy(p);
      vec2 su = (f2 - uSeamRect.xy) / (uSeamRect.zw - uSeamRect.xy);
      vec2 suX = dFdx(su), suY = dFdy(su);
      float fold = texture2D(uDetailTex, vUv).r;
      vec2 foldD = vec2(dFdx(fold), dFdy(fold));

      // suit masks: r = main panels, g = web lines, b = chest spider
      vec3 m = texture2D(uSuitTex, vUv).rgb * cloth;
      vec3 base = mix(mix(mix(uBody, uMask, m.r), uWeb, m.g), uEmblem, m.b);
      float rub = max(m.g, m.b); // 0 soft cloth … 1 glossy print or metal

      // raised print: slope from the neighbouring texels, carried onto the screen
      float h0 = m.g * WEB_H + m.b * MARK_H;
      vec2 sl = vec2(print(vUv + vec2(TX, 0.0)) - h0, print(vUv + vec2(0.0, TX)) - h0) / TX;
      vec2 g = vec2(dot(sl, uvX), dot(sl, uvY));
      // the cloth: painted folds plus a fine weave (twill on the main panels, ribbed knit elsewhere)
      g += FOLD_H * foldD;
      vec2 twill = weave(p, oX, oY, 0.021, vec3(0.8, 0.6, 0.0), vec3(-0.6, 0.8, 0.0), px);
      vec2 rib = weave(p, oX, oY, 0.034, vec3(0.0, 0.96, 0.28), vec3(0.0, 0.96, 0.28), px);
      g += mix(rib * 0.0011, twill * 0.0007, m.r) * (1.0 - rub);
      // a raised thread just toward the light throws a soft shadow onto this spot
      vec2 toLight = KEY2.x * uvX + KEY2.y * uvY;
      vec3 near = texture2D(uSuitTex, vUv + toLight * 2.4, 1.0).rgb;
      float ao = max(near.g, near.b) * (1.0 - rub) * cloth;

      // the stitched seam, for suits that have one
      if (uSeam > 0.5 && inBox(su) > 0.5) {
        vec3 st = texture2D(uSeamTex, su).rgb * front;
        vec4 rl = relief(uSeamRel, su, uSeamK) * front;
        base = mix(base, base * 0.3, st.r);
        base = mix(base, uThread, st.g);
        g = g * (1.0 - max(st.r, st.g)) + SEAM_H * vec2(dot(rl.xy, suX), dot(rl.xy, suY));
        ao = max(ao * (1.0 - st.g), rl.w);
        rub = max(rub, st.g * 0.6);
      }
      // squint and blink: dark lids close over each lens, the top one travelling further.
      // Each lens pixel looks up where it would have been before the lids moved in.
      // (lens pixels only, so the mip level is picked by hand from the texture's footprint)
      float lodL = log2(max(max(length(uvX), length(uvY)) * 1024.0, 1.0));
      float shape = 1.0, grid = 1.0;
      if (lens > 0.5) {
        vec2 ld = vUv - uLensUvC;
        float al = dot(ld, uLensUvAx), ac = dot(ld, uLensUvUp);
        ac /= ac > 0.0 ? 1.0 - 0.7 * uSquint : 1.0 - 0.46 * uSquint;
        shape = textureLod(uLensTex, uLensUvC + uLensUvAx * al + uLensUvUp * ac, lodL + 3.0).r;
        grid = textureLod(uLensTex, vUv, lodL).r;
      }
      float open = lens * smoothstep(0.2, 0.34, shape);
      frame = max(frame, lens - open);
      lens = open;
      base = mix(base, uFrame, frame);
      rub = mix(rub, 1.0, frame);
      g *= cloth;

      // bend the normal by the relief (surface-gradient bump mapping, in world space)
      vec2 gs = g * uScale;
      vec3 r1 = cross(wY, N), r2 = cross(N, wX);
      float det = dot(wX, r1);
      vec3 nb = abs(det) * N - sign(det) * (gs.x * r1 + gs.y * r2);
      vec3 Nb = dot(nb, nb) > 1e-30 ? normalize(nb) : N;

      // light: a soft key from the front, the sun raking in from behind, sky fill opposite
      float keyM = clamp(dot(N, KEY) * 0.5 + 0.5, 0.0, 1.0); // the big forms only
      float key = clamp(dot(Nb, KEY) * 0.5 + 0.5, 0.0, 1.0);
      float sun = max(dot(Nb, uSun), 0.0);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
      float sunSide = smoothstep(-0.35, 0.5, dot(N, uSun));
      vec3 col = base * (0.2 + 0.95 * key * key) * (1.0 - 0.5 * ao);

      // screen-print dots in the shadows, following the big forms rather than the fine relief
      float shade = clamp(1.0 - keyM * 1.25, 0.0, 1.0);
      vec2 q = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / uDot;
      float hr = 0.52 * sqrt(shade);
      float dots = (1.0 - smoothstep(hr - 0.09, hr + 0.09, length(fract(q) - 0.5))) * step(0.04, hr);
      col = mix(col, col * 0.42, dots * 0.6 * (1.0 - lens));

      // highlights: a broad sheen on the cloth, a tight one on the print and the metal frames
      vec3 R = reflect(-V, Nb);
      vec3 skyR = texture2D(uLut, vec2(clamp(0.74 - R.y * 0.85, 0.02, 0.98), 0.5)).rgb;
      float nh = max(dot(Nb, normalize(KEY + V)), 0.0);
      col += mix(0.07 * pow(nh, 8.0), 0.62 * pow(nh, 34.0), rub) * vec3(1.0, 0.95, 0.88) * (1.0 - lens);
      col += frame * skyR * (0.12 + 0.3 * fres);

      // lenses: pale glass over a fine mesh, mirroring the sky
      vec3 lc = mix(uLens, skyR, 0.2) * (0.72 + 0.4 * key) * mix(0.74, 1.0, grid);
      lc *= 0.62 + 0.38 * smoothstep(0.34, 0.75, shape); // set back under the frame: darker at the rim
      float gl = 1.0 - smoothstep(0.0, 0.035, abs(vUv.x - 0.4 + (vUv.y - 0.44) * 0.62) - 0.035);
      gl += 0.55 * (1.0 - smoothstep(0.0, 0.02, abs(vUv.x - 0.52 + (vUv.y - 0.44) * 0.62) - 0.012));
      lc += gl * 0.3 + pow(max(dot(R, uSun), 0.0), 24.0) * uRim * 0.8;
      float sweep = 1.0 - smoothstep(0.0, 0.16, abs(f2.x + f2.y * 0.32 - mix(-1.0, 1.0, uSheen)));
      lc += sweep * step(0.0, uSheen) * 0.75;
      col = mix(col, lc, lens);

      float low = smoothstep(-2.7, -1.7, p.y);
      col += uRim * (sun * 0.95 + fres * sunSide * 1.5 * low) * (1.0 - lens * 0.6);
      col += uFill * fres * (1.0 - sunSide) * 0.55;
      col = mix(col, vec3(0.012, 0.016, 0.043), smoothstep(-1.9, -3.25, p.y) * 0.9);
      col *= mix(0.25, 1.0, uFade); // brief dip while the suit changes
      gl_FragColor = vec4(grain(col), 1.0);
    }`;

  /* ---------- hero model ---------- */

  async function inflate(b64) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function imageTexture(src, aniso) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const t = new T.Texture(img);
        t.anisotropy = aniso;
        t.needsUpdate = true;
        resolve(t);
      };
      img.onerror = () => reject(new Error('texture failed to decode'));
      img.src = src;
    });
  }

  /** Turns SMR.heroModel (quantised, compressed) into a geometry and its three textures. */
  async function unpackHero(src, aniso) {
    const [buf, suit, detail, lens] = await Promise.all([inflate(src.mesh), imageTexture(src.suit, aniso), imageTexture(src.detail, aniso), imageTexture(src.lens, aniso)]);
    const meta = src.meta, V = meta.V, bb = meta.bb, at = {};
    for (const [name, off, len, type] of meta.layout) at[name] = new window[type](buf.buffer, buf.byteOffset + off, len);
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2), part = new Float32Array(V);
    for (let i = 0; i < V; i++) {
      for (let a = 0; a < 3; a++) {
        pos[i * 3 + a] = bb[a] + (at.pos[i * 3 + a] / 65535) * (bb[a + 3] - bb[a]);
        nor[i * 3 + a] = at.nor[i * 4 + a] / 127;
      }
      uv[i * 2] = at.uv[i * 2] / 65535;
      uv[i * 2 + 1] = at.uv[i * 2 + 1] / 65535;
      part[i] = at.part[i];
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    geometry.setAttribute('aPart', new T.BufferAttribute(part, 1));
    geometry.setIndex(new T.BufferAttribute(new Uint16Array(at.index), 1));
    // the "wide" lens shape key, stored sparse: only the vertices it moves
    for (const [key, attr] of [['wide', 'aWide']]) {
      const dense = new Float32Array(V * 3), ids = at[key + '.ids'], d = at[key + '.d'], s = meta.morphs[key].scale / 32767;
      for (let j = 0; j < ids.length; j++) for (let a = 0; a < 3; a++) dense[ids[j] * 3 + a] = d[j * 3 + a] * s;
      geometry.setAttribute(attr, new T.BufferAttribute(dense, 3));
    }
    // the lens artwork in texture space: its centre, its long axis, and which way is up the
    // face (both lenses share the artwork, mirrored), so the lids can close over it
    let cu = 0, cv = 0, cy = 0, n = 0;
    for (let i = 0; i < V; i++) if (part[i] === 3 && pos[i * 3] > 0) { cu += uv[i * 2]; cv += uv[i * 2 + 1]; cy += pos[i * 3 + 1]; n++; }
    cu /= n; cv /= n; cy /= n;
    let suu = 0, suv = 0, svv = 0;
    for (let i = 0; i < V; i++) if (part[i] === 3 && pos[i * 3] > 0) { const du = uv[i * 2] - cu, dv = uv[i * 2 + 1] - cv; suu += du * du; suv += du * dv; svv += dv * dv; }
    const ang = 0.5 * Math.atan2(2 * suv, suu - svv);
    const ax = new T.Vector2(Math.cos(ang), Math.sin(ang));
    let up = new T.Vector2(-ax.y, ax.x), corr = 0;
    for (let i = 0; i < V; i++) if (part[i] === 3 && pos[i * 3] > 0) corr += ((uv[i * 2] - cu) * up.x + (uv[i * 2 + 1] - cv) * up.y) * (pos[i * 3 + 1] - cy);
    if (corr < 0) up = up.negate();
    return { geometry, suit, detail, lens, lensC: new T.Vector2(cu, cv), lensAx: ax, lensUp: up };
  }

  function color(hex) { const c = U.hexToRgb(hex); return new T.Vector3(c[0] / 255, c[1] / 255, c[2] / 255); }

  function mergeGeometries(list) {
    const parts = list.map((g) => g.toNonIndexed());
    const count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length; }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    return out;
  }

  /** True when WebGL is being drawn by the CPU (no usable graphics card). */
  function softwareGL() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return false;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }

  function createStage(glCanvas, fxCanvas) {
    const soft = softwareGL();
    const budget = soft ? { floor: 0.2e6, low: 0.35e6, start: 0.5e6, high: 0.9e6 } : BUDGET;
    const renderer = new T.WebGLRenderer({ canvas: glCanvas, antialias: !soft, alpha: false, stencil: false, powerPreference: 'high-performance' });
    renderer.autoClear = false;
    const fg = fxCanvas.getContext('2d');
    const view = { w: 1920, h: 1080, scale: 1, glScale: 1, cssW: 0, cssH: 0, res: 1 };

    const cityScene = new T.Scene(), heroScene = new T.Scene();
    const cityCam = new T.PerspectiveCamera(38, 16 / 9, 2, 14000);
    const heroCam = new T.PerspectiveCamera(HERO_FOV, 16 / 9, 0.5, 60);
    heroCam.position.set(0, 0, HERO_DIST);

    let pal = SMR.palettes.dawn, suit = null;
    const hero = { x: 0, y: 0, ppu: 250 };
    const orb = { x: 0, y: 0, r: 200 };
    const cam = Object.assign({}, SHOTS.title);
    let shot = SHOTS.title, shotName = 'title';
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, nx: 0, ny: 0, sx: 0, sy: 0, active: false };
    const eyes = { squint: 0.05, mood: 'neutral', blink: -1, nextBlink: 3.5, sheen: -1, nextSheen: 5, widen: 0 };
    const opts = { motion: true, parallax: true, grain: true };
    const perf = { quality: 'auto', res: 1, min: 0.5, max: 1, ceiling: Infinity, ema: 16.7, slow: 0, fast: 0, cooldown: 0, lastDrop: null, stuck: false };
    const sunDir = new T.Vector3(0, 0.08, -1);
    let running = false, held = false, last = 0, time = 0, idle = false, fpsCb = null, fpsAcc = 0, fpsN = 0;

    /* ---------- shared uniforms ---------- */
    const lut = new T.CanvasTexture(U.makeCanvas(256, 2));
    lut.minFilter = lut.magFilter = T.LinearFilter; lut.generateMipmaps = false;
    const fogU = {
      uHazeLow: { value: new T.Vector3() }, uHazeHigh: { value: new T.Vector3() }, uGlow: { value: new T.Vector3() },
      uSunDir: { value: sunDir }, uFog: { value: 0.00052 },
    };
    const timeU = { value: 0 }, grainU = { value: 0.12 };

    /* ---------- sky ---------- */
    const skyMat = new T.ShaderMaterial({
      vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthTest: true, depthWrite: false,
      uniforms: {
        uLut: { value: lut }, uSunDir: { value: sunDir }, uCore: { value: new T.Vector3() }, uMid: { value: new T.Vector3() },
        uEdge: { value: new T.Vector3() }, uSunGlow: { value: new T.Vector3() }, uHalo: { value: new T.Vector3() },
        uRays: { value: new T.Vector4() }, uSunPx: { value: new T.Vector2() }, uSunRpx: { value: 200 },
        uTime: timeU, uStars: { value: 1 }, uMotion: { value: 1 }, uGrain: grainU,
      },
    });
    const sky = new T.Mesh(new T.SphereGeometry(1, 24, 16), skyMat);
    sky.frustumCulled = false; sky.renderOrder = 10; // after the city: only uncovered sky gets shaded
    cityScene.add(sky);

    /* ---------- city ---------- */
    const cityU = Object.assign({
      uWallA: { value: new T.Vector3() }, uWallB: { value: new T.Vector3() }, uRimC: { value: new T.Vector3() }, uFillC: { value: new T.Vector3() },
      uWin0: { value: new T.Vector3() }, uWin1: { value: new T.Vector3() }, uWin2: { value: new T.Vector3() }, uTime: timeU, uGrain: grainU,
    }, fogU);
    const cityMat = new T.ShaderMaterial({ vertexShader: CITY_VS, fragmentShader: CITY_FS, uniforms: cityU });
    const groundMat = new T.ShaderMaterial({
      vertexShader: 'varying vec3 vWorld; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader: GROUND_FS, uniforms: Object.assign({ uInk: { value: new T.Vector3() }, uTime: timeU, uGrain: grainU }, fogU),
    });
    const lightMat = new T.ShaderMaterial({
      vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS, uniforms: { uTime: timeU, uPx: { value: 14 } },
      blending: T.AdditiveBlending, depthWrite: false, transparent: true,
    });
    const cityGroup = new T.Group();
    cityScene.add(cityGroup);

    function buildCity() {
      while (cityGroup.children.length) { const c = cityGroup.children.pop(); c.geometry.dispose(); }
      const r = U.rng(20261112);
      const boxes = [], tanks = [], cones = [], lights = [];
      const GRID = 0.5, cg = Math.cos(GRID), sg = Math.sin(GRID), PITCH = 74;
      const sunAz = Math.atan2(sunDir.x, -sunDir.z);
      const box = (x, y, z, sx, sy, sz, seed, plain, lit) => boxes.push({ x, y, z, sx, sy, sz, seed, plain, lit });

      function tower(wx, wz, w, dep, h, seed, lit, spire) {
        const h1 = h * r.range(0.6, 0.78), h2 = h * r.range(0.86, 0.94);
        box(wx, 0, wz, w, h1, dep, seed, 0, lit);
        box(wx, h1, wz, w * 0.72, h2 - h1, dep * 0.72, seed, 0, lit);
        box(wx, h2, wz, w * 0.46, h - h2, dep * 0.46, seed, 0, lit);
        if (spire) {
          const ch = r.range(34, 60), needle = r.range(30, 60);
          cones.push({ x: wx, y: h, z: wz, r: w * 0.2, h: ch, seed });
          box(wx, h + ch - 2, wz, 1.6, needle, 1.6, seed, 1, 0);
          lights.push(wx, h + ch + needle - 2, wz);
        } else if (r.chance(0.5)) {
          const needle = r.range(20, 46);
          box(wx + w * 0.1, h, wz, 1.4, needle, 1.4, seed, 1, 0);
          lights.push(wx + w * 0.1, h + needle, wz);
        }
      }

      for (let i = -62; i <= 62; i++) for (let j = -62; j <= 62; j++) {
        const gx = i * PITCH + Math.floor(i / 4) * 16, gz = j * PITCH + Math.floor(j / 5) * 20;
        const wx = gx * cg - gz * sg, wz = gx * sg + gz * cg;
        const d = Math.hypot(wx, wz), ang = Math.atan2(wx, -wz);
        const seed = r.range(1, 99), lit = pal.windowLit * r.range(0.2, 1.25);
        const pick = r(), hr = r(), wr = r.range(0.6, 0.86), dr = r.range(0.6, 0.86), clutter = r(), cx = r.range(-0.2, 0.2);
        if (d < 62 || d > 3700 || Math.abs(ang) > 1.02) continue;
        const cluster = 0.5 + 0.5 * Math.sin(wx * 0.0042 + 1.3) * Math.cos(wz * 0.0031);
        const w = PITCH * wr, dep = PITCH * dr;
        let h;
        const isTower = d > 330 && pick < U.smoothstep(300, 1500, d) * 0.4 * (0.5 + cluster);
        if (d < 330) h = 22 + hr * 46;
        else if (isTower) h = (125 + hr * 190) * (0.72 + 0.5 * cluster);
        else h = (34 + hr * 76) * U.lerp(0.8, 1.3, U.smoothstep(300, 1500, d));
        const off = Math.abs(ang - sunAz);
        if (d > 520 && off < 0.16) h *= U.lerp(0.5, 1, off / 0.16);
        if (isTower) tower(wx, wz, w, dep, h, seed, lit, hr > 0.62);
        else {
          box(wx, 0, wz, w, h, dep, seed, 0, lit);
          if (d < 1100) {
            box(wx, h, wz, w + 1.2, 1.1, dep + 1.2, seed, 1, 0); // parapet
            if (clutter < 0.34) tanks.push({ x: wx + w * cx, y: h + 1, z: wz + dep * cx, s: 1 + hr * 0.5 });
            else if (clutter < 0.8) box(wx + w * cx, h, wz - dep * cx, w * 0.3, 3 + hr * 4, dep * 0.26, seed, 1, 0);
            if (clutter > 0.72) { const a = 8 + hr * 16; box(wx - w * 0.3, h, wz + dep * 0.3, 0.5, a, 0.5, seed, 1, 0); if (a > 18) lights.push(wx - w * 0.3, h + a, wz + dep * 0.3); }
          }
        }
      }
      // two landmarks that stand in front of the sun
      const lm = (az, dist, h, w) => tower(Math.sin(az) * dist, -Math.cos(az) * dist, w, w, h, 7.7, pal.windowLit, true);
      lm(sunAz - 0.058, 1750, 455, 86);
      lm(sunAz + 0.034, 2350, 400, 70);

      // drop what the camera never sees: everything outside its widest view, beyond the nearest blocks
      const inView = (x, z) => { const d = Math.hypot(x, z); return Math.abs(Math.atan2(x, -z)) <= (d < 450 ? 1.02 : 0.8); };
      const visible = (list) => list.filter((o) => inView(o.x, o.z));
      const kept = { boxes: visible(boxes), tanks: visible(tanks), cones: visible(cones), lights: [] };
      for (let i = 0; i < lights.length; i += 3) if (inView(lights[i], lights[i + 2])) kept.lights.push(lights[i], lights[i + 1], lights[i + 2]);
      boxes.length = 0; boxes.push(...kept.boxes);
      tanks.length = 0; tanks.push(...kept.tanks);
      cones.length = 0; cones.push(...kept.cones);
      lights.length = 0; lights.push(...kept.lights);
      // nearest first: the depth test then throws away hidden walls before they are shaded
      boxes.sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));
      const quat = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -GRID);
      const m = new T.Matrix4(), v = new T.Vector3(), s = new T.Vector3();
      const boxGeo = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const info = new Float32Array(boxes.length * 4);
      const mesh = new T.InstancedMesh(boxGeo, cityMat, boxes.length);
      boxes.forEach((b, i) => {
        m.compose(v.set(b.x, b.y, b.z), quat, s.set(b.sx, b.sy, b.sz));
        mesh.setMatrixAt(i, m);
        info.set([b.seed, b.plain, b.lit, 0], i * 4);
      });
      boxGeo.setAttribute('aInfo', new T.InstancedBufferAttribute(info, 4));
      mesh.frustumCulled = false;
      cityGroup.add(mesh);

      const coneGeo = new T.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
      const cInfo = new Float32Array(cones.length * 4);
      const cMesh = new T.InstancedMesh(coneGeo, cityMat, Math.max(1, cones.length));
      cones.forEach((c, i) => { m.compose(v.set(c.x, c.y, c.z), quat, s.set(c.r, c.h, c.r)); cMesh.setMatrixAt(i, m); cInfo.set([c.seed, 1, 0, 0], i * 4); });
      coneGeo.setAttribute('aInfo', new T.InstancedBufferAttribute(cInfo, 4));
      cMesh.count = cones.length; cMesh.frustumCulled = false;
      cityGroup.add(cMesh);

      // water towers: tank, cap and four legs merged into one small model
      const legs = [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([lx, lz]) => new T.BoxGeometry(0.32, 4.8, 0.32).translate(lx, 2.4, lz));
      const tankGeo = mergeGeometries([new T.CylinderGeometry(2.7, 2.7, 4.6, 9, 1, true).translate(0, 7, 0), new T.ConeGeometry(3.05, 2, 9, 1, true).translate(0, 10.3, 0)].concat(legs));
      const tInfo = new Float32Array(tanks.length * 4);
      const tMesh = new T.InstancedMesh(tankGeo, cityMat, Math.max(1, tanks.length));
      tanks.forEach((t, i) => { m.compose(v.set(t.x, t.y, t.z), quat, s.set(t.s, t.s, t.s)); tMesh.setMatrixAt(i, m); tInfo.set([3.3, 1, 0, 0], i * 4); });
      tankGeo.setAttribute('aInfo', new T.InstancedBufferAttribute(tInfo, 4));
      tMesh.count = tanks.length; tMesh.frustumCulled = false;
      cityGroup.add(tMesh);

      const lg = new T.BufferGeometry();
      lg.setAttribute('position', new T.BufferAttribute(new Float32Array(lights), 3));
      lg.setAttribute('aPhase', new T.BufferAttribute(new Float32Array(lights.length / 3).map((_, i) => (i * 1.618) % 2.2), 1));
      const pts = new T.Points(lg, lightMat);
      pts.frustumCulled = false;
      cityGroup.add(pts);

      const ground = new T.Mesh(new T.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), groundMat);
      ground.frustumCulled = false;
      cityGroup.add(ground);
    }

    /* ---------- hero ---------- */
    // The bust is the 3D model in SMR.heroModel (js/scene/heromodel.js). It is unpacked once
    // at start; until then (a few frames) the hero is simply not drawn. The suit's colours are
    // applied through the model's masks, and the stitched seam is painted on for suits that have one.
    const seamCanvas = U.makeCanvas(528, 640);
    SMR.heroArt.paintSeam(seamCanvas);
    const seamTex = new T.CanvasTexture(seamCanvas);
    seamTex.flipY = false; seamTex.generateMipmaps = false; seamTex.minFilter = seamTex.magFilter = T.LinearFilter;
    const SR = SMR.heroArt.SEAM_RECT;
    const relTex = (m) => {
      const t = new T.DataTexture(m.data, m.w, m.h, T.RGBAFormat);
      t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
      return t;
    };
    const blank = relTex({ data: new Uint8Array([0, 0, 0, 255]), w: 1, h: 1 });
    const heroU = {
      uMask: { value: new T.Vector3() }, uBody: { value: new T.Vector3() }, uWeb: { value: new T.Vector3() }, uFrame: { value: new T.Vector3() },
      uLens: { value: new T.Vector3() }, uEmblem: { value: new T.Vector3() }, uThread: { value: new T.Vector3() },
      uRim: { value: new T.Vector3() }, uFill: { value: new T.Vector3() }, uSun: { value: new T.Vector3(-0.74, 0.2, -0.64).normalize() },
      uSuitTex: { value: blank }, uDetailTex: { value: blank }, uLensTex: { value: blank }, uLut: { value: lut },
      uSeamTex: { value: seamTex }, uSeamRel: { value: relTex({ data: new Uint8Array([128, 128, 0, 0]), w: 1, h: 1 }) }, uSeamK: { value: new T.Vector2() },
      uSeamRect: { value: new T.Vector4(SR[0], SR[1], SR[2], SR[3]) }, uScale: { value: 1 },
      uSeam: { value: 1 }, uSheen: { value: -1 }, uDot: { value: 7 }, uFade: { value: 1 }, uSquint: { value: 0.05 }, uWiden: { value: 0 },
      uLensUvC: { value: new T.Vector2(0.46, 0.44) }, uLensUvAx: { value: new T.Vector2(1, 0) }, uLensUvUp: { value: new T.Vector2(0, 1) },
      uTime: timeU, uGrain: grainU, uYaw: { value: 0 }, uPitch: { value: 0 },
    };
    const heroMat = new T.ShaderMaterial({ vertexShader: HERO_VS, fragmentShader: HERO_FS, uniforms: heroU });
    const heroMesh = new T.Mesh(new T.BufferGeometry(), heroMat);
    heroMesh.frustumCulled = false;
    heroMesh.visible = false;
    heroScene.add(heroMesh);

    unpackHero(SMR.heroModel, soft ? 1 : Math.min(4, renderer.capabilities.getMaxAnisotropy())).then((h) => {
      heroMesh.geometry.dispose();
      heroMesh.geometry = h.geometry;
      heroU.uSuitTex.value = h.suit; heroU.uDetailTex.value = h.detail; heroU.uLensTex.value = h.lens;
      heroU.uLensUvC.value.copy(h.lensC); heroU.uLensUvAx.value.copy(h.lensAx); heroU.uLensUvUp.value.copy(h.lensUp);
      heroMesh.visible = true;
      suitFade = 0; // fade up from the dip, like a suit change
    }).catch((err) => console.warn('Spider-Man: Rebirth could not unpack the hero model.', err));

    // the seam's relief map is small, but it still waits for idle time after the first frames
    const whenIdle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 300 }) : (f) => setTimeout(f, 40);
    whenIdle(() => {
      const m = SMR.heroArt.seamRelief(264, 320);
      heroU.uSeamRel.value.dispose();
      heroU.uSeamRel.value = relTex(m);
      heroU.uSeamK.value.set(m.k[0], m.k[1]);
    });
    let suitFade = 1, suitNext = null;

    function applySuit(s) {
      heroU.uMask.value.copy(color(s.mask)); heroU.uBody.value.copy(color(s.body)); heroU.uWeb.value.copy(color(s.web));
      heroU.uFrame.value.copy(color(s.frame)); heroU.uLens.value.copy(color(s.lens)); heroU.uEmblem.value.copy(color(s.emblem));
      heroU.uThread.value.copy(color(s.thread || '#e9dcc6')); heroU.uSeam.value = s.seam ? 1 : 0;
    }

    /* ---------- palette ---------- */
    function applyPalette() {
      const g = lut.image.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 256, 0);
      pal.sky.forEach(([stop, c]) => grad.addColorStop(stop, c));
      g.fillStyle = grad; g.fillRect(0, 0, 256, 2);
      lut.needsUpdate = true;
      const su = skyMat.uniforms;
      su.uCore.value.copy(color(pal.orb.core)); su.uMid.value.copy(color(pal.orb.mid)); su.uEdge.value.copy(color(pal.orb.edge));
      su.uSunGlow.value.copy(color(pal.orb.glow)); su.uHalo.value.copy(color(pal.orb.halo));
      su.uRays.value.set(pal.rays[0] / 255, pal.rays[1] / 255, pal.rays[2] / 255, pal.rays[3]);
      su.uStars.value = pal.stars;
      fogU.uHazeLow.value.copy(color(pal.far[1])); fogU.uHazeHigh.value.copy(color(pal.far[0])); fogU.uGlow.value.copy(color(pal.orb.mid));
      cityU.uWallA.value.copy(color(pal.near[0])); cityU.uWallB.value.copy(color(U.mix(pal.near[0], pal.near[1], 0.7)));
      cityU.uRimC.value.copy(color(pal.rim)); cityU.uFillC.value.copy(color(pal.fill));
      cityU.uWin0.value.copy(color(pal.windows[0])); cityU.uWin1.value.copy(color(pal.windows[2])); cityU.uWin2.value.copy(color(pal.windows[4]));
      groundMat.uniforms.uInk.value.copy(color(pal.front));
      heroU.uRim.value.copy(color(pal.rim)); heroU.uFill.value.copy(color(pal.fill));
    }

    /* ---------- layout ---------- */
    function layout() {
      const a = view.w / view.h;
      if (a >= 1.45) { hero.ppu = 250; hero.x = view.w * 0.735; hero.y = 505; }
      else if (a >= 1.0) { hero.ppu = 232; hero.x = view.w * 0.75; hero.y = 520; }
      else { hero.ppu = 205; hero.x = view.w * 0.62; hero.y = 690; }
      orb.r = hero.ppu * 0.86; orb.x = hero.x - hero.ppu * 1.36; orb.y = hero.y + hero.ppu * 0.6;
      // aim the sun so it lands on that spot of the title shot
      cityCam.aspect = heroCam.aspect = a;
      cityCam.fov = SHOTS.title.fov;
      cityCam.position.set(0, CAM_HEIGHT, 0);
      cityCam.rotation.set(SHOTS.title.pitch * DEG, 0, 0, 'YXZ');
      cityCam.updateProjectionMatrix(); cityCam.updateMatrixWorld();
      const ndc = new T.Vector3((orb.x / view.w) * 2 - 1, 1 - (orb.y / view.h) * 2, 0.5).unproject(cityCam);
      sunDir.copy(ndc.sub(cityCam.position).normalize());
      heroCam.updateProjectionMatrix();
    }

    function pickRes() {
      const dpr = window.devicePixelRatio || 1, area = view.cssW * view.cssH;
      const fit = (px) => Math.sqrt(px / area);
      perf.min = Math.min(dpr, Math.max(soft ? 0.3 : 0.5, fit(budget.floor)));
      perf.max = perf.quality === 'low' ? Math.min(dpr, Math.max(perf.min, fit(budget.low))) : Math.min(dpr, 2, fit(budget.high));
      const start = perf.quality === 'auto' ? Math.min(perf.max, fit(budget.start), perf.ceiling) : perf.max;
      return Math.max(perf.min, start);
    }

    /** Change only the drawing resolution; the layout and the city stay as they are. */
    function applyRes(res) {
      perf.res = view.res = res;
      renderer.setPixelRatio(res);
      renderer.setSize(view.cssW, view.cssH, false);
      const fxRes = Math.min(res, 1.25);
      fxCanvas.width = Math.round(view.cssW * fxRes); fxCanvas.height = Math.round(view.cssH * fxRes);
      view.scale = fxCanvas.height / 1080;
      view.glScale = renderer.domElement.height / 1080;
      view.w = (view.cssW / view.cssH) * 1080; view.h = 1080;
      heroU.uDot.value = Math.max(4, 7.2 * view.glScale);
      lightMat.uniforms.uPx.value = 15 * view.glScale;
    }
    function setRes(res) { applyRes(res); perf.slow = perf.fast = 0; perf.ema = 16.7; perf.cooldown = 500; }

    /** Auto quality: lower the resolution while frames run slow, try a little higher after a long smooth stretch. */
    function adapt(gap) {
      if (perf.quality !== 'auto') return;
      if (perf.cooldown > 0) { perf.cooldown -= gap; return; }
      gap = Math.min(gap, 100);
      perf.ema += (gap - perf.ema) * 0.08;
      if (perf.ema > 23) {
        perf.slow += gap; perf.fast = 0;
        if (perf.slow > 700 && !perf.stuck && perf.res > perf.min + 0.01) {
          if (perf.lastDrop && perf.ema > perf.lastDrop.ema * 0.9) {
            // the last drop did not help, so something else caps the frame rate (battery saver, a 30 Hz screen)
            perf.stuck = true; setRes(perf.lastDrop.res); return;
          }
          perf.lastDrop = { res: perf.res, ema: perf.ema };
          perf.ceiling = perf.res * 0.94;
          setRes(Math.max(perf.min, perf.res * 0.8));
        }
      } else if (perf.ema < 18.5) {
        perf.fast += gap; perf.slow = 0;
        if (perf.fast > 6000) {
          perf.fast = 0;
          const next = Math.min(perf.max, perf.ceiling, perf.res * 1.12);
          if (next > perf.res + 0.02) setRes(next);
        }
      } else { perf.slow = Math.max(0, perf.slow - gap); perf.fast = 0; }
    }

    function resize() {
      const cssW = glCanvas.clientWidth || window.innerWidth, cssH = glCanvas.clientHeight || window.innerHeight;
      if (!cssW || !cssH) return;
      view.cssW = cssW; view.cssH = cssH;
      applyRes(pickRes());
      layout();
      applyPalette();
      buildCity();
      webSim.rebuild(view, pal);
      fx.rebuild(view, pal);
      render();
    }

    /* ---------- 2D overlay ---------- */
    const webSim = SMR.createWeb(), fx = SMR.createFx();

    /* ---------- frame ---------- */
    function update(dt) {
      const k = U.clamp(view.w / 1920, 0.35, 1);
      const rate = opts.motion ? 3.2 : 60;
      for (const key of ['yaw', 'pitch', 'fwd', 'fov', 'hy', 'hs']) cam[key] = U.damp(cam[key], shot[key], key === 'fwd' || key === 'fov' ? rate * 0.55 : rate, dt);
      cam.hx = U.damp(cam.hx, shot.hx * k, rate, dt);

      pointer.vx = U.damp(pointer.vx, 0, 10, dt); pointer.vy = U.damp(pointer.vy, 0, 10, dt);
      const usePointer = opts.parallax && opts.motion;
      pointer.sx = U.damp(pointer.sx, usePointer ? pointer.nx : 0, 2.8, dt);
      pointer.sy = U.damp(pointer.sy, usePointer ? pointer.ny : 0, 2.8, dt);

      let goal = MOODS[eyes.mood];
      if (opts.motion) {
        eyes.nextBlink -= dt;
        if (eyes.nextBlink <= 0 && eyes.blink < 0) { eyes.blink = 0; eyes.nextBlink = 3 + Math.random() * 6; }
        if (eyes.blink >= 0) { eyes.blink += dt / 0.24; if (eyes.blink >= 1) eyes.blink = -1; else goal = Math.max(goal, Math.sin(eyes.blink * Math.PI) * 0.96); }
        eyes.nextSheen -= dt;
        if (eyes.nextSheen <= 0 && eyes.sheen < 0) { eyes.sheen = 0; eyes.nextSheen = 7 + Math.random() * 7; }
        if (eyes.sheen >= 0) { eyes.sheen += dt / 0.85; if (eyes.sheen >= 1) eyes.sheen = -1; }
      } else { eyes.blink = -1; eyes.sheen = -1; }
      eyes.widen = U.damp(eyes.widen, 0, 5, dt);
      eyes.squint = U.damp(eyes.squint, U.clamp(goal - eyes.widen, 0, 1), eyes.blink >= 0 ? 40 : 11, dt);

      if (suitNext) {
        suitFade -= dt / 0.14;
        if (suitFade <= 0) { applySuit(suitNext); suitNext = null; }
      } else if (suitFade < 1) suitFade = Math.min(1, suitFade + dt / 0.2);

      webSim.update(dt, time, pointer, opts.motion);
      fx.update(dt, time, idle, opts.motion);
    }

    function render() {
      if (!view.cssW || !suit) return;
      const drift = opts.motion ? Math.sin(time * 0.07) : 0;
      // city camera
      cityCam.fov = cam.fov;
      cityCam.rotation.set(cam.pitch * DEG - pointer.sy * 0.012, -(cam.yaw * DEG + pointer.sx * 0.02 + drift * 0.006), 0, 'YXZ');
      cityCam.position.set(pointer.sx * 9 + drift * 5, CAM_HEIGHT - pointer.sy * 4 + cam.fwd * 0.05, -cam.fwd);
      cityCam.updateProjectionMatrix(); cityCam.updateMatrixWorld();
      sky.scale.setScalar(9000);
      const sp = sunDir.clone().multiplyScalar(5000).add(cityCam.position).project(cityCam);
      const pxH = renderer.domElement.height, pxW = renderer.domElement.width;
      skyMat.uniforms.uSunPx.value.set((sp.x * 0.5 + 0.5) * pxW, (sp.y * 0.5 + 0.5) * pxH);
      skyMat.uniforms.uSunRpx.value = orb.r * view.glScale * (38 / cam.fov);
      skyMat.uniforms.uMotion.value = opts.motion ? 1 : 0;
      timeU.value = time;

      // hero placement (pixels → hero-scene units)
      const breath = opts.motion ? Math.sin(time * 0.95) : 0;
      const unit = 1080 / (2 * HERO_DIST * Math.tan((HERO_FOV * DEG) / 2));
      const hx = hero.x + cam.hx - pointer.sx * 30 - drift * 12, hy = hero.y + cam.hy - pointer.sy * 12 + breath * 2.2;
      heroMesh.position.set((hx - view.w / 2) / unit, (540 - hy) / unit, 0);
      heroMesh.scale.setScalar((hero.ppu / unit) * cam.hs);
      heroU.uScale.value = heroMesh.scale.x;
      heroMesh.rotation.set(0, Math.atan2(heroMesh.position.x, HERO_DIST) * 0.9 + pointer.sx * 0.1, -0.03, 'YXZ');
      heroU.uYaw.value = pointer.sx * 0.42 - 0.06;
      heroU.uPitch.value = pointer.sy * 0.2;
      heroU.uSheen.value = eyes.sheen;
      heroU.uSquint.value = eyes.squint;
      heroU.uWiden.value = eyes.widen;
      heroU.uFade.value = U.smooth(U.clamp(suitFade, 0, 1)); // a quick dip hides the colour swap

      renderer.clear();
      renderer.render(cityScene, cityCam);
      renderer.clearDepth();
      renderer.render(heroScene, heroCam);

      // overlay
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
      fg.setTransform(view.scale, 0, 0, view.scale, 0, 0);
      const px = -(pointer.sx * 26 + drift * 12), py = -pointer.sy * 11;
      const up = (cam.pitch - 8.6) * 26;
      webSim.draw(fg, px * 0.85, py * 0.85 + up, time);
      webSim.drawShots(fg);
      fx.drawDust(fg, px * 1.3, py * 1.3, { x: orb.x, y: orb.y + up }, time);
      fx.drawSpider(fg, view.w * 0.47, time);
    }

    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const gap = now - last;
      if (gap < MIN_GAP) return; // high-refresh screens: no need to draw more than ~60-70 times a second
      last = now;
      const dt = Math.min(0.05, gap / 1000 || 0.016);
      time += dt;
      update(dt); render();
      adapt(gap);
      if (fpsCb) { fpsAcc += gap / 1000; fpsN++; if (fpsAcc >= 0.5) { fpsCb(Math.round(fpsN / fpsAcc), Math.round(renderer.domElement.height)); fpsAcc = 0; fpsN = 0; } }
    }
    function start() { if (running || held) return; running = true; last = performance.now(); requestAnimationFrame(frame); }

    function toVirtual(clientX, clientY) {
      const rect = glCanvas.getBoundingClientRect();
      return { x: ((clientX - rect.left) / rect.width) * view.w, y: ((clientY - rect.top) / rect.height) * view.h };
    }

    return {
      resize,
      start,
      stop() { running = false; },
      /** Stop drawing while something opaque covers the whole view. */
      hold(v) { held = v; if (v) running = false; else start(); },
      setQuality(q) {
        if (q === perf.quality) return;
        perf.quality = q; perf.ceiling = Infinity; perf.stuck = false; perf.lastDrop = null;
        if (view.cssW) setRes(pickRes());
      },
      setShot(name, instant) {
        if (!SHOTS[name]) return;
        shot = SHOTS[name]; shotName = name;
        if (instant) Object.assign(cam, shot, { hx: shot.hx * U.clamp(view.w / 1920, 0.35, 1) });
      },
      getShot: () => shotName,
      setSuit(next, instant) {
        if (!suit || instant) { suit = next; applySuit(next); suitNext = null; suitFade = 1; return; }
        suit = next; suitNext = next;
      },
      setPalette(name) {
        const next = SMR.palettes[name] || SMR.palettes.dawn;
        if (next === pal) return;
        pal = next;
        if (view.cssW) { applyPalette(); buildCity(); webSim.rebuild(view, pal); fx.rebuild(view, pal); }
      },
      setOptions(o) { Object.assign(opts, o); grainU.value = opts.grain ? 0.12 : 0; },
      setMood(mood) { if (mood in MOODS) eyes.mood = mood; },
      react() { eyes.widen = 0.5; if (eyes.sheen < 0) eyes.sheen = 0; },
      setIdle(v) { idle = v; },
      onFps(cb) { fpsCb = cb; },
      pointerMove(clientX, clientY) {
        const p = toVirtual(clientX, clientY);
        if (pointer.active) { pointer.vx = p.x - pointer.x; pointer.vy = p.y - pointer.y; }
        pointer.x = p.x; pointer.y = p.y;
        pointer.nx = U.clamp((p.x / view.w) * 2 - 1, -1, 1); pointer.ny = U.clamp((p.y / view.h) * 2 - 1, -1, 1);
        pointer.active = true;
      },
      pointerLeave() { pointer.active = false; pointer.nx = 0; pointer.ny = 0; },
      fireWeb(clientX, clientY) {
        const p = toVirtual(clientX, clientY);
        webSim.shoot(hero.x + cam.hx - hero.ppu * 1.9, view.h + 40, p.x, p.y);
        eyes.widen = 0.35;
      },
      step(dt) { time += dt; update(dt); render(); },
      debug: { view, hero, orb, cam, eyes, pointer, perf, renderer, sky, cityGroup, heroMesh, fxCanvas, soft },
    };
  }

  SMR.createStage = createStage;
  // the game draws the same sky and buildings, so it borrows these
  SMR.shaders = { GRAIN_GLSL, FOG_GLSL, SKY_VS, SKY_FS, CITY_VS, CITY_FS };
})();
