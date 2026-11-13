/* The playable hero: the full-body model from SMR.heroRig, skinned to its skeleton and coloured
   per suit from the same masks as the menu bust. The model has no animation of its own, so every
   pose is built here each frame: arms and legs are aimed along directions in the body's own
   space (x = his left, y = up, z = forward), the spine and head are turned on top, and the hips
   drop so a bent leg still reaches the ground. Poses blend smoothly into one another. */
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
  /** A limb direction: f = swing forward (radians), o = out from the body, side = +1 left / -1 right. */
  function limb(out, f, o, side) {
    const co = Math.cos(o);
    return out.set(side * Math.sin(o), -co * Math.cos(f), co * Math.sin(f)).normalize();
  }

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

    /* ---------- skeleton at rest ---------- */
    const names = meta.bones.map((b) => b[0]), parent = meta.bones.map((b) => b[1]);
    const restPos = meta.bones.map((b) => v3(b[2][0], b[2][1], b[2][2]));
    const restQ = meta.bones.map((b) => new T.Quaternion(b[3][0], b[3][1], b[3][2], b[3][3]).normalize());
    const n = names.length, idx = {};
    names.forEach((nm, i) => { idx[nm] = i; });
    const restLocalQ = [], bones = [];
    for (let i = 0; i < n; i++) {
      const b = new T.Bone(); b.name = names[i];
      const p = parent[i];
      const pq = p < 0 ? new T.Quaternion() : restQ[p].clone().invert();
      b.position.copy(p < 0 ? restPos[i] : restPos[i].clone().sub(restPos[p]).applyQuaternion(pq));
      b.quaternion.copy(pq.clone().multiply(restQ[i]));
      restLocalQ.push(b.quaternion.clone());
      bones.push(b);
      if (p < 0) mesh.add(b); else bones[p].add(b);
    }
    mesh.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(bones));
    const hipsRest = restPos[idx.Hips].clone();

    // each aimed bone: which joint it points at, and that direction in the bone's own frame
    const AIM = {
      LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
      LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot',
      LeftFoot: 'LeftToeBase', RightFoot: 'RightToeBase', LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1',
    };
    const aimLocal = {}, segLen = {};
    for (const b in AIM) {
      const i = idx[b], c = idx[AIM[b]];
      const d = restPos[c].clone().sub(restPos[i]);
      segLen[b] = d.length();
      aimLocal[i] = d.normalize().applyQuaternion(restQ[i].clone().invert());
    }
    const legLen = segLen.LeftUpLeg + segLen.LeftLeg;
    const reachRest = restPos[idx.LeftUpLeg].y - restPos[idx.LeftFoot].y; // hip joint to ankle, standing

    // fingers curl toward the palm into a loose fist: each knuckle turns about the axis that
    // carries its finger toward the palm side of the hand
    const curl = [];
    for (const side of ['Left', 'Right']) {
      const h = restPos[idx[side + 'Hand']], mid = restPos[idx[side + 'HandMiddle1']];
      const across = restPos[idx[side + 'HandIndex1']].clone().sub(restPos[idx[side + 'HandPinky1']]).normalize();
      const along = mid.clone().sub(h).normalize();
      const palm = new T.Vector3().crossVectors(along, across).normalize();
      if (palm.y > 0) palm.negate(); // in the rest pose the palms face down
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k <= 3; k++) {
        const i = idx[side + 'Hand' + f + k], c = idx[side + 'Hand' + f + (k + 1)];
        if (i === undefined || c === undefined) continue;
        const dir = restPos[c].clone().sub(restPos[i]).normalize();
        const axis = new T.Vector3().crossVectors(dir, palm).normalize().applyQuaternion(restQ[i].clone().invert());
        curl.push({ i, k, axis });
      }
    }

    /* ---------- pose state (blends toward the target each frame) ---------- */
    const mk = () => ({
      hipY: 0, hip: v3(), spine: v3(), head: v3(), fist: 0.6,
      armL: [v3(0.3, -1, 0.05).normalize(), v3(0.25, -1, 0.3).normalize()],
      armR: [v3(-0.3, -1, 0.05).normalize(), v3(-0.25, -1, 0.3).normalize()],
      legL: [v3(0.06, -1, 0).normalize(), v3(0.04, -1, -0.03).normalize(), v3(0, -0.35, 1).normalize()],
      legR: [v3(-0.06, -1, 0).normalize(), v3(-0.04, -1, -0.03).normalize(), v3(0, -0.35, 1).normalize()],
      ground: true,
    });
    const cur = mk(), tgt = mk();
    let phase = 0, idleT = 0;

    const tmpQ = new T.Quaternion(), tmpQ2 = new T.Quaternion(), tmpV = v3(), tmpV2 = v3(), eul = new T.Euler();
    const worldQ = Array.from({ length: n }, () => new T.Quaternion());

    function aimTo(target, i, q) {
      tmpV.copy(aimLocal[i]).applyQuaternion(q);
      tmpQ2.setFromUnitVectors(tmpV, target);
      return q.premultiply(tmpQ2);
    }

    /** Writes the blended pose into the bones. */
    function apply() {
      const spineSet = { Spine: 0.34, Spine1: 0.33, Spine2: 0.33 };
      for (let i = 0; i < n; i++) {
        const nm = names[i], p = parent[i];
        const q = worldQ[i];
        if (p < 0) q.copy(restLocalQ[i]); else q.copy(worldQ[p]).multiply(restLocalQ[i]);
        if (nm === 'Hips') q.premultiply(tmpQ.setFromEuler(eul.set(cur.hip.x, cur.hip.y, cur.hip.z, 'YXZ')));
        else if (spineSet[nm]) q.premultiply(tmpQ.setFromEuler(eul.set(cur.spine.x * spineSet[nm], cur.spine.y * spineSet[nm], cur.spine.z * spineSet[nm], 'YXZ')));
        else if (nm === 'Neck') q.premultiply(tmpQ.setFromEuler(eul.set(cur.head.x * 0.4, cur.head.y * 0.4, 0, 'YXZ')));
        else if (nm === 'Head') q.premultiply(tmpQ.setFromEuler(eul.set(cur.head.x * 0.6, cur.head.y * 0.6, 0, 'YXZ')));
        else if (nm === 'LeftArm') aimTo(cur.armL[0], i, q);
        else if (nm === 'LeftForeArm') aimTo(cur.armL[1], i, q);
        else if (nm === 'RightArm') aimTo(cur.armR[0], i, q);
        else if (nm === 'RightForeArm') aimTo(cur.armR[1], i, q);
        else if (nm === 'LeftUpLeg') aimTo(cur.legL[0], i, q);
        else if (nm === 'LeftLeg') aimTo(cur.legL[1], i, q);
        else if (nm === 'LeftFoot') aimTo(cur.legL[2], i, q);
        else if (nm === 'RightUpLeg') aimTo(cur.legR[0], i, q);
        else if (nm === 'RightLeg') aimTo(cur.legR[1], i, q);
        else if (nm === 'RightFoot') aimTo(cur.legR[2], i, q);
        const b = bones[i];
        if (p < 0) b.quaternion.copy(q); else b.quaternion.copy(tmpQ.copy(worldQ[p]).invert().multiply(q));
      }
      // finger curl: each knuckle bends toward the palm
      for (const c of curl) {
        tmpQ.setFromAxisAngle(c.axis, cur.fist * (c.k === 1 ? 0.8 : 1.05));
        bones[c.i].quaternion.copy(restLocalQ[c.i]).multiply(tmpQ);
      }
      bones[idx.Hips].position.set(hipsRest.x, hipsRest.y + cur.hipY, hipsRest.z);
    }

    /** How far the hips must drop so the lower foot of a bent pair of legs touches the floor. */
    function groundDrop(p) {
      const reach = (leg) => -(leg[0].y * segLen.LeftUpLeg + leg[1].y * segLen.LeftLeg);
      return Math.max(reach(p.legL), reach(p.legR)) - reachRest;
    }

    /* ---------- the poses ---------- */
    function poseIdle(t, still) {
      const br = Math.sin(t * 1.7), look = U.smooth(U.clamp((still - 2.5) / 2, 0, 1));
      tgt.hip.set(0, 0, 0.04 * Math.sin(t * 0.5)); tgt.spine.set(0.02 * br, 0, -0.03 * Math.sin(t * 0.5)); tgt.head.set(-0.04, 0.42 * Math.sin(t * 0.37) * look, 0); tgt.fist = 0.55;
      limb(tgt.armL[0], 0.04, 0.2, 1); limb(tgt.armL[1], 0.32, 0.12, 1);
      limb(tgt.armR[0], 0.04, 0.2, -1); limb(tgt.armR[1], 0.32, 0.12, -1);
      limb(tgt.legL[0], 0.0, 0.07, 1); limb(tgt.legL[1], -0.04, 0.05, 1); tgt.legL[2].set(0.08, -0.3, 1).normalize();
      limb(tgt.legR[0], 0.0, 0.07, -1); limb(tgt.legR[1], -0.04, 0.05, -1); tgt.legR[2].set(-0.08, -0.3, 1).normalize();
    }
    function poseRun(ph, s, w) { // s: 0 jog … 1 sprint; w: 1 = a walk
      w = w || 0;
      const a = U.lerp(U.lerp(0.55, 0.85, s), 0.36, w), sinP = Math.sin(ph), cosP = Math.cos(ph);
      const leg = (out, p, side) => {
        const th = a * Math.sin(p), bend = U.lerp(0.28, 0.08, w) + U.lerp(U.lerp(1.2, 1.7, s), 0.55, w) * Math.pow(Math.max(0, Math.cos(p + 0.55)), 1.3);
        limb(out[0], th, 0.05, side); limb(out[1], th - bend, 0.04, side);
        out[2].set(0, -0.15 - 0.5 * Math.max(0, -Math.sin(p)), 1).normalize();
      };
      leg(tgt.legL, ph, 1); leg(tgt.legR, ph + Math.PI, -1);
      const arm = (out, p, side) => { const sw = -U.lerp(U.lerp(0.65, 1.0, s), 0.32, w) * Math.sin(p); limb(out[0], sw, U.lerp(0.2, 0.14, w), side); limb(out[1], sw + U.lerp(U.lerp(1.25, 1.5, s), 0.35, w), 0.05, side); };
      arm(tgt.armL, ph, 1); arm(tgt.armR, ph + Math.PI, -1);
      tgt.hip.set(U.lerp(U.lerp(0.12, 0.3, s), 0.02, w), 0.14 * sinP * (1 - w * 0.5), 0); tgt.spine.set(U.lerp(U.lerp(0.08, 0.2, s), 0.02, w), -0.3 * sinP * (1 - w * 0.6), 0.03 * cosP); tgt.head.set(-U.lerp(U.lerp(0.18, 0.4, s), 0.05, w), 0.12 * sinP * (1 - w), 0);
      tgt.fist = U.lerp(0.85, 0.5, w);
    }
    function poseAir(vy, t) {
      const up = U.clamp(vy / 9, -1, 1);
      if (up > 0) { // rising: knees tucked, arms up and out
        limb(tgt.legL[0], 1.0, 0.12, 1); limb(tgt.legL[1], -0.55, 0.08, 1);
        limb(tgt.legR[0], 0.5, 0.12, -1); limb(tgt.legR[1], -1.2, 0.08, -1);
        tgt.armL[0].set(0.85, 0.35, 0.25).normalize(); tgt.armL[1].set(0.45, 0.85, 0.35).normalize();
        tgt.armR[0].set(-0.85, 0.15, 0.3).normalize(); tgt.armR[1].set(-0.5, 0.5, 0.75).normalize();
        tgt.spine.set(0.15, 0, 0); tgt.hip.set(0.15, 0, 0);
      } else { // falling: limbs spread to steer
        const w = Math.sin(t * 5) * 0.1;
        limb(tgt.legL[0], 0.45 + w, 0.22, 1); limb(tgt.legL[1], -0.5, 0.15, 1);
        limb(tgt.legR[0], 0.1 - w, 0.22, -1); limb(tgt.legR[1], -0.75, 0.15, -1);
        tgt.armL[0].set(0.95, 0.3, 0.15).normalize(); tgt.armL[1].set(0.75, 0.6, 0.25).normalize();
        tgt.armR[0].set(-0.95, 0.3, 0.15).normalize(); tgt.armR[1].set(-0.75, 0.6, 0.25).normalize();
        tgt.spine.set(-0.12, 0, 0); tgt.hip.set(0.1, 0, 0);
      }
      tgt.legL[2].set(0, -0.8, 0.6).normalize(); tgt.legR[2].set(0, -0.8, 0.6).normalize();
      tgt.head.set(-0.25, 0, 0); tgt.fist = 0.5;
    }
    function poseSwing(webLocal, useRight, k) { // k: -1 back of the arc … 1 front
      const arm = useRight ? tgt.armR : tgt.armL, other = useRight ? tgt.armL : tgt.armR, s = useRight ? -1 : 1;
      arm[0].copy(webLocal); arm[1].copy(webLocal); // the web arm holds the line
      const kick = U.clamp(k, -1, 1), front = Math.max(0, kick), back = Math.max(0, -kick);
      // the free arm trails at the back of the arc and sweeps forward and out at the front
      other[0].set(-s * 0.85, -0.3 + 0.45 * front, 0.1 + 0.5 * kick).normalize();
      other[1].set(-s * 0.5, 0.1 + 0.45 * front, 0.8).normalize();
      // legs trail behind, swing through the bottom, then the knees tuck up at the front
      const th = 0.12 + 0.85 * front - 0.4 * back;
      limb(tgt.legL[0], th + 0.12, 0.1, 1); limb(tgt.legL[1], th - 0.45 - 0.9 * front, 0.06, 1);
      limb(tgt.legR[0], th - 0.1, 0.1, -1); limb(tgt.legR[1], th - 0.8 - 0.6 * front, 0.06, -1);
      tgt.legL[2].set(0, -0.9, 0.35).normalize(); tgt.legR[2].set(0, -0.9, 0.35).normalize();
      tgt.spine.set(-0.28 * kick - 0.05, 0.12 * s, 0.2 * s); tgt.hip.set(0.18 * kick, 0, 0); tgt.head.set(-0.42 - 0.12 * kick, 0, 0); tgt.fist = 0.9;
    }
    /** The classic crouch on a ledge: knees wide, one hand down, weight forward, looking out. */
    function posePerch(t) {
      limb(tgt.legL[0], 1.15, 0.62, 1); limb(tgt.legL[1], -0.25, 0.25, 1);
      limb(tgt.legR[0], 1.15, 0.62, -1); limb(tgt.legR[1], -0.25, 0.25, -1);
      tgt.legL[2].set(0.35, -0.25, 1).normalize(); tgt.legR[2].set(-0.35, -0.25, 1).normalize();
      tgt.armL[0].set(0.15, -0.85, 0.5).normalize(); tgt.armL[1].set(0.05, -0.95, 0.3).normalize();
      tgt.armR[0].set(-0.55, -0.45, 0.7).normalize(); tgt.armR[1].set(0.15, -0.35, 0.95).normalize();
      tgt.spine.set(0.75, 0.04 * Math.sin(t * 0.6), 0); tgt.hip.set(0.5, 0, 0);
      tgt.head.set(-0.95 + 0.06 * Math.sin(t * 0.9), 0.5 * Math.sin(t * 0.35), 0); tgt.fist = 0.4;
    }
    function poseZip() {
      tgt.armL[0].set(0.3, 0.55, 0.78).normalize(); tgt.armL[1].set(0.12, 0.45, 0.88).normalize();
      tgt.armR[0].set(-0.3, 0.55, 0.78).normalize(); tgt.armR[1].set(-0.12, 0.45, 0.88).normalize();
      limb(tgt.legL[0], -0.25, 0.08, 1); limb(tgt.legL[1], -1.0, 0.05, 1);
      limb(tgt.legR[0], -0.05, 0.08, -1); limb(tgt.legR[1], -0.55, 0.05, -1);
      tgt.legL[2].set(0, -1, 0.15).normalize(); tgt.legR[2].set(0, -1, 0.15).normalize();
      tgt.spine.set(0.25, 0, 0); tgt.hip.set(0.35, 0, 0); tgt.head.set(-0.55, 0, 0); tgt.fist = 0.95;
    }
    function poseLand(k) { // k: 1 at impact, fading
      limb(tgt.legL[0], 1.05 * k, 0.16, 1); limb(tgt.legL[1], -0.9 * k, 0.1, 1);
      limb(tgt.legR[0], 0.85 * k, 0.16, -1); limb(tgt.legR[1], -1.1 * k, 0.1, -1);
      tgt.legL[2].set(0.1, -0.3, 1).normalize(); tgt.legR[2].set(-0.1, -0.3, 1).normalize();
      limb(tgt.armL[0], 0.5 * k, 0.45, 1); limb(tgt.armL[1], 0.9 * k, 0.3, 1);
      limb(tgt.armR[0], 0.2 * k, 0.45, -1); limb(tgt.armR[1], 0.5 * k, 0.3, -1);
      tgt.spine.set(0.45 * k, 0, 0); tgt.hip.set(0.35 * k, 0, 0); tgt.head.set(-0.4 * k, 0, 0); tgt.fist = 0.6;
    }
    function poseDive() { // head first, arms forward, legs trailing
      tgt.armL[0].set(0.25, 0.92, 0.3).normalize(); tgt.armL[1].set(0.12, 0.98, 0.15).normalize();
      tgt.armR[0].set(-0.25, 0.92, 0.3).normalize(); tgt.armR[1].set(-0.12, 0.98, 0.15).normalize();
      limb(tgt.legL[0], -0.08, 0.1, 1); limb(tgt.legL[1], -0.25, 0.06, 1);
      limb(tgt.legR[0], 0.05, 0.1, -1); limb(tgt.legR[1], -0.45, 0.06, -1);
      tgt.legL[2].set(0, -1, -0.2).normalize(); tgt.legR[2].set(0, -1, -0.2).normalize();
      tgt.spine.set(-0.15, 0, 0); tgt.hip.set(0, 0, 0); tgt.head.set(-0.75, 0, 0); tgt.fist = 0.2;
    }
    function poseTuck() { // knees to chest, for flips and rolls
      limb(tgt.legL[0], 1.45, 0.14, 1); limb(tgt.legL[1], -0.9, 0.08, 1);
      limb(tgt.legR[0], 1.45, 0.14, -1); limb(tgt.legR[1], -0.9, 0.08, -1);
      tgt.legL[2].set(0, -0.6, 0.8).normalize(); tgt.legR[2].set(0, -0.6, 0.8).normalize();
      limb(tgt.armL[0], 1.0, 0.25, 1); limb(tgt.armL[1], 0.2, 0.1, 1);
      limb(tgt.armR[0], 1.0, 0.25, -1); limb(tgt.armR[1], 0.2, 0.1, -1);
      tgt.spine.set(0.55, 0, 0); tgt.hip.set(0.2, 0, 0); tgt.head.set(0.3, 0, 0); tgt.fist = 0.9;
    }
    function posePunch(right, k) { // k: 1 at full reach
      const arm = right ? tgt.armR : tgt.armL, guard = right ? tgt.armL : tgt.armR, sd = right ? -1 : 1;
      arm[0].set(sd * 0.12 * (1 - k), 0.12, 1).normalize(); arm[1].set(sd * 0.05, 0.1, 1).normalize();
      guard[0].set(sd * -0.35, -0.6, 0.55).normalize(); guard[1].set(sd * 0.25, 0.75, 0.6).normalize();
      tgt.spine.y += (right ? 0.45 : -0.45) * k; tgt.fist = 1;
    }
    function aimArm(useRight, dirLocal) {
      const arm = useRight ? tgt.armR : tgt.armL;
      arm[0].copy(dirLocal); arm[1].copy(dirLocal);
    }

    /* ---------- body placement ---------- */
    const bodyQ = new T.Quaternion(), goalQ = new T.Quaternion(), basis = new T.Matrix4();
    const ax = v3(), ay = v3(), az = v3();
    /** Orient the body: up and forward in world space. */
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

    function blend(dt, rate) {
      const k = 1 - Math.exp(-rate * dt);
      cur.hipY = U.lerp(cur.hipY, tgt.hipY, k);
      cur.hip.lerp(tgt.hip, k); cur.spine.lerp(tgt.spine, k); cur.head.lerp(tgt.head, k);
      cur.fist = U.lerp(cur.fist, tgt.fist, k);
      for (const key of ['armL', 'armR', 'legL', 'legR']) for (let j = 0; j < cur[key].length; j++) cur[key][j].lerp(tgt[key][j], k).normalize();
    }

    const hipWorld = v3(), inv = new T.Quaternion();
    /**
     * Pose the hero for this frame.
     * s: { state, speed, sprint, vy, grounded, landT, webPoint, webRight, swingK, aimPoint, aimRight, hip (world point), up, fwd, look }
     */
    function update(dt, s) {
      idleT += dt;
      let rate = 12, orientRate = 10;
      if (s.state === 'ground') {
        if (s.speed > 0.6) {
          const w = U.clamp((5 - s.speed) / 2, 0, 1);
          const stride = U.lerp(U.lerp(1.15, 1.8, s.sprint), 0.7, w);
          phase = (phase + (s.speed * dt / stride) * Math.PI) % (Math.PI * 2);
          poseRun(phase, s.sprint, w);
          rate = 16;
        } else if (s.perch) { posePerch(idleT); rate = 6; }
        else poseIdle(idleT, s.idleT || 0);
        if (s.landT > 0) poseLand(U.clamp(s.landT / 0.22, 0, 1));
        tgt.hipY = 0;
      } else if (s.state === 'swing') {
        inv.copy(bodyQ).invert();
        tmpV.copy(s.webPoint).sub(s.hip).applyQuaternion(inv).normalize();
        poseSwing(tmpV, s.webRight, s.swingK);
        rate = 9; orientRate = 7;
      } else if (s.state === 'zip' || s.state === 'boost') { poseZip(); rate = 14; orientRate = 12; }
      else if (s.state === 'wall') {
        phase = (phase + (Math.max(s.speed, 2) * dt / 1.2) * Math.PI) % (Math.PI * 2);
        poseRun(phase, 0.3);
        const ra = 1.15 + 0.6 * Math.sin(phase), rb = 1.15 + 0.6 * Math.sin(phase + Math.PI);
        limb(tgt.armL[0], ra, 0.35, 1); limb(tgt.armL[1], ra + 0.4, 0.2, 1);
        limb(tgt.armR[0], rb, 0.35, -1); limb(tgt.armR[1], rb + 0.4, 0.2, -1);
        tgt.hip.x = 0.05; tgt.spine.x = 0.05; tgt.head.x = -0.6;
        rate = 16; orientRate = 12;
      } else if (s.dive) { poseDive(); rate = 10; orientRate = 8; }
      else { poseAir(s.vy, idleT); rate = 8; orientRate = 6; }
      if (s.spin) { poseTuck(); rate = 18; }
      if (s.punch > 0) posePunch(s.punchRight, Math.sin(U.clamp(1 - s.punch / 0.22, 0, 1) * Math.PI));
      if (s.aimPoint) { // firing a web at something
        inv.copy(bodyQ).invert();
        aimArm(s.aimRight, tmpV.copy(s.aimPoint).sub(s.hip).applyQuaternion(inv).normalize());
      }
      tgt.head.y += U.clamp(s.look || 0, -0.9, 0.9);
      blend(dt, rate);
      if (s.state === 'ground' || s.state === 'wall') cur.hipY = Math.min(0, groundDrop(cur));
      else cur.hipY = U.lerp(cur.hipY, 0, 1 - Math.exp(-6 * dt));
      face(s.up, s.fwd, orientRate, dt);
      apply();
      // tricks and rolls spin the whole body about the hips on top of everything else
      mesh.quaternion.copy(bodyQ);
      if (s.spin) mesh.quaternion.multiply(tmpQ.setFromAxisAngle(s.spin.axis, s.spin.angle));
      // place the body so the hips sit at the given point however he is turned
      hipWorld.copy(hipsRest).applyQuaternion(mesh.quaternion);
      mesh.position.copy(s.hip).sub(hipWorld);
      mesh.updateMatrixWorld(true);
    }

    const handV = v3();
    function hand(right) { return bones[idx[right ? 'RightHand' : 'LeftHand']].getWorldPosition(handV); }

    function setSuit(suit, color) {
      uniforms.uMask.value.copy(color(suit.mask)); uniforms.uBody.value.copy(color(suit.body)); uniforms.uWeb.value.copy(color(suit.web));
      uniforms.uFrame.value.copy(color(suit.frame)); uniforms.uLens.value.copy(color(suit.lens)); uniforms.uEmblem.value.copy(color(suit.emblem));
    }
    function dispose() { geo.dispose(); mat.dispose(); suitTex.dispose(); lensTex.dispose(); }

    bodyQ.identity();
    return { mesh, uniforms, update, hand, setSuit, dispose, height: 1.8, hipHeight: hipsRest.y, legLen };
  }

  SMR.createHero = createHero;
})();
