/* 2D artwork that gets wrapped onto the 3D hero: the eye shapes (redrawn whenever
   he squints or blinks), the hand-stitched seam, and the chest mark. */
(function () {
  'use strict';
  const SMR = window.SMR;
  const U = SMR.util;

  // Outline of the dark frame around the viewer's-right lens (face units, y down).
  const EYE = {
    start: [0.078, 0.118],
    segs: [
      [[0.2, -0.13], [0.43, -0.355], [0.668, -0.405]],
      [[0.735, -0.13], [0.625, 0.3], [0.372, 0.348]],
      [[0.21, 0.375], [0.086, 0.275], [0.078, 0.118]],
    ],
    lensPivot: [0.392, 0.012],
    lensScale: 0.775,
    axis: [0.7535, -0.6575],
    axisPoint: [0.37, -0.11],
  };

  /** side: +1 viewer's right, -1 left. squint: 0 open … 1 narrowed. inset: lens instead of frame. */
  function eyePath(p, side, squint, inset) {
    const ax = EYE.axis, pe = [-ax[1], ax[0]];
    const tf = (pt) => {
      let x = pt[0], y = pt[1];
      if (inset) {
        x = EYE.lensPivot[0] + (x - EYE.lensPivot[0]) * EYE.lensScale;
        y = EYE.lensPivot[1] + (y - EYE.lensPivot[1]) * EYE.lensScale;
      }
      const vx = x - EYE.axisPoint[0], vy = y - EYE.axisPoint[1];
      const along = vx * ax[0] + vy * ax[1];
      let across = vx * pe[0] + vy * pe[1];
      across *= across < 0 ? 1 - 0.5 * squint : 1 - 0.68 * squint;
      return [side * (EYE.axisPoint[0] + ax[0] * along + pe[0] * across), EYE.axisPoint[1] + ax[1] * along + pe[1] * across];
    };
    const s = tf(EYE.start);
    p.moveTo(s[0], s[1]);
    EYE.segs.forEach((seg) => {
      const a = tf(seg[0]), b = tf(seg[1]), c = tf(seg[2]);
      p.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]);
    });
    p.closePath();
  }

  // Each painter covers a rectangle of the face: [x0, y0, x1, y1] in face units (y down).
  const EYE_RECT = [-0.8, -0.52, 0.8, 0.46];
  const SEAM_RECT = [-0.78, -0.98, -0.12, -0.18];
  const SEAM = [[-0.56, -0.86], [-0.47, -0.74], [-0.5, -0.63], [-0.4, -0.52], [-0.42, -0.41], [-0.33, -0.31]];

  function fit(g, rect) {
    const w = g.canvas.width, h = g.canvas.height;
    g.setTransform(w / (rect[2] - rect[0]), 0, 0, h / (rect[3] - rect[1]), (-rect[0] * w) / (rect[2] - rect[0]), (-rect[1] * h) / (rect[3] - rect[1]));
  }

  /** Red = frame, green = lens, blue = fixed gloss streaks. */
  function paintEyes(canvas, squint) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    fit(g, EYE_RECT);
    g.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      g.fillStyle = '#f00';
      g.beginPath(); eyePath(g, side, squint, false); g.fill();
      g.fillStyle = '#0f0';
      g.beginPath(); eyePath(g, side, squint, true); g.fill();
      g.save();
      g.beginPath(); eyePath(g, side, squint, true); g.clip();
      const gx = side < 0 ? -0.5 : 0.2;
      g.fillStyle = 'rgba(0,0,255,0.75)';
      g.beginPath(); g.moveTo(gx + 0.02, -0.4); g.lineTo(gx + 0.1, -0.4); g.lineTo(gx - 0.12, 0.4); g.lineTo(gx - 0.2, 0.4); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,255,0.4)';
      g.beginPath(); g.moveTo(gx + 0.15, -0.4); g.lineTo(gx + 0.18, -0.4); g.lineTo(gx - 0.04, 0.4); g.lineTo(gx - 0.07, 0.4); g.closePath(); g.fill();
      g.restore();
    }
  }

  /** Red = the tear, green = the thread. */
  function paintSeam(canvas) {
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    fit(g, SEAM_RECT);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = '#f00';
    g.lineWidth = 0.022;
    g.beginPath();
    SEAM.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
    const r = U.rng(77);
    g.lineWidth = 0.015;
    for (let i = 0; i < SEAM.length - 1; i++) {
      const a = SEAM[i], b = SEAM[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const count = Math.max(2, Math.round(len / 0.065));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const tilt = r.range(-0.35, 0.35), half = r.range(0.036, 0.048);
        const sx = nx + (dx / len) * tilt, sy = ny + (dy / len) * tilt;
        g.strokeStyle = 'rgba(255,0,0,0.5)';
        g.beginPath(); g.moveTo(px - sx * half + 0.007, py - sy * half + 0.009); g.lineTo(px + sx * half + 0.007, py + sy * half + 0.009); g.stroke();
        g.strokeStyle = '#0f0';
        g.beginPath(); g.moveTo(px - sx * half, py - sy * half); g.lineTo(px + sx * half, py + sy * half); g.stroke();
      }
    }
  }

  /** White spider mark on black; covers the emblem's design box. */
  function paintEmblem(canvas) {
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fff';
    g.beginPath();
    SMR.emblem.trace(g, canvas.width / 2, canvas.height * (76 / 158), canvas.width / 120);
    g.fill();
  }

  SMR.heroArt = { eyePath, paintEyes, paintSeam, paintEmblem, EYE_RECT, SEAM_RECT };
})();
