/* Brain View — particle anatomy generator.
   Units: the figure spans y = -1.41 (tail tip) … +1.40 (crown). x = lateral, +z = front (face/belly).
   Everything is deterministic for a given seed. */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Compact 3D simplex noise (Gustavson), seeded.
  function makeNoise3(seed) {
    const rnd = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const g = [1,1,0,-1,1,0,1,-1,0,-1,-1,0,1,0,1,-1,0,1,1,0,-1,-1,0,-1,0,1,1,0,-1,1,0,1,-1,0,-1,-1];
    const F3 = 1 / 3, G3 = 1 / 6;
    return function (x, y, z) {
      const s = (x + y + z) * F3;
      const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
      const t = (i + j + k) * G3;
      const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
        else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
        else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
      } else {
        if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
        else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
        else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      }
      const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
      const x3 = x0 - 1 + 0.5, y3 = y0 - 1 + 0.5, z3 = z0 - 1 + 0.5;
      const ii = i & 255, jj = j & 255, kk = k & 255;
      let n = 0, tt, gi;
      tt = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (tt > 0) { gi = (p[ii + p[jj + p[kk]]] % 12) * 3; tt *= tt; n += tt * tt * (g[gi] * x0 + g[gi + 1] * y0 + g[gi + 2] * z0); }
      tt = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (tt > 0) { gi = (p[ii + i1 + p[jj + j1 + p[kk + k1]]] % 12) * 3; tt *= tt; n += tt * tt * (g[gi] * x1 + g[gi + 1] * y1 + g[gi + 2] * z1); }
      tt = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (tt > 0) { gi = (p[ii + i2 + p[jj + j2 + p[kk + k2]]] % 12) * 3; tt *= tt; n += tt * tt * (g[gi] * x2 + g[gi + 1] * y2 + g[gi + 2] * z2); }
      tt = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (tt > 0) { gi = (p[ii + 1 + p[jj + 1 + p[kk + 1]]] % 12) * 3; tt *= tt; n += tt * tt * (g[gi] * x3 + g[gi + 1] * y3 + g[gi + 2] * z3); }
      return 32 * n; // ~[-1,1]
    };
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  // Catmull-Rom through (ys[i], vs[i]); ys strictly descending.
  function profile(ys, vs) {
    return function (y) {
      const n = ys.length;
      if (y >= ys[0]) return vs[0];
      if (y <= ys[n - 1]) return vs[n - 1];
      let i = 0;
      while (i < n - 2 && y < ys[i + 1]) i++;
      const t = (ys[i] - y) / (ys[i] - ys[i + 1]);
      const p0 = vs[Math.max(0, i - 1)], p1 = vs[i], p2 = vs[i + 1], p3 = vs[Math.min(n - 1, i + 2)];
      const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    };
  }

  // ---- measured proportions (from the reference footage) ----
  const Y_TOP = 0.80, Y_TIP = -1.41, SPINE_LEN = Y_TOP - Y_TIP;
  const spineZ = profile(
    [0.80, 0.50, 0.34, 0.26, 0.12, -0.08, -0.48, -0.88, -1.20, -1.41],
    [-0.17, -0.17, -0.17, -0.205, -0.30, -0.41, -0.43, -0.37, -0.27, -0.18]);
  const HY = [0.80, 0.50, 0.40, 0.31, 0.12, -0.07, -0.26, -0.49, -0.645, -0.836, -1.03, -1.22, -1.41];
  const hullA = profile(HY, [0.135, 0.143, 0.195, 0.276, 0.478, 0.587, 0.663, 0.706, 0.698, 0.533, 0.331, 0.147, 0.0]);
  const hullC = profile(HY, [-0.16, -0.16, -0.165, -0.19, -0.18, -0.18, -0.176, -0.21, -0.26, -0.27, -0.245, -0.20, -0.18]);
  const hullB = profile(HY, [0.125, 0.125, 0.125, 0.14, 0.28, 0.355, 0.41, 0.31, 0.22, 0.165, 0.115, 0.065, 0.0]);

  const KIND = { CORTEX: 0, SPINE: 1, NERVE: 2, HAZE: 3, CEREBELLUM: 4, STEM: 5 };

  /* opts: { seed, cerebellumFrac, stemFrac, brainCount } */
  function buildAnatomy(opts) {
    opts = opts || {};
    const seed = opts.seed || 20240817;
    const rnd = mulberry32(seed);
    const noise = makeNoise3(seed ^ 0x9e3779b9);
    const noise2 = makeNoise3(seed ^ 0x51ed270b);
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v); };

    const P = { pos: [], kind: [], white: [], inten: [], size: [], tl: [], reveal: [], origin: [] };
    function push(x, y, z, kind, white, inten, size, tl, reveal, ox, oy, oz) {
      P.pos.push(x, y, z); P.kind.push(kind); P.white.push(white); P.inten.push(inten); P.size.push(size);
      P.tl.push(tl); P.reveal.push(reveal); P.origin.push(ox, oy, oz);
    }

    // ============================ BRAIN ============================
    const BC = { x: 0, y: 1.138, z: -0.055 };       // cerebrum centre
    const STEM_TOP = { x: 0, y: 0.985, z: -0.13 }, STEM_BOT = { x: 0, y: Y_TOP, z: -0.17 };
    const brainCount = opts.brainCount || 46000;
    const cerebFrac = opts.cerebellumFrac == null ? 0.13 : clamp(opts.cerebellumFrac, 0.05, 0.26);
    const stemFrac = opts.stemFrac == null ? 0.035 : clamp(opts.stemFrac, 0.02, 0.07);
    const nCereb = Math.round(brainCount * cerebFrac), nStem = Math.round(brainCount * stemFrac);
    const nCortex = brainCount - nCereb - nStem;

    function cortexPoint(nx, ny, nz) {
      // base egg
      let x = nx * 0.285, y = ny * (ny > 0 ? 0.262 : lerp(0.17, 0.262, smooth(-0.95, -0.15, nz))), z = nz * 0.398;
      const nz2 = nz * nz;
      x *= 1 - (nz > 0 ? 0.16 : 0.10) * nz2;                 // narrower poles
      if (nz > 0) y -= 0.035 * nz2;                          // frontal pole sits lower
      else y += 0.012 * nz2;
      // temporal lobe: lateral-lower bulge, slightly ahead of centre
      const ax = Math.abs(nx);
      if (ny < 0) {
        const tb = Math.exp(-Math.pow((nz - 0.12) / 0.5, 2)) * smooth(0.25, 0.8, ax) * (-ny);
        y -= 0.085 * tb; x *= 1 + 0.05 * tb;
        // concave underside around the midline (where the stem enters)
        y += 0.02 * Math.exp(-Math.pow(ax / 0.33, 2)) * (-ny) * smooth(0.5, -0.4, nz);
      }
      // longitudinal fissure
      const fiss = Math.exp(-Math.pow(nx / 0.06, 2)) * smooth(0.1, 0.75, ny);
      const k = 1 - 0.11 * fiss;
      return [x * k, y * k, z * k, fiss];
    }

    const stemOrigin = [STEM_TOP.x, STEM_TOP.y - 0.02, STEM_TOP.z];
    const brainFar = 0.62;
    function brainReveal(x, y, z) {
      const d = Math.hypot(x - stemOrigin[0], y - stemOrigin[1], z - stemOrigin[2]);
      return 1.70 + 0.58 * clamp(d / brainFar, 0, 1) + rnd() * 0.06;
    }

    let made = 0, guard = 0;
    while (made < nCortex && guard++ < nCortex * 30) {
      // uniform direction
      const u = rnd() * 2 - 1, ph = rnd() * 6.283185307, s = Math.sqrt(1 - u * u);
      const nx = s * Math.cos(ph), ny = u, nz = s * Math.sin(ph);
      const sp = cortexPoint(nx, ny, nz);
      // gyri / sulci: thin dark creases between broad folds
      const qx = nx * 4.3, qy = ny * 4.3, qz = nz * 4.3;
      const wx = noise2(qx * 0.55, qy * 0.55, qz * 0.55), wy = noise2(qy * 0.55 + 7.1, qz * 0.55, qx * 0.55);
      const n1 = noise(qx + 0.9 * wx, qy + 0.9 * wy, qz + 0.9 * wx);
      const n2 = noise(qx * 2.1 + 3.3, qy * 2.1 + wy, qz * 2.1 - 1.7);
      const crease = Math.min(Math.abs(n1), 0.22 + Math.abs(n2) * 0.9);
      const ridge = smooth(0.015, 0.17, crease);
      const interior = rnd() < 0.52;
      if (!interior && rnd() > (0.16 + 0.84 * ridge) * (1 - 0.6 * sp[3]) * (0.35 + 0.65 * smooth(-0.75, -0.05, ny))) continue;
      let depth;
      if (interior) depth = 1 - 0.96 * Math.cbrt(rnd());
      else depth = 0.045 * (1 - ridge) + Math.pow(rnd(), 2.2) * 0.075;
      const k = 1 - depth;
      const x = BC.x + sp[0] * k;
      const y = BC.y + sp[1] * k, z = BC.z + sp[2] * k;
      const inten = interior ? 0.42 + rnd() * 0.3 : (0.5 + 0.5 * ridge) * (0.75 + rnd() * 0.5);
      push(x, y, z, KIND.CORTEX, interior ? 0.18 + 0.12 * rnd() : 0.18 + 0.26 * ridge * rnd(), inten,
        interior ? 0.9 : 0.85 + rnd() * 0.75, -1, brainReveal(x, y, z), stemOrigin[0], stemOrigin[1], stemOrigin[2]);
      made++;
    }

    // cerebellum: two lobes with fine horizontal folia
    const CB = { x: 0, y: 0.872, z: -0.3 };
    made = 0; guard = 0;
    while (made < nCereb && guard++ < nCereb * 30) {
      const u = rnd() * 2 - 1, ph = rnd() * 6.283185307, s = Math.sqrt(1 - u * u);
      let nx = s * Math.cos(ph), ny = u, nz = s * Math.sin(ph);
      const mid = Math.exp(-Math.pow(nx / 0.16, 2));
      const rr = 1 - 0.14 * mid * smooth(0.3, -0.6, nz);
      const fol = 0.5 + 0.5 * Math.sin(ny * 21 + nz * 3 + noise(nx * 3, ny * 3, nz * 3) * 1.6);
      const interior = rnd() < 0.45;
      if (!interior && rnd() > 0.28 + 0.72 * fol) continue;
      const k = (interior ? 0.96 * Math.cbrt(rnd()) : 1 - Math.pow(rnd(), 2.0) * 0.1 - 0.03 * (1 - fol)) * rr;
      const x = CB.x + nx * 0.21 * k, y = CB.y + ny * 0.105 * k, z = CB.z + nz * 0.14 * k;
      push(x, y, z, KIND.CEREBELLUM, interior ? 0.18 : 0.08 + 0.18 * fol * rnd(), interior ? 0.36 : (0.5 + 0.45 * fol) * (0.75 + rnd() * 0.45),
        0.85 + rnd() * 0.7, -1, brainReveal(x, y, z) - 0.05, stemOrigin[0], stemOrigin[1], stemOrigin[2]);
      made++;
    }

    // brainstem: tapered, dense -> the white-hot junction
    for (let i = 0; i < nStem; i++) {
      const t = Math.pow(rnd(), 0.8);
      const cx = lerp(STEM_TOP.x, STEM_BOT.x, t), cy = lerp(STEM_TOP.y + 0.05, STEM_BOT.y, t), cz = lerp(STEM_TOP.z + 0.02, STEM_BOT.z, t);
      const r = lerp(0.07, 0.036, t) * Math.sqrt(rnd()), a = rnd() * 6.283185307;
      const x = cx + r * Math.cos(a), y = cy + gauss() * 0.004, z = cz + r * Math.sin(a) * 0.9;
      push(x, y, z, KIND.STEM, 0.42 + rnd() * 0.3, 0.62 + rnd() * 0.4, 0.9 + rnd() * 0.7, -1, 1.56 + t * 0.1 + rnd() * 0.05,
        stemOrigin[0], stemOrigin[1], stemOrigin[2]);
    }
    const nBrain = P.kind.length;

    // ============================ BODY ============================
    const sOfY = (y) => clamp((Y_TOP - y) / SPINE_LEN, 0, 1);          // 0 top … 1 tail
    const tlOfY = (y) => 1 - sOfY(y);                                   // timeline: top = newest
    const lump = (y, th) => 1 + 0.07 * noise(Math.sin(th) * 1.3, y * 1.7, Math.cos(th) * 1.3) + 0.035 * noise(Math.sin(th) * 3.1 + 5, y * 4.2, Math.cos(th) * 3.1);
    function hull(y, th, rho) {
      const L = lump(y, th) * rho;
      return [hullA(y) * Math.sin(th) * L, y, hullC(y) + hullB(y) * Math.cos(th) * L];
    }
    function bodyReveal(x, y, z) {
      const d = Math.hypot(x, z - spineZ(y));
      return 0.80 + 0.40 * clamp(d / 0.8, 0, 1) + rnd() * 0.12;
    }
    function nervePoint(q, white, inten, size, jit) {
      const x = q[0] + gauss() * jit, y = q[1] + gauss() * jit, z = q[2] + gauss() * jit;
      push(x, y, z, KIND.NERVE, white, inten, size, tlOfY(y), bodyReveal(x, y, z), 0, y, spineZ(y));
    }

    // --- spinal cord + vertebrae ---
    const NV = 46;
    const cordN = 2600;
    for (let i = 0; i < cordN; i++) {
      const s = rnd(), y = Y_TOP - s * SPINE_LEN;
      const r = 0.0048 * (1 - 0.45 * s);
      push(gauss() * r, y, spineZ(y) + gauss() * r, KIND.SPINE, 0.9, 0.55 + rnd() * 0.35, 0.9 + rnd() * 0.5, 1 - s,
        0.10 + 0.70 * s + rnd() * 0.03, 0, y, spineZ(y));
    }
    const vert = [];
    for (let k = 0; k < NV; k++) {
      const s = (k + 0.5) / NV, y = Y_TOP - s * SPINE_LEN, z = spineZ(y);
      const taper = 1 - 0.55 * Math.pow(s, 1.3);
      const w = 0.024 * taper * (k < 6 ? 0.82 : 1) * (1 + 0.25 * Math.exp(-Math.pow((s - 0.55) / 0.2, 2)));
      vert.push({ s, y, z, w });
      const nPts = 120;
      for (let i = 0; i < nPts; i++) {
        const r = rnd();
        let x, yy, zz, wh = 0.92;
        if (r < 0.40) { x = gauss() * 0.008 * taper; yy = y + gauss() * 0.006; zz = z + gauss() * 0.008 * taper; }           // body
        else if (r < 0.96) {                                                                                                     // transverse processes (chevron)
          const side = rnd() < 0.5 ? -1 : 1, t = Math.pow(rnd(), 0.75);
          x = side * w * t; yy = y - 0.42 * w * t * t + gauss() * 0.003; zz = z - 0.25 * w * t + gauss() * 0.003;
        } else { const t = rnd(); x = gauss() * 0.003; yy = y - 0.3 * w * t; zz = z - 0.7 * w * t; wh = 0.8; }                  // spinous process
        push(x, yy, zz, KIND.SPINE, wh, 0.6 + rnd() * 0.4, 0.95 + rnd() * 0.6, 1 - s, 0.10 + 0.70 * s + rnd() * 0.04, 0, yy, z);
      }
    }

    // --- rib-like nerves: leave the spine, reach the hull, wrap to the front ---
    const STEP = 0.0046;
    function fiberOnHull(th0, y0, dth, dy, len, opt) {
      // walks in (theta, y) hull space; returns number of points
      const n = Math.max(6, Math.round(len / STEP));
      const rho = opt.rho, ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, ph3 = rnd() * 6.28, wav = opt.wav == null ? 1.7 : opt.wav;
      let made = 0;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const th = th0 + dth * u + 0.06 * wav * Math.sin(u * 6.5 + ph1) + 0.025 * wav * Math.sin(u * 17 + ph2);
        const y = y0 + dy * Math.pow(u, opt.pw || 1) + 0.014 * wav * Math.sin(u * 9.5 + ph2);
        if (y < Y_TIP + 0.01 || y > Y_TOP) break;
        const q = hull(y, th, rho + 0.012 * Math.sin(u * 12 + ph1));
        const fade = (opt.i0 + (opt.i1 - opt.i0) * u) * (0.62 + 0.38 * Math.sin(u * n * 0.11 + ph3) + 0.25 * Math.sin(u * n * 0.031 + ph1));
        nervePoint(q, opt.w0 + (opt.w1 - opt.w0) * u, fade * (0.7 + rnd() * 0.6), 0.85 + rnd() * 0.6, 0.0017);
        made++;
      }
      return made;
    }
    const fibers = []; // {tl, start, count}
    for (let k = 0; k < NV; k++) {
      const v = vert[k];
      const perSide = v.y > 0.42 ? 1 : (rnd() < 0.55 ? 2 : 1);
      for (let side = -1; side <= 1; side += 2) {
        for (let r = 0; r < perSide; r++) {
          const start = P.kind.length;
          const yk = v.y + (rnd() - 0.5) * 0.03;
          const th0 = 2.25 + rnd() * 0.55;                                  // where it meets the hull (back-lateral)
          const reach = rnd();
          const thEnd = reach < 0.55 ? 0.04 + rnd() * 0.35 : 0.5 + rnd() * 1.1; // many reach the front midline
          const drop = -(0.05 + 0.30 * Math.pow(v.s, 1.6) + rnd() * 0.13);
          const rho = 0.93 + rnd() * 0.07;
          // root: spine -> hull
          const yJoin = yk + drop * 0.12;
          const H = hull(yJoin, side * th0, rho);
          const rootLen = Math.hypot(H[0], H[1] - yk, H[2] - v.z);
          const nr = Math.max(4, Math.round(rootLen / STEP));
          const bow = (rnd() - 0.3) * 0.05;
          for (let i = 0; i < nr; i++) {
            const u = i / nr, e = u * u * (3 - 2 * u);
            const q = [lerp(side * v.w * 0.6, H[0], e), lerp(yk, H[1], u) + bow * Math.sin(Math.PI * u), lerp(v.z, H[2], Math.pow(u, 0.8))];
            nervePoint(q, 0.82, (0.8 + rnd() * 0.5), 0.9 + rnd() * 0.6, 0.0017);
          }
          // wrap
          const arc = (th0 - thEnd) * (hullA(yJoin) + hullB(yJoin)) * 0.5;
          const len = Math.max(0.05, Math.hypot(arc, drop));
          fiberOnHull(side * th0, yJoin, side * (thEnd - th0), drop * 0.88, len, { rho, i0: 1.0, i1: 0.55, w0: 0.86, w1: 0.5, pw: 1.15 });
          // branches
          const nb = v.y > 0.45 ? 0 : (rnd() < 0.6 ? 1 : 0) + (rnd() < 0.2 ? 1 : 0);
          for (let b = 0; b < nb; b++) {
            const ub = 0.15 + rnd() * 0.6;
            const thb = side * lerp(th0, thEnd, ub), yb = yJoin + drop * 0.88 * Math.pow(ub, 1.15);
            const down = rnd() < 0.72;
            fiberOnHull(thb, yb, side * (rnd() - 0.55) * 0.9, (down ? -1 : 1) * (0.08 + rnd() * 0.3), 0.12 + rnd() * 0.32,
              { rho: rho - 0.01, i0: 0.7, i1: 0.3, w0: 0.5, w1: 0.25 });
          }
          fibers.push({ tl: 1 - v.s, start, count: P.kind.length - start });
        }
      }
    }

    // --- meridian nerves: down the neck bundle, over the hull, to the tail ---
    const NM = 30;
    for (let m = 0; m < NM; m++) {
      const th = (m + rnd() * 0.7) / NM * 6.283185307, rho = 0.955 + rnd() * 0.045;
      const ph = rnd() * 6.28, drift = (rnd() - 0.5) * 0.5, yEnd = rnd() < 0.7 ? Y_TIP + 0.01 : lerp(-0.2, -1.2, rnd());
      const n = Math.round((Y_TOP - yEnd) / (STEP * 0.92));
      for (let i = 0; i < n; i++) {
        const u = i / n, y = Y_TOP - u * (Y_TOP - yEnd);
        const below = smooth(0.42, 0.1, y), neck = smooth(0.3, 0.45, y);       // wander only once past the neck
        const tt = th + below * (drift * u + 0.13 * Math.sin(y * 3.1 + ph) + 0.05 * Math.sin(y * 9 + ph * 2));
        const q = hull(y, tt, rho);
        nervePoint(q, 0.45 - 0.2 * u + 0.25 * neck, (0.5 - 0.2 * u) * (1 + 0.9 * neck) * (0.7 + rnd() * 0.6), 0.85 + rnd() * 0.6, 0.0017);
      }
    }

    // --- wandering web arcs on the hull ---
    const NW = 130;
    for (let w = 0; w < NW; w++) {
      const y0 = lerp(0.42, -1.18, Math.pow(rnd(), 0.9)), th0 = rnd() * 6.283185307;
      const ang = rnd() * 6.283185307, len = 0.14 + rnd() * 0.5;
      const A = Math.max(0.12, (hullA(y0) + hullB(y0)) * 0.5);
      fiberOnHull(th0, y0, Math.cos(ang) * len / A + (rnd() - 0.5) * 0.4, Math.sin(ang) * len * 0.8, len,
        { rho: 0.9 + rnd() * 0.1, i0: 0.5, i1: 0.26, w0: 0.42, w1: 0.2, wav: 1.6 });
    }

    // --- haze: faint coloured dust filling the hull ---
    const NH = 15000;
    for (let i = 0; i < NH; i++) {
      // rejection-sample height by cross-section size
      let y, tries = 0;
      do { y = lerp(Y_TIP, 0.74, rnd()); } while (rnd() > (hullA(y) * hullB(y)) / 0.30 + 0.06 && tries++ < 20);
      const th = rnd() * 6.283185307, rho = 0.45 + 0.57 * Math.sqrt(rnd());
      const q = hull(y, th, rho);
      push(q[0], q[1], q[2], KIND.HAZE, 0.0, 0.2 + rnd() * 0.2, 1.0 + rnd() * 0.9, tlOfY(y), 1.42 + 0.3 * rnd() + 0.15 * clamp(Math.hypot(q[0], q[2] - spineZ(y)) / 0.8, 0, 1), 0, y, spineZ(y));
    }

    const N = P.kind.length;
    return {
      N, nBrain, nCortex, nCereb, nStem,
      pos: new Float32Array(P.pos), kind: new Uint8Array(P.kind), white: new Float32Array(P.white),
      inten: new Float32Array(P.inten), size: new Float32Array(P.size), tl: new Float32Array(P.tl),
      reveal: new Float32Array(P.reveal), origin: new Float32Array(P.origin),
      KIND, fibers, bounds: { top: 1.40, bottom: Y_TIP }, stem: stemOrigin, brainCentre: [BC.x, BC.y, BC.z],
      spineZ, hullA, hullB, hullC
    };
  }

  root.BrainAnatomy = { buildAnatomy, mulberry32, makeNoise3, KIND };
})(typeof window !== 'undefined' ? window : globalThis);
