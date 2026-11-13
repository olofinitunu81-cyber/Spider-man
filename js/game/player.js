/* How the hero moves. Shift swings in the air and sprints on the ground; Space jumps (hold it
   to go higher) and, in the air, fires a web-zip that throws him forward; C zips to the point
   he is aiming at; X perches on that point or dives; Ctrl dodges; T throws an air trick; Alt walks.
   Swings are a real pendulum (gravity pulls, the rope holds) worked in 1/240 s slices, so fast
   swings stay stable at any frame rate. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const G = 25;              // gravity, m/s², a little stronger than real for snappy jumps
  const HW = 0.32, H = 1.75; // the hero's collision box: half width and height
  const HIP = 1.0;           // hips above the feet
  const STEP = 1 / 240;      // physics slice
  const WALK = 3.2, RUN = 8.5, SPRINT = 16, WALL = 15, ZIP = 46, MAX = 44;
  const TRICKS = [['Front flip', [1, 0, 0], 1], ['Back flip', [1, 0, 0], -1], ['Corkscrew', [0, 0, 1], 1], ['Twister', [0, 1, 0], 1], ['Barrel roll', [0, 0, 1], -1]];

  function createPlayer(world, tuning) {
    tuning = tuning || {};
    const p = {
      pos: world.start.clone(), vel: new T.Vector3(), state: 'ground', facing: Math.PI,
      anchor: new T.Vector3(), webEnd: new T.Vector3(), rope: 0, ropeMax: 0, webRight: true, swingT: 0, swingK: 0,
      zipTo: new T.Vector3(), zipEdge: false, zipN: new T.Vector3(), zipT: 0, zipCool: 0, boostCool: 0, boostT: 0,
      wallN: new T.Vector3(), wallTop: 0, wallT: 0,
      airT: 0, groundT: 0, landT: 0, coyote: 0, jumpBuf: 0, jumpHold: 0, dive: false,
      dodgeT: 0, dodgeX: 0, dodgeZ: 0, trickT: 0, trick: null, combo: 0,
      shotT: 0, shotAt: new T.Vector3(), shotRight: true, punchT: 0, punchRight: false,
      health: 100, focus: 0,
      stats: { top: 0, swings: 0, zips: 0, dist: 0, walls: 0, tricks: 0 },
      events: [], // what happened this frame, for sound and the HUD
    };
    const hip = new T.Vector3(), d = new T.Vector3(), wish = new T.Vector3(), tan = new T.Vector3(), tmp = new T.Vector3();

    function hipPoint(out) { return out.set(p.pos.x, p.pos.y + HIP, p.pos.z); }
    const heading = () => {
      const hs = Math.hypot(p.vel.x, p.vel.z);
      return hs > 3 ? [p.vel.x / hs, p.vel.z / hs] : [Math.sin(p.facing), Math.cos(p.facing)];
    };
    function gainFocus(n) { p.focus = Math.min(100, p.focus + n); }

    function toAir() { p.state = 'air'; p.airT = 0; p.dive = false; }

    function startSwing(a) {
      p.state = 'swing'; p.dive = false;
      p.webEnd.copy(a);
      hipPoint(hip);
      // The web sticks to the building, but the swing pivots over his line of travel (as if
      // from an overhang), so the arc carries him along the street instead of into the wall.
      const [ux, uz] = heading();
      const rx = a.x - hip.x, rz = a.z - hip.z, fwd = rx * ux + rz * uz;
      p.anchor.set(hip.x + ux * fwd + (rx - ux * fwd) * 0.35, a.y, hip.z + uz * fwd + (rz - uz * fwd) * 0.35);
      p.rope = Math.min(hip.distanceTo(p.anchor), 70);
      p.ropeMax = Math.max(8, p.anchor.y - world.floorAt(p.anchor.x, p.anchor.z, p.anchor.y - 1) - HIP - 2.2); // never scrape the street
      p.swingT = 0;
      // the web goes from whichever hand is on the anchor's side
      tmp.copy(a).sub(hip);
      p.webRight = tmp.x * -Math.cos(p.facing) + tmp.z * Math.sin(p.facing) >= 0;
      // a swing that starts slow gets a push so the first arc is fun
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (hs < 12) { p.vel.x += ux * (12 - hs) * 0.6; p.vel.z += uz * (12 - hs) * 0.6; }
      p.stats.swings++;
      p.events.push('swing');
    }

    function release(boost) {
      toAir();
      if (boost) {
        const [ux, uz] = heading();
        p.vel.x += ux * 3.5; p.vel.z += uz * 3.5;
        if (p.vel.y > -4) p.vel.y += 5.5;
      }
      p.events.push('release');
    }

    /** Space in the air: a web snaps to something ahead and throws him forward and up. */
    function webBoost(aimDir) {
      const [ux, uz] = heading();
      const fx = aimDir ? U.lerp(ux, aimDir.x, 0.5) : ux, fz = aimDir ? U.lerp(uz, aimDir.z, 0.5) : uz;
      const fl = Math.hypot(fx, fz) || 1;
      hipPoint(hip);
      const h = world.raycast(hip.x, hip.y, hip.z, fx / fl * 0.8, 0.6, fz / fl * 0.8, 60);
      p.webEnd.set(hip.x + (fx / fl) * 30, hip.y + 18, hip.z + (fz / fl) * 30);
      if (h && h.box >= 0) p.webEnd.set(h.x, h.y, h.z);
      const hs = Math.hypot(p.vel.x, p.vel.z), push = Math.max(hs + 8, 22);
      p.vel.set((fx / fl) * push, Math.max(p.vel.y, 0) + 7, (fz / fl) * push);
      if (p.vel.length() > MAX) p.vel.setLength(MAX);
      p.state = 'boost'; p.boostT = 0.24; p.boostCool = 0.4; p.dive = false;
      p.stats.zips++;
      p.events.push('boost');
    }

    function startZip(target, edge, nx, nz) {
      p.state = 'zip'; p.dive = false;
      p.zipTo.copy(target); p.zipEdge = edge; p.zipN.set(nx, 0, nz); p.zipT = 0; p.zipCool = 0.35;
      p.stats.zips++;
      p.events.push('zip');
    }

    function enterWall(nx, nz, top) {
      p.state = 'wall'; p.dive = false;
      p.wallN.set(nx, 0, nz); p.wallTop = top; p.wallT = 0;
      p.vel.set(0, Math.max(p.vel.y, 4), 0);
      p.stats.walls++;
      p.events.push('wall');
    }

    function land(fromVy) {
      const impact = -fromVy;
      if (p.trickT > 0.15) p.events.push('sloppy');
      p.state = 'ground'; p.groundT = 0; p.dive = false; p.trickT = 0; p.trick = null; p.combo = 0;
      p.landT = U.clamp(impact / 34, 0, 0.3);
      if (p.landT > 0.05) p.events.push('land');
      if (tuning.fallDamage && impact > 30) {
        p.health = Math.max(0, p.health - (impact - 30) * 3);
        p.events.push(p.health > 0 ? 'hurt' : 'down');
      }
    }

    /**
     * One frame. input: { x, y (move, -1..1), walk, swing (held), jump (held), jumpPressed,
     * zipPressed, perchPressed, dodgePressed, trickPressed, aim: { o, d } (the camera's aim) };
     * camYaw: the camera's heading.
     */
    function update(dt, input, camYaw) {
      p.events.length = 0;
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      wish.set(fx * input.y - fz * input.x, 0, fz * input.y + fx * input.x);
      if (wish.lengthSq() > 1) wish.normalize();
      if (input.jumpPressed) p.jumpBuf = 0.14;
      const aim = input.aim;
      // C: zip to the point under the crosshair. X: perch there, or dive if there is nowhere to land
      if ((input.zipPressed || input.perchPressed) && p.zipCool <= 0 && aim) {
        const pr = world.findPerch(aim.o.x, aim.o.y, aim.o.z, aim.d.x, aim.d.y, aim.d.z);
        const ok = pr && pr.point.distanceTo(p.pos) > 4 && (input.zipPressed || pr.edge || pr.point.distanceTo(p.pos) < 70);
        if (ok) { startZip(pr.point, pr.edge, pr.nx, pr.nz); if (input.perchPressed) p.events.push('perch'); }
        else if (input.perchPressed && p.state !== 'ground' && p.state !== 'wall') { p.dive = true; if (p.state !== 'air') toAir(); p.dive = true; p.events.push('dive'); }
        else p.events.push('noAnchor');
      }
      if (input.dodgePressed && p.dodgeT <= -0.15 && p.state !== 'zip') {
        let dx = wish.x, dz = wish.z;
        if (dx * dx + dz * dz < 0.04) { dx = -Math.sin(p.facing); dz = -Math.cos(p.facing); }
        const l = Math.hypot(dx, dz); p.dodgeX = dx / l; p.dodgeZ = dz / l; p.dodgeT = 0.3;
        if (p.state === 'swing') release(false);
        if (p.state === 'wall') { toAir(); p.vel.set(p.wallN.x * 6, 2, p.wallN.z * 6); }
        p.events.push('dodge');
      }
      if (input.trickPressed && (p.state === 'air' || p.state === 'boost') && p.trickT <= 0) {
        const t = TRICKS[(p.stats.tricks + p.combo * 2) % TRICKS.length];
        p.trick = { name: t[0], axis: new T.Vector3(t[1][0], t[1][1], t[1][2]), dir: t[2] };
        p.trickT = 0.62; p.combo++; p.stats.tricks++;
        gainFocus(8 + p.combo * 4);
        p.events.push('trick');
      }
      const steps = Math.max(1, Math.ceil(dt / STEP)), h = dt / steps;
      for (let i = 0; i < steps; i++) step(h, input);
      p.zipCool -= dt; p.boostCool -= dt; p.jumpBuf -= dt; p.shotT -= dt; p.punchT -= dt; p.dodgeT -= dt;
      p.trickT = Math.max(0, p.trickT - dt);
      p.landT = Math.max(0, p.landT - dt);
      const sp = p.vel.length();
      if (sp > p.stats.top) p.stats.top = sp;
      if (p.state !== 'ground') p.stats.dist += sp * dt;
      // turn to face where he is going
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (p.state === 'ground' && hs > 0.5 && p.dodgeT <= 0) p.facing = turn(p.facing, Math.atan2(p.vel.x, p.vel.z), 14 * dt);
      else if ((p.state === 'air' || p.state === 'swing' || p.state === 'zip' || p.state === 'boost') && hs > 2 && p.dodgeT <= 0) p.facing = turn(p.facing, Math.atan2(p.vel.x, p.vel.z), 5 * dt);
      else if (p.state === 'wall') p.facing = Math.atan2(-p.wallN.x, -p.wallN.z);
    }

    function turn(a, b, k) {
      let dd = b - a;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      return a + dd * Math.min(1, k);
    }

    function step(h, input) {
      const hasWish = wish.lengthSq() > 0.01;
      if (p.dodgeT > 0 && (p.state === 'ground' || p.state === 'air')) { // a quick sidestep or roll
        const k = p.dodgeT / 0.3, s = 13 * k + 3;
        p.vel.x = U.lerp(p.vel.x, p.dodgeX * s + (p.state === 'air' ? p.vel.x * 0.4 : 0), 0.35);
        p.vel.z = U.lerp(p.vel.z, p.dodgeZ * s + (p.state === 'air' ? p.vel.z * 0.4 : 0), 0.35);
      }
      if (p.state === 'ground') {
        p.groundT += h;
        const target = input.walk ? WALK : input.swing ? SPRINT : RUN;
        if (p.dodgeT <= 0) {
          const k = 1 - Math.exp(-(hasWish ? 9 : 14) * h);
          p.vel.x += (wish.x * target - p.vel.x) * k; p.vel.z += (wish.z * target - p.vel.z) * k;
        }
        p.vel.y -= G * h;
        if (p.jumpBuf > 0 && p.landT < 0.12) {
          p.jumpBuf = 0;
          p.vel.y = input.swing ? 10.5 : 9.2;
          p.jumpHold = 0.4; // keep holding Space to keep rising
          toAir();
          p.events.push('jump');
        }
      } else if (p.state === 'air' || p.state === 'boost') {
        p.airT += h;
        if (p.state === 'boost') { p.boostT -= h; if (p.boostT <= 0) toAir(); }
        // holding jump on the way up carries him higher
        if (p.jumpHold > 0) { p.jumpHold -= h; if (input.jump && p.vel.y > 0) p.vel.y += 15 * h; else p.jumpHold = 0; }
        p.vel.y -= G * h * (p.state === 'boost' ? 0.35 : 1) + (p.dive ? 30 * h : 0);
        p.vel.x += wish.x * 13 * h; p.vel.z += wish.z * 13 * h;
        const drag = 1 - 0.04 * h; p.vel.x *= drag; p.vel.z *= drag;
        if (p.vel.y < (p.dive ? -75 : -55)) p.vel.y = p.dive ? -75 : -55;
        // Space in the air: web-zip forward
        if (p.jumpBuf > 0 && p.coyote <= 0 && p.boostCool <= 0 && p.airT > 0.12) { p.jumpBuf = 0; p.jumpHold = 0; webBoost(input.aim && input.aim.d); }
        // Shift in the air: swing
        if (input.swing && p.state === 'air' && (p.airT > 0.12 || !input.jump)) {
          hipPoint(hip);
          const [hx, hz] = heading();
          const a = world.findAnchor(hip.x, hip.y, hip.z, hx, hz, p.vel.length());
          if (a) startSwing(a);
          else if (!p.noAnchorShown) { p.events.push('noAnchor'); p.noAnchorShown = true; }
        }
        if (!input.swing) p.noAnchorShown = false;
        if (p.coyote > 0) { p.coyote -= h; if (p.jumpBuf > 0) { p.jumpBuf = 0; p.vel.y = 9.2; p.jumpHold = 0.4; p.coyote = 0; p.events.push('jump'); } }
      } else if (p.state === 'swing') {
        p.swingT += h;
        p.vel.y -= G * h;
        hipPoint(hip);
        d.copy(hip).sub(p.anchor);
        const r = d.length() || 1;
        d.multiplyScalar(1 / r);
        // steer across the rope, and keep a little drive along the swing
        tan.copy(wish).addScaledVector(d, -wish.dot(d));
        p.vel.addScaledVector(tan, 15 * h);
        const sp = p.vel.length();
        if (sp > 1) p.vel.addScaledVector(p.vel, (3.5 / sp) * h);
        // reel in a touch (free height), and faster if the arc would reach the street
        p.rope = Math.max(9, p.rope - (p.rope > p.ropeMax ? 16 : 2.2) * h);
        p.pos.addScaledVector(p.vel, h);
        hipPoint(hip);
        d.copy(hip).sub(p.anchor);
        const len = d.length();
        if (len > p.rope) {
          d.multiplyScalar(1 / len);
          hip.copy(p.anchor).addScaledVector(d, p.rope);
          p.pos.set(hip.x, hip.y - HIP, hip.z);
          const out = p.vel.dot(d);
          if (out > 0) p.vel.addScaledVector(d, -out);
        }
        // how far through the arc: -1 hanging back … 1 swung out in front
        tmp.set(p.vel.x, 0, p.vel.z).normalize();
        p.swingK = U.clamp(-(d.x * tmp.x + d.z * tmp.z) * 1.6, -1, 1);
        if (p.vel.length() > MAX) p.vel.setLength(MAX);
        const c = world.collide(p.pos, p.vel, HW, H);
        if (c.water) { if (!p.wet) { p.wet = true; p.events.push('splash'); } release(false); return; }
        if (c.ground) { land(p.vel.y); return; }
        if (c.wall && c.top - p.pos.y > 2) { enterWall(c.nx, c.nz, c.top); return; }
        if (p.jumpBuf > 0 && p.boostCool <= 0) { p.jumpBuf = 0; webBoost(input.aim && input.aim.d); return; } // Space mid-swing: let go and zip on
        if (!input.swing) release(p.swingT > 0.35);
        else if (hip.y > p.anchor.y - 1.5 || p.swingT > 5.5) release(true);
        return;
      } else if (p.state === 'zip') {
        p.zipT += h;
        d.copy(p.zipTo).sub(p.pos);
        const dist = d.length();
        if (dist < 1.2 || p.zipT > 2.6) {
          if (p.zipEdge) {
            p.pos.copy(p.zipTo).addScaledVector(p.zipN, -0.6);
            p.vel.set(-p.zipN.x * 5, 6.5, -p.zipN.z * 5);
            toAir();
            p.events.push('vault');
          } else if (p.zipN.lengthSq() > 0.5) {
            enterWall(p.zipN.x, p.zipN.z, world.floorAt(p.zipTo.x - p.zipN.x * 1.5, p.zipTo.z - p.zipN.z * 1.5, 1e4));
          } else { p.vel.multiplyScalar(0.3); toAir(); }
          return;
        }
        p.vel.copy(d).multiplyScalar(Math.min(ZIP, dist / h) / dist);
        p.pos.addScaledVector(p.vel, h);
        const c = world.collide(p.pos, p.vel, HW, H);
        if (c.ground && p.zipTo.y - p.pos.y < 1) land(-2);
        return;
      } else if (p.state === 'wall') {
        p.wallT += h;
        const n = p.wallN;
        const into = -(wish.x * n.x + wish.z * n.z);           // pushing toward the wall: climb
        tan.set(-n.z, 0, n.x);                                   // along the wall
        const side = wish.dot(tan);
        if (into < -0.55 && p.wallT > 0.15) {                   // pressing away: let go
          p.vel.set(n.x * 4, 0, n.z * 4);
          toAir();
          return;
        }
        const climb = into > 0.2 ? (input.swing ? WALL * 1.25 : WALL) * U.clamp(into * 1.3, 0, 1) : (hasWish ? 0 : p.wallT < 0.6 ? 0 : -1.5);
        p.vel.set(tan.x * side * 8, climb, tan.z * side * 8);
        p.pos.addScaledVector(p.vel, h);
        p.pos.x -= n.x * 0.05; p.pos.z -= n.z * 0.05;           // stay pressed to the wall
        if (p.pos.y + 0.6 >= p.wallTop) {                        // over the top
          p.pos.y = p.wallTop + 0.05;
          p.pos.x -= n.x * 0.9; p.pos.z -= n.z * 0.9;
          p.vel.set(-n.x * 5, 5.5, -n.z * 5);
          toAir();
          p.events.push('vault');
          return;
        }
        if (p.jumpBuf > 0) {                                     // kick off the wall
          p.jumpBuf = 0;
          p.vel.set(n.x * 9 + tan.x * side * 4, 10, n.z * 9 + tan.z * side * 4);
          p.jumpHold = 0.3;
          toAir();
          p.facing = Math.atan2(n.x, n.z);
          p.events.push('jump');
          return;
        }
        const c = world.collide(p.pos, p.vel, HW, H);
        if (c.ground && p.vel.y <= 0) { land(-1); return; }
        if (!c.wall) { if (p.wallT > 0.15) toAir(); return; }
        if (c.nx !== n.x || c.nz !== n.z) { p.wallN.set(c.nx, 0, c.nz); p.wallTop = c.top; }
        return;
      }

      p.pos.addScaledVector(p.vel, h);
      const c = world.collide(p.pos, p.vel, HW, H);
      if (c.water) { if (!p.wet) { p.wet = true; p.events.push('splash'); } return; }
      if (p.state === 'ground') {
        if (!c.ground) { toAir(); p.coyote = 0.12; }
        else if (c.wall && hasWish && -(wish.x * c.nx + wish.z * c.nz) > 0.6 && c.top - p.pos.y > 1.2) enterWall(c.nx, c.nz, c.top);
      } else {
        if (c.ground) land(p.vel.y);
        else if (c.wall && c.top - p.pos.y > 1.6 && (hasWish || p.airT > 0.15)) enterWall(c.nx, c.nz, c.top);
      }
    }

    /** Fire a web at a point (a web-strike, a yank or a finisher), or punch toward it. */
    function shoot(at) {
      p.shotT = 0.3; p.shotAt.copy(at);
      tmp.copy(at).sub(p.pos);
      p.shotRight = tmp.x * -Math.cos(p.facing) + tmp.z * Math.sin(p.facing) >= 0;
    }
    function punch() { p.punchT = 0.22; p.punchRight = !p.punchRight; }
    /** A web-strike: zip straight at a target. */
    function strike(at) { startZip(at, false, 0, 0); p.stats.zips--; }

    function reset(pos, facing) {
      p.pos.copy(pos); p.vel.set(0, 0, 0); p.state = 'ground'; p.facing = facing; p.wet = false;
      p.dive = false; p.trickT = 0; p.trick = null; p.combo = 0; p.dodgeT = 0; p.health = 100;
    }

    return { p, update, shoot, punch, strike, reset, hipPoint, gainFocus, HIP };
  }

  SMR.createPlayer = createPlayer;
})();
