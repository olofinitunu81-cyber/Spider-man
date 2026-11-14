/* The hero's animation library.

   Every clip is authored once, as poses on the hero's own skeleton (the Mixamo-standard rig in
   SMR.heroRig), and baked to per-bone rotation tracks at 30 frames a second. The game blends the
   baked tracks the way an engine's animation system does (weighted, crossfaded, masked to the
   upper body where it should be), and tools/anim exports the same tracks to glTF (.glb) and
   three.js clip JSON for Blender, Unity, Unreal or Godot.

   Poses are written in body space: x is his left, y is up, z is forward. Angles are in degrees.
     hip   [drop, pitch, yaw, roll, dx, dz]  the pelvis: drop and shift in metres; pitch + leans
                                             forward, yaw + turns left, roll + tips right
     rot   [pitch, yaw, roll]  the whole body turning about the hips (flips, spins, rolls)
     spine [pitch, yaw, roll]  spread over the three spine bones;  head [pitch, yaw, roll] (+ down)
     aL/aR arms: [f, o, ef, eo] the upper arm swung forward f (0 down, 90 ahead, 180 up, -90
           back) and out o, the forearm at (f + ef, o + eo); or { u, f } as vectors; or
           { ik: [x, y, z], pole } to reach the wrist to a point with the elbow toward the pole
     lL/lR legs: [f, o, knee, toe]; or { ik: [x, y, z], pole, toe | ft } to put the ankle on a point
           (add rel: true to measure from the hips); toe + points the foot, - lifts the toes
     hL/hR the hand: a wrist bend in degrees (+ back), or { d, n }: where the fingers point and
           which way the palm faces;  pr [left, right] forearm turn, + palm down
     fist  [left, right] 0 open … 1 closed;  g [left, right] a hand shape ('thwip', 'claw', ...)
     root  [x, y, z] the ground the move covers, in metres (exported as root motion; in the game
           the physics moves him instead)
   Planted feet and hands use IK, so they stay put while the body moves over them.
   Swinging, falling and climbing are poses the game blends by what the physics is doing (where
   he is in the arc, how fast he is falling, which way he is climbing); the web arm is then aimed
   at the real web. The physics always decides where he goes. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const T = window.THREE;
  const D = Math.PI / 180;
  const FPS = 30, PI2 = Math.PI * 2;
  const S = Math.sin, C = Math.cos, M = Math.max;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const vec = (a) => new T.Vector3(a[0], a[1], a[2]);
  // the rig's proportions, read from the skeleton when a solver is made (these are the hero's)
  const RIG = { hipsY: 1.0058, footPitch: 33, ankle: 0.104, toeY: 0.01, footLen: 0.175 };

  /* ---------- the skeleton solver: a pose in, bone rotations out ---------- */
  function createSolver(meta) {
    const names = meta.bones.map((b) => b[0]), parent = meta.bones.map((b) => b[1]);
    const restPos = meta.bones.map((b) => vec(b[2]));
    const restQ = meta.bones.map((b) => new T.Quaternion(b[3][0], b[3][1], b[3][2], b[3][3]).normalize());
    const invRestQ = restQ.map((q) => q.clone().invert());
    const n = names.length, idx = {};
    names.forEach((nm, i) => { idx[nm] = i; });
    const restLocalQ = [], restLocalPos = [];
    for (let i = 0; i < n; i++) {
      const p = parent[i];
      restLocalPos.push(p < 0 ? restPos[i].clone() : restPos[i].clone().sub(restPos[p]).applyQuaternion(invRestQ[p]));
      restLocalQ.push(p < 0 ? restQ[i].clone() : invRestQ[p].clone().multiply(restQ[i]));
    }
    // each aimed bone: which joint it points at, and that direction in the bone's own frame
    const AIM = {
      LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
      LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot',
      LeftFoot: 'LeftToeBase', RightFoot: 'RightToeBase', LeftHand: 'LeftHandMiddle1', RightHand: 'RightHandMiddle1',
    };
    const aimLocal = new Array(n).fill(null);
    for (const b in AIM) {
      const i = idx[b], c = idx[AIM[b]];
      aimLocal[i] = restPos[c].clone().sub(restPos[i]).normalize().applyQuaternion(invRestQ[i]);
    }
    const role = names.map((nm) => {
      if (nm === 'Hips') return 'hips';
      if (nm === 'Spine' || nm === 'Spine1' || nm === 'Spine2') return 'spine';
      if (nm === 'Neck') return 'neck';
      if (nm === 'Head') return 'head';
      const m = nm.match(/^(Left|Right)(Arm|ForeArm|Hand|UpLeg|Leg|Foot)$/);
      return m ? m[1][0] + m[2] : null;
    });
    // hinges: the forearm folds toward the front of the upper arm, the shin toward the back of the thigh
    const foldLocal = new Array(n).fill(null);
    for (const s of ['Left', 'Right']) {
      foldLocal[idx[s + 'Arm']] = new T.Vector3(0, 0, 1).applyQuaternion(invRestQ[idx[s + 'Arm']]);
      foldLocal[idx[s + 'UpLeg']] = new T.Vector3(0, 0, -1).applyQuaternion(invRestQ[idx[s + 'UpLeg']]);
    }
    // hands: which way each palm faces, and the fingers' curl axes (each knuckle bends toward the palm)
    const curl = [], palmLocal = [], handBasisInv = [], handIdx = [idx.LeftHand, idx.RightHand];
    ['Left', 'Right'].forEach((side, si) => {
      const h = restPos[idx[side + 'Hand']], mid = restPos[idx[side + 'HandMiddle1']];
      const across = restPos[idx[side + 'HandIndex1']].clone().sub(restPos[idx[side + 'HandPinky1']]).normalize();
      const along = mid.clone().sub(h).normalize();
      const palm = new T.Vector3().crossVectors(along, across).normalize();
      if (palm.y > 0) palm.negate(); // in the rest pose the palms face down
      palm.addScaledVector(along, -palm.dot(along)).normalize();
      palmLocal[si] = palm.clone().applyQuaternion(invRestQ[idx[side + 'Hand']]);
      handBasisInv[si] = new T.Matrix4().makeBasis(along, palm, new T.Vector3().crossVectors(along, palm)).transpose();
      ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'].forEach((f, fi) => {
        for (let k = 1; k <= 3; k++) {
          const i = idx[side + 'Hand' + f + k], c = idx[side + 'Hand' + f + (k + 1)];
          if (i === undefined || c === undefined) continue;
          const dir = restPos[c].clone().sub(restPos[i]).normalize();
          const axis = new T.Vector3().crossVectors(dir, f === 'Thumb' ? palm.clone().add(along).normalize() : palm).normalize().applyQuaternion(invRestQ[i]);
          curl.push({ i, k, f: fi, hand: si, axis });
        }
      });
    });
    const len = (a, b) => restPos[idx[b]].distanceTo(restPos[idx[a]]);
    const fd = restPos[idx.LeftToeBase].clone().sub(restPos[idx.LeftFoot]);
    const geo = {
      hipsY: restPos[idx.Hips].y, hipJointX: restPos[idx.LeftUpLeg].x, hipJointDY: restPos[idx.Hips].y - restPos[idx.LeftUpLeg].y,
      thigh: len('LeftUpLeg', 'LeftLeg'), shin: len('LeftLeg', 'LeftFoot'), upper: len('LeftArm', 'LeftForeArm'), fore: len('LeftForeArm', 'LeftHand'),
      ankle: restPos[idx.LeftFoot].y, toeY: restPos[idx.LeftToeBase].y, footLen: fd.length(), footPitch: Math.atan2(-fd.y, Math.hypot(fd.x, fd.z)) / D,
    };
    geo.reach = geo.thigh + geo.shin;
    Object.assign(RIG, { hipsY: geo.hipsY, footPitch: geo.footPitch, ankle: geo.ankle, toeY: geo.toeY, footLen: geo.footLen });
    const SPINE = { Spine: 0.34, Spine1: 0.33, Spine2: 0.33 };
    const upperBody = names.map((nm) => /^(Spine|Spine1|Spine2|Neck|Head|HeadTop_End)$/.test(nm) || /Shoulder|Arm|Hand/.test(nm));

    const wq = Array.from({ length: n }, () => new T.Quaternion()), wp = Array.from({ length: n }, () => new T.Vector3());
    const q1 = new T.Quaternion(), q2 = new T.Quaternion(), e = new T.Euler(), m1 = new T.Matrix4();
    const tA = new T.Vector3(), tB = new T.Vector3(), tC = new T.Vector3(), tD = new T.Vector3(), tU = new T.Vector3(), tE = new T.Vector3(), hp = new T.Vector3();
    const lower = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3()]; // forearms, then shins
    function aim(i, q, dir) {
      tA.copy(aimLocal[i]).applyQuaternion(q);
      q2.setFromUnitVectors(tA, dir);
      q.premultiply(q2);
    }
    // which way a joint folds when the limb is straight and the pose doesn't say
    const armHint = (u, sg, out) => out.set(-sg * 0.1, u.z + 0.25, -u.y + 0.25);
    const legHint = (u, sg, out) => out.set(0, -u.z - 0.25, u.y - 0.25);
    /** An upper arm or thigh: aimed (directly, or by two-bone IK at a target), then turned so the joint folds the right way. */
    function upperLimb(i, q, L, sg, a, b, hint, slot) {
      const u = tU, f = lower[slot];
      if (L.ik) {
        tB.copy(L.ik).sub(wp[i]);
        const d0 = tB.length() || 1e-6, dist = clamp(d0, Math.abs(a - b) + 1e-3, (a + b) * 0.9995);
        tB.multiplyScalar(1 / d0);
        const ca = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1), sa = Math.sqrt(1 - ca * ca);
        u.copy(L.pole).addScaledVector(tB, -L.pole.dot(tB));
        if (u.lengthSq() < 1e-8) { hint(tB, sg, u); u.addScaledVector(tB, -u.dot(tB)); }
        u.normalize().multiplyScalar(sa).addScaledVector(tB, ca);
        f.copy(tB).multiplyScalar(dist).addScaledVector(u, -a).normalize();
      } else { u.copy(L.u); f.copy(L.f); }
      aim(i, q, u);
      const bend = tC.copy(f).addScaledVector(u, -f.dot(u));
      hint(u, sg, tD); tD.addScaledVector(u, -tD.dot(u)).normalize();
      bend.addScaledVector(tD, 0.03).normalize();
      tD.copy(foldLocal[i]).applyQuaternion(q); tD.addScaledVector(u, -tD.dot(u)).normalize();
      const ang = Math.atan2(tE.crossVectors(tD, bend).dot(u), tD.dot(bend));
      q.premultiply(q2.setFromAxisAngle(u, ang));
    }

    /** Decoded pose -> local bone quaternions (n * 4) and the hips position (3). */
    function solve(d, outQ, outHip) {
      const h = restPos[idx.Hips];
      hp.set(h.x + d.hip[4], h.y + d.hip[0], h.z + d.hip[5]);
      for (let i = 0; i < n; i++) {
        const p = parent[i], q = wq[i], r = role[i];
        if (p < 0) { q.copy(restLocalQ[i]); wp[i].copy(hp); }
        else { q.copy(wq[p]).multiply(restLocalQ[i]); wp[i].copy(restLocalPos[i]).applyQuaternion(wq[p]).add(wp[p]); }
        if (r === 'hips') q.premultiply(q1.setFromEuler(e.set(d.hip[1], d.hip[2], d.hip[3], 'YXZ')));
        else if (r === 'spine') { const k = SPINE[names[i]]; q.premultiply(q1.setFromEuler(e.set(d.spine[0] * k, d.spine[1] * k, d.spine[2] * k, 'YXZ'))); }
        else if (r === 'neck') q.premultiply(q1.setFromEuler(e.set(d.head[0] * 0.4, d.head[1] * 0.4, d.head[2] * 0.4, 'YXZ')));
        else if (r === 'head') q.premultiply(q1.setFromEuler(e.set(d.head[0] * 0.6, d.head[1] * 0.6, d.head[2] * 0.6, 'YXZ')));
        else if (r) {
          const s = r[0] === 'L' ? 0 : 1, sg = s ? -1 : 1, part = r.slice(1);
          if (part === 'Arm') upperLimb(i, q, d.arm[s], sg, geo.upper, geo.fore, armHint, s);
          else if (part === 'ForeArm') {
            const f = lower[s], H = d.hand[s];
            aim(i, q, f);
            if (H.n) { // turn the forearm so the palm can face where the pose asks, leaving the rest to the wrist
              tB.copy(palmLocal[s]).applyQuaternion(q1.copy(q).multiply(restLocalQ[handIdx[s]]));
              tB.addScaledVector(f, -tB.dot(f)); tC.copy(H.n).addScaledVector(f, -H.n.dot(f));
              if (tB.lengthSq() > 1e-6 && tC.lengthSq() > 1e-6) {
                tB.normalize(); tC.normalize();
                q.premultiply(q2.setFromAxisAngle(f, 0.75 * Math.atan2(tD.crossVectors(tB, tC).dot(f), tB.dot(tC))));
              }
            } else if (d.pr[s]) q.premultiply(q2.setFromAxisAngle(f, d.pr[s] * sg));
          } else if (part === 'Hand') {
            const H = d.hand[s];
            if (H.n) { // the hand exactly: where the fingers point and which way the palm faces
              tB.copy(H.d); tC.copy(H.n).addScaledVector(tB, -H.n.dot(tB)).normalize();
              m1.makeBasis(tB, tC, tD.crossVectors(tB, tC)).multiply(handBasisInv[s]);
              q.copy(q1.setFromRotationMatrix(m1)).multiply(restQ[i]);
            } else if (H.w) { // bent back at the wrist (toward the back of the hand), or forward if negative
              tB.copy(palmLocal[s]).applyQuaternion(q);
              tC.copy(lower[s]).multiplyScalar(Math.cos(H.w)).addScaledVector(tB, -Math.sin(H.w)).normalize();
              aim(i, q, tC);
            }
          } else if (part === 'UpLeg') upperLimb(i, q, d.leg[s], sg, geo.thigh, geo.shin, legHint, 2 + s);
          else if (part === 'Leg') aim(i, q, lower[2 + s]);
          else if (part === 'Foot') aim(i, q, d.leg[s].foot);
        }
        if (p < 0) q1.copy(q); else q1.copy(wq[p]).invert().multiply(q);
        q1.toArray(outQ, i * 4);
      }
      // flips and spins: the whole body turns about the hips, on top of everything else
      if (d.rot[0] || d.rot[1] || d.rot[2]) {
        const r0 = idx.Hips * 4;
        q1.fromArray(outQ, r0).premultiply(q2.setFromEuler(e.set(d.rot[0], d.rot[1], d.rot[2], 'YXZ'))).toArray(outQ, r0);
      }
      for (const c of curl) {
        const amt = d.curl[c.hand][c.f] * (c.k === 1 ? 0.85 : 1.05) * (c.f === 4 ? 0.6 : 1);
        q1.copy(restLocalQ[c.i]).multiply(q2.setFromAxisAngle(c.axis, amt));
        q1.toArray(outQ, c.i * 4);
      }
      outHip[0] = hp.x; outHip[1] = hp.y; outHip[2] = hp.z;
    }

    /** Forward kinematics: world (body space) rotations and positions from local rotations. */
    function fk(localQ, hip, outQ, outP) {
      for (let i = 0; i < n; i++) {
        const p = parent[i];
        q1.fromArray(localQ, i * 4);
        if (p < 0) { outQ[i].copy(q1); outP[i].set(hip[0], hip[1], hip[2]); }
        else { outQ[i].copy(outQ[p]).multiply(q1); outP[i].copy(restLocalPos[i]).applyQuaternion(outQ[p]).add(outP[p]); }
      }
    }
    return { names, parent, restPos, restQ, restLocalQ, restLocalPos, idx, n, aimLocal, solve, fk, geo, upperBody };
  }

  /* ---------- pose authoring ---------- */
  const BASE = {
    hip: [0, 0, 0, 0, 0, 0], rot: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0],
    aL: [4, 12, 18, -4], aR: [4, 12, 18, -4], lL: [0, 4, 3, 0], lR: [0, 4, 3, 0],
    hL: 0, hR: 0, pr: [0, 0], fist: [0.5, 0.5], g: [null, null], root: [0, 0, 0],
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  /** A full pose: the neutral stance with some parts replaced. */
  const P = (o) => {
    const p = Object.assign(clone(BASE), clone(o || {}));
    while (p.hip.length < 6) p.hip.push(0);
    return p;
  };
  /** A pose built on another one. */
  const K = (base, o) => P(Object.assign(clone(base), clone(o || {})));
  const flipX = (a) => (a ? [-a[0], a[1], a[2]] : a);
  function mirrorLimb(a) {
    if (Array.isArray(a)) return a.slice();
    const m = clone(a);
    for (const k of ['ik', 'pole', 'u', 'f', 'ft']) if (m[k]) m[k] = flipX(m[k]);
    return m;
  }
  const mirrorHand = (h) => (h && typeof h === 'object' ? { d: flipX(h.d), n: flipX(h.n) } : h);
  function mirror(p) {
    const m = clone(p);
    m.aL = mirrorLimb(p.aR); m.aR = mirrorLimb(p.aL); m.lL = mirrorLimb(p.lR); m.lR = mirrorLimb(p.lL);
    m.hL = mirrorHand(p.hR); m.hR = mirrorHand(p.hL); m.pr = [p.pr[1], p.pr[0]];
    m.fist = [p.fist[1], p.fist[0]]; m.g = [p.g[1], p.g[0]];
    m.hip = [p.hip[0], p.hip[1], -p.hip[2], -p.hip[3], -p.hip[4], p.hip[5]]; m.rot = [p.rot[0], -p.rot[1], -p.rot[2]];
    m.spine = [p.spine[0], -p.spine[1], -p.spine[2]]; m.head = [p.head[0], -p.head[1], -p.head[2]];
    m.root = [-p.root[0], p.root[1], p.root[2]];
    return m;
  }
  // hand shapes: curl of index, middle, ring, pinky, thumb
  const GEST = { thwip: [0.02, 1.0, 1.0, 0.02, 0.05], open: [0.04, 0.04, 0.04, 0.05, 0.05], claw: [0.35, 0.3, 0.32, 0.38, 0.2], flat: [0, 0, 0, 0, 0] };

  const limbDir = (f, o, sg) => { const co = C(o * D); return new T.Vector3(sg * S(o * D), -co * C(f * D), co * S(f * D)).normalize(); };
  const footDir = (toe, sg) => new T.Vector3(sg * 0.1, -S((RIG.footPitch + toe) * D), C((RIG.footPitch + toe) * D)).normalize();
  function decLimb(a, sg, leg, p) {
    if (Array.isArray(a)) {
      if (leg) return { u: limbDir(a[0], a[1], sg), f: limbDir(a[0] - a[2], a[1] * 0.7, sg), foot: footDir(a[3] || 0, sg) };
      return { u: limbDir(a[0], a[1], sg), f: limbDir(a[0] + a[2], a[1] + a[3], sg) };
    }
    const o = {};
    if (a.ik) {
      o.ik = vec(a.ik);
      if (a.rel) o.ik.add(new T.Vector3(p.hip[4], RIG.hipsY + p.hip[0], p.hip[5])); // relative to the hips
      o.pole = vec(a.pole || (leg ? [sg * 0.12, 0, 1] : [sg * 0.6, -0.1, -0.8])).normalize();
    } else { o.u = vec(a.u).normalize(); o.f = vec(a.f).normalize(); }
    if (leg) o.foot = a.ft ? vec(a.ft).normalize() : footDir(a.toe || 0, sg);
    return o;
  }
  const decHand = (h) => (h && typeof h === 'object' ? { d: vec(h.d).normalize(), n: vec(h.n).normalize() } : { w: (h || 0) * D });
  /** Authoring pose -> what the solver needs (vectors and radians). */
  function decode(p) {
    const curlOf = (k) => (p.g[k] && GEST[p.g[k]] ? GEST[p.g[k]].map((x) => x * 1.45) : [p.fist[k], p.fist[k], p.fist[k], p.fist[k], p.fist[k] * 0.7].map((x) => x * 1.45));
    return {
      hip: [p.hip[0], p.hip[1] * D, p.hip[2] * D, p.hip[3] * D, p.hip[4], p.hip[5]], rot: p.rot.map((x) => x * D),
      spine: p.spine.map((x) => x * D), head: p.head.map((x) => x * D), pr: p.pr.map((x) => x * D),
      arm: [decLimb(p.aL, 1, false, p), decLimb(p.aR, -1, false, p)], leg: [decLimb(p.lL, 1, true, p), decLimb(p.lR, -1, true, p)],
      hand: [decHand(p.hL), decHand(p.hR)], curl: [curlOf(0), curlOf(1)], root: p.root.slice(),
    };
  }
  function mixLimb(ls, ws, kmax, leg) {
    const ik = ls.every((l) => l.ik), fk = ls.every((l) => !l.ik);
    if (!ik && !fk) return ls[kmax];
    const o = ik ? { ik: new T.Vector3(), pole: new T.Vector3() } : { u: new T.Vector3(), f: new T.Vector3() };
    if (leg) o.foot = new T.Vector3();
    ls.forEach((l, k) => {
      const w = ws[k];
      if (!w) return;
      if (ik) { o.ik.addScaledVector(l.ik, w); o.pole.addScaledVector(l.pole, w); } else { o.u.addScaledVector(l.u, w); o.f.addScaledVector(l.f, w); }
      if (leg) o.foot.addScaledVector(l.foot, w);
    });
    if (ik) o.pole.normalize(); else { o.u.normalize(); o.f.normalize(); }
    if (leg) o.foot.normalize();
    return o;
  }
  function mixHand(hs, ws, kmax) {
    if (hs.every((h) => h.n)) {
      const o = { d: new T.Vector3(), n: new T.Vector3() };
      hs.forEach((h, k) => { o.d.addScaledVector(h.d, ws[k]); o.n.addScaledVector(h.n, ws[k]); });
      o.d.normalize(); o.n.normalize();
      return o;
    }
    if (hs.every((h) => !h.n)) return { w: hs.reduce((s, h, k) => s + h.w * ws[k], 0) };
    return hs[kmax];
  }
  /** Mix decoded poses with weights (which may be negative: Catmull-Rom). */
  function mix(ds, ws) {
    const out = { hip: [0, 0, 0, 0, 0, 0], rot: [0, 0, 0], spine: [0, 0, 0], head: [0, 0, 0], pr: [0, 0], root: [0, 0, 0], curl: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], arm: [], leg: [], hand: [] };
    let kmax = 0;
    ws.forEach((w, k) => { if (w > ws[kmax]) kmax = k; });
    ds.forEach((d, k) => {
      const w = ws[k];
      if (!w) return;
      for (const key of ['hip', 'rot', 'spine', 'head', 'pr', 'root']) d[key].forEach((x, i) => { out[key][i] += x * w; });
      for (let s = 0; s < 2; s++) d.curl[s].forEach((x, i) => { out.curl[s][i] += x * w; });
    });
    for (let s = 0; s < 2; s++) {
      out.arm[s] = mixLimb(ds.map((d) => d.arm[s]), ws, kmax, false);
      out.leg[s] = mixLimb(ds.map((d) => d.leg[s]), ws, kmax, true);
      out.hand[s] = mixHand(ds.map((d) => d.hand[s]), ws, kmax);
    }
    return out;
  }

  /* ---------- the clips ---------- */
  const CLIPS = [];
  /** A looping cycle: fn(phase 0..2π, rig) -> pose; or gait: {...} for a walk or run. */
  function cycle(name, o) {
    const c = Object.assign({ name, loop: true, kind: 'cycle' }, o);
    if (o.gait) { c.fn = gait(o.gait); c.speed = o.gait.speed; c.dur = o.gait.dur; c.stride = o.gait.speed * o.gait.dur; }
    if (o.crawl) { c.fn = crawl(o.crawl); c.stride = o.crawl.stride; }
    CLIPS.push(c);
  }
  /** A keyframed clip: keys [[time, pose], …], eased through with Catmull-Rom. */
  function keyed(name, o) { CLIPS.push(Object.assign({ name, loop: false, kind: 'keys' }, o)); }

  const FOOT = 0.104;                                          // the ankle above the floor, foot flat
  const ank = (heel) => 0.01 + 0.175 * S((33 + heel) * D);     // ... with the heel raised, toes down
  const planted = (x, z, heel, more) => Object.assign({ ik: [x, heel ? ank(heel) : FOOT, z], toe: heel || 0 }, more || {});
  const air = (x, y, z, toe, more) => Object.assign({ ik: [x, y, z], rel: true, toe: toe || 0 }, more || {});
  const HY = 1.0058;

  /**
   * Walking and running with the feet planted: a foot on the ground slides back under him at
   * exactly his speed (so it never skates), rolls from heel to toe, then swings forward through
   * the air; the hips ride highest over the planted foot when walking and lowest when running,
   * and never ask a planted leg to reach further than it can.
   */
  function gait(o) {
    return (p, g) => {
      const ph = p / PI2, ex = o.speed * o.dur * o.beta, fl = g.footLen, fp = g.footPitch;
      const zOn = ex * o.land, toeOn = zOn + fl * C(fp * D), thOff = (fp + o.heel) * D;
      const feet = [0, 1].map((s) => {
        const sg = s ? -1 : 1, q = (ph + s * 0.5) % 1;
        if (q < o.beta) {
          const u = q / o.beta, heel = o.heel * sstep(o.heelAt, 1, u), th = (fp + heel) * D;
          return { down: true, x: sg * o.width, y: g.toeY + fl * S(th), z: toeOn - ex * u - fl * C(th), toe: u < 0.2 ? lerp(o.toeLand, heel, u / 0.2) : heel };
        }
        const u = (q - o.beta) / (1 - o.beta), it = 1 - u;
        const z0 = toeOn - ex - fl * C(thOff), y0 = g.toeY + fl * S(thOff), z1 = z0 - o.kick, y1 = y0 + o.lift;
        const z2 = zOn + o.reach, y2 = g.ankle + o.lift * 0.45, z3 = zOn, y3 = g.ankle;
        const b = (a0, a1, a2, a3) => it * it * it * a0 + 3 * it * it * u * a1 + 3 * it * u * u * a2 + u * u * u * a3;
        return { down: false, x: sg * o.width, y: b(y0, y1, y2, y3), z: b(z0, z1, z2, z3), toe: lerp(o.heel, o.toeLand, sstep(0.2, 0.9, u)) };
      });
      const c1 = C(PI2 * ph), mid = C(PI2 * (ph - o.beta / 2)), bob = C(2 * PI2 * (ph - o.beta / 2)), sway = o.sway * mid;
      let hy = g.hipsY + o.drop + o.bob * bob;
      feet.forEach((f, s) => {
        if (!f.down) return;
        const dx = f.x - (s ? -1 : 1) * g.hipJointX - sway, r = g.reach * 0.985;
        const top = f.y + Math.sqrt(Math.max(0, r * r - dx * dx - f.z * f.z)) + g.hipJointDY;
        hy = -0.012 * Math.log(Math.exp(-hy / 0.012) + Math.exp(-top / 0.012)); // a soft minimum
      });
      const arm = (s) => {
        const sw = -C(PI2 * (ph + s * 0.5)); // -1 back … 1 forward, against the leg on the same side
        return [o.armBias + o.armAmp * sw, o.armOut, o.elbow + o.elbowSw * M(0, sw), -o.cross * M(0, sw)];
      };
      const leg = (f, sg) => ({ ik: [f.x, f.y, f.z], toe: f.toe, pole: [sg * 0.12, 0, 1] });
      return P({
        hip: [hy - g.hipsY, o.lean, -o.yaw * c1, o.roll * mid, sway, 0], spine: [o.chest, o.twist * c1, -o.roll * 0.5 * mid],
        head: [o.head - o.lean - o.chest, (o.yaw - o.twist) * 0.6 * c1, 0],
        aL: arm(0), aR: arm(1), pr: [o.pr, o.pr], fist: [o.fist, o.fist], lL: leg(feet[0], 1), lR: leg(feet[1], -1),
      });
    };
  }

  /**
   * Crawling on a wall or a ceiling (the surface is his floor): hands and feet in diagonal pairs,
   * each planted until it has slid a stride back under him, then lifted and placed ahead.
   * dir: which way he goes in the plane ([x, z]; z is toward his head).
   */
  function crawl(o) {
    const HOME = [['lh', 0.4, 0.05, 0.5, 0], ['rf', -0.36, 0.12, -0.36, 0.06], ['rh', -0.4, 0.05, 0.5, 0.5], ['lf', 0.36, 0.12, -0.36, 0.56]];
    return (p, g) => {
      const ph = p / PI2, at = {}, mx = o.dir[0], mz = o.dir[1];
      let lift = 0;
      for (const [k, hx, hy, hz, off] of HOME) {
        const q = (ph + off) % 1;
        let s = 0, up = 0;
        if (o.stride) {
          if (q < o.beta) s = 0.5 - q / o.beta;
          else { const u = (q - o.beta) / (1 - o.beta); s = -0.5 + sstep(0, 1, u); up = S(Math.PI * u); lift += up; }
        }
        at[k] = [hx + mx * o.stride * s, hy + 0.09 * up, hz + mz * o.stride * s];
      }
      const breathe = o.stride ? 0 : S(p), push = C(PI2 * ph * 2);
      return P({
        hip: [o.h - g.hipsY + 0.012 * push + 0.008 * breathe, 80, 5 * C(PI2 * ph) * Math.abs(mz), 0, 0.03 * mx * push, 0.03 * mz * push],
        spine: [-6 - 2 * breathe, -6 * C(PI2 * ph) * Math.abs(mz), 0], head: [o.head + 3 * breathe, o.look ? 22 * S(p) : 18 * mx, 0],
        aL: { ik: at.lh, pole: [1, 0.8, -0.3] }, aR: { ik: at.rh, pole: [-1, 0.8, -0.3] },
        hL: { d: [0.35, 0, 1], n: [0, -1, 0] }, hR: { d: [-0.35, 0, 1], n: [0, -1, 0] },
        lL: { ik: at.lf, pole: [1, 0.7, 0.2], ft: [0.45, -0.55, -0.35] }, lR: { ik: at.rf, pole: [-1, 0.7, 0.2], ft: [-0.45, -0.55, -0.35] },
        fist: [0.15, 0.15], g: ['claw', 'claw'],
      });
    };
  }

  // stances
  const STAND = P({ hip: [-0.02, 2, 0], spine: [1, 0, 0], head: [-3, 0, 0], aL: [5, 9, 20, -6], aR: [5, 9, 20, -6],
    lL: planted(0.12, -0.03), lR: planted(-0.12, -0.03), fist: [0.35, 0.35] });
  const GUARD = P({ hip: [-0.08, 6, -24], spine: [6, 14, 0], head: [-8, 10, 0], aL: [38, 18, 114, -42], aR: [22, 24, 130, -44], pr: [25, 25], fist: [1, 1],
    lL: planted(0.13, 0.2, 0, { pole: [0.35, 0, 1] }), lR: planted(-0.16, -0.24, 16, { pole: [-0.2, 0, 1] }) });
  const CROUCH = P({ hip: [-0.3, 26, 0], spine: [18, 0, 0], head: [-34, 0, 0], aL: [36, 30, 34, 0], aR: [36, 30, 34, 0],
    lL: planted(0.15, 0.04), lR: planted(-0.15, 0.04), fist: [0.6, 0.6] });
  const TUCK = P({ spine: [28, 0, 0], head: [18, 0, 0], aL: [58, 24, 84, 0], aR: [58, 24, 84, 0], fist: [0.9, 0.9],
    lL: air(0.14, -0.3, 0.3, 30, { pole: [0.2, 0.4, 1] }), lR: air(-0.14, -0.3, 0.3, 30, { pole: [-0.2, 0.4, 1] }) });
  const SPREAD = P({ spine: [-6, 0, 0], head: [-16, 0, 0], aL: [100, 68, 30, 0], aR: [100, 68, 30, 0], fist: [0.35, 0.35],
    lL: air(0.22, -0.8, 0.14, 22), lR: air(-0.2, -0.76, -0.12, 26) });

  // --- standing, walking, running ---
  cycle('idle', { dur: 4, fn: (p) => P({
    hip: [-0.025 + 0.004 * S(2 * p), 2, 2 * S(p + 0.5), 2.5 * S(p), 0.022 * S(p), 0], spine: [1 - 1.5 * S(2 * p), -1.5 * S(p + 0.5), -1.5 * S(p)],
    head: [-3 + S(2 * p), 10 * S(p) - 4 * S(2 * p + 1), 1.5 * S(p)],
    aL: [5 + 2 * S(p + 0.6), 9 + 1.2 * S(2 * p), 20, -6], aR: [5 + 2 * S(p + 0.9), 9 + 1.2 * S(2 * p), 20, -6],
    lL: planted(0.12, -0.03), lR: planted(-0.12, -0.03), fist: [0.3, 0.3] }) });
  cycle('idle_ready', { dur: 1.6, fn: (p) => K(GUARD, { hip: [-0.09 + 0.018 * S(2 * p), 6, -24], spine: [6 + 2 * S(2 * p), 14, 0], head: [-8, 10 + 3 * S(p), 0],
    aL: [38 + 3 * S(2 * p + 0.5), 18, 114, -42], aR: [22 + 3 * S(2 * p + 0.8), 24, 130, -44] }) });
  cycle('walk', { gait: { speed: 2.0, dur: 0.7, beta: 0.6, land: 0.42, width: 0.1, heel: 36, heelAt: 0.5, toeLand: -14, lift: 0.1, kick: 0.04, reach: 0.06,
    drop: -0.03, bob: 0.018, sway: 0.022, lean: 3, chest: 1, yaw: 5, twist: 8, roll: 3, head: -3, armBias: 4, armAmp: 20, armOut: 8, elbow: 16, elbowSw: 18, cross: 4, pr: 0, fist: 0.3 } });
  cycle('run', { gait: { speed: 8.5, dur: 0.68, beta: 0.17, land: 0.4, width: 0.06, heel: 46, heelAt: 0.3, toeLand: -4, lift: 0.42, kick: 0.22, reach: 0.3,
    drop: -0.06, bob: -0.032, sway: 0.01, lean: 9, chest: 2, yaw: 8, twist: 12, roll: 3, head: -6, armBias: 10, armAmp: 36, armOut: 12, elbow: 82, elbowSw: 18, cross: 14, pr: 20, fist: 0.85 } });
  cycle('sprint', { gait: { speed: 16, dur: 0.52, beta: 0.13, land: 0.36, width: 0.05, heel: 50, heelAt: 0.25, toeLand: 0, lift: 0.58, kick: 0.28, reach: 0.42,
    drop: -0.08, bob: -0.04, sway: 0.008, lean: 22, chest: 4, yaw: 9, twist: 14, roll: 2, head: -10, armBias: 14, armAmp: 52, armOut: 10, elbow: 88, elbowSw: 12, cross: 18, pr: 30, fist: 1 } });
  // the crouch on a ledge: knees wide, one hand down between the feet, looking out over the city
  cycle('perch', { dur: 4, fn: (p) => P({
    hip: [0.56 - HY + 0.005 * S(2 * p), 30, 0, 0, 0, 0.02], spine: [28 + 2 * S(2 * p), 3 * S(p), 0], head: [-58 + 3 * S(2 * p), 26 * S(p), 0],
    aL: { ik: [0.08, 0.06, 0.38], pole: [1, 0.4, -0.2] }, hL: { d: [0.15, 0, 1], n: [0, -1, 0] },
    aR: { ik: [-0.22, 0.42, 0.44], pole: [-1, 0.2, -0.4] }, hR: 10, pr: [0, -20],
    lL: planted(0.25, 0.08, 24, { pole: [1, 0.2, 0.9] }), lR: planted(-0.25, 0.08, 24, { pole: [-1, 0.2, 0.9] }),
    fist: [0.15, 0.45], g: ['flat', null] }) });

  // --- jumping, falling, landing ---
  keyed('jump', { dur: 0.6, keys: [
    [0, K(CROUCH, { hip: [-0.24, 22, 0], aL: [-38, 16, 30, 0], aR: [-38, 16, 30, 0] })],
    [0.12, P({ hip: [0, 4, 0], spine: [-4, 0, 0], head: [-14, 0, 0], aL: [150, 20, 15, 0], aR: [150, 20, 15, 0], lL: planted(0.12, 0.02, 50), lR: planted(-0.12, 0.02, 50), fist: [0.4, 0.4], root: [0, 0.12, 0] })],
    [0.3, P({ spine: [4, 0, 0], head: [-18, 0, 0], aL: [122, 38, 30, 0], aR: [116, 42, 34, 0], lL: air(0.12, -0.64, 0.2, 30), lR: air(-0.12, -0.78, 0.02, 35), fist: [0.5, 0.5], root: [0, 0.9, 0] })],
    [0.6, P({ spine: [8, 0, 0], head: [-20, 0, 0], aL: [100, 52, 40, 0], aR: [92, 56, 44, 0], lL: air(0.13, -0.56, 0.28, 25), lR: air(-0.13, -0.72, -0.02, 30), fist: [0.5, 0.5], root: [0, 1.5, 0] })],
  ] });
  keyed('double_jump', { dur: 0.65, keys: [
    [0, K(SPREAD, { aL: [110, 50, 40, 0], aR: [110, 50, 40, 0] })], [0.1, K(TUCK, { rot: [40, 0, 0], root: [0, 0.4, 0] })], [0.3, K(TUCK, { rot: [190, 0, 0], root: [0, 1.1, 0] })],
    [0.48, K(TUCK, { rot: [320, 0, 0], root: [0, 1.4, 0] })], [0.65, K(SPREAD, { rot: [360, 0, 0], root: [0, 1.5, 0] })],
  ] });
  cycle('fall', { dur: 1.2, fn: (p) => K(SPREAD, {
    spine: [-6 + 2 * S(p), 0, 3 * S(p)], head: [-16, 4 * S(p), 0], aL: [100 + 8 * S(p), 68 + 4 * S(p + 1), 30 + 10 * S(p + 1), 0], aR: [100 + 8 * S(p + 2.2), 68 + 4 * S(p + 3), 30 + 10 * S(p + 3.4), 0],
    lL: air(0.22, -0.8 + 0.03 * S(p), 0.14 + 0.1 * S(p), 22), lR: air(-0.2, -0.76 + 0.03 * S(p + 2.5), -0.12 + 0.1 * S(p + 2.5), 26) }) });
  cycle('dive', { dur: 1.0, fn: (p) => P({
    spine: [-8, 0, 2 * S(p)], head: [-55, 0, 0], aL: [170, 14 + 3 * S(p), 4, 0], aR: [170, 14 + 3 * S(p + 1), 4, 0], hL: -10, hR: -10,
    lL: air(0.08, -0.86, -0.04 + 0.03 * S(p), 45), lR: air(-0.08, -0.84, -0.06 + 0.03 * S(p + 3), 45), fist: [0.15, 0.15] }) });
  keyed('land_soft', { dur: 0.45, keys: [
    [0, K(CROUCH, { hip: [-0.18, 16, 0], spine: [12, 0, 0], head: [-18, 0, 0], aL: [44, 36, 30, 0], aR: [44, 36, 30, 0] })],
    [0.1, K(CROUCH, { hip: [-0.3, 28, 0], spine: [22, 0, 0], aL: [52, 32, 34, 0], aR: [52, 32, 34, 0] })],
    [0.45, K(STAND, { lL: planted(0.13, 0.0), lR: planted(-0.13, 0.0) })],
  ] });
  keyed('land_roll', { dur: 0.7, keys: [
    [0, K(CROUCH, { hip: [-0.36, 32, 0], spine: [36, 0, 0], aL: [70, 30, 30, 0], aR: [70, 30, 30, 0] })],
    [0.16, K(TUCK, { hip: [-0.44, 0, 0], rot: [110, 0, 0], root: [0, 0, 0.8] })], [0.34, K(TUCK, { hip: [-0.4, 0, 0], rot: [250, 0, 0], root: [0, 0, 1.7] })],
    [0.5, K(CROUCH, { hip: [-0.36, 30, 0], rot: [360, 0, 0], root: [0, 0, 2.4] })], [0.7, K(STAND, { rot: [360, 0, 0], root: [0, 0, 2.7] })],
  ] });
  // one knee and one fist down, the other arm out behind: the landing that cracks the pavement
  const HERO = P({ hip: [0.5 - HY, 36, 10, 0, 0, 0.05], spine: [30, 6, 0], head: [10, -4, 0],
    aR: { ik: [-0.17, 0.08, 0.36], pole: [-1, 0, -0.2] }, hR: { d: [0, -1, 0.15], n: [1, 0, 0] },
    aL: [-46, 56, 24, 0], hL: 18, fist: [0.25, 1],
    lL: planted(0.2, 0.36, 0, { pole: [0.4, 0.2, 1] }), lR: { ik: [-0.17, 0.12, -0.5], toe: 70, pole: [-0.1, -1, 0.3] } });
  keyed('land_hero', { dur: 1.3, keys: [
    [0, K(HERO, { hip: [0.46 - HY, 40, 10, 0, 0, 0.05], spine: [36, 6, 0] })], [0.14, HERO],
    [0.65, K(HERO, { head: [-30, -10, 0], spine: [24, 4, 0] })], [0.95, K(HERO, { hip: [0.75 - HY, 20, 4, 0, 0, 0], head: [-10, 0, 0], spine: [14, 0, 0], lR: { ik: [-0.15, 0.2, -0.3], toe: 50, pole: [-0.1, -0.3, 1] } })],
    [1.3, K(STAND, { lL: planted(0.13, 0.12), lR: { ik: [-0.12, FOOT, -0.06], toe: 0, pole: [-0.12, 0, 1] } })],
  ] });

  // --- webs: shots, catching the line, swinging (blended by the physics), letting go, launching ---
  const THWIP = { d: [0, 0.82, 0.57], n: [0, -0.57, 0.82] }; // wrist back, palm out, middle fingers in
  const SHOT = (t) => P({ hip: [0, 0, 6 * t], spine: [2, 10 * t, 0], aR: [80 + 10 * t, 8, 12 - 12 * t, -4 + 4 * t], hR: t > 0.5 ? THWIP : 30 * t, g: [null, t > 0.5 ? 'thwip' : null], fist: [0.5, 0.5] });
  keyed('web_shoot_r', { dur: 0.4, upper: true, mirror: 'web_shoot_l', keys: [[0, P()], [0.06, SHOT(0.6)], [0.11, SHOT(1)], [0.26, SHOT(1)], [0.4, P()]] });
  const BOTH = P({ spine: [5, 0, 0], head: [-6, 0, 0], aL: [90, 8, 0, 0], aR: [90, 8, 0, 0], hL: THWIP, hR: THWIP, g: ['thwip', 'thwip'] });
  keyed('web_shoot_both', { dur: 0.45, upper: true, keys: [[0, K(BOTH, { aL: [40, 14, 60, 0], aR: [40, 14, 60, 0], hL: { d: [0, 0, 1], n: [-1, 0, 0] }, hR: { d: [0, 0, 1], n: [1, 0, 0] } })], [0.09, BOTH], [0.3, BOTH], [0.45, K(BOTH, { aL: [30, 12, 40, 0], aR: [30, 12, 40, 0], hL: { d: [0, -0.3, 1], n: [-1, 0, 0] }, hR: { d: [0, -0.3, 1], n: [1, 0, 0] }, g: [null, null] })]] });
  const SW_ARM = [176, 10, 4, 0]; // the web hand straight up the line
  keyed('web_attach_r', { dur: 0.32, upper: true, mirror: 'web_attach_l', keys: [
    [0, P({ aR: [110, 14, 30, 0], hR: 20 })], [0.07, P({ spine: [-8, 0, 8], head: [-28, 0, 0], aR: [178, 8, 0, 0], hR: THWIP, g: [null, 'thwip'] })],
    [0.14, P({ spine: [-12, 0, 10], head: [-26, 0, 0], aR: SW_ARM, fist: [0.5, 1] })], [0.32, P({ spine: [-8, 0, 8], head: [-30, 0, 0], aR: SW_ARM, fist: [0.5, 1] })],
  ] });
  // the arc: legs trail behind as he drops in, swing through at the bottom, kick up as he rises
  cycle('swing_back_r', { dur: 1.0, mirror: 'swing_back_l', fn: (p) => P({ hip: [0, -12, 0], spine: [-14, 6, 6], head: [-26, 0, 0],
    aR: SW_ARM, aL: [-28 + 5 * S(p), 36, 46, 0], fist: [0.55, 1], hL: 15,
    lL: [-24 + 4 * S(p), 7, 30 + 6 * S(p), 32], lR: [-14 + 4 * S(p + 1.4), 7, 62 + 6 * S(p + 1.4), 32] }) });
  cycle('swing_bottom_r', { dur: 1.0, mirror: 'swing_bottom_l', fn: (p) => P({ hip: [0, 2, 0], spine: [-2, 8, 8], head: [-34, 0, 0],
    aR: SW_ARM, aL: [26 + 5 * S(p), 58, 42, 0], fist: [0.5, 1],
    lL: [24 + 4 * S(p), 8, 40 + 6 * S(p), 26], lR: [8 + 4 * S(p + 1.4), 8, 68 + 6 * S(p + 1.4), 26] }) });
  cycle('swing_front_r', { dur: 1.0, mirror: 'swing_front_l', fn: (p) => P({ hip: [0, -6, 0], spine: [6, 8, 8], head: [-40, 0, 0],
    aR: SW_ARM, aL: [82 + 5 * S(p), 52, 40, 0], fist: [0.5, 1], hL: 20,
    lL: [86 + 3 * S(p), 10, 102 + 4 * S(p), 18], lR: [68 + 3 * S(p + 1.4), 10, 120 + 4 * S(p + 1.4), 18] }) });
  keyed('web_release', { dur: 0.5, keys: [
    [0, P({ hip: [0, -6, 0], spine: [6, 8, 8], head: [-40, 0, 0], aR: SW_ARM, aL: [82, 52, 40, 0], fist: [0.5, 1], lL: [86, 10, 102, 18], lR: [68, 10, 120, 18] })],
    [0.14, P({ spine: [-16, 0, 0], head: [-30, 0, 0], aL: [150, 50, 20, 0], aR: [158, 46, 16, 0], lL: [-6, 10, 10, 40], lR: [0, 10, 16, 40], fist: [0.3, 0.3] })],
    [0.5, P({ spine: [-6, 0, 0], head: [-16, 0, 0], aL: [100, 68, 30, 0], aR: [100, 68, 30, 0], lL: [22, 14, 40, 22], lR: [-6, 14, 30, 26], fist: [0.35, 0.35] })],
  ] });
  keyed('launch', { dur: 0.6, keys: [
    [0, P({ spine: [18, 0, 0], head: [-30, 0, 0], aL: [112, 10, 8, 0], aR: [112, 10, 8, 0], hL: THWIP, hR: THWIP, g: ['thwip', 'thwip'], lL: [72, 10, 108, 20], lR: [72, 10, 108, 20] })],
    [0.22, P({ spine: [-20, 0, 0], head: [-34, 0, 0], aL: [164, 34, 10, 0], aR: [164, 34, 10, 0], lL: [-14, 8, 6, 45], lR: [-8, 8, 10, 45], fist: [0.3, 0.3], root: [0, 1.5, 3] })],
    [0.6, P({ spine: [-6, 0, 0], head: [-16, 0, 0], aL: [100, 68, 30, 0], aR: [100, 68, 30, 0], lL: [10, 12, 30, 25], lR: [22, 12, 44, 25], fist: [0.35, 0.35], root: [0, 3.2, 8] })],
  ] });
  cycle('web_zip', { dur: 0.6, fn: (p) => P({ spine: [8, 0, 0], head: [-30, 0, 0], aL: [116, 8, 8, 0], aR: [116, 8, 8, 0], hL: 25, hR: 25, fist: [1, 1],
    lL: [-22 + 4 * S(p), 6, 44, 28], lR: [-8 + 4 * S(p + Math.PI), 6, 66, 28] }) });

  // --- walls and ceilings: the surface is his floor; he lies along it, limbs spread like a spider ---
  cycle('wall_crawl_up', { dur: 0.8, crawl: { dir: [0, 1], stride: 0.42, beta: 0.7, h: 0.33, head: -76 } });
  cycle('wall_crawl_down', { dur: 0.8, crawl: { dir: [0, -1], stride: 0.42, beta: 0.7, h: 0.33, head: -64 } });
  cycle('wall_crawl_left', { dur: 0.8, mirror: 'wall_crawl_right', crawl: { dir: [1, 0], stride: 0.36, beta: 0.7, h: 0.33, head: -74 } });
  cycle('wall_idle', { dur: 3.2, crawl: { dir: [0, 1], stride: 0, beta: 1, h: 0.34, head: -74, look: true } });
  cycle('ceiling_crawl', { dur: 0.95, crawl: { dir: [0, 1], stride: 0.4, beta: 0.72, h: 0.31, head: -70 } });
  cycle('ceiling_idle', { dur: 3.2, crawl: { dir: [0, 1], stride: 0, beta: 1, h: 0.32, head: -66, look: true } });
  // running straight up a wall: a sprint with the wall as the floor
  cycle('wall_run_up', { gait: { speed: 18, dur: 0.5, beta: 0.13, land: 0.36, width: 0.05, heel: 50, heelAt: 0.25, toeLand: 0, lift: 0.56, kick: 0.26, reach: 0.4,
    drop: -0.08, bob: -0.04, sway: 0.008, lean: 26, chest: 4, yaw: 9, twist: 14, roll: 2, head: -16, armBias: 16, armAmp: 54, armOut: 12, elbow: 88, elbowSw: 12, cross: 18, pr: 30, fist: 1 } });
  // running along a wall with it on his right: leaning off it, the free arm out for balance
  const sideRun = gait({ speed: 14, dur: 0.56, beta: 0.15, land: 0.38, width: 0.07, heel: 46, heelAt: 0.28, toeLand: -2, lift: 0.5, kick: 0.24, reach: 0.36,
    drop: -0.07, bob: -0.035, sway: 0.01, lean: 14, chest: 3, yaw: 8, twist: 10, roll: 2, head: -8, armBias: 12, armAmp: 40, armOut: 14, elbow: 84, elbowSw: 14, cross: 14, pr: 25, fist: 0.9 });
  cycle('wall_run_side_r', { dur: 0.56, speed: 14, stride: 14 * 0.56, mirror: 'wall_run_side_l', fn: (p, g) => {
    const b = sideRun(p, g);
    return K(b, { hip: [b.hip[0], b.hip[1], b.hip[2], b.hip[3] - 8, b.hip[4], 0], spine: [b.spine[0], b.spine[1], -10], head: [b.head[0], b.head[1], 10],
      aL: [70 + 14 * S(p), 64, 40, 0], fist: [0.4, 1] });
  } });
  keyed('wall_jump', { dur: 0.55, keys: [
    [0, P({ hip: [-0.1, 20, 0], spine: [14, 0, 0], head: [-30, 0, 0], aL: [-30, 30, 40, 0], aR: [-30, 30, 40, 0], lL: air(0.16, -0.42, 0.28, 0, { pole: [0.4, 0.2, 1] }), lR: air(-0.16, -0.42, 0.28, 0, { pole: [-0.4, 0.2, 1] }), fist: [0.6, 0.6] })],
    [0.14, P({ spine: [-14, -10, 0], head: [-26, -14, 0], aL: [150, 40, 20, 0], aR: [126, 58, 30, 0], lL: air(0.1, -0.84, -0.12, 45), lR: air(-0.1, -0.8, -0.2, 45), fist: [0.3, 0.3], root: [0, 0.6, 1.2] })],
    [0.55, K(SPREAD, { rot: [0, 30, 0], root: [0, 1.4, 3.4] })],
  ] });

  // --- tricks in the air ---
  const flip = (axis, deg, open, up) => [0, 0.1, 0.32, 0.52, 0.7].map((t, k) => {
    const a = [0, 40, 190, 320, 360][k] * (deg / 360), r = [0, 0, 0];
    r[axis] = a;
    return [t, K(k === 0 || k === 4 ? open : TUCK, { rot: r, root: [0, up * [0, 0.35, 0.9, 1.1, 1.0][k], 0] })];
  });
  keyed('front_flip', { dur: 0.7, keys: flip(0, 360, SPREAD, 1) });
  keyed('back_flip', { dur: 0.7, keys: flip(0, -360, K(SPREAD, { aL: [160, 30, 10, 0], aR: [160, 30, 10, 0] }), 1) });
  const CORK = P({ head: [-10, 0, 0], aL: [40, 12, 135, -60], aR: [40, 12, 135, -60], fist: [1, 1], lL: air(0.06, -0.86, -0.02, 45), lR: air(-0.06, -0.84, 0.02, 45) });
  keyed('aerial_spin', { dur: 0.7, mirror: 'barrel_roll', keys: [[0, SPREAD], [0.1, K(CORK, { rot: [0, 0, 30] })], [0.35, K(CORK, { rot: [0, 0, 200] })], [0.55, K(CORK, { rot: [0, 0, 330] })], [0.7, K(SPREAD, { rot: [0, 0, 360] })]] });
  const TWIST = P({ spine: [-4, 0, 0], head: [-15, 0, 0], aL: [95, 85, 10, 0], aR: [95, 85, 10, 0], lL: air(0.3, -0.62, 0.26, 30), lR: air(-0.2, -0.78, -0.16, 40) });
  keyed('twister', { dur: 0.7, keys: [[0, SPREAD], [0.12, K(TWIST, { rot: [0, 50, 0] })], [0.35, K(TWIST, { rot: [0, 200, 0] })], [0.55, K(TWIST, { rot: [0, 320, 0] })], [0.7, K(SPREAD, { rot: [0, 360, 0] })]] });

  // --- fighting: the feet stay planted while the hips and shoulders throw the blows ---
  const JAB = K(GUARD, { hip: [-0.08, 8, -32], spine: [8, -4, 0], head: [-8, 26, 0], aL: [86, 6, 0, 0], pr: [90, 25] });
  const CROSS = K(GUARD, { hip: [-0.09, 10, 16], spine: [10, 22, 0], head: [-8, -28, 0], aR: [86, 2, 0, 0], aL: [34, 22, 120, -44], pr: [25, 90],
    lR: planted(-0.16, -0.24, 34, { pole: [-0.1, 0, 1] }) });
  keyed('punch_l', { dur: 0.36, keys: [[0, GUARD], [0.07, JAB], [0.15, JAB], [0.36, GUARD]] });
  keyed('punch_r', { dur: 0.42, keys: [[0, GUARD], [0.1, CROSS], [0.2, CROSS], [0.42, GUARD]] });
  keyed('uppercut', { dur: 0.55, keys: [
    [0, GUARD], [0.12, K(GUARD, { hip: [-0.16, 16, -10], spine: [18, 8, 0], aR: [8, 20, 100, -20] })],
    [0.24, K(GUARD, { hip: [-0.02, -2, 26], spine: [-10, 26, 0], head: [-26, -24, 0], aR: [158, 8, 24, 0], lR: planted(-0.16, -0.24, 40, { pole: [-0.1, 0, 1] }) })],
    [0.32, K(GUARD, { hip: [-0.02, -2, 26], spine: [-10, 26, 0], head: [-24, -24, 0], aR: [160, 8, 24, 0], lR: planted(-0.16, -0.24, 40, { pole: [-0.1, 0, 1] }) })], [0.55, GUARD],
  ] });
  const CHAMBER = K(GUARD, { spine: [-4, 6, 0], lR: { ik: [-0.12, 0.6, 0.34], toe: -10, pole: [-0.1, 0.5, 1] } });
  const PUSH = K(GUARD, { hip: [-0.06, -8, -14], spine: [-12, 6, 0], head: [0, 10, 0], lR: { ik: [-0.08, 1.0, 0.72], ft: [0, 1, 0.25], pole: [-0.1, 1, 0.3] } });
  keyed('kick_front', { dur: 0.6, keys: [[0, GUARD], [0.13, CHAMBER], [0.24, PUSH], [0.32, PUSH], [0.44, CHAMBER], [0.6, GUARD]] });
  const PIVOT = (yaw, out) => K(GUARD, { hip: [-0.05, out ? -18 : 0, 0, out ? -24 : 0], rot: [0, yaw, 0], spine: [out ? 10 : 0, 0, out ? 14 : 0], head: [-10, out ? -60 : 0, 0],
    aL: [60, 66, 40, 0], aR: [50, 60, 60, 0], lL: planted(0.04, 0.02, 10, { pole: [0.2, 0, 1] }),
    lR: out ? { ik: [-0.86, 1.02, 0.08], ft: [-0.2, 1, 0.3], pole: [0, 1, 0.2] } : { ik: [-0.22, 0.46, -0.08], toe: 20, pole: [-0.4, 0.4, 1] } });
  keyed('kick_spin', { dur: 0.8, keys: [[0, GUARD], [0.16, PIVOT(110, false)], [0.32, PIVOT(210, true)], [0.42, PIVOT(250, true)], [0.58, PIVOT(320, false)], [0.8, K(GUARD, { rot: [0, 360, 0] })]] });
  keyed('combo', { dur: 1.62, keys: [
    [0, GUARD], [0.07, JAB], [0.15, JAB], [0.28, GUARD], [0.38, CROSS], [0.48, CROSS], [0.62, GUARD],
    [0.78, PIVOT(110, false)], [0.94, PIVOT(210, true)], [1.04, PIVOT(250, true)], [1.2, PIVOT(320, false)], [1.42, K(GUARD, { rot: [0, 360, 0] })], [1.62, K(GUARD, { rot: [0, 360, 0] })],
  ] });
  keyed('dodge_left', { dur: 0.55, mirror: 'dodge_right', keys: [
    [0, GUARD], [0.08, K(CROUCH, { hip: [-0.3, 18, 0, -12], lL: planted(0.2, 0.04), lR: planted(-0.12, 0.04) })],
    [0.2, K(TUCK, { hip: [-0.25, 0, 0], rot: [0, 0, -140], root: [0.9, 0.3, 0] })], [0.32, K(TUCK, { hip: [-0.25, 0, 0], rot: [0, 0, -280], root: [1.9, 0.3, 0] })],
    [0.44, K(CROUCH, { rot: [0, 0, -360], root: [2.5, 0, 0] })], [0.55, K(GUARD, { rot: [0, 0, -360], root: [2.6, 0, 0] })],
  ] });
  keyed('dodge_back', { dur: 0.65, keys: [
    [0, GUARD], [0.08, K(CROUCH, { aL: [150, 25, 20, 0], aR: [150, 25, 20, 0] })],
    [0.22, K(TUCK, { hip: [-0.1, 0, 0], rot: [-130, 0, 0], root: [0, 0.6, -1.1] })], [0.38, K(TUCK, { hip: [-0.1, 0, 0], rot: [-280, 0, 0], root: [0, 0.6, -2.3] })],
    [0.52, K(CROUCH, { rot: [-360, 0, 0], root: [0, 0, -2.9] })], [0.65, K(GUARD, { rot: [-360, 0, 0], root: [0, 0, -3] })],
  ] });

  // --- web attacks and takedowns ---
  keyed('web_strike', { dur: 0.6, keys: [
    [0, K(BOTH, { lL: air(0.14, -0.4, 0.3, 20), lR: air(-0.14, -0.4, 0.3, 20) })],
    [0.12, K(BOTH, { aL: [112, 8, 0, 0], aR: [112, 8, 0, 0], spine: [12, 0, 0], lL: air(0.14, -0.34, 0.24, 20), lR: air(-0.14, -0.34, 0.24, 20), root: [0, 0.3, 2] })],
    [0.3, P({ hip: [0, -16, 0], spine: [-18, 0, 0], head: [-6, 0, 0], aL: [-26, 30, 30, 0], aR: [-26, 30, 30, 0], fist: [1, 1],
      lR: air(-0.08, -0.4, 0.8, -10, { ft: [0, 0.9, 0.4], pole: [0, 1, 0.3] }), lL: air(0.14, -0.48, 0.12, 30, { pole: [0.2, 0.4, 1] }), root: [0, 0.5, 5] })],
    [0.42, P({ hip: [0, -16, 0], spine: [-18, 0, 0], head: [-6, 0, 0], aL: [-26, 30, 30, 0], aR: [-26, 30, 30, 0], fist: [1, 1],
      lR: air(-0.08, -0.4, 0.8, -10, { ft: [0, 0.9, 0.4], pole: [0, 1, 0.3] }), lL: air(0.14, -0.48, 0.12, 30, { pole: [0.2, 0.4, 1] }), root: [0, 0.5, 6] })],
    [0.6, K(SPREAD, { root: [0, 0.4, 6.4] })],
  ] });
  const PULL = P({ hip: [-0.05, -6, 0], spine: [-14, 0, 0], head: [-10, 0, 0], aL: [18, 34, 130, -40], aR: [18, 34, 130, -40], fist: [1, 1] });
  keyed('web_yank', { dur: 0.5, upper: true, keys: [[0, BOTH], [0.16, PULL], [0.3, PULL], [0.5, P()]] });
  keyed('takedown', { dur: 1.6, keys: [
    [0, K(CROUCH, { aL: [-36, 26, 30, 0], aR: [-36, 26, 30, 0] })],
    [0.22, K(TUCK, { rot: [0, 90, 0], root: [0, 1.1, 0.6] })],
    [0.46, K(TWIST, { rot: [0, 290, 0], root: [0, 1.7, 1.3] })],
    [0.66, K(BOTH, { rot: [0, 360, 0], spine: [24, 0, 0], aL: [60, 8, 0, 0], aR: [60, 8, 0, 0], lL: air(0.18, -0.6, 0.24, 20), lR: air(-0.18, -0.6, 0.24, 20), root: [0, 1.4, 1.8] })],
    [0.9, K(HERO, { rot: [0, 360, 0], root: [0, 0, 2.2] })], [1.25, K(HERO, { rot: [0, 360, 0], head: [-26, -8, 0], root: [0, 0, 2.2] })],
    [1.6, K(GUARD, { rot: [0, 360, 0], root: [0, 0, 2.2] })],
  ] });

  // --- after the job ---
  const HANDS_ON_HIPS = K(STAND, { spine: [-5, 0, 0], head: [-10, 16, 0], aL: [-18, 44, 112, -76], aR: [-18, 44, 112, -76], hL: -20, hR: -20, fist: [0.7, 0.7],
    lL: planted(0.15, -0.02), lR: planted(-0.15, -0.04) });
  keyed('victory', { dur: 2.2, keys: [
    [0, STAND], [0.3, K(STAND, { spine: [-8, 6, 4], head: [-22, 10, 0], aR: [176, 8, 6, 0], aL: [6, 22, 12, 0], fist: [0.4, 1] })],
    [0.6, K(STAND, { spine: [-10, 6, 4], head: [-24, 10, 0], aR: [178, 8, 4, 0], aL: [6, 22, 12, 0], fist: [0.4, 1] })],
    [0.95, K(STAND, { spine: [4, 0, 0], aR: [40, 12, 118, -40], fist: [0.5, 1] })], [1.4, HANDS_ON_HIPS], [2.2, HANDS_ON_HIPS],
  ] });

  // whole swings, for engines that animate a swing by hand (the game blends the three arc poses by the physics instead)
  const arc = (name) => CLIPS.find((x) => x.name === name).fn(0);
  keyed('swing_forward', { dur: 1.2, keys: [[0, arc('swing_back_r')], [0.6, arc('swing_bottom_r')], [1.2, arc('swing_front_r')]] });
  keyed('swing_backward', { dur: 1.2, keys: [[0, arc('swing_front_r')], [0.6, arc('swing_bottom_r')], [1.2, arc('swing_back_r')]] });

  // mirrored twins
  CLIPS.slice().forEach((c) => {
    if (!c.mirror) return;
    const m = Object.assign({}, c, { name: c.mirror, mirror: null });
    if (c.kind === 'cycle') m.fn = (p, g) => mirror(c.fn(p, g)); else m.keys = c.keys.map(([t, pz]) => [t, mirror(pz)]);
    CLIPS.push(m);
  });

  /* ---------- baking ---------- */
  function poseAt(c, t, g) {
    if (c.kind === 'cycle') return decode(c.fn((t / c.dur) * PI2, g));
    const ks = c.dk || (c.dk = c.keys.map(([tt, pz]) => [tt, decode(pz)]));
    if (t <= ks[0][0]) return ks[0][1];
    if (t >= ks[ks.length - 1][0]) return ks[ks.length - 1][1];
    let i = 0;
    while (i < ks.length - 2 && t > ks[i + 1][0]) i++;
    const u = (t - ks[i][0]) / (ks[i + 1][0] - ks[i][0]);
    // Catmull-Rom through the neighbouring keys (smooth speed through every key), eased out of the first and into the last
    const ease = (i === 0 ? 1 : 0) + (i === ks.length - 2 ? 1 : 0);
    const uu = ease ? lerp(u, u * u * (3 - 2 * u), 0.5 * ease) : u;
    const p0 = ks[Math.max(0, i - 1)][1], p1 = ks[i][1], p2 = ks[i + 1][1], p3 = ks[Math.min(ks.length - 1, i + 2)][1];
    const t2 = uu * uu, t3 = t2 * uu;
    return mix([p0, p1, p2, p3], [(-t3 + 2 * t2 - uu) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + uu) / 2, (t3 - t2) / 2]);
  }

  /**
   * Bake every clip on this skeleton: local rotations per frame (frames * bones * 4, kept in one
   * hemisphere from frame to frame), the hips per frame (frames * 3) and the root motion (frames * 3).
   */
  function bake(solver, only) {
    const n = solver.n, out = {}, g = solver.geo;
    const wq = Array.from({ length: n }, () => new T.Quaternion()), wp = Array.from({ length: n }, () => new T.Vector3());
    const feet = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'].map((b) => solver.idx[b]);
    const restFloor = Math.min(...feet.map((i) => solver.restPos[i].y));
    for (const c of CLIPS) {
      if (only && !only.includes(c.name)) continue;
      const frames = c.loop ? Math.round(c.dur * FPS) : Math.round(c.dur * FPS) + 1;
      const q = new Float32Array(frames * n * 4), hip = new Float32Array(frames * 3), root = new Float32Array(frames * 3);
      const hp = [0, 0, 0];
      for (let f = 0; f < frames; f++) {
        const t = c.loop ? (f / frames) * c.dur : Math.min(c.dur, f / FPS);
        const d = poseAt(c, t, g);
        const qs = q.subarray(f * n * 4, (f + 1) * n * 4);
        solver.solve(d, qs, hp);
        if (c.ground) { solver.fk(qs, hp, wq, wp); hp[1] += restFloor - Math.min(...feet.map((i) => wp[i].y)); }
        if (f > 0) for (let i = 0; i < n; i++) {
          const a = ((f - 1) * n + i) * 4, b = (f * n + i) * 4;
          if (q[a] * q[b] + q[a + 1] * q[b + 1] + q[a + 2] * q[b + 2] + q[a + 3] * q[b + 3] < 0) for (let k = 0; k < 4; k++) q[b + k] = -q[b + k];
        }
        hip.set(hp, f * 3); root.set(d.root, f * 3);
      }
      // loops are sampled so that frame 'frames' lands exactly on frame 0 again
      out[c.name] = { name: c.name, dur: c.dur, loop: c.loop, frames, fps: c.loop ? frames / c.dur : FPS, q, hip, root, upper: !!c.upper, speed: c.speed || 0, stride: c.stride || 0 };
    }
    return out;
  }

  /**
   * Baked clips as three.js AnimationClips, ready for GLTFExporter or AnimationClip.toJSON.
   * opts.rootBone: put the root motion on a bone of that name (the parent of Hips) and keep the
   * Hips track in place; otherwise it is added to the Hips track (opts.rootMotion false: left out).
   */
  function toThree(baked, solver, opts) {
    opts = opts || {};
    return Object.values(baked).map((b) => {
      const times = new Float32Array(b.frames + (b.loop ? 1 : 0)); // loops end on their first frame again
      for (let f = 0; f < times.length; f++) times[f] = f / b.fps;
      const tracks = [];
      for (let i = 0; i < solver.n; i++) {
        const v = new Float32Array(times.length * 4);
        for (let f = 0; f < times.length; f++) v.set(b.q.subarray(((f % b.frames) * solver.n + i) * 4, ((f % b.frames) * solver.n + i) * 4 + 4), f * 4);
        for (let f = 1; f < times.length; f++) { // one hemisphere, so engines interpolate the short way
          const a = (f - 1) * 4, c = f * 4;
          if (v[a] * v[c] + v[a + 1] * v[c + 1] + v[a + 2] * v[c + 2] + v[a + 3] * v[c + 3] < 0) for (let k = 0; k < 4; k++) v[c + k] = -v[c + k];
        }
        let still = true; // a bone that holds still through the clip needs only two keys
        for (let k = 4; k < v.length && still; k++) if (Math.abs(v[k] - v[k % 4]) > 2e-5) still = false;
        if (still) tracks.push(new T.QuaternionKeyframeTrack(solver.names[i] + '.quaternion', [0, times[times.length - 1]], [...v.subarray(0, 4), ...v.subarray(0, 4)]));
        else tracks.push(new T.QuaternionKeyframeTrack(solver.names[i] + '.quaternion', times, v));
      }
      const hv = new Float32Array(times.length * 3), rv = new Float32Array(times.length * 3);
      let moves = false;
      for (let f = 0; f < times.length; f++) for (let k = 0; k < 3; k++) {
        const fr = f % b.frames, r = b.loop ? 0 : b.root[fr * 3 + k];
        rv[f * 3 + k] = r; if (Math.abs(r) > 1e-4) moves = true;
        hv[f * 3 + k] = b.hip[fr * 3 + k] + (!opts.rootBone && opts.rootMotion !== false ? r : 0);
      }
      tracks.push(new T.VectorKeyframeTrack('Hips.position', times, hv));
      if (opts.rootBone) tracks.push(new T.VectorKeyframeTrack(opts.rootBone + '.position', moves ? times : new Float32Array([0, times[times.length - 1]]), moves ? rv : new Float32Array(6)));
      const clip = new T.AnimationClip(b.name, times[times.length - 1], tracks);
      clip.userData = { loop: b.loop, upperBodyOnly: b.upper, rootMotion: moves, speed: b.speed, stride: b.stride };
      return clip;
    });
  }

  /** An original, neutral mannequin skinned to the same skeleton: for previews and exports. */

  function mannequin(solver) {
    const parts = [];
    const add = (geo, bone) => {
      geo = geo.index ? geo.toNonIndexed() : geo;
      const k = geo.attributes.position.count;
      geo.setAttribute('skinIndex', new T.BufferAttribute(new Uint16Array(k * 4).map((_, j) => (j % 4 === 0 ? bone : 0)), 4));
      geo.setAttribute('skinWeight', new T.BufferAttribute(new Float32Array(k * 4).map((_, j) => (j % 4 === 0 ? 1 : 0)), 4));
      parts.push(geo);
    };
    const id = solver.idx, rp = solver.restPos;
    const limb = (a, b, r0, r1) => {
      const pa = rp[id[a]], pb = rp[id[b]], len = pa.distanceTo(pb);
      const g = new T.CylinderGeometry(r1, r0, len, 10, 1).translate(0, len / 2, 0);
      g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), pb.clone().sub(pa).normalize()));
      g.translate(pa.x, pa.y, pa.z);
      add(g, id[a]);
      const s = new T.SphereGeometry(r0 * 1.05, 10, 8).translate(pa.x, pa.y, pa.z);
      add(s, id[a]);
    };
    for (const s of ['Left', 'Right']) {
      limb(s + 'Arm', s + 'ForeArm', 0.055, 0.045); limb(s + 'ForeArm', s + 'Hand', 0.045, 0.035);
      limb(s + 'UpLeg', s + 'Leg', 0.085, 0.06); limb(s + 'Leg', s + 'Foot', 0.06, 0.045); limb(s + 'Foot', s + 'ToeBase', 0.045, 0.035);
      limb(s + 'Shoulder', s + 'Arm', 0.05, 0.05);
      const h = rp[id[s + 'Hand']], m = rp[id[s + 'HandMiddle2']];
      add(new T.SphereGeometry(0.05, 10, 8).scale(1, 0.55, 1).translate((h.x + m.x) / 2, (h.y + m.y) / 2, (h.z + m.z) / 2), id[s + 'Hand']);
    }
    limb('Hips', 'Spine', 0.13, 0.12); limb('Spine', 'Spine1', 0.12, 0.13); limb('Spine1', 'Spine2', 0.13, 0.15); limb('Spine2', 'Neck', 0.15, 0.06); limb('Neck', 'Head', 0.05, 0.05);
    const hd = rp[id.Head], ht = rp[id.HeadTop_End];
    add(new T.SphereGeometry(0.11, 14, 10).scale(0.9, 1.15, 1).translate(hd.x, (hd.y + ht.y) / 2, hd.z + 0.01), id.Head);
    const count = parts.reduce((s2, g) => s2 + g.attributes.position.count, 0);
    const out = new T.BufferGeometry();
    for (const [attr, size, Arr] of [['position', 3, Float32Array], ['normal', 3, Float32Array], ['skinIndex', 4, Uint16Array], ['skinWeight', 4, Float32Array]]) {
      const arr = new Arr(count * size); let o = 0;
      for (const g of parts) { arr.set(g.attributes[attr].array, o); o += g.attributes[attr].array.length; }
      out.setAttribute(attr, new T.BufferAttribute(arr, size));
    }
    return out;
  }


  SMR.anim = { FPS, CLIPS, createSolver, bake, toThree, mannequin, decode, P, K, mirror };
})();
