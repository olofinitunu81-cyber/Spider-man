/* 2D artwork that gets wrapped onto the 3D hero: the eye shapes (painted once, wide
   open; the shader narrows them for a squint), the hand-stitched seam, the chest mark,
   and relief maps made from the same shapes so they have real height. */
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

  /* ---- relief maps ----
     The same artwork turned into height, so the lens frames, chest mark and stitches stand
     off the suit and catch the light. Each map is RGBA bytes:
     r, g = slope across and down (signed, 128 = flat), b = height, a = contact shadow. */

  function channel(canvas, c) {
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const out = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + c] / 255;
    return out;
  }

  // one box-blur pass along rows (step 1) or columns (step w), edges clamped
  function box(src, dst, w, h, r, alongRows) {
    const n = alongRows ? w : h, lines = alongRows ? h : w, step = alongRows ? 1 : w;
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const o = alongRows ? l * w : l, first = src[o], last = src[o + (n - 1) * step];
      let acc = first * (r + 1);
      for (let i = 1; i <= r; i++) acc += i < n ? src[o + i * step] : last;
      for (let i = 0; i < n; i++) {
        dst[o + i * step] = acc * inv;
        acc += (i + r + 1 < n ? src[o + (i + r + 1) * step] : last) - (i - r >= 0 ? src[o + (i - r) * step] : first);
      }
    }
  }

  /** Two box passes each way: a soft, rounded falloff whose cost does not grow with r. */
  function blur(src, w, h, r) {
    const a = src.slice(), b = new Float32Array(src.length);
    for (let k = 0; k < 2; k++) { box(a, b, w, h, r, true); box(b, a, w, h, r, false); }
    return a;
  }

  /** Read src moved by (dx, dy) texels: a shadow falls on p when the shape sits at p + offset. */
  function shifted(src, w, h, dx, dy) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(h - 1, Math.max(0, y + dy)) * w;
      for (let x = 0; x < w; x++) out[y * w + x] = src[sy + Math.min(w - 1, Math.max(0, x + dx))];
    }
    return out;
  }

  // height whose ramp sits just inside the shape's edge, so the shape rises from its own outline
  const inner = (b) => Math.min(1, Math.max(0, 2 * b - 1));

  function encode(height, shade, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    let kmax = 1e-6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] = (height[x < w - 1 ? i + 1 : i] - height[x > 0 ? i - 1 : i]) * 0.5;
      gy[i] = (height[y < h - 1 ? i + w : i] - height[y > 0 ? i - w : i]) * 0.5;
      kmax = Math.max(kmax, Math.abs(gx[i]), Math.abs(gy[i]));
    }
    const data = new Uint8Array(w * h * 4);
    const byte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 128 + Math.round((gx[i] / kmax) * 127);
      data[i * 4 + 1] = 128 + Math.round((gy[i] / kmax) * 127);
      data[i * 4 + 2] = byte(height[i]);
      data[i * 4 + 3] = byte(shade[i]);
    }
    // k turns a decoded slope (-1..1) into height per unit of texture coordinate
    return { data, w, h, k: [kmax * w, kmax * h] };
  }

  /** Raised rubber frames with the lenses set slightly lower and gently domed. */
  function eyeRelief(w, h) {
    const c = U.makeCanvas(w, h);
    c.getContext('2d', { willReadFrequently: true }); // read back once, so keep it on the CPU
    paintEyes(c, 0);
    const R = channel(c, 0), G = channel(c, 1);
    const s = w / 512;
    const frame = blur(R, w, h, Math.max(1, Math.round(2 * s)));
    const lensEdge = blur(G, w, h, Math.max(1, Math.round(1 * s)));
    const dome = blur(G, w, h, Math.round(26 * s));
    const halo = shifted(blur(R, w, h, Math.round(4 * s)), w, h, Math.round(3 * s), -Math.round(3 * s));
    const rim = shifted(blur(G, w, h, Math.round(3 * s)), w, h, Math.round(3 * s), -Math.round(3 * s));
    const H = new Float32Array(w * h), S = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const li = inner(lensEdge[i]);
      H[i] = inner(frame[i]) - 0.42 * li + 0.34 * li * dome[i];
      S[i] = (1 - R[i]) * halo[i] * 1.25 + G[i] * (1 - rim[i]) * 1.1;
    }
    return encode(H, S, w, h);
  }

  /** The chest mark as a raised print with a bevelled edge. */
  function emblemRelief(w, h) {
    const c = U.makeCanvas(w, h);
    c.getContext('2d', { willReadFrequently: true }); // read back once, so keep it on the CPU
    paintEmblem(c);
    const M = channel(c, 0);
    const s = w / 384;
    const bev = blur(M, w, h, Math.max(1, Math.round(s)));
    const halo = shifted(blur(M, w, h, Math.round(3 * s)), w, h, Math.round(3 * s), -Math.round(3 * s));
    const H = new Float32Array(w * h), S = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      H[i] = inner(bev[i]);
      S[i] = (1 - M[i]) * halo[i] * 1.2;
    }
    return encode(H, S, w, h);
  }

  /** The tear sinks in, the stitches stand up. */
  function seamRelief(w, h) {
    const c = U.makeCanvas(w, h);
    c.getContext('2d', { willReadFrequently: true }); // read back once, so keep it on the CPU
    paintSeam(c);
    const R = channel(c, 0), G = channel(c, 1);
    const tear = blur(R, w, h, 1), thread = blur(G, w, h, 1);
    const halo = shifted(blur(G, w, h, 2), w, h, 2, -2);
    const H = new Float32Array(w * h), S = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      H[i] = 0.5 + 0.5 * thread[i] - 0.4 * tear[i] * (1 - G[i]);
      S[i] = (1 - G[i]) * halo[i] * 0.9;
    }
    return encode(H, S, w, h);
  }

  SMR.heroArt = { eyePath, paintEyes, paintSeam, paintEmblem, eyeRelief, emblemRelief, seamRelief, EYE_RECT, SEAM_RECT };
})();
