/* The hero model. The bust is sculpted as a signed-distance field (smoothly blended
   ellipsoids and capsules for skull, jaw, neck, shoulders and chest) and then turned
   into a real triangle mesh with the surface-nets method.
   Units: 1 = half the height of the head. x right, y up, z toward the viewer. */
(function () {
  'use strict';
  const SMR = window.SMR;

  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  function ell(x, y, z, cx, cy, cz, rx, ry, rz) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
    const k0 = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const ex = dx / rx, ey = dy / ry, ez = dz / rz;
    const k1 = Math.sqrt(ex * ex + ey * ey + ez * ez);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  }
  function cap(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
    const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az;
    let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * h);
  }

  function sdf(x, y, z) {
    const ax = Math.abs(x); // the bust is symmetric
    let d = ell(x, y, z, 0, 0.22, -0.1, 0.725, 0.78, 0.9); // cranium
    d = smin(d, ell(x, y, z, 0, -0.36, 0.12, 0.56, 0.64, 0.66), 0.22); // face and jaw
    d = smin(d, ell(x, y, z, 0, -0.2, 0.74, 0.1, 0.2, 0.12), 0.12); // nose
    d = smin(d, cap(x, y, z, 0, -0.55, -0.18, 0, -1.5, -0.26, 0.43, 0.48), 0.1); // neck
    let b = cap(ax, y, z, 0.2, -1.22, -0.3, 1.3, -1.6, -0.28, 0.26, 0.3); // trapezius
    b = smin(b, ell(ax, y, z, 1.68, -1.92, -0.2, 0.5, 0.56, 0.54), 0.2); // deltoid
    b = smin(b, cap(ax, y, z, 1.78, -2.0, -0.2, 1.98, -3.5, -0.12, 0.4, 0.38), 0.15); // upper arm
    b = smin(b, ell(x, y, z, 0, -2.5, -0.2, 1.42, 1.25, 0.72), 0.25); // ribcage
    b = smin(b, ell(ax, y, z, 0.62, -2.12, 0.32, 0.68, 0.46, 0.34), 0.16); // chest
    b = smin(b, ell(x, y, z, 0, -1.72, -0.02, 1.2, 0.32, 0.42), 0.2); // collar
    d = smin(d, b, 0.14);
    return Math.max(d, -3.3 - y);
  }

  /** Build { positions, normals, indices } for the bust. */
  function build(cell) {
    const x0 = -2.6, y0 = -3.36, z0 = -1.3, x1 = 2.6, y1 = 1.12, z1 = 1.14;
    const nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
    const vals = new Float32Array(nx * ny * nz);
    for (let k = 0, i = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let ii = 0; ii < nx; ii++, i++) vals[i] = sdf(x0 + ii * cell, y0 + j * cell, z0 + k * cell);

    const at = (i, j, k) => vals[i + nx * (j + ny * k)];
    const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const pos = [];
    const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { v[c] = at(i + C[c][0], j + C[c][1], k + C[c][2]); if (v[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        if ((v[a] < 0) === (v[b] < 0)) continue;
        const t = v[a] / (v[a] - v[b]);
        sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
      }
      cellVert[cidx(i, j, k)] = pos.length / 3;
      pos.push(x0 + (i + sx / n) * cell, y0 + (j + sy / n) * cell, z0 + (k + sz / n) * cell);
    }

    // pull every vertex onto the true surface and take its normal from the field
    const positions = new Float32Array(pos), normals = new Float32Array(pos.length);
    const e = 0.004;
    for (let i = 0; i < positions.length; i += 3) {
      let x = positions[i], y = positions[i + 1], z = positions[i + 2], gx = 0, gy = 0, gz = 1;
      for (let it = 0; it < 2; it++) {
        gx = sdf(x + e, y, z) - sdf(x - e, y, z); gy = sdf(x, y + e, z) - sdf(x, y - e, z); gz = sdf(x, y, z + e) - sdf(x, y, z - e);
        const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1; gx /= l; gy /= l; gz /= l;
        const d = sdf(x, y, z); x -= gx * d; y -= gy * d; z -= gz * d;
      }
      positions[i] = x; positions[i + 1] = y; positions[i + 2] = z;
      normals[i] = gx; normals[i + 1] = gy; normals[i + 2] = gz;
    }

    // one quad for every grid edge that crosses the surface
    const idx = [];
    const quad = (a, b, c, d) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      for (const t of [[a, b, c], [a, c, d]]) {
        const [p, q, r] = t;
        const ux = positions[q * 3] - positions[p * 3], uy = positions[q * 3 + 1] - positions[p * 3 + 1], uz = positions[q * 3 + 2] - positions[p * 3 + 2];
        const wx = positions[r * 3] - positions[p * 3], wy = positions[r * 3 + 1] - positions[p * 3 + 1], wz = positions[r * 3 + 2] - positions[p * 3 + 2];
        const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
        if (fx * normals[p * 3] + fy * normals[p * 3 + 1] + fz * normals[p * 3 + 2] >= 0) idx.push(p, q, r); else idx.push(p, r, q);
      }
    };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const s = at(i, j, k) < 0;
      if (s !== at(i + 1, j, k) < 0) quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)]);
      if (s !== at(i, j + 1, k) < 0) quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)]);
      if (s !== at(i, j, k + 1) < 0) quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)]);
    }
    return { positions, normals, indices: new Uint32Array(idx) };
  }

  SMR.bust = { build, sdf };
})();
