/* The game's own spider mark. It is described as geometry (not an image) so the
   same shape can be stamped on the suit, used as an icon, and drawn by the loader. */
(function () {
  'use strict';
  const SMR = window.SMR;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k];
  const norm = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
  const perp = (a) => [-a[1], a[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  /** A two-segment leg that tapers from the body to a point. */
  function leg(a, b, c, wa, wb) {
    const n1 = norm(perp(sub(b, a)));
    const n2 = norm(perp(sub(c, b)));
    const m = norm(add(n1, n2));
    const k = wb / Math.max(0.4, dot(m, n1));
    return [add(a, mul(n1, wa)), add(b, mul(m, k)), c, sub(b, mul(m, k)), sub(a, mul(n1, wa))];
  }

  // Design space is roughly 110 wide by 150 tall, centred on the body.
  const RIGHT_LEGS = [
    [[4, -15], [23, -37], [15, -72], 4.4, 3.3],
    [[7, -11], [43, -27], [46, -61], 4.4, 3.3],
    [[7, -5], [45, 5], [55, 42], 4.4, 3.3],
    [[5, 1], [26, 24], [22, 77], 4.4, 3.3],
  ];

  const polys = [
    [[0, -28], [9.5, -14], [0, -1], [-9.5, -14]], // head
    [[0, -5], [12.5, 16], [0, 67], [-12.5, 16]], // abdomen
  ];
  RIGHT_LEGS.forEach(([a, b, c, wa, wb]) => {
    polys.push(leg(a, b, c, wa, wb));
    const flip = (p) => [-p[0], p[1]];
    polys.push(leg(flip(a), flip(b), flip(c), wa, wb).reverse());
  });

  /** Trace the mark into a canvas context or Path2D. */
  function trace(target, cx, cy, scale) {
    polys.forEach((poly) => {
      poly.forEach((p, i) => {
        const x = cx + p[0] * scale, y = cy + p[1] * scale;
        if (i === 0) target.moveTo(x, y); else target.lineTo(x, y);
      });
      target.closePath();
    });
  }

  const svgPath = polys
    .map((poly) => 'M' + poly.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z')
    .join('');

  /** Inline SVG markup for use as a UI icon. */
  function svg(className) {
    return `<svg class="${className || 'mark'}" viewBox="-60 -76 120 158" aria-hidden="true" focusable="false"><path d="${svgPath}"/></svg>`;
  }

  SMR.emblem = { polys, trace, svg, svgPath };
})();
