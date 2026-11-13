/* Small living details drawn over the 3D view: dust in the light and one idle spider. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;
  const TAU = U.TAU;

  function softDot(color, size) {
    const c = U.makeCanvas(size, size), g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, U.rgba(color, 1));
    grad.addColorStop(0.45, U.rgba(color, 0.45));
    grad.addColorStop(1, U.rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function createFx() {
    let pal = null, view = null;
    let dust = [];
    let dustSprite = null;
    const spider = { y: -60, vy: 0, out: false, swing: 0 };

    function rebuild(v, palette) {
      view = v; pal = palette;
      dustSprite = softDot(pal.dust, 32);
      const r = U.rng(5150);
      dust = [];
      const count = Math.round(54 * U.clamp(view.w / 1920, 0.45, 1.4));
      for (let i = 0; i < count; i++) {
        dust.push({ x: r.range(0, view.w), y: r.range(120, view.h), depth: r.range(0.35, 1), size: r.range(1.4, 4.2), phase: r.range(0, TAU), drift: r.range(4, 13) });
      }
    }

    function update(dt, time, idle, motion) {
      if (motion) {
        for (const d of dust) {
          d.x += (d.drift + 6 * U.noise1(time * 0.3 + d.phase)) * d.depth * dt;
          d.y -= (3 + 5 * Math.sin(time * 0.5 + d.phase)) * d.depth * dt;
          if (d.x > view.w + 10) d.x = -10;
          if (d.y < 90) d.y = view.h + 10;
        }
      }
      // the spider only comes down when nobody has touched anything for a while
      const goal = idle && motion ? 250 : -70;
      const k = idle ? 5 : 26;
      spider.vy += ((goal - spider.y) * k - spider.vy * (idle ? 3.4 : 9)) * dt;
      spider.y += spider.vy * dt;
      spider.out = spider.y > -40;
    }

    /* ---- draw passes, called by the scene at the right depth ---- */

    function drawDust(g, ox, oy, orb, time) {
      for (const d of dust) {
        const x = d.x + ox * d.depth, y = d.y + oy * d.depth;
        const near = 1 / (1 + Math.pow(Math.hypot(x - orb.x, y - orb.y) / 520, 2));
        const tw = 0.55 + 0.45 * Math.sin(time * 1.1 + d.phase);
        const a = (0.1 + 0.55 * near) * tw * d.depth;
        if (a < 0.03) continue;
        const s = d.size * (1.6 + d.depth * 2.4);
        g.globalAlpha = a;
        g.drawImage(dustSprite, x - s / 2, y - s / 2, s, s);
      }
      g.globalAlpha = 1;
    }

    function drawSpider(g, x, time) {
      if (!spider.out) return;
      const sway = Math.sin(time * 0.8) * 7 * U.clamp(spider.y / 250, 0, 1);
      const sx = x + sway, sy = spider.y;
      g.save();
      g.strokeStyle = U.rgba(pal.web[0], 0.55);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, -10); g.quadraticCurveTo(x + sway * 0.3, sy * 0.5, sx, sy - 9); g.stroke();
      g.translate(sx, sy);
      g.rotate(sway * 0.012);
      g.fillStyle = pal.ink;
      g.strokeStyle = pal.ink;
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const wig = Math.sin(time * 3 + i * 1.3) * 1.2;
        const up = [-13, -5, 4, 12][i], reach = [15, 18, 18, 15][i];
        for (const side of [-1, 1]) {
          g.moveTo(side * 3, -1 + i * 1.6);
          g.lineTo(side * reach * 0.62, up * 0.55 - 4 + wig);
          g.lineTo(side * reach, up + 4 + wig);
        }
      }
      g.stroke();
      g.beginPath(); g.ellipse(0, 5, 6.2, 8, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(0, -4.5, 4.2, 4.6, 0, 0, TAU); g.fill();
      g.fillStyle = U.rgba(pal.rim, 0.8);
      g.beginPath(); g.ellipse(-2.6, 3, 1.3, 3.6, 0.3, 0, TAU); g.fill();
      g.restore();
    }

    return { rebuild, update, drawDust, drawSpider };
  }

  SMR.createFx = createFx;
})();
