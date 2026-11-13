/* How the hero moves: running and jumping on the streets and roofs, swinging on a web (a real
   pendulum: gravity pulls, the rope holds), web-zipping to a point, and running up walls.
   Physics runs in small fixed slices so fast swings stay stable at any frame rate. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const T = window.THREE;

  const G = 25;            // gravity, m/s², a little stronger than real for snappy jumps
  const HW = 0.32, H = 1.75; // the hero's collision box: half width and height
  const HIP = 1.0;         // hips above the feet
  const STEP = 1 / 240;    // physics slice
  const RUN = 8.5, SPRINT = 16, WALL = 15, ZIP = 46, MAX = 44;

  function createPlayer(world, tuning) {
    const p = {
      pos: world.start.clone(), vel: new T.Vector3(), state: 'ground', facing: Math.PI,
      anchor: new T.Vector3(), webEnd: new T.Vector3(), rope: 0, ropeMax: 0, webRight: true, swingT: 0, swingK: 0,
      zipTo: new T.Vector3(), zipEdge: false, zipN: new T.Vector3(), zipT: 0, zipCool: 0,
      wallN: new T.Vector3(), wallTop: 0, wallT: 0,
      airT: 0, groundT: 0, landT: 0, coyote: 0, jumpBuf: 0, holdSince: 0,
      shotT: 0, shotAt: new T.Vector3(), shotRight: true,
      stats: { top: 0, swings: 0, zips: 0, dist: 0, walls: 0 },
      events: [], // what happened this frame, for sound and the HUD: 'jump', 'swing', 'release', 'land', 'zip', 'wall', 'vault', 'noAnchor'
    };
    const hip = new T.Vector3(), d = new T.Vector3(), wish = new T.Vector3(), tan = new T.Vector3(), tmp = new T.Vector3();
    const up = new T.Vector3(0, 1, 0);

    function hipPoint(out) { return out.set(p.pos.x, p.pos.y + HIP, p.pos.z); }

    function startSwing(a) {
      p.state = 'swing';
      p.webEnd.copy(a);
      hipPoint(hip);
      // The web sticks to the building, but the swing pivots over his line of travel (as if
      // from an overhang), so the arc carries him along the street instead of into the wall.
      const hs0 = Math.hypot(p.vel.x, p.vel.z);
      const ux = hs0 > 3 ? p.vel.x / hs0 : Math.sin(p.facing), uz = hs0 > 3 ? p.vel.z / hs0 : Math.cos(p.facing);
      const rx = a.x - hip.x, rz = a.z - hip.z, fwd = rx * ux + rz * uz;
      p.anchor.set(hip.x + ux * fwd + (rx - ux * fwd) * 0.35, a.y, hip.z + uz * fwd + (rz - uz * fwd) * 0.35);
      p.rope = Math.min(hip.distanceTo(p.anchor), 70);
      p.ropeMax = Math.max(8, p.anchor.y - world.floorAt(p.anchor.x, p.anchor.z, p.anchor.y - 1) - HIP - 2.2); // never scrape the street
      p.swingT = 0;
      // the web goes from whichever hand is on the anchor's side
      tmp.copy(a).sub(hip);
      const right = new T.Vector3(-Math.cos(p.facing), 0, Math.sin(p.facing));
      p.webRight = tmp.dot(right) >= 0;
      // a swing that starts slow gets a push so the first arc is fun
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (hs < 12) { p.vel.x += Math.sin(p.facing) * (12 - hs) * 0.6; p.vel.z += Math.cos(p.facing) * (12 - hs) * 0.6; }
      p.stats.swings++;
      p.events.push('swing');
    }

    function release(boost) {
      p.state = 'air';
      p.airT = 0;
      if (boost) {
        const hs = Math.hypot(p.vel.x, p.vel.z) || 1;
        p.vel.x += (p.vel.x / hs) * 3.5; p.vel.z += (p.vel.z / hs) * 3.5;
        if (p.vel.y > -4) p.vel.y += 5.5;
      }
      p.events.push('release');
    }

    function startZip(target, edge, nx, nz) {
      p.state = 'zip';
      p.zipTo.copy(target); p.zipEdge = edge; p.zipN.set(nx, 0, nz); p.zipT = 0; p.zipCool = 0.35;
      p.stats.zips++;
      p.events.push('zip');
    }

    function enterWall(nx, nz, top) {
      p.state = 'wall';
      p.wallN.set(nx, 0, nz); p.wallTop = top; p.wallT = 0;
      p.vel.set(0, Math.max(p.vel.y, 4), 0);
      p.stats.walls++;
      p.events.push('wall');
    }

    function land(fromVy) {
      p.state = 'ground'; p.groundT = 0;
      p.landT = U.clamp(-fromVy / 34, 0, 0.3);
      if (p.landT > 0.05) p.events.push('land');
    }

    /**
     * One frame. input: { x, y (move, -1..1), sprint, jump (held), jumpPressed, zipPressed,
     * zipAim: { o: Vector3, d: Vector3 } (the camera's aim) }; camYaw: the camera's heading.
     */
    function update(dt, input, camYaw) {
      p.events.length = 0;
      // what "forward" means: where the camera looks, flattened
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      wish.set(fx * input.y - fz * input.x, 0, fz * input.y + fx * input.x);
      if (wish.lengthSq() > 1) wish.normalize();
      if (input.jumpPressed) p.jumpBuf = 0.14;
      if (input.zipPressed && p.zipCool <= 0 && input.zipAim) {
        const o = input.zipAim.o, dd = input.zipAim.d;
        const pr = world.findPerch(o.x, o.y, o.z, dd.x, dd.y, dd.z);
        if (pr && pr.point.distanceTo(p.pos) > 4) startZip(pr.point, pr.edge, pr.nx, pr.nz);
        else p.events.push('noAnchor');
      }
      const steps = Math.max(1, Math.ceil(dt / STEP)), h = dt / steps;
      for (let i = 0; i < steps; i++) step(h, input);
      p.zipCool -= dt; p.jumpBuf -= dt; p.shotT -= dt; p.landT = Math.max(0, p.landT - dt);
      const sp = p.vel.length();
      if (sp > p.stats.top) p.stats.top = sp;
      if (p.state !== 'ground') p.stats.dist += sp * dt;
      // turn to face where he is going
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (p.state === 'ground' && hs > 0.5) p.facing = turn(p.facing, Math.atan2(p.vel.x, p.vel.z), 14 * dt);
      else if ((p.state === 'air' || p.state === 'swing' || p.state === 'zip') && hs > 2) p.facing = turn(p.facing, Math.atan2(p.vel.x, p.vel.z), 5 * dt);
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
      if (p.state === 'ground') {
        p.groundT += h;
        const target = input.sprint ? SPRINT : RUN;
        const tx = wish.x * target, tz = wish.z * target;
        const k = 1 - Math.exp(-(hasWish ? 9 : 14) * h);
        p.vel.x += (tx - p.vel.x) * k; p.vel.z += (tz - p.vel.z) * k;
        p.vel.y -= G * h;
        if (p.jumpBuf > 0 && p.landT < 0.12) {
          p.jumpBuf = 0;
          p.vel.y = input.sprint ? 11 : 9.2;
          p.state = 'air'; p.airT = 0; p.holdSince = 0;
          p.events.push('jump');
        }
      } else if (p.state === 'air') {
        p.airT += h; p.holdSince = input.jump ? p.holdSince + h : 0;
        p.vel.y -= G * h;
        p.vel.x += wish.x * 13 * h; p.vel.z += wish.z * 13 * h;
        const drag = 1 - 0.04 * h; p.vel.x *= drag; p.vel.z *= drag;
        if (p.vel.y < -55) p.vel.y = -55;
        // swing: hold jump in the air
        if (input.jump && (p.airT > 0.2 || input.jumpPressed) && p.holdSince > 0.05) {
          hipPoint(hip);
          const hs = Math.hypot(p.vel.x, p.vel.z);
          const hx = hs > 3 ? p.vel.x / hs : Math.sin(p.facing), hz = hs > 3 ? p.vel.z / hs : Math.cos(p.facing);
          const a = world.findAnchor(hip.x, hip.y, hip.z, hx, hz, p.vel.length());
          if (a) startSwing(a);
          else if (!p.noAnchorShown) { p.events.push('noAnchor'); p.noAnchorShown = true; }
        }
        if (!input.jump) p.noAnchorShown = false;
        if (p.coyote > 0) { p.coyote -= h; if (p.jumpBuf > 0) { p.jumpBuf = 0; p.vel.y = 9.2; p.coyote = 0; p.events.push('jump'); } }
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
        if (c.ground) { land(p.vel.y); return; }
        if (c.wall && c.top - p.pos.y > 2) { enterWall(c.nx, c.nz, c.top); return; }
        if (!input.jump) release(p.swingT > 0.35);
        else if (hip.y > p.anchor.y - 1.5 || p.swingT > 5.5) release(true);
        return;
      } else if (p.state === 'zip') {
        p.zipT += h;
        hipPoint(hip);
        d.copy(p.zipTo).sub(p.pos);
        const dist = d.length();
        if (dist < 1.2 || p.zipT > 2.6) {
          if (p.zipEdge) {
            p.pos.copy(p.zipTo).addScaledVector(p.zipN, -0.6);
            p.vel.set(-p.zipN.x * 5, 6.5, -p.zipN.z * 5);
            p.state = 'air'; p.airT = 0;
            p.events.push('vault');
          } else if (p.zipN.lengthSq() > 0.5) {
            enterWall(p.zipN.x, p.zipN.z, world.floorAt(p.zipTo.x - p.zipN.x * 1.5, p.zipTo.z - p.zipN.z * 1.5, 1e4));
          } else { p.vel.multiplyScalar(0.3); p.state = 'air'; p.airT = 0; }
          return;
        }
        p.vel.copy(d).multiplyScalar(Math.min(ZIP, dist / h) / dist);
        p.pos.addScaledVector(p.vel, h);
        const c = world.collide(p.pos, p.vel, HW, H);
        if (c.ground && p.zipTo.y - p.pos.y < 1) { land(-2); }
        return;
      } else if (p.state === 'wall') {
        p.wallT += h;
        const n = p.wallN;
        const into = -(wish.x * n.x + wish.z * n.z);           // pushing toward the wall: climb
        tan.set(-n.z, 0, n.x);                                   // along the wall
        const side = wish.dot(tan);
        if (into < -0.55 && p.wallT > 0.15) {                   // pressing away: let go
          p.vel.set(n.x * 4, 0, n.z * 4);
          p.state = 'air'; p.airT = 0; p.holdSince = 0;
          return;
        }
        const climb = into > 0.2 ? WALL * U.clamp(into * 1.3, 0, 1) : (hasWish ? 0 : p.wallT < 0.6 ? 0 : -1.5);
        p.vel.set(tan.x * side * 8, climb, tan.z * side * 8);
        p.pos.addScaledVector(p.vel, h);
        p.pos.x -= n.x * 0.05; p.pos.z -= n.z * 0.05;           // stay pressed to the wall
        if (p.pos.y + 0.6 >= p.wallTop) {                        // over the top
          p.pos.y = p.wallTop + 0.05;
          p.pos.x -= n.x * 0.9; p.pos.z -= n.z * 0.9;
          p.vel.set(-n.x * 5, 5.5, -n.z * 5);
          p.state = 'air'; p.airT = 0;
          p.events.push('vault');
          return;
        }
        if (p.jumpBuf > 0) {                                     // kick off the wall
          p.jumpBuf = 0;
          p.vel.set(n.x * 9 + tan.x * side * 4, 10, n.z * 9 + tan.z * side * 4);
          p.state = 'air'; p.airT = 0; p.holdSince = 0;
          p.facing = Math.atan2(n.x, n.z);
          p.events.push('jump');
          return;
        }
        const c = world.collide(p.pos, p.vel, HW, H);
        if (c.ground && p.vel.y <= 0) { land(-1); return; }
        if (!c.wall) { if (p.wallT > 0.15) { p.state = 'air'; p.airT = 0; } return; }
        if (c.nx !== n.x || c.nz !== n.z) { p.wallN.set(c.nx, 0, c.nz); p.wallTop = c.top; }
        return;
      }

      p.pos.addScaledVector(p.vel, h);
      const c = world.collide(p.pos, p.vel, HW, H);
      if (p.state === 'ground') {
        if (!c.ground) { p.state = 'air'; p.airT = 0; p.coyote = 0.12; p.holdSince = 0; }
        else if (c.wall && hasWish && -(wish.x * c.nx + wish.z * c.nz) > 0.6 && c.top - p.pos.y > 1.2) enterWall(c.nx, c.nz, c.top);
      } else if (p.state === 'air') {
        if (c.ground) land(p.vel.y);
        else if (c.wall && c.top - p.pos.y > 1.6 && (hasWish || p.airT > 0.15)) enterWall(c.nx, c.nz, c.top);
      }
    }

    /** Fire a web at a point (for catching drones). */
    function shoot(at) {
      p.shotT = 0.3; p.shotAt.copy(at);
      const right = new T.Vector3(-Math.cos(p.facing), 0, Math.sin(p.facing));
      p.shotRight = tmp.copy(at).sub(p.pos).dot(right) >= 0;
    }

    function reset(pos, facing) {
      p.pos.copy(pos); p.vel.set(0, 0, 0); p.state = 'ground'; p.facing = facing;
    }

    return { p, update, shoot, reset, hipPoint, HIP };
  }

  SMR.createPlayer = createPlayer;
})();
