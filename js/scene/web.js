/* Spider silk.
   1) A corner web simulated as a small cloth of pinned-and-free points, so it sways
      in the wind and shivers when the pointer brushes it.
   2) Web lines the player can fire at the skyline by clicking the scene. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const TAU = U.TAU;

  const RADIALS = 10, RINGS = 10;

  function createWeb() {
    let nodes = [], links = [], dew = [];
    let anchor = { x: 0, y: 0 };
    let pal = null;
    const shots = [];
    const idx = (j, k) => j * RINGS + k;

    function rebuild(view, palette) {
      pal = palette;
      const r = U.rng(606);
      anchor = { x: -46, y: -58 };
      nodes = []; links = []; dew = [];
      const radii = [];
      let rad = 80;
      for (let k = 0; k < RINGS; k++) { radii.push(rad); rad *= 1.265; }
      for (let j = 0; j < RADIALS; j++) {
        const th = ((-7 + j * (102 / (RADIALS - 1))) * Math.PI) / 180;
        for (let k = 0; k < RINGS; k++) {
          const rr = radii[k] * r.range(0.97, 1.03);
          const x = anchor.x + Math.cos(th) * rr, y = anchor.y + Math.sin(th) * rr;
          nodes.push({ x, y, px: x, py: y, pinned: j === 0 || j === RADIALS - 1 || k === 0 });
        }
      }
      const link = (a, b, slack) => {
        const na = nodes[a], nb = nodes[b];
        links.push({ a, b, rest: Math.hypot(na.x - nb.x, na.y - nb.y) * slack });
      };
      for (let j = 0; j < RADIALS; j++) for (let k = 0; k < RINGS - 1; k++) link(idx(j, k), idx(j, k + 1), 1);
      for (let j = 0; j < RADIALS - 1; j++) for (let k = 1; k < RINGS; k++) link(idx(j, k), idx(j + 1, k), 1.025);
      for (let i = 0; i < 26; i++) {
        dew.push({ j: r.int(0, RADIALS - 2), k: r.int(2, RINGS - 1), t: r.range(0.2, 0.8), size: r.range(1.3, 2.6), phase: r.range(0, TAU) });
      }
    }

    /** @param pointer { x, y, vx, vy, active } in virtual units */
    function update(dt, time, pointer, motion) {
      const step = Math.min(dt, 1 / 30);
      if (motion) {
        const gust = 26 + 22 * U.noise1(time * 0.23);
        for (const n of nodes) {
          if (n.pinned) continue;
          let ax = gust * U.noise1(time * 0.5 + n.y * 0.006) + 10 * Math.sin(time * 1.7 + n.x * 0.02);
          let ay = 26 + 12 * U.noise1(time * 0.4 + n.x * 0.005 + 40);
          if (pointer.active) {
            const dx = n.x - pointer.x, dy = n.y - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 150 * 150) {
              const f = 1 - Math.sqrt(d2) / 150;
              ax += pointer.vx * f * 9;
              ay += pointer.vy * f * 9;
            }
          }
          const vx = (n.x - n.px) * 0.972, vy = (n.y - n.py) * 0.972;
          n.px = n.x; n.py = n.y;
          n.x += vx + ax * step * step;
          n.y += vy + ay * step * step;
        }
        for (let it = 0; it < 4; it++) {
          for (const l of links) {
            const a = nodes[l.a], b = nodes[l.b];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const diff = (d - l.rest) / d;
            if (a.pinned && b.pinned) continue;
            if (a.pinned) { b.x -= dx * diff; b.y -= dy * diff; }
            else if (b.pinned) { a.x += dx * diff; a.y += dy * diff; }
            else { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
          }
        }
      }
      for (let i = shots.length - 1; i >= 0; i--) {
        shots[i].age += dt;
        if (shots[i].age > shots[i].life) shots.splice(i, 1);
      }
    }

    function ringPoint(j, k, t) {
      const a = nodes[idx(j, k)], b = nodes[idx(j + 1, k)];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const hx = anchor.x - mx, hy = anchor.y - my, hl = Math.hypot(hx, hy) || 1;
      const cx = mx + (hx / hl) * d * 0.17, cy = my + (hy / hl) * d * 0.17;
      const u = 1 - t;
      return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y, cx, cy];
    }

    function draw(g, ox, oy, time) {
      g.save();
      g.translate(ox, oy);
      g.lineCap = 'round';
      const grad = g.createLinearGradient(anchor.x + 760, anchor.y + 560, anchor.x, anchor.y);
      grad.addColorStop(0, U.rgba(pal.web[1], 0.62));
      grad.addColorStop(0.5, U.rgba(pal.web[0], 0.42));
      grad.addColorStop(1, U.rgba(pal.web[0], 0.2));
      g.strokeStyle = grad;

      g.lineWidth = 1.25;
      g.beginPath();
      for (let j = 0; j < RADIALS; j++) {
        g.moveTo(anchor.x, anchor.y);
        for (let k = 0; k < RINGS; k++) { const n = nodes[idx(j, k)]; g.lineTo(n.x, n.y); }
      }
      g.stroke();

      g.lineWidth = 1;
      g.beginPath();
      for (let k = 1; k < RINGS; k++) {
        for (let j = 0; j < RADIALS - 1; j++) {
          const a = nodes[idx(j, k)], b = nodes[idx(j + 1, k)];
          const p = ringPoint(j, k, 0.5);
          g.moveTo(a.x, a.y);
          g.quadraticCurveTo(p[2], p[3], b.x, b.y);
        }
      }
      g.stroke();

      // dew catching the light
      for (const d of dew) {
        const p = ringPoint(d.j, d.k, d.t);
        const tw = 0.45 + 0.55 * Math.abs(Math.sin(time * 0.9 + d.phase));
        g.fillStyle = U.rgba(pal.web[1], 0.22 * tw);
        g.beginPath(); g.arc(p[0], p[1], d.size * 2.6, 0, TAU); g.fill();
        g.fillStyle = U.rgba('#ffffff', 0.5 + 0.5 * tw);
        g.beginPath(); g.arc(p[0], p[1], d.size * 0.62, 0, TAU); g.fill();
      }
      g.restore();
    }

    /* ---- fired web lines ---- */

    function shoot(x0, y0, x1, y1) {
      if (shots.length >= 7) shots.shift();
      const r = U.rng(((x1 * 31 + y1 * 17) | 0) + shots.length * 7919);
      const strands = [];
      const n = 8;
      for (let i = 0; i < n; i++) strands.push({ a: (i / n) * TAU + r.range(-0.2, 0.2), len: r.range(13, 30) });
      shots.push({ x0, y0, x1, y1, age: 0, life: 7.5, strands });
    }

    function drawShots(g) {
      if (!shots.length) return;
      g.save();
      g.lineCap = 'round';
      for (const s of shots) {
        const fly = U.clamp(s.age / 0.11, 0, 1);
        const fade = U.clamp((s.life - s.age) / 1.2, 0, 1);
        const settle = Math.max(0, s.age - 0.11);
        const ex = U.lerp(s.x0, s.x1, fly), ey = U.lerp(s.y0, s.y1, fly);
        const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
        // a plucked string: big wobble that dies down into a gentle sag
        const sag = fly < 1 ? 0 : len * 0.035 * (1 - Math.exp(-settle * 5)) + len * 0.03 * Math.exp(-settle * 5.5) * Math.cos(settle * 34);
        const mx = (s.x0 + ex) / 2, my = (s.y0 + ey) / 2 + sag;
        g.strokeStyle = U.rgba(pal.web[0], 0.85 * fade);
        g.lineWidth = 2.1;
        g.beginPath(); g.moveTo(s.x0, s.y0); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
        g.strokeStyle = U.rgba(pal.web[1], 0.35 * fade);
        g.lineWidth = 5;
        g.beginPath(); g.moveTo(s.x0, s.y0); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
        if (fly >= 1) {
          const pop = U.ease.outBack(U.clamp(settle / 0.16, 0, 1));
          g.strokeStyle = U.rgba(pal.web[0], 0.9 * fade);
          g.lineWidth = 1.5;
          g.beginPath();
          for (const st of s.strands) {
            g.moveTo(s.x1, s.y1);
            g.lineTo(s.x1 + Math.cos(st.a) * st.len * pop, s.y1 + Math.sin(st.a) * st.len * pop);
          }
          for (let i = 0; i < s.strands.length; i++) {
            const a = s.strands[i], b = s.strands[(i + 1) % s.strands.length];
            const ra = a.len * 0.55 * pop, rb = b.len * 0.55 * pop;
            const am = (a.a + (b.a < a.a ? b.a + TAU : b.a)) / 2;
            g.moveTo(s.x1 + Math.cos(a.a) * ra, s.y1 + Math.sin(a.a) * ra);
            g.quadraticCurveTo(s.x1 + Math.cos(am) * (ra + rb) * 0.36, s.y1 + Math.sin(am) * (ra + rb) * 0.36, s.x1 + Math.cos(b.a) * rb, s.y1 + Math.sin(b.a) * rb);
          }
          g.stroke();
          g.fillStyle = U.rgba(pal.web[0], 0.95 * fade);
          g.beginPath(); g.arc(s.x1, s.y1, 3.2 * pop, 0, TAU); g.fill();
        }
      }
      g.restore();
    }

    return { rebuild, update, draw, shoot, drawShots, clearShots: () => { shots.length = 0; } };
  }

  SMR.createWeb = createWeb;
})();
