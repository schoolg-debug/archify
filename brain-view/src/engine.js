/* Brain View — WebGL2 renderer: additive particle anatomy, bloom, orbit camera, picking, morphing. */
(function (root) {
  'use strict';
  const A = root.BrainAnatomy;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- tiny mat4 ----------
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(e, c, up) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function hexToRgb(h) {
    h = h.replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  // ---------- shaders ----------
  const COMMON = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 uVP;
uniform float uForm, uSpread, uClusMix, uIntro, uGalaxy, uOrrery;
vec3 morph(vec3 anat, vec3 clus, vec3 gdir, float st, vec3 nd, float turb, out float e) {
  vec3 a = anat + gdir * uSpread;
  vec3 c = clus * (1.0 + uSpread * 0.85);
  float f = clamp((uForm - st * 0.25) / 0.75, 0.0, 1.0);
  e = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 p = mix(a, c, e);
  p += nd * turb * sin(3.14159265 * e);
  return p;
}
// third form: every group becomes a small spiral galaxy
vec3 galaxy(vec3 p, vec3 gal, float st, vec3 nd, out float eg) {
  float f = clamp((uGalaxy - st * 0.38) / 0.62, 0.0, 1.0);
  eg = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 q = mix(p, gal, eg);
  q += nd * 0.2 * sin(3.14159265 * eg);
  return q;
}
// fourth form: an orrery — every note is a bead on its group's planet
vec3 orrery(vec3 p, vec3 tgt, float st, vec3 nd, out float eo) {
  float f = clamp((uOrrery - st * 0.4) / 0.6, 0.0, 1.0);
  eo = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 q = mix(p, tgt, eo);
  q += nd * 0.24 * sin(3.14159265 * eo);
  return q;
}`;

  const POINT_VS = COMMON + `
layout(location=0) in vec3 aAnat;
layout(location=1) in vec3 aClus;
layout(location=2) in vec3 aClusPrev;
layout(location=3) in vec4 aRand;
layout(location=4) in vec4 aMeta;   // kind, white, intensity, reveal
layout(location=5) in vec4 aGrow;   // intro origin xyz, timeline 0..1
layout(location=6) in float aNote;
layout(location=7) in vec3 aGroupDir;
layout(location=8) in float aSize;
layout(location=9) in vec3 aGal;
layout(location=10) in vec3 aGalPrev;
uniform sampler2D uNoteTex;
uniform highp sampler2D uOrrTex, uOrrPrev;
uniform int uTexW, uTexH, uColorMode, uPick;
uniform vec3 uColor;
uniform float uTime, uPx, uPointSize, uRefDist, uShowBody, uShowNotes, uBriBody, uBriNotes, uDim, uHover, uSel, uFiltered;
out vec4 vColor;
vec3 ramp(float t) {
  const vec3 c0 = vec3(1.0, 0.231, 0.188), c1 = vec3(1.0, 0.54, 0.12), c2 = vec3(1.0, 0.82, 0.24),
             c3 = vec3(0.56, 0.88, 0.29), c4 = vec3(0.27, 0.88, 0.72);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}
void main() {
  float kind = aMeta.x;
  bool body = (kind > 0.5 && kind < 3.5);
  int id = int(aNote + 0.5);
  vec4 nt = texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW), 0);
  float lit = nt.a;
  float e;
  vec3 nd = normalize(aRand.yzw - 0.5);
  vec3 clus = mix(aClusPrev, aClus, uClusMix);
  vec3 p = morph(aAnat, clus, aGroupDir, aRand.x, nd, 0.10 + 0.24 * aRand.w, e);
  float eg;
  p = galaxy(p, mix(aGalPrev, aGal, uClusMix), aRand.z, nd, eg);
  float eo = 0.0;
  if (uOrrery > 0.0) {       // flow into this note's bead
    ivec2 tc = ivec2(id % uTexW, id / uTexW);
    vec4 ot = mix(texelFetch(uOrrPrev, tc, 0), texelFetch(uOrrTex, tc, 0), uClusMix);
    p = orrery(p, ot.xyz + nd * ot.w * aRand.w, aRand.y, nd, eo);
  }
  // intro: spine draws downward, nerves grow outward, brain inflates from the stem
  float dur = kind < 0.5 || kind > 3.5 ? 0.46 : (abs(kind - 1.0) < 0.5 ? 0.10 : (abs(kind - 3.0) < 0.5 ? 0.40 : 0.36));
  float k = clamp((uIntro - aMeta.w) / dur, 0.0, 1.0);
  float ek = 1.0 - pow(1.0 - k, 3.0);
  p = mix(aGrow.xyz, p, ek);
  gl_Position = uVP * vec4(p, 1.0);
  float show = body ? uShowBody : uShowNotes;
  float size = uPx * aSize * (abs(kind - 3.0) < 0.5 ? 4.2 : 1.0) * uPointSize * (uRefDist / max(gl_Position.w, 0.1)) * (1.0 - 0.22 * eg);
  bool hot = (abs(aNote - uHover) < 0.5 || abs(aNote - uSel) < 0.5);
  if (uPick == 1) {
    if (show < 0.5 || lit < 0.5 || k < 0.99 || uOrrery > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; }
    else gl_PointSize = max(size * 1.6, 5.0);
    int c = id + 1;
    vColor = vec4(float(c & 255) / 255.0, float((c >> 8) & 255) / 255.0, float((c >> 16) & 255) / 255.0, 1.0);
    return;
  }
  vec3 tint;
  float white = aMeta.y;
  if (uColorMode == 0) tint = uColor;
  else if (uColorMode == 3) { tint = ramp(aGrow.w); if (kind > 1.5 && kind < 3.5) tint = mix(tint, uColor, kind > 2.5 ? 0.85 : 0.5); white *= 0.28; }
  else tint = body ? uColor : nt.rgb;
  if (eg > 0.0) {      // galaxy dust takes its group's hue
    vec3 gcol = texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW + uTexH), 0).rgb;
    tint = mix(tint, gcol, eg); white *= 1.0 - 0.8 * eg;
  }
  if (eo > 0.0) { tint = mix(tint, vec3(0.74, 0.72, 1.0), eo * 0.85); white *= 1.0 - eo; }
  vec3 col = mix(tint, vec3(1.0), white);
  if (body) { float g = dot(col, vec3(0.45)); col = mix(vec3(g), col, smoothstep(1.42, 1.85, uIntro)); }
  float gain = kind < 0.5 ? 0.40 : kind < 1.5 ? 0.46 : kind < 2.5 ? 0.48 : kind < 3.5 ? 0.062 : kind < 4.5 ? 0.30 : 0.40;
  float I = aMeta.z * gain * (body ? uBriBody : uBriNotes) * show * k;
  I *= mix(uDim, 1.0 + 0.22 * uFiltered, lit) * (1.0 - eo * eo * eo);
  I *= 0.86 + 0.14 * sin(uTime * (1.3 + aRand.y * 2.2) + aRand.z * 40.0);
  if (hot) { I = max(I, 0.5) * (1.0 + 1.6 * (1.0 - 0.8 * eg)); col = mix(col, vec3(1.0), 0.45 * (1.0 - eg)); size *= 1.0 + 0.55 * (1.0 - eg); }
  if (size < 1.0) { I *= size * size; size = 1.0; }
  gl_PointSize = size;
  vColor = vec4(col, I);
}`;
  const POINT_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uPick;
in vec4 vColor; out vec4 o;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (uPick == 1) { if (d > 1.0) discard; o = vColor; return; }
  float a = clamp(1.0 - d, 0.0, 1.0);
  a = a * a * (3.0 - 2.0 * a);
  o = vec4(vColor.rgb * vColor.a * a, 1.0);
}`;

  const LINE_VS = COMMON + `
layout(location=0) in vec3 aAnat;
layout(location=1) in vec3 aClus;
layout(location=2) in vec3 aClusPrev;
layout(location=6) in float aNote;
layout(location=7) in vec3 aGroupDir;
layout(location=9) in vec3 aGal;
layout(location=10) in vec3 aGalPrev;
uniform sampler2D uNoteTex;
uniform int uTexW, uTexH, uColorMode;
uniform vec3 uColor;
uniform float uAlpha, uDim, uShowNotes, uHot;
out vec4 vColor;
void main() {
  int id = int(aNote + 0.5);
  vec4 nt = texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW), 0);
  float e;
  vec3 p = morph(aAnat, mix(aClusPrev, aClus, uClusMix), aGroupDir, 0.5, vec3(0.0), 0.0, e);
  float eg;
  p = galaxy(p, mix(aGalPrev, aGal, uClusMix), 0.5, vec3(0.0), eg);
  gl_Position = uVP * vec4(p, 1.0);
  vec3 tint = (uColorMode == 1 || uColorMode == 2) ? nt.rgb : uColor;
  tint = mix(tint, texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW + uTexH), 0).rgb, eg);
  tint = mix(tint, vec3(1.0), 0.25 + 0.4 * uHot);
  float I = uAlpha * mix(uDim * 1.5, 1.0, max(nt.a, uHot)) * uShowNotes * clamp((uIntro - 2.4) / 0.6, 0.0, 1.0);
  vColor = vec4(tint * I, 1.0);
}`;
  const LINE_FS = `#version 300 es
precision highp float; in vec4 vColor; out vec4 o; void main() { o = vColor; }`;

  // one glowing star per note (galaxy form only)
  const STAR_VS = COMMON + `
layout(location=0) in vec3 aAnat;
layout(location=1) in vec3 aClus;
layout(location=2) in vec3 aClusPrev;
layout(location=6) in float aNote;
layout(location=7) in vec3 aGroupDir;
layout(location=9) in vec3 aGal;
layout(location=10) in vec3 aGalPrev;
layout(location=11) in vec2 aStar;   // size, seed
uniform sampler2D uNoteTex;
uniform highp sampler2D uOrrTex, uOrrPrev;
uniform int uTexW, uTexH, uPick;
uniform float uTime, uPx, uPointSize, uRefDist, uDim, uShowNotes, uHover, uSel, uPxPerUnit;
out vec4 vColor;
out float vStyle;
void main() {
  int id = int(aNote + 0.5);
  vec4 nt = texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW), 0);
  vec3 gcol = texelFetch(uNoteTex, ivec2(id % uTexW, id / uTexW + uTexH), 0).rgb;
  float e, eg;
  vec3 p = morph(aAnat, mix(aClusPrev, aClus, uClusMix), aGroupDir, 0.5, vec3(0.0), 0.0, e);
  p = galaxy(p, mix(aGalPrev, aGal, uClusMix), aStar.y, vec3(0.0), eg);
  float eo = 0.0, orad = 0.0;
  if (uOrrery > 0.0) {
    ivec2 tc = ivec2(id % uTexW, id / uTexW);
    vec4 ot = mix(texelFetch(uOrrPrev, tc, 0), texelFetch(uOrrTex, tc, 0), uClusMix);
    p = orrery(p, ot.xyz, aStar.y, vec3(0.0), eo); orad = ot.w;
  }
  gl_Position = uVP * vec4(p, 1.0);
  float visO = smoothstep(0.3, 0.92, uOrrery);
  float vis = max(smoothstep(0.18, 0.85, uGalaxy) * (1.0 - visO), visO) * uShowNotes;
  vStyle = visO;
  bool hot = (abs(aNote - uHover) < 0.5 || abs(aNote - uSel) < 0.5);
  float sizeG = uPx * aStar.x * (0.6 + 0.4 * uPointSize) * (uRefDist / max(gl_Position.w, 0.1));
  float sizeO = max(2.0 * orad * (0.75 + 0.25 * uPointSize) * uPxPerUnit / max(gl_Position.w, 0.1), 2.2);
  float size = mix(sizeG, sizeO, visO) * (hot ? 1.5 : 1.0);
  if (uPick == 1) {
    if (vis < 0.5 || nt.a < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; }
    else { gl_PointSize = max(size * mix(0.55, 0.62, visO), 7.0); gl_Position.z -= 0.03 * gl_Position.w; }
    int c = id + 1;
    vColor = vec4(float(c & 255) / 255.0, float((c >> 8) & 255) / 255.0, float((c >> 16) & 255) / 255.0, 1.0);
    return;
  }
  float I = vis * mix(uDim * 1.4, 1.0, nt.a) * (0.86 + 0.14 * sin(uTime * (0.9 + aStar.y * 2.0) + aStar.y * 60.0));
  gl_PointSize = size;
  vColor = vec4(mix(gcol, vec3(1.0), hot ? 0.35 : 0.0), I * (hot ? 1.5 : 1.0));
}`;
  const STAR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int uPick;
in vec4 vColor; in float vStyle; out vec4 o;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (uPick == 1) { if (d > 1.0) discard; o = vColor; return; }
  float core = exp(-d * d * 30.0);
  float halo = exp(-d * d * 6.5) * 0.62 + exp(-d * d * 2.0) * 0.16;
  vec3 glow = (vColor.rgb * (halo + core * 0.5) + vec3(1.0) * core * 1.15) * smoothstep(1.0, 0.72, d);
  // orrery: a small lit sphere
  vec3 n = vec3(c.x * 2.0, -c.y * 2.0, sqrt(max(0.0, 1.0 - d * d)));
  float diff = max(dot(n, vec3(-0.42, 0.56, 0.71)), 0.0);
  vec3 base = mix(vec3(0.73, 0.71, 1.0), vColor.rgb, 0.24);
  vec3 bead = (base * (0.14 + 0.68 * diff) + vec3(1.0) * pow(diff, 22.0) * 0.28) * smoothstep(1.0, 0.9, d);
  o = vec4(mix(glow, bead, vStyle) * vColor.a, 1.0);
}`;
  // orrery decor: rings, cage, fans, beams, crystal, link threads (position + colour + (t, seed))
  const DECO_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;
layout(location=1) in vec4 aC;
layout(location=2) in vec2 aT;
uniform mat4 uVP, uModel;
uniform float uAlpha, uGrow, uTime, uFlow;
out vec4 vC;
void main() {
  gl_Position = uVP * (uModel * vec4(aP, 1.0));
  float m = uGrow > 8.0 ? 1.0 : smoothstep(uGrow, uGrow - 0.16, aT.x);
  float sh = 1.0 - uFlow * (0.3 + 0.3 * sin(uTime * 1.6 - aT.x * 7.0 + aT.y * 40.0));
  vC = vec4(aC.rgb, aC.a * uAlpha * m * sh);
}`;
  const DECO_FS = `#version 300 es
precision highp float; in vec4 vC; out vec4 o; void main() { o = vec4(vC.rgb * vC.a, 1.0); }`;
  const GLOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aP;
layout(location=1) in vec4 aC;
layout(location=2) in float aS;
uniform mat4 uVP; uniform float uPxPerUnit, uAlpha;
out vec4 vC;
void main() {
  gl_Position = uVP * vec4(aP, 1.0);
  gl_PointSize = max(1.5, aS * uPxPerUnit / max(gl_Position.w, 0.1));
  vC = vec4(aC.rgb, aC.a * uAlpha);
}`;
  const GLOW_FS = `#version 300 es
precision highp float; in vec4 vC; out vec4 o;
void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 4.2) * smoothstep(1.0, 0.75, d); o = vec4(vC.rgb * vC.a * a, 1.0); }`;
  const FIELD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aP;
uniform mat4 uVP; uniform float uPx, uVis, uTime;
out float vI;
void main() {
  gl_Position = uVP * vec4(aP.xyz, 1.0);
  gl_PointSize = max(1.0, uPx * (0.55 + aP.w * 1.15));
  vI = uVis * (0.16 + 0.84 * aP.w * aP.w) * (0.78 + 0.22 * sin(uTime * (0.4 + aP.w) + aP.w * 97.0));
}`;
  const FIELD_FS = `#version 300 es
precision highp float; in float vI; out vec4 o;
void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = clamp(1.0 - d, 0.0, 1.0); o = vec4(vec3(0.80, 0.86, 1.0) * vI * a, 1.0); }`;

  const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUv; void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
  const DOWN_FS = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uTexel; uniform float uClampMax; in vec2 vUv; out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture(uTex, vUv + uTexel * vec2(0.5, -0.5)).rgb
         + texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture(uTex, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  o = vec4(min(c * 0.25, vec3(uClampMax)), 1.0);
}`;
  const BLUR_FS = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUv; out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += (texture(uTex, vUv + uDir * 1.3846).rgb + texture(uTex, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture(uTex, vUv + uDir * 3.2308).rgb + texture(uTex, vUv - uDir * 3.2308).rgb) * 0.070270;
  o = vec4(c, 1.0);
}`;
  const COMP_FS = `#version 300 es
precision highp float; uniform sampler2D uScene, uB1, uB2, uB3; uniform float uGlow; uniform vec3 uBg; in vec2 vUv; out vec4 o;
void main() {
  vec3 s = texture(uScene, vUv).rgb;
  vec3 b = texture(uB1, vUv).rgb * 0.50 + texture(uB2, vUv).rgb * 0.36 + texture(uB3, vUv).rgb * 0.30;
  vec3 c = uBg + s + b * uGlow;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  function create(canvas, data, opts) {
    opts = opts || {};
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    const floatOK = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');

    // ---------- data ----------
    const areas = data.areas, folders = data.folders, notes = data.notes, NN = notes.length;
    const dates = notes.map((n) => Date.parse(n.d || '') || 0);
    const valid = dates.filter((d) => d > 0);
    const dMin = valid.length ? Math.min.apply(null, valid) : 0, dMax = valid.length ? Math.max.apply(null, valid) : 1;
    const noteArea = new Int32Array(NN), noteFolder = new Int32Array(NN), noteTime = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      noteFolder[i] = notes[i].f; noteArea[i] = folders[notes[i].f].area;
      noteTime[i] = dMax > dMin ? clamp(((dates[i] || dMin) - dMin) / (dMax - dMin), 0, 1) : 0.5;
    }
    const byTime = Array.from({ length: NN }, (_, i) => i).sort((a, b) => (dates[a] - dates[b]) || (a - b)); // oldest first
    const rankOf = new Float32Array(NN); byTime.forEach((n, r) => { rankOf[n] = NN > 1 ? r / (NN - 1) : 0.5; });
    // colour and spine position both follow the order notes were written in (oldest -> newest)
    const linTime = Float32Array.from(noteTime); noteTime.set(rankOf);
    const dMed = NN ? dates[byTime[NN >> 1]] : 0, medLin = NN ? linTime[byTime[NN >> 1]] : 0.5;

    // which areas take the cerebellum / brainstem (as in the reference: body -> cerebellum, core -> stem)
    const areaCount = new Int32Array(areas.length); for (let i = 0; i < NN; i++) areaCount[noteArea[i]]++;
    let cerebArea = -1, stemArea = -1;
    areas.forEach((a, i) => {
      const share = areaCount[i] / NN;
      if (a.region === 'cerebellum' || (cerebArea < 0 && a.region == null && /body|health|fitness|wellness/i.test(a.name) && share >= 0.04 && share <= 0.3)) cerebArea = i;
      if (a.region === 'stem' || (stemArea < 0 && a.region == null && /^core|identity|foundation/i.test(a.name) && share <= 0.1)) stemArea = i;
    });

    const anat = A.buildAnatomy({
      seed: opts.seed || 20240817,
      cerebellumFrac: cerebArea >= 0 ? clamp(areaCount[cerebArea] / NN, 0.07, 0.24) : 0.13,
      stemFrac: 0.035
    });
    const N = anat.N, K = anat.KIND, pos = anat.pos;
    const rnd = A.mulberry32((opts.seed || 20240817) ^ 0x1234567);
    const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * rnd()); };

    // ---------- ownership: every particle belongs to a note ----------
    const noteOf = new Int32Array(N);
    (function assignBrain() {
      const idxAll = [], idxCereb = [], idxStem = [];
      for (let i = 0; i < anat.nBrain; i++) {
        const k = anat.kind[i];
        if (k === K.CEREBELLUM && cerebArea >= 0) idxCereb.push(i);
        else if (k === K.STEM && stemArea >= 0) idxStem.push(i);
        else idxAll.push(i);
      }
      function areaItem(ai) {
        const fMap = new Map();
        for (let i = 0; i < NN; i++) if (noteArea[i] === ai) { const f = noteFolder[i]; if (!fMap.has(f)) fMap.set(f, []); fMap.get(f).push(i); }
        const kids = Array.from(fMap.entries()).sort((a, b) => b[1].length - a[1].length)
          .map(([f, ns]) => ({ w: ns.length, children: ns.sort((a, b) => dates[a] - dates[b]).map((n) => ({ w: 1, note: n })) }));
        return { w: areaCount[ai], children: kids };
      }
      function bisect(idx, items) {
        if (!idx.length || !items.length) return;
        if (items.length === 1) {
          const it = items[0];
          if (it.children) bisect(idx, it.children); else for (let i = 0; i < idx.length; i++) noteOf[idx[i]] = it.note;
          return;
        }
        let total = 0; for (const it of items) total += it.w;
        let acc = 0, cut = 1, best = Infinity;
        for (let i = 0; i < items.length - 1; i++) { acc += items[i].w; const d = Math.abs(acc - total / 2); if (d < best) { best = d; cut = i + 1; } }
        let wA = 0; for (let i = 0; i < cut; i++) wA += items[i].w;
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < idx.length; i++) for (let c = 0; c < 3; c++) { const v = pos[idx[i] * 3 + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
        let ax = 0; if (mx[1] - mn[1] > mx[ax] - mn[ax]) ax = 1; if (mx[2] - mn[2] > mx[ax] - mn[ax]) ax = 2;
        idx.sort((a, b) => pos[a * 3 + ax] - pos[b * 3 + ax]);
        const nA = clamp(Math.round(idx.length * wA / total), 1, idx.length - 1);
        bisect(idx.slice(0, nA), items.slice(0, cut)); bisect(idx.slice(nA), items.slice(cut));
      }
      const main = [];
      areas.forEach((a, i) => { if (i !== cerebArea && i !== stemArea && areaCount[i] > 0) main.push(areaItem(i)); });
      bisect(idxAll, main);
      if (cerebArea >= 0) bisect(idxCereb, [areaItem(cerebArea)]);
      if (stemArea >= 0) bisect(idxStem, [areaItem(stemArea)]);
    })();
    (function assignBody() {
      const pick = (tl, spread) => byTime[clamp(Math.round(tl * (NN - 1) + (rnd() - 0.5) * NN * spread), 0, NN - 1)];
      let i = anat.nBrain;
      while (i < N) {
        const k = anat.kind[i];
        if (k === K.NERVE) {            // consecutive runs along a fibre share one note
          let j = i; const run = 130 + ((rnd() * 170) | 0);
          while (j < N && anat.kind[j] === K.NERVE && j - i < run) j++;
          const n = pick(anat.tl[(i + j) >> 1], 0.03);
          for (let q = i; q < j; q++) noteOf[q] = n;
          i = j;
        } else if (k === K.SPINE) {
          let j = i; while (j < N && anat.kind[j] === K.SPINE && j - i < 50) j++;
          const n = pick(anat.tl[(i + j) >> 1], 0.012);
          for (let q = i; q < j; q++) noteOf[q] = n;
          i = j;
        } else { noteOf[i] = pick(anat.tl[i], 0.03); i++; }
      }
    })();

    // per-note brain anchor (centroid of its cortex patch) — used for links, labels, focus
    const anchor = new Float32Array(NN * 3), anchorN = new Int32Array(NN);
    for (let i = 0; i < anat.nBrain; i++) { const n = noteOf[i]; anchor[n * 3] += pos[i * 3]; anchor[n * 3 + 1] += pos[i * 3 + 1]; anchor[n * 3 + 2] += pos[i * 3 + 2]; anchorN[n]++; }
    for (let n = 0; n < NN; n++) if (anchorN[n]) { anchor[n * 3] /= anchorN[n]; anchor[n * 3 + 1] /= anchorN[n]; anchor[n * 3 + 2] /= anchorN[n]; } else { anchor[n * 3 + 1] = 1.1; }

    // ---------- buffers ----------
    const aRand = new Float32Array(N * 4), aMeta = new Float32Array(N * 4), aGrow = new Float32Array(N * 4), aNote = new Float32Array(N);
    const pj = new Float32Array(N * 3);     // per-particle gaussian jitter (cluster form)
    for (let i = 0; i < N; i++) {
      aRand[i * 4] = rnd(); aRand[i * 4 + 1] = rnd(); aRand[i * 4 + 2] = rnd(); aRand[i * 4 + 3] = rnd();
      aMeta[i * 4] = anat.kind[i]; aMeta[i * 4 + 1] = anat.white[i]; aMeta[i * 4 + 2] = anat.inten[i]; aMeta[i * 4 + 3] = anat.reveal[i];
      aGrow[i * 4] = anat.origin[i * 3]; aGrow[i * 4 + 1] = anat.origin[i * 3 + 1]; aGrow[i * 4 + 2] = anat.origin[i * 3 + 2];
      aGrow[i * 4 + 3] = i < anat.nBrain ? noteTime[noteOf[i]] : anat.tl[i];
      aNote[i] = noteOf[i];
      pj[i * 3] = gauss(); pj[i * 3 + 1] = gauss(); pj[i * 3 + 2] = gauss();
    }
    const nj = new Float32Array(NN * 3); for (let i = 0; i < NN * 3; i++) nj[i] = gauss();

    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    function buf(loc, arr, size, usage) {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, usage || gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b;
    }
    buf(0, pos, 3);
    const clusArr = new Float32Array(N * 3), clusPrevArr = new Float32Array(N * 3), gdirArr = new Float32Array(N * 3);
    const bClus = buf(1, clusArr, 3, gl.DYNAMIC_DRAW), bClusPrev = buf(2, clusPrevArr, 3, gl.DYNAMIC_DRAW);
    buf(3, aRand, 4); buf(4, aMeta, 4); buf(5, aGrow, 4); buf(6, aNote, 1);
    const bGdir = buf(7, gdirArr, 3, gl.DYNAMIC_DRAW);
    buf(8, anat.size, 1);
    const galArr = new Float32Array(N * 3), galPrevArr = new Float32Array(N * 3);
    const bGal = buf(9, galArr, 3, gl.DYNAMIC_DRAW), bGalPrev = buf(10, galPrevArr, 3, gl.DYNAMIC_DRAW);

    // links
    const linkPairs = [];
    for (let i = 0; i < NN; i++) for (const j of (notes[i].l || [])) if (j > i && j < NN) linkPairs.push(i, j);
    const NL = linkPairs.length;                    // vertex count
    const lAnat = new Float32Array(NL * 3), lClus = new Float32Array(NL * 3), lClusPrev = new Float32Array(NL * 3), lNote = new Float32Array(NL), lGdir = new Float32Array(NL * 3);
    for (let v = 0; v < NL; v++) { const n = linkPairs[v]; lAnat.set(anchor.subarray(n * 3, n * 3 + 3), v * 3); lNote[v] = n; }
    const lvao = gl.createVertexArray(); gl.bindVertexArray(lvao);
    buf(0, lAnat, 3); const blClus = buf(1, lClus, 3, gl.DYNAMIC_DRAW), blClusPrev = buf(2, lClusPrev, 3, gl.DYNAMIC_DRAW);
    buf(6, lNote, 1); const blGdir = buf(7, lGdir, 3, gl.DYNAMIC_DRAW);
    const lGal = new Float32Array(NL * 3), lGalPrev = new Float32Array(NL * 3);
    const blGal = buf(9, lGal, 3, gl.DYNAMIC_DRAW), blGalPrev = buf(10, lGalPrev, 3, gl.DYNAMIC_DRAW);
    // hot links (hovered / selected note) drawn from a small dynamic index buffer
    const hotIdx = gl.createBuffer(); let hotCount = 0;
    const linkStart = new Map(); // note -> list of first-vertex indices
    for (let v = 0; v < NL; v += 2) { for (const n of [linkPairs[v], linkPairs[v + 1]]) { if (!linkStart.has(n)) linkStart.set(n, []); linkStart.get(n).push(v); } }
    gl.bindVertexArray(null);

    // galaxy form: a star per note, hub-to-star spokes, and a background starfield
    const degree = new Float32Array(NN); for (let i = 0; i < NN; i++) degree[i] = (notes[i].l || []).length;
    const sClus = new Float32Array(NN * 3), sClusPrev = new Float32Array(NN * 3), sGal = new Float32Array(NN * 3), sGalPrev = new Float32Array(NN * 3);
    const sNote = new Float32Array(NN), sGdir = new Float32Array(NN * 3), sStar = new Float32Array(NN * 2);
    for (let n = 0; n < NN; n++) { sNote[n] = n; sStar[n * 2] = 3.0 + 1.9 * Math.sqrt(Math.min(degree[n], 25)); sStar[n * 2 + 1] = rnd(); }
    const svao = gl.createVertexArray(); gl.bindVertexArray(svao);
    buf(0, anchor, 3); const bsClus = buf(1, sClus, 3, gl.DYNAMIC_DRAW), bsClusPrev = buf(2, sClusPrev, 3, gl.DYNAMIC_DRAW);
    buf(6, sNote, 1); const bsGdir = buf(7, sGdir, 3, gl.DYNAMIC_DRAW);
    const bsGal = buf(9, sGal, 3, gl.DYNAMIC_DRAW), bsGalPrev = buf(10, sGalPrev, 3, gl.DYNAMIC_DRAW); const bsStar = buf(11, sStar, 2, gl.DYNAMIC_DRAW);
    // spokes: 2 vertices per note (hub end, star end); attributes filled by layoutClusters
    const kAnat = new Float32Array(NN * 6), kClus = new Float32Array(NN * 6), kClusPrev = new Float32Array(NN * 6), kGal = new Float32Array(NN * 6), kGalPrev = new Float32Array(NN * 6);
    const kNote = new Float32Array(NN * 2), kGdir = new Float32Array(NN * 6);
    for (let n = 0; n < NN; n++) { kNote[n * 2] = n; kNote[n * 2 + 1] = n; }
    const kvao = gl.createVertexArray(); gl.bindVertexArray(kvao);
    const bkAnat = buf(0, kAnat, 3, gl.DYNAMIC_DRAW), bkClus = buf(1, kClus, 3, gl.DYNAMIC_DRAW), bkClusPrev = buf(2, kClusPrev, 3, gl.DYNAMIC_DRAW);
    buf(6, kNote, 1); const bkGdir = buf(7, kGdir, 3, gl.DYNAMIC_DRAW);
    const bkGal = buf(9, kGal, 3, gl.DYNAMIC_DRAW), bkGalPrev = buf(10, kGalPrev, 3, gl.DYNAMIC_DRAW);
    const NF = 4200, fArr = new Float32Array(NF * 4);
    for (let i = 0; i < NF; i++) {
      const u = rnd() * 2 - 1, ph = rnd() * 6.283185307, sq = Math.sqrt(1 - u * u), r = 7 + 11 * Math.pow(rnd(), 0.8);
      fArr[i * 4] = r * sq * Math.cos(ph); fArr[i * 4 + 1] = r * u; fArr[i * 4 + 2] = r * sq * Math.sin(ph); fArr[i * 4 + 3] = Math.pow(rnd(), 2.2);
    }
    const fvao = gl.createVertexArray(); gl.bindVertexArray(fvao); buf(0, fArr, 4);
    gl.bindVertexArray(null);

    const quad = gl.createVertexArray(); gl.bindVertexArray(quad);
    buf(0, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2); gl.bindVertexArray(null);

    // ---------- per-note texture: rgb = group colour, a = lit ----------
    const TW = 256, TH = Math.max(1, Math.ceil(NN / TW));
    const noteTexData = new Uint8Array(TW * TH * 2 * 4);        // second half: galaxy (group) colours
    const noteTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, noteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const litCur = new Float32Array(NN).fill(1), litTgt = new Float32Array(NN).fill(1);
    let texDirty = true, litAnimating = false, filtered = 0;

    // ---------- orrery resources ----------
    const ORBIT_R = 2.46;
    const orr = { active: [], arcsDirty: true, grow: -0.2, toLink: 0, was: false };
    const orrData = new Float32Array(TW * TH * 4), orrPrev = new Float32Array(TW * TH * 4);   // per note: bead xyz + radius
    function floatTex() {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TW, TH, 0, gl.RGBA, gl.FLOAT, orrData); return t;
    }
    const orrTex = floatTex(), orrPrevTex = floatTex();
    const upTex = (t, d) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TW, TH, 0, gl.RGBA, gl.FLOAT, d); };
    function decoVao() {
      const v = gl.createVertexArray(), b = gl.createBuffer(); gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 28);
      gl.bindVertexArray(null); return { v, b, n: 0 };
    }
    function decoData(D, arr, usage) { gl.bindBuffer(gl.ARRAY_BUFFER, D.b); gl.bufferData(gl.ARRAY_BUFFER, arr instanceof Float32Array ? arr : new Float32Array(arr), usage || gl.STATIC_DRAW); D.n = arr.length / 9; }
    const dStatic = decoVao(), dArcs = decoVao(), dHot = decoVao(), dDyn = decoVao(), dCrysL = decoVao(), dCrysT = decoVao(), dGemL = decoVao(), dGemT = decoVao();
    (function meshes() {
      const L = [], T = [];
      const rot = (q, ax, ay) => { let x = q[0], y = q[1], z = q[2]; let c = Math.cos(ay), s2 = Math.sin(ay); const x2 = x * c + z * s2; z = -x * s2 + z * c; x = x2; c = Math.cos(ax); s2 = Math.sin(ax); const y2 = y * c - z * s2; z = y * s2 + z * c; y = y2; return [x, y, z]; };
      const cube = (h, ax, ay, lc, fc) => {
        const V = []; for (let i = 0; i < 8; i++) V.push(rot([(i & 1 ? h : -h), (i & 2 ? h : -h), (i & 4 ? h : -h)], ax, ay));
        for (const e of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) L.push(V[e[0]][0], V[e[0]][1], V[e[0]][2], lc[0], lc[1], lc[2], lc[3], 0, 0, V[e[1]][0], V[e[1]][1], V[e[1]][2], lc[0], lc[1], lc[2], lc[3], 0, 0);
        for (const f of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) for (const k of [0, 1, 2, 0, 2, 3]) T.push(V[f[k]][0], V[f[k]][1], V[f[k]][2], fc[0], fc[1], fc[2], fc[3], 0, 0);
      };
      cube(0.5, 0, 0, [1, 0.8, 0.88, 0.8], [1, 0.42, 0.6, 0.085]);
      cube(0.36, 0.62, 0.78, [1, 0.62, 0.74, 0.65], [1, 0.3, 0.46, 0.11]);
      cube(0.2, 1.1, 0.3, [1, 0.5, 0.52, 0.9], [1, 0.2, 0.22, 0.34]);
      decoData(dCrysL, L); decoData(dCrysT, T);
      const GL2 = [], GT = [], top = [0, 0.66, 0], bot = [0, -0.66, 0], eq = [[0.44, 0, 0], [0, 0, 0.44], [-0.44, 0, 0], [0, 0, -0.44]];
      const tri = (a, b, c, col) => { for (const q of [a, b, c]) GT.push(q[0], q[1], q[2], col[0], col[1], col[2], col[3], 0, 0); };
      const ln = (a, b) => GL2.push(a[0], a[1], a[2], 1, 0.9, 1, 0.55, 0, 0, b[0], b[1], b[2], 1, 0.9, 1, 0.55, 0, 0);
      for (let i = 0; i < 4; i++) { const a = eq[i], b = eq[(i + 1) % 4];
        tri(top, a, b, i % 2 ? [1, 0.82, 0.95, 0.6] : [1, 0.62, 0.9, 0.45]); tri(bot, a, b, i % 2 ? [0.78, 0.3, 0.95, 0.5] : [0.6, 0.22, 0.9, 0.4]);
        ln(top, a); ln(bot, a); ln(a, b); }
      decoData(dGemL, GL2); decoData(dGemT, GT);
    })();
    const gvao = gl.createVertexArray(), gbuf = gl.createBuffer();
    gl.bindVertexArray(gvao); gl.bindBuffer(gl.ARRAY_BUFFER, gbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    gl.bindVertexArray(null);
    function model(tx, ty, tz, ry, rx, sc) {
      const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
      return new Float32Array([cy * sc, 0, -sy * sc, 0, sy * sx * sc, cx * sc, cy * sx * sc, 0, sy * cx * sc, -sx * sc, cy * cx * sc, 0, tx, ty, tz, 1]);
    }
    const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const beadOf = (n) => [orrData[n * 4], orrData[n * 4 + 1], orrData[n * 4 + 2]];
    function arc(out, A, B, col, seed, segs, vol) {     // quadratic curve bowed away from the core
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, mz = (A[2] + B[2]) / 2, len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
      let ox = mx + (seed - 0.5) * 0.3, oy = my - TARGET_Y + 0.1 + ((seed * 7.3) % 1 - 0.5) * 0.6, oz = mz + ((seed * 3.7) % 1 - 0.5) * 0.3; const ol = Math.hypot(ox, oy, oz) || 1;
      let k = (0.14 + 0.5 * len) * (0.5 + 0.95 * ((seed * 13.1) % 1));
      if (vol) {      // threads loop well above and below the plane so that together they fill a sphere
        const sg = ((seed * 29.7) % 1) < 0.5 ? -1 : 1;
        ox = mx * 0.55 + ((seed * 5.9) % 1 - 0.5) * 0.7; oy = sg * (0.55 + 1.0 * ((seed * 17.3) % 1)); oz = mz * 0.55 + ((seed * 11.3) % 1 - 0.5) * 0.7;
        k = (0.3 + 0.8 * len) * (0.4 + 1.05 * ((seed * 13.1) % 1));
      }
      const ol2 = Math.hypot(ox, oy, oz) || 1;
      const cx = mx + ox / ol2 * k, cy = my + oy / ol2 * k, cz = mz + oz / ol2 * k;
      let px = A[0], py = A[1], pz = A[2];
      for (let i = 1; i <= segs; i++) {
        const t = i / segs, u = 1 - t, x = u * u * A[0] + 2 * u * t * cx + t * t * B[0], y = u * u * A[1] + 2 * u * t * cy + t * t * B[1], z = u * u * A[2] + 2 * u * t * cz + t * t * B[2];
        out.push(px, py, pz, col[0], col[1], col[2], col[3], (i - 1) / segs, seed, x, y, z, col[0], col[1], col[2], col[3], t, seed); px = x; py = y; pz = z;
      }
    }
    function buildArcs() {      // golden threads: one curve per link, growing outward from the core
      const out = [], dc = (q) => Math.hypot(q[0], q[1] - TARGET_Y, q[2]);
      for (let v = 0; v < NL; v += 2) {
        let A = beadOf(linkPairs[v]), B = beadOf(linkPairs[v + 1]); if (dc(A) > dc(B)) { const t = A; A = B; B = t; }
        arc(out, A, B, [1.0, 0.6, 0.18, 0.14], (v * 0.61803398875) % 1, 14, true);
      }
      decoData(dArcs, out); orr.arcsDirty = false;
    }

    // ---------- programs ----------
    const pPoint = program(gl, POINT_VS, POINT_FS), pLine = program(gl, LINE_VS, LINE_FS);
    const pStar = program(gl, STAR_VS, STAR_FS), pField = program(gl, FIELD_VS, FIELD_FS);
    const pDeco = program(gl, DECO_VS, DECO_FS), pGlow = program(gl, GLOW_VS, GLOW_FS);
    const pDown = program(gl, QUAD_VS, DOWN_FS), pBlur = program(gl, QUAD_VS, BLUR_FS), pComp = program(gl, QUAD_VS, COMP_FS);

    // ---------- render targets ----------
    function target(w, h, float, depth) {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      let rb = null;
      if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { t, f, w, h, rb };
    }
    function freeTarget(T) { if (!T) return; gl.deleteTexture(T.t); gl.deleteFramebuffer(T.f); if (T.rb) gl.deleteRenderbuffer(T.rb); }
    let RT = null;
    let W = 0, H = 0, cssW = 0, cssH = 0, dpr = 1;
    function resize() {
      const r = canvas.getBoundingClientRect();
      cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
      dpr = Math.min(opts.maxDpr || 2, root.devicePixelRatio || 1);
      const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (w === W && h === H) return;
      W = w; H = h; canvas.width = W; canvas.height = H;
      if (RT) { for (const k in RT) { const v = RT[k]; if (Array.isArray(v)) v.forEach(freeTarget); else freeTarget(v); } }
      const s = (d) => [Math.max(2, Math.round(W / d)), Math.max(2, Math.round(H / d))];
      RT = {
        scene: target(W, H, floatOK),
        a: [target(...s(2), floatOK), target(...s(4), floatOK), target(...s(8), floatOK)],
        b: [target(...s(2), floatOK), target(...s(4), floatOK), target(...s(8), floatOK)],
        pick: target(...s(2), false, true)
      };
    }

    // ---------- state ----------
    const S = {
      form: 0, formTarget: 0, spread: 0, spreadTarget: 0, clusMix: 1, galaxy: 0, galaxyTarget: 0, galaxyLin: 0, orrery: 0, orreryTarget: 0, beams: 1, gemAng: 0,
      colorMode: 0, color: hexToRgb(opts.color || '#FF3B30'), colorTarget: hexToRgb(opts.color || '#FF3B30'),
      clusterBy: 'folder', showBody: 1, showNotes: 1, showLinks: 0, turning: 1, speed: 1, pointSize: 1, glow: 1,
      briBody: 1, briNotes: 1, dim: 0.05, hover: -1, sel: -1,
      yaw: 0, pitch: 0, dist: 4.92, distTarget: 4.92, yawVel: 0, pitchVel: 0, dragging: false,
      t0: performance.now(), intro: 0, introDone: false, time: 0
    };
    const oEase = () => { const f = clamp((S.orrery - 0.2) / 0.6, 0, 1); return f * f * f * (f * (f * 6 - 15) + 10); };
    const TARGET_Y = 0.10, FOV = 35 * Math.PI / 180, OMEGA = (2 * Math.PI) / 16;
    function fitDist() {
      const gx = S.galaxy, ox = oEase(), th = Math.tan(FOV / 2);
      const dh = (lerp(lerp(2.81, 3.05, gx), 5.1, ox) / 0.88) / (2 * th), dw = (lerp(lerp(1.62, 4.6, gx), 5.4, ox) / 0.86) / (2 * th * (cssW / cssH));
      return Math.max(dh, dw);
    }
    let baseDist = 4.92, zoom = 1, zoomTarget = 1;

    // ---------- groups (cluster layouts, label anchors, spread directions) ----------
    let groups = [];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function groupKey(mode) {
      const keyOf = new Int32Array(NN); const list = [];
      if (mode === 'area') { areas.forEach((a, i) => list.push({ name: a.name, color: a.color, area: i })); for (let i = 0; i < NN; i++) keyOf[i] = noteArea[i]; }
      else if (mode === 'month') {
        const m = new Map();
        byTime.slice().reverse().forEach((n) => {
          const d = new Date(dates[n] || dMin), k = d.getUTCFullYear() * 12 + d.getUTCMonth();
          if (!m.has(k)) { m.set(k, list.length); list.push({ name: months[d.getUTCMonth()] + ' ' + d.getUTCFullYear(), color: null, area: -1, t: 0 }); }
          keyOf[n] = m.get(k);
        });
      } else if (mode === 'source') {
        const m = new Map();
        for (let i = 0; i < NN; i++) { const k = notes[i].src || 'other'; if (!m.has(k)) { m.set(k, list.length); list.push({ name: (data.sources && data.sources[k]) || k, color: null, area: -1 }); } keyOf[i] = m.get(k); }
      } else {
        // folders, ordered so that an area's folders sit next to each other
        const order = folders.map((f, i) => i).sort((a, b) => (folders[a].area - folders[b].area) || (a - b));
        const remap = new Int32Array(folders.length); order.forEach((f, i) => { remap[f] = i; list.push({ name: folders[f].name, color: folders[f].color || areas[folders[f].area].color, area: folders[f].area }); });
        for (let i = 0; i < NN; i++) keyOf[i] = remap[noteFolder[i]];
      }
      return { keyOf, list };
    }
    function layoutClusters(mode, animate) {
      const { keyOf, list } = groupKey(mode);
      const G = list.length, cnt = new Int32Array(G);
      for (let i = 0; i < NN; i++) cnt[keyOf[i]]++;
      // drop empty groups from the shell
      const live = []; for (let g = 0; g < G; g++) if (cnt[g] > 0) live.push(g);
      const L = live.length, R = L <= 2 ? 0.45 : L <= 10 ? 0.78 : 0.87, RY = L <= 10 ? 1.0 : 1.38;
      const gr = A.mulberry32(977 + L * 31 + mode.length);
      live.forEach((g, i) => {
        const y = L === 1 ? 0 : 1 - 2 * (i + 0.5) / L, r = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.399963229728653 + 0.6;
        const k = 0.9 + gr() * 0.2;
        list[g].c = L === 1 ? [0, 0.05, 0] : [R * r * Math.cos(ph) * k, RY * R * y * k + 0.05, R * r * Math.sin(ph) * k];
        list[g].sigma = (0.017 + 0.0105 * Math.cbrt(cnt[g])) * (L <= 10 ? 1.5 : 1);
        list[g].count = cnt[g];
      });
      // anatomy centroid of each group's brain particles
      const ac = new Float32Array(G * 3), an = new Int32Array(G);
      for (let i = 0; i < anat.nBrain; i++) { const g = keyOf[noteOf[i]]; ac[g * 3] += pos[i * 3]; ac[g * 3 + 1] += pos[i * 3 + 1]; ac[g * 3 + 2] += pos[i * 3 + 2]; an[g]++; }
      const bc = anat.brainCentre;
      for (let g = 0; g < G; g++) {
        if (an[g]) { ac[g * 3] /= an[g]; ac[g * 3 + 1] /= an[g]; ac[g * 3 + 2] /= an[g]; }
        list[g].a = [ac[g * 3], ac[g * 3 + 1], ac[g * 3 + 2]];
        list[g].dir = [(ac[g * 3] - bc[0]) * 1.9, (ac[g * 3 + 1] - bc[1]) * 1.9 + 0.12, (ac[g * 3 + 2] - bc[2]) * 1.9];
      }
      // snapshot previous, write new
      clusPrevArr.set(clusArr); lClusPrev.set(lClus);
      const noteC = new Float32Array(NN * 3);
      for (let n = 0; n < NN; n++) {
        const g = list[keyOf[n]], s = g.sigma * 0.78;
        noteC[n * 3] = g.c[0] + nj[n * 3] * s; noteC[n * 3 + 1] = g.c[1] + nj[n * 3 + 1] * s; noteC[n * 3 + 2] = g.c[2] + nj[n * 3 + 2] * s;
      }
      for (let i = 0; i < N; i++) {
        const n = noteOf[i], g = list[keyOf[n]], ps = 0.006 + g.sigma * 0.55;
        clusArr[i * 3] = noteC[n * 3] + pj[i * 3] * ps; clusArr[i * 3 + 1] = noteC[n * 3 + 1] + pj[i * 3 + 1] * ps; clusArr[i * 3 + 2] = noteC[n * 3 + 2] + pj[i * 3 + 2] * ps;
        if (i < anat.nBrain) { gdirArr[i * 3] = g.dir[0]; gdirArr[i * 3 + 1] = g.dir[1]; gdirArr[i * 3 + 2] = g.dir[2]; }
        else { // body opens outward from the spine
          const y = pos[i * 3 + 1], dx = pos[i * 3], dz = pos[i * 3 + 2] - anat.hullC(y);
          gdirArr[i * 3] = dx * 0.75; gdirArr[i * 3 + 1] = (y - 0.2) * 0.12; gdirArr[i * 3 + 2] = dz * 0.75;
        }
      }
      for (let v = 0; v < NL; v++) { const n = linkPairs[v], g = list[keyOf[n]]; lClus[v * 3] = noteC[n * 3]; lClus[v * 3 + 1] = noteC[n * 3 + 1]; lClus[v * 3 + 2] = noteC[n * 3 + 2]; lGdir[v * 3] = g.dir[0]; lGdir[v * 3 + 1] = g.dir[1]; lGdir[v * 3 + 2] = g.dir[2]; }
      // ---- galaxy form: every group is a small spiral galaxy, every note a star in it ----
      galPrevArr.set(galArr); lGalPrev.set(lGal); sGalPrev.set(sGal); sClusPrev.set(sClus); kGalPrev.set(kGal); kClusPrev.set(kClus);
      const big = L > 24, GR = big ? [2.15, 1.2, 1.75] : [1.72, 0.96, 1.4];
      const hue = (i) => { const h = (i * 137.508 + 200) % 360, f = (x) => { const k = (x + h / 30) % 12; return 0.6 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
      const liveIdx = new Int32Array(G).fill(-1); live.forEach((g, i) => { liveIdx[g] = i; });
      const members = live.map(() => []);
      for (let n = 0; n < NN; n++) members[liveIdx[keyOf[n]]].push(n);
      const starP = new Float32Array(NN * 3), hubOf = new Int32Array(NN);
      live.forEach((g, i) => {
        const Gp = list[g];
        const y = L === 1 ? 0 : 1 - 2 * (i + 0.5) / L, r = Math.sqrt(Math.max(0, 1 - y * y)), ph = i * 2.399963229728653 + 1.9, k = L === 1 ? 0 : 0.8 + 0.2 * gr();
        const c = [GR[0] * r * Math.cos(ph) * k, GR[1] * y * k + TARGET_Y, GR[2] * r * Math.sin(ph) * k];
        const rad = Math.min(0.44, 0.11 + 0.047 * Math.cbrt(cnt[g])) * (big ? 0.6 : 1);
        let nx = gr() - 0.5, ny = 0.35 + gr() * 0.5, nz = 0.5 + gr() * 0.6; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        let ux = -nz, uz = nx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
        Gp.gc = c; Gp.gr = rad; Gp.gb = [ux, 0, uz, vx, vy, vz, nx, ny, nz];
        Gp.arms = 2 + ((gr() * 2) | 0); Gp.twist = (gr() < 0.5 ? -1 : 1) * (2.5 + gr() * 1.7);
        Gp.gcol = Gp.color ? hexToRgb(Gp.color) : hue(i);
        // the best-linked note is the hub at the core; the rest spread through the disc, well-linked ones closer in
        const m = members[i].slice().sort((a, b) => degree[b] - degree[a] || a - b);
        Gp.hub = m[0]; Gp.top = m.slice(0, 3); Gp.m = m;
        m.forEach((n, q) => {
          let rr = 0, th = 0, h = 0;
          if (q > 0) { rr = rad * (0.15 + 0.62 * Math.sqrt(q / m.length)) * (1 + 0.07 * clamp(nj[n * 3], -2, 2)); th = q * 2.399963229728653 + 0.35 * nj[n * 3 + 1]; h = nj[n * 3 + 2] * rad * 0.02; }
          const cs = Math.cos(th) * rr, sn = Math.sin(th) * rr;
          starP[n * 3] = c[0] + ux * cs + vx * sn + nx * h; starP[n * 3 + 1] = c[1] + vy * sn + ny * h; starP[n * 3 + 2] = c[2] + uz * cs + vz * sn + nz * h;
          hubOf[n] = q < 40 ? m[0] : n;          // only the best-linked stars get a spoke to the hub
        });
      });
      for (let i = 0; i < N; i++) {
        const g = list[keyOf[noteOf[i]]], b = g.gb, c = g.gc, R_ = g.gr, kd = anat.kind[i];
        const u1 = aRand[i * 4 + 1], u2 = aRand[i * 4 + 2], u3 = aRand[i * 4 + 3], g0 = pj[i * 3], g1 = pj[i * 3 + 1], g2 = pj[i * 3 + 2];
        let rr, th, h;
        if (kd === K.HAZE) { rr = R_ * 0.42 * Math.abs(g0); th = u1 * 6.283185307; h = g2 * R_ * 0.05; }                  // nebula glow round the core
        else if (u1 < 0.14) { rr = R_ * 0.19 * Math.abs(g0); th = u3 * 6.283185307; h = g2 * R_ * 0.06; }                  // bulge
        else {                                                                                                            // spiral arms
          const t = Math.pow(u2, 0.8); rr = R_ * (0.14 + 1.36 * t) * (1 + 0.04 * g0);
          th = Math.floor(u3 * g.arms) * 6.283185307 / g.arms + g.twist * Math.log(1 + 2.4 * t) + g1 * (0.09 + 0.2 * (1 - t)); h = g2 * R_ * 0.025;
        }
        const cs = Math.cos(th) * rr, sn = Math.sin(th) * rr;
        galArr[i * 3] = c[0] + b[0] * cs + b[3] * sn + b[6] * h; galArr[i * 3 + 1] = c[1] + b[4] * sn + b[7] * h; galArr[i * 3 + 2] = c[2] + b[2] * cs + b[5] * sn + b[8] * h;
      }
      for (let v = 0; v < NL; v++) { const n = linkPairs[v]; lGal[v * 3] = starP[n * 3]; lGal[v * 3 + 1] = starP[n * 3 + 1]; lGal[v * 3 + 2] = starP[n * 3 + 2]; }
      sGal.set(starP); sClus.set(noteC);
      const G0 = TW * TH * 4;
      for (let n = 0; n < NN; n++) {
        const g = list[keyOf[n]], h = hubOf[n];
        sGdir[n * 3] = g.dir[0]; sGdir[n * 3 + 1] = g.dir[1]; sGdir[n * 3 + 2] = g.dir[2];
        for (let c = 0; c < 3; c++) {
          kAnat[n * 6 + c] = anchor[h * 3 + c]; kAnat[n * 6 + 3 + c] = anchor[n * 3 + c];
          kClus[n * 6 + c] = noteC[h * 3 + c]; kClus[n * 6 + 3 + c] = noteC[n * 3 + c];
          kGal[n * 6 + c] = starP[h * 3 + c]; kGal[n * 6 + 3 + c] = starP[n * 3 + c];
          kGdir[n * 6 + c] = g.dir[c]; kGdir[n * 6 + 3 + c] = g.dir[c];
          noteTexData[G0 + n * 4 + c] = Math.round(g.gcol[c] * 255);
        }
        noteTexData[G0 + n * 4 + 3] = 255;
      }
      texDirty = true;
      if (!animate) { clusPrevArr.set(clusArr); lClusPrev.set(lClus); galPrevArr.set(galArr); lGalPrev.set(lGal); sGalPrev.set(sGal); sClusPrev.set(sClus); kGalPrev.set(kGal); kClusPrev.set(kClus); }
      const up = (b, a) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferSubData(gl.ARRAY_BUFFER, 0, a); };
      up(bGal, galArr); up(bGalPrev, galPrevArr); up(blGal, lGal); up(blGalPrev, lGalPrev);
      up(bsClus, sClus); up(bsClusPrev, sClusPrev); up(bsGdir, sGdir); up(bsGal, sGal); up(bsGalPrev, sGalPrev);
      up(bkAnat, kAnat); up(bkClus, kClus); up(bkClusPrev, kClusPrev); up(bkGdir, kGdir); up(bkGal, kGal); up(bkGalPrev, kGalPrev);
      gl.bindBuffer(gl.ARRAY_BUFFER, bClus); gl.bufferSubData(gl.ARRAY_BUFFER, 0, clusArr);
      gl.bindBuffer(gl.ARRAY_BUFFER, bClusPrev); gl.bufferSubData(gl.ARRAY_BUFFER, 0, clusPrevArr);
      gl.bindBuffer(gl.ARRAY_BUFFER, bGdir); gl.bufferSubData(gl.ARRAY_BUFFER, 0, gdirArr);
      gl.bindBuffer(gl.ARRAY_BUFFER, blClus); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lClus);
      gl.bindBuffer(gl.ARRAY_BUFFER, blClusPrev); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lClusPrev);
      gl.bindBuffer(gl.ARRAY_BUFFER, blGdir); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lGdir);
      // ---- orrery form: groups are planets on rings round a crystal core; each note is a bead ----
      orrPrev.set(orrData);
      const C0 = [0, TARGET_Y, 0], nRing = L <= 12 ? L : Math.min(11, Math.ceil(L / 9)), perRing = Math.ceil(L / nRing), sm = L > 24 ? 0.55 : 1;
      const rIncl = [], rOm = [], rPh = [];
      for (let k = 0; k < nRing; k++) { rIncl.push((gr() - 0.5) * 0.24); rOm.push(gr() * 6.283185307); rPh.push(gr() * 6.283185307); }
      const ringRad = (k) => 0.62 + 1.2 * (nRing > 1 ? k / (nRing - 1) : 0.5);
      const ringPt = (k, th, rad) => {
        const ci = Math.cos(rIncl[k]), si = Math.sin(rIncl[k]), co = Math.cos(rOm[k]), so = Math.sin(rOm[k]), c = Math.cos(th) * rad, s2 = Math.sin(th) * rad;
        return [C0[0] + c * co - s2 * so * ci, C0[1] + s2 * si, C0[2] + c * so + s2 * co * ci];
      };
      const D = [];
      const seg = (a, b, col) => { D.push(a[0], a[1], a[2], col[0], col[1], col[2], col[3], 0, 0, b[0], b[1], b[2], col[0], col[1], col[2], col[3], 0, 0); };
      const circle = (fn, n, col, dash) => { let prev = fn(0); for (let i = 1; i <= n; i++) { const cur = fn(i / n * 6.283185307); if (!dash || (i % dash[0]) < dash[1]) seg(prev, cur, col); prev = cur; } };
      const RING = [0.45, 0.5, 0.78, 0.36], CAGE = [0.42, 0.47, 0.74, 0.22], MINI = [0.55, 0.58, 0.86, 0.32];
      for (let k = 0; k < nRing; k++) circle((t) => ringPt(k, t, ringRad(k)), 200, RING, (k % 3 === 2) ? [3, 2] : null);
      [[0, 0], [1.05, 0.3], [1.05, 2.4], [1.5708, 1.2], [0.55, 4.1]].forEach((q, i) => {     // celestial cage
        const ci = Math.cos(q[0]), si = Math.sin(q[0]), co = Math.cos(q[1]), so = Math.sin(q[1]), RC = 2.14;
        circle((t) => { const c = Math.cos(t) * RC, s2 = Math.sin(t) * RC; return [C0[0] + c * co - s2 * so * ci, C0[1] + s2 * si, C0[2] + c * so + s2 * co * ci]; }, 240, CAGE, i === 4 ? [2, 1] : null);
      });
      circle((t) => [C0[0] + Math.cos(t) * ORBIT_R, C0[1], C0[2] + Math.sin(t) * ORBIT_R], 240, [0.62, 0.66, 0.92, 0.5], [8, 5]);   // the gem's dashed orbit
      const byCount = live.map((g, i) => i).sort((a, b) => cnt[live[a]] - cnt[live[b]] || a - b);       // smallest on the inner rings
      byCount.forEach((li, oi) => {
        const Gp = list[live[li]], m = Gp.m, M = m.length;
        const k = L <= 12 ? oi : oi % nRing, slot = L <= 12 ? 0 : Math.floor(oi / nRing);
        const th = rPh[k] + (L <= 12 ? oi * 2.399963229728653 : slot / perRing * 6.283185307);
        const c = ringPt(k, th, ringRad(k)), rho = clamp(0.036 + 0.021 * Math.cbrt(M), 0.05, 0.19) * sm;
        Gp.oc = c; Gp.orad = rho;
        if (M >= 40) {                        // a "berry": beads spread over a sphere
          const br = clamp(rho * 1.9 / Math.sqrt(M), 0.0062, 0.016);
          m.forEach((n, q) => {
            const y = 1 - 2 * (q + 0.5) / M, r = Math.sqrt(Math.max(0, 1 - y * y)), ph = q * 2.399963229728653, sh = (M > 200 && q % 3 === 2) ? 0.6 : 1;
            orrData[n * 4] = c[0] + r * Math.cos(ph) * rho * sh; orrData[n * 4 + 1] = c[1] + y * rho * sh; orrData[n * 4 + 2] = c[2] + r * Math.sin(ph) * rho * sh; orrData[n * 4 + 3] = br * (q === 0 ? 1.6 : 1);
          });
        } else {                              // a hub with moons on small orbits
          let ux = gr() - 0.5, uy = (gr() - 0.5) * 0.6, uz = gr() - 0.5, l2 = Math.hypot(ux, uy, uz) || 1; ux /= l2; uy /= l2; uz /= l2;
          let vx = -uz, vy = 0.35, vz = ux; const d2 = vx * ux + vy * uy + vz * uz; vx -= d2 * ux; vy -= d2 * uy; vz -= d2 * uz; l2 = Math.hypot(vx, vy, vz) || 1; vx /= l2; vy /= l2; vz /= l2;
          const per = 10, rings = Math.max(1, Math.ceil((M - 1) / per));
          m.forEach((n, q) => {
            let x = c[0], y = c[1], z = c[2], br = 0.017 * sm + 0.004;
            if (q > 0) {
              const j = Math.floor((q - 1) / per), inRing = Math.min(per, M - 1 - j * per), a = ((q - 1) % per) / inRing * 6.283185307 + j * 0.7, rd = rho * (0.55 + 0.42 * j);
              x += rd * (Math.cos(a) * ux + Math.sin(a) * vx); y += rd * (Math.cos(a) * uy + Math.sin(a) * vy); z += rd * (Math.cos(a) * uz + Math.sin(a) * vz); br = 0.0105 * (sm < 1 ? 0.8 : 1);
            }
            orrData[n * 4] = x; orrData[n * 4 + 1] = y; orrData[n * 4 + 2] = z; orrData[n * 4 + 3] = br;
          });
          for (let j = 0; j < rings && M > 1; j++) { const rd = rho * (0.55 + 0.42 * j); circle((t) => [c[0] + rd * (Math.cos(t) * ux + Math.sin(t) * vx), c[1] + rd * (Math.cos(t) * uy + Math.sin(t) * vy), c[2] + rd * (Math.cos(t) * uz + Math.sin(t) * vz)], 48, MINI, null); }
        }
        let un = 0; for (const n of m) if (degree[n] === 0) un++;
        Gp.stats = { notes: M, links: 0, toLink: un };
      });
      for (let v = 0; v < NL; v += 2) { const a = keyOf[linkPairs[v]], b = keyOf[linkPairs[v + 1]]; if (a !== b) { list[a].stats.links++; list[b].stats.links++; } }
      // the three groups with the most recent activity get a beam and a fan of their newest notes
      const recentCut = dMax - 21 * 864e5, rc = new Int32Array(G);
      for (let n = 0; n < NN; n++) if (dates[n] >= recentCut) rc[keyOf[n]]++;
      orr.active = live.slice().sort((a, b) => rc[b] - rc[a] || cnt[b] - cnt[a]).slice(0, Math.min(3, L)).map((g) => list[g]);
      orr.active.forEach((Gp) => {
        Gp.m.slice().sort((a, b) => dates[b] - dates[a]).slice(0, 26).forEach((n) => seg(Gp.oc, beadOf(n), [1, 0.2, 0.2, 0.36]));
      });
      if (!animate) orrPrev.set(orrData);
      upTex(orrTex, orrData); upTex(orrPrevTex, orrPrev);
      decoData(dStatic, D); orr.arcsDirty = true; orr.toLink = 0; for (let n = 0; n < NN; n++) if (degree[n] === 0) orr.toLink++;
      S.clusMix = animate ? 0 : 1;
      groups = list.filter((g) => g.count > 0); groups.keyOf = keyOf; groups.noteC = noteC; groups.starP = starP;
    }

    // folder colours: shades around the area colour
    (function folderColours() {
      const per = new Map();
      folders.forEach((f, i) => { if (!per.has(f.area)) per.set(f.area, []); per.get(f.area).push(i); });
      per.forEach((list, ai) => {
        const base = hexToRgb(areas[ai].color);
        list.forEach((fi, k) => {
          const t = list.length > 1 ? k / (list.length - 1) : 0.5, m = 0.72 + 0.5 * t, w = 0.28 * (1 - t);
          const c = base.map((v) => clamp(v * m + w * (1 - v) * 0.9, 0, 1));
          folders[fi].color = '#' + c.map((v) => ('0' + Math.round(v * 255).toString(16)).slice(-2)).join('');
        });
      });
    })();
    function writeNoteColours() {
      for (let n = 0; n < NN; n++) {
        const c = hexToRgb(S.colorMode === 2 ? folders[noteFolder[n]].color : areas[noteArea[n]].color);
        noteTexData[n * 4] = c[0] * 255; noteTexData[n * 4 + 1] = c[1] * 255; noteTexData[n * 4 + 2] = c[2] * 255;
      }
      texDirty = true;
    }
    writeNoteColours();
    layoutClusters('folder', false);

    // ---------- camera ----------
    let VP = new Float32Array(16), eye = [0, 0, 5];
    function updateCamera() {
      const pitch = clamp(S.pitch + 0.34 * oEase(), -1.25, 1.25);      // the orrery is seen from a little above its plane
      const d = baseDist * zoom, cp = Math.cos(pitch), sp = Math.sin(pitch);
      eye = [Math.sin(S.yaw) * cp * d, TARGET_Y + sp * d, Math.cos(S.yaw) * cp * d];
      const V = lookAt(eye, [0, TARGET_Y, 0], [0, 1, 0]);
      VP = mul(perspective(FOV, W / H, 0.1, 60), V);
    }
    function project(p) {
      const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13],
        w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
      return { x: (x / w * 0.5 + 0.5) * cssW, y: (1 - (y / w * 0.5 + 0.5)) * cssH, w };
    }
    function formPos(anatP, clusP, dir) {      // CPU mirror of morph() without turbulence
      const f = clamp((S.form - 0.125) / 0.75, 0, 1), e = f * f * f * (f * (f * 6 - 15) + 10), sp = S.spread;
      return [lerp(anatP[0] + dir[0] * sp, clusP[0] * (1 + sp * 0.85), e), lerp(anatP[1] + dir[1] * sp, clusP[1] * (1 + sp * 0.85), e), lerp(anatP[2] + dir[2] * sp, clusP[2] * (1 + sp * 0.85), e)];
    }

    // ---------- draw ----------
    function setCommon(P) {
      gl.uniformMatrix4fv(P.u.uVP, false, VP);
      gl.uniform1f(P.u.uForm, S.form); gl.uniform1f(P.u.uSpread, S.spread); gl.uniform1f(P.u.uClusMix, S.clusMix); gl.uniform1f(P.u.uIntro, S.intro);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, noteTex); gl.uniform1i(P.u.uNoteTex, 0); gl.uniform1i(P.u.uTexW, TW);
      gl.uniform1i(P.u.uColorMode, S.colorMode); gl.uniform3fv(P.u.uColor, S.color);
      gl.uniform1f(P.u.uDim, S.dim); gl.uniform1f(P.u.uShowNotes, S.showNotes);
      gl.uniform1f(P.u.uGalaxy, S.galaxy); gl.uniform1i(P.u.uTexH, TH); gl.uniform1f(P.u.uOrrery, S.orrery);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, orrTex); gl.uniform1i(P.u.uOrrTex, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, orrPrevTex); gl.uniform1i(P.u.uOrrPrev, 2);
      gl.activeTexture(gl.TEXTURE0);
    }
    function setPoint(pick) {
      const P = pPoint; gl.useProgram(P.p); setCommon(P);
      gl.uniform1i(P.u.uPick, pick ? 1 : 0);
      gl.uniform1f(P.u.uTime, S.time);
      gl.uniform1f(P.u.uPx, 1.9 * dpr * Math.pow(cssH / 810, 0.85) * (pick ? 0.5 : 1));
      gl.uniform1f(P.u.uPointSize, S.pointSize); gl.uniform1f(P.u.uRefDist, baseDist);
      gl.uniform1f(P.u.uShowBody, S.showBody); gl.uniform1f(P.u.uBriBody, S.briBody); gl.uniform1f(P.u.uBriNotes, S.briNotes);
      gl.uniform1f(P.u.uHover, S.hover); gl.uniform1f(P.u.uSel, S.sel); gl.uniform1f(P.u.uFiltered, filtered);
    }
    function setStar(pick) {
      const P = pStar; gl.useProgram(P.p); setCommon(P);
      gl.uniform1i(P.u.uPick, pick ? 1 : 0); gl.uniform1f(P.u.uTime, S.time);
      gl.uniform1f(P.u.uPx, 1.9 * dpr * Math.pow(cssH / 810, 0.85) * (pick ? 0.5 : 1));
      gl.uniform1f(P.u.uPointSize, S.pointSize); gl.uniform1f(P.u.uRefDist, baseDist);
      gl.uniform1f(P.u.uHover, S.hover); gl.uniform1f(P.u.uSel, S.sel);
      gl.uniform1f(P.u.uPxPerUnit, (pick ? 0.5 : 1) * H / (2 * Math.tan(FOV / 2)));
    }
    function drawOrrery(oe, dt) {
      const ppu = H / (2 * Math.tan(FOV / 2));
      // the companion gem keeps to the near side of its dashed orbit
      let da = S.yaw - S.gemAng; da = Math.atan2(Math.sin(da), Math.cos(da)); S.gemAng += da * (1 - Math.exp(-dt * 2.2));
      const ga = S.gemAng, gem = [Math.sin(ga) * ORBIT_R, TARGET_Y, Math.cos(ga) * ORBIT_R];
      const P = pDeco; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u.uVP, false, VP); gl.uniformMatrix4fv(P.u.uModel, false, IDENT);
      gl.uniform1f(P.u.uTime, S.time); gl.uniform1f(P.u.uGrow, 9); gl.uniform1f(P.u.uFlow, 0); gl.uniform1f(P.u.uAlpha, oe * S.clusMix);
      gl.bindVertexArray(dStatic.v); gl.drawArrays(gl.LINES, 0, dStatic.n);
      // every link as a golden thread, growing out from the core
      orr.grow += clamp((S.showLinks ? 1.25 : -0.25) - orr.grow, -dt / 1.3, dt / 2.6);
      if (orr.grow > -0.2 && NL && S.clusMix >= 1) {
        if (orr.arcsDirty) buildArcs();
        gl.uniform1f(P.u.uGrow, orr.grow); gl.uniform1f(P.u.uFlow, 1); gl.uniform1f(P.u.uAlpha, oe);
        gl.bindVertexArray(dArcs.v); gl.drawArrays(gl.LINES, 0, dArcs.n);
        gl.uniform1f(P.u.uGrow, 9); gl.uniform1f(P.u.uFlow, 0);
      }
      if (dHot.n) { gl.uniform1f(P.u.uAlpha, oe); gl.bindVertexArray(dHot.v); gl.drawArrays(gl.LINES, 0, dHot.n); }
      if (S.beams && orr.active.length) {          // beams: camera-facing ribbons from the gem to the active planets
        const B = [], w = 0.0105 * Math.max(1, zoom * 0.9), c = [1, 0.15, 0.13, 0.95];
        for (const Gp of orr.active) {
          const A = gem, T = Gp.oc, dx = T[0] - A[0], dy = T[1] - A[1], dz = T[2] - A[2], ex = eye[0] - A[0], ey = eye[1] - A[1], ez = eye[2] - A[2];
          let sx = dy * ez - dz * ey, sy = dz * ex - dx * ez, sz = dx * ey - dy * ex; const sl = Math.hypot(sx, sy, sz) || 1; sx *= w / sl; sy *= w / sl; sz *= w / sl;
          const q = (pt, sg, t) => B.push(pt[0] + sx * sg, pt[1] + sy * sg, pt[2] + sz * sg, c[0], c[1], c[2], c[3], t, 0);
          q(A, -1, 0); q(A, 1, 0); q(T, 1, 1); q(A, -1, 0); q(T, 1, 1); q(T, -1, 1);
        }
        decoData(dDyn, B, gl.DYNAMIC_DRAW); gl.uniform1f(P.u.uAlpha, oe * S.clusMix * (0.84 + 0.16 * Math.sin(S.time * 2.3)));
        gl.bindVertexArray(dDyn.v); gl.drawArrays(gl.TRIANGLES, 0, dDyn.n);
      }
      gl.uniform1f(P.u.uAlpha, oe);
      gl.uniformMatrix4fv(P.u.uModel, false, model(0, TARGET_Y, 0, S.time * 0.35, 0.55 + 0.12 * Math.sin(S.time * 0.5), 0.2));
      gl.bindVertexArray(dCrysT.v); gl.drawArrays(gl.TRIANGLES, 0, dCrysT.n); gl.bindVertexArray(dCrysL.v); gl.drawArrays(gl.LINES, 0, dCrysL.n);
      gl.uniformMatrix4fv(P.u.uModel, false, model(gem[0], gem[1] + 0.012 * Math.sin(S.time * 1.3), gem[2], S.time * 0.8, 0, 0.085));
      gl.bindVertexArray(dGemT.v); gl.drawArrays(gl.TRIANGLES, 0, dGemT.n); gl.bindVertexArray(dGemL.v); gl.drawArrays(gl.LINES, 0, dGemL.n);
      // glows, a moon, and the gem's comet trail
      const Gs = [], gp = (pt, col, sz) => Gs.push(pt[0], pt[1], pt[2], col[0], col[1], col[2], col[3], sz);
      gp([0, TARGET_Y, 0], [1, 0.35, 0.55, 0.5], 0.62); gp([0, TARGET_Y, 0], [1, 0.75, 0.85, 0.65], 0.2);
      gp(gem, [0.72, 0.3, 1.0, 0.8], 0.46); gp(gem, [1, 0.62, 0.95, 0.9], 0.2);
      const ma = S.time * 0.16; gp([Math.cos(ma) * 0.42, TARGET_Y - 0.05, Math.sin(ma) * 0.42], [0.85, 0.86, 0.92, 0.7], 0.14);
      for (let i = 0; i < 26; i++) {
        const a = ga + 0.07 + i * 0.021 + 0.004 * Math.sin(i * 12.9), rr = ORBIT_R + 0.035 * Math.sin(i * 7.7) + 0.02 * Math.sin(S.time * 0.9 + i);
        gp([Math.sin(a) * rr, TARGET_Y + 0.03 * Math.sin(i * 3.1) + i * 0.0035, Math.cos(a) * rr], [0.92, 0.92, 1, 0.85 - i * 0.02], 0.03 - i * 0.0004);
      }
      const Q = pGlow; gl.useProgram(Q.p); gl.uniformMatrix4fv(Q.u.uVP, false, VP); gl.uniform1f(Q.u.uPxPerUnit, ppu); gl.uniform1f(Q.u.uAlpha, oe);
      gl.bindVertexArray(gvao); gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Gs), gl.DYNAMIC_DRAW); gl.drawArrays(gl.POINTS, 0, Gs.length / 8);
    }
    const gEase = () => { const f = clamp((S.galaxy - 0.19) / 0.62, 0, 1); return f * f * f * (f * (f * 6 - 15) + 10); };
    function blit(P, src, dst, set) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.f : null); gl.viewport(0, 0, dst ? dst.w : W, dst ? dst.h : H);
      gl.useProgram(P.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(P.u.uTex, 0);
      if (set) set(P); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function uploadTex() {
      for (let n = 0; n < NN; n++) noteTexData[n * 4 + 3] = Math.round(litCur[n] * 255);
      gl.bindTexture(gl.TEXTURE_2D, noteTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TW, TH * 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, noteTexData);
      texDirty = false;
    }
    const listeners = { frame: [], hover: [], click: [] };
    let last = performance.now(), manualTime = null;
    function frame(now) {
      if (manualTime != null) now = manualTime;
      let dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (manualTime != null) dt = manualStep;
      resize();
      S.time += dt; S.intro = S.introDone ? 99 : S.intro + dt; if (S.intro > 3.4) S.introDone = true;
      // smoothing
      const kf = 1 - Math.exp(-dt * 14);
      S.form += (S.formTarget - S.form) * kf; S.spread += (S.spreadTarget - S.spread) * kf;
      S.galaxy += clamp(S.galaxyTarget - S.galaxy, -dt / 2.6, dt / 2.6);
      S.orrery += clamp(S.orreryTarget - S.orrery, -dt / 2.8, dt / 2.8);
      if ((S.orrery > 0.5) !== orr.was) { orr.was = S.orrery > 0.5; setHot(); }
      if (S.clusMix < 1) S.clusMix = Math.min(1, S.clusMix + dt / 0.9);
      for (let c = 0; c < 3; c++) S.color[c] += (S.colorTarget[c] - S.color[c]) * (1 - Math.exp(-dt * 16));
      zoom += (zoomTarget - zoom) * (1 - Math.exp(-dt * 10));
      baseDist = fitDist();
      if (!S.dragging) {
        const turn = S.turning ? OMEGA * S.speed * clamp((S.intro - 1.0) / 0.35, 0, 1) : 0;
        S.yaw += (turn + S.yawVel) * dt; S.pitch = clamp(S.pitch + S.pitchVel * dt, -1.25, 1.25);
        S.yawVel *= Math.exp(-dt * 3.5); S.pitchVel *= Math.exp(-dt * 3.5);
      }
      if (litAnimating) {
        let moving = false; const k = 1 - Math.exp(-dt * 11);
        for (let n = 0; n < NN; n++) { const d = litTgt[n] - litCur[n]; if (Math.abs(d) > 0.004) { litCur[n] += d * k; moving = true; } else litCur[n] = litTgt[n]; }
        litAnimating = moving; texDirty = true;
      }
      if (texDirty) uploadTex();
      updateCamera();

      // scene
      gl.bindFramebuffer(gl.FRAMEBUFFER, RT.scene.f); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const gx = gEase();
      const oe = oEase();
      if (S.galaxy > 0.01 || S.orrery > 0.01) {      // starfield behind everything
        gl.useProgram(pField.p); gl.uniformMatrix4fv(pField.u.uVP, false, VP);
        gl.uniform1f(pField.u.uPx, 1.7 * dpr * Math.pow(cssH / 810, 0.85)); gl.uniform1f(pField.u.uVis, 0.95 * Math.max(S.galaxy, 0.6 * S.orrery)); gl.uniform1f(pField.u.uTime, S.time);
        gl.bindVertexArray(fvao); gl.drawArrays(gl.POINTS, 0, NF);
      }
      setPoint(false); gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, N);
      const linkA = Math.max(S.showLinks ? 0.055 : 0, 0.032 * gx) * (1 - oe);
      if (linkA > 0 || hotCount || gx > 0) {
        const P = pLine; gl.useProgram(P.p); setCommon(P);
        if (gx > 0) { gl.bindVertexArray(kvao); gl.uniform1f(P.u.uAlpha, 0.16 * gx * (1 - oe)); gl.uniform1f(P.u.uHot, 0); gl.drawArrays(gl.LINES, 0, NN * 2); }
        gl.bindVertexArray(lvao);
        if (NL && linkA > 0) { gl.uniform1f(P.u.uAlpha, linkA); gl.uniform1f(P.u.uHot, 0); gl.drawArrays(gl.LINES, 0, NL); }
        if (hotCount && oe < 0.5) { gl.uniform1f(P.u.uAlpha, 0.5 * (1 - 2 * oe)); gl.uniform1f(P.u.uHot, 1); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hotIdx); gl.drawElements(gl.LINES, hotCount, gl.UNSIGNED_INT, 0); }
      }
      if (oe > 0.001) drawOrrery(oe, dt);
      if (S.galaxy > 0.01 || S.orrery > 0.01) { setStar(false); gl.bindVertexArray(svao); gl.drawArrays(gl.POINTS, 0, NN); }
      gl.disable(gl.BLEND); gl.bindVertexArray(quad);
      // bloom
      let src = RT.scene;
      for (let i = 0; i < 3; i++) {
        blit(pDown, src, RT.a[i], (P) => { gl.uniform2f(P.u.uTexel, 1 / src.w, 1 / src.h); gl.uniform1f(P.u.uClampMax, 1.6); });
        blit(pBlur, RT.a[i], RT.b[i], (P) => gl.uniform2f(P.u.uDir, 1 / RT.a[i].w, 0));
        blit(pBlur, RT.b[i], RT.a[i], (P) => gl.uniform2f(P.u.uDir, 0, 1 / RT.a[i].h));
        src = RT.a[i];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(pComp.p);
      [RT.scene, RT.a[0], RT.a[1], RT.a[2]].forEach((T, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, T.t); });
      gl.uniform1i(pComp.u.uScene, 0); gl.uniform1i(pComp.u.uB1, 1); gl.uniform1i(pComp.u.uB2, 2); gl.uniform1i(pComp.u.uB3, 3);
      gl.uniform1f(pComp.u.uGlow, S.glow * 0.24); gl.uniform3f(pComp.u.uBg, 0.004, 0.0035, 0.009);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      for (const f of listeners.frame) f(S);
      if (manualTime == null) raf = requestAnimationFrame(frame);
    }
    let raf = 0, manualStep = 1 / 60;

    // ---------- picking ----------
    const pickBuf = new Uint8Array(17 * 17 * 4);
    function pick(cx, cy) {
      if (!RT) return -1;
      const T = RT.pick, px = Math.round(cx / cssW * T.w), py = Math.round((1 - cy / cssH) * T.h), R = 8;
      const x0 = clamp(px - R, 0, T.w - 1), y0 = clamp(py - R, 0, T.h - 1), w = Math.min(2 * R + 1, T.w - x0), h = Math.min(2 * R + 1, T.h - y0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.f); gl.viewport(0, 0, T.w, T.h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
      setPoint(true); gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, N);
      if (S.galaxy > 0.5 || S.orrery > 0.5) { setStar(true); gl.bindVertexArray(svao); gl.drawArrays(gl.POINTS, 0, NN); }
      gl.bindVertexArray(null);
      gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pickBuf);
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      let best = -1, bd = 1e9;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, id = pickBuf[o] | (pickBuf[o + 1] << 8) | (pickBuf[o + 2] << 16);
        if (!id) continue;
        const d = (x + x0 - px) * (x + x0 - px) + (y + y0 - py) * (y + y0 - py);
        if (d < bd) { bd = d; best = id - 1; }
      }
      return bd <= 36 ? best : -1;
    }
    function setHot() {
      const ids = [];
      for (const n of [S.hover, S.sel]) if (n >= 0 && linkStart.has(n)) for (const v of linkStart.get(n)) ids.push(v, v + 1);
      hotCount = ids.length;
      const arcs = [];                       // in the orrery a note's links are drawn as bright curved arcs
      if (S.orrery > 0.5) for (const n of [S.hover, S.sel]) if (n >= 0) (notes[n].l || []).forEach((j, i) => { if (j < NN) arc(arcs, beadOf(n), beadOf(j), [0.87, 0.85, 1.0, 0.8], (n * 0.37 + i * 0.618) % 1, 18); });
      decoData(dHot, arcs, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(lvao); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hotIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(ids), gl.DYNAMIC_DRAW); gl.bindVertexArray(null);
    }

    // ---------- pointer / camera input ----------
    const pointers = new Map(); let moved = 0, pinch0 = 0, zoom0 = 1, hoverQueued = null;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0; S.dragging = true; S.yawVel = S.pitchVel = 0;
      if (pointers.size === 2) { const p = Array.from(pointers.values()); pinch0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); zoom0 = zoomTarget; }
    });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const p = pointers.get(e.pointerId);
      if (p) {
        const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
        if (pointers.size === 1) {
          const k = 2.6 / cssH; S.yaw -= dx * k; S.pitch = clamp(S.pitch + dy * k, -1.25, 1.25);
          S.yawVel = -dx * k * 30; S.pitchVel = dy * k * 30;
        } else if (pointers.size === 2) {
          const q = Array.from(pointers.values()), d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
          if (pinch0 > 0) zoomTarget = clamp(zoom0 * pinch0 / d, 0.25, 2.6);
        }
        if (moved > 4 && S.hover >= 0) { S.hover = -1; setHot(); for (const f of listeners.hover) f(-1, x, y); }
        return;
      }
      if (e.pointerType === 'touch') return;
      hoverQueued = { x, y };
    });
    const endPtr = (e) => {
      const had = pointers.has(e.pointerId); pointers.delete(e.pointerId);
      if (pointers.size === 0) S.dragging = false;
      if (had && moved < 5 && e.type === 'pointerup') {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const id = pick(x, y); for (const f of listeners.click) f(id, x, y);
      }
    };
    canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
    canvas.addEventListener('pointerleave', () => { hoverQueued = null; if (S.hover >= 0) { S.hover = -1; setHot(); for (const f of listeners.hover) f(-1, 0, 0); } });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomTarget = clamp(zoomTarget * Math.exp(e.deltaY * 0.0012), 0.25, 2.6); }, { passive: false });
    canvas.addEventListener('dblclick', () => { zoomTarget = 1; S.pitchVel = 0; S.pitch = 0; });
    listeners.frame.push(() => {
      if (!hoverQueued || S.dragging) return;
      const { x, y } = hoverQueued; hoverQueued = null;
      const id = pick(x, y);
      if (id !== S.hover) { S.hover = id; setHot(); }
      for (const f of listeners.hover) f(id, x, y);
    });

    // ---------- public API ----------
    const api = {
      gl, state: S, anatomy: anat, noteOf, noteArea, noteFolder, noteTime, dates, dMin, dMax, dMed, medLin, particleCount: N, linkCount: NL / 2,
      on(ev, fn) { listeners[ev].push(fn); return api; },
      set(k, v) {
        if (k === 'form') S.formTarget = clamp(v, 0, 1); else if (k === 'spread') S.spreadTarget = clamp(v, 0, 1);
        else if (k === 'galaxy') S.galaxyTarget = v ? 1 : 0;
        else if (k === 'orrery') S.orreryTarget = v ? 1 : 0;
        else S[k] = v;
      },
      setColor(hex) { S.colorTarget = hexToRgb(hex); },
      setColorMode(m) { S.colorMode = { one: 0, area: 1, folder: 2, time: 3 }[m] || 0; writeNoteColours(); },
      setClusterBy(m) { S.clusterBy = m; layoutClusters(m, true); },
      setLit(fn) {            // fn(noteIndex) -> boolean ; null = everything
        let any = false;
        for (let n = 0; n < NN; n++) { const v = !fn || fn(n) ? 1 : 0; litTgt[n] = v; if (!v) any = true; }
        filtered = any ? 1 : 0; litAnimating = true;
      },
      setSelected(n) { S.sel = n == null ? -1 : n; setHot(); },
      setHover(n) { S.hover = n == null ? -1 : n; setHot(); },
      groups() { return groups; },
      groupScreen(g) {
        let p = formPos(g.a, g.c, g.dir); const t = gEase(), o = oEase();
        if (t > 0 && g.gc) p = [lerp(p[0], g.gc[0], t), lerp(p[1], g.gc[1] + g.gr * 0.9 + 0.05, t), lerp(p[2], g.gc[2], t)];
        if (o > 0 && g.oc) p = [lerp(p[0], g.oc[0], o), lerp(p[1], g.oc[1] + g.orad + 0.045, o), lerp(p[2], g.oc[2], o)];
        return project(p);
      },
      starScreen(n) {
        const t = gEase(), o = oEase(), sp = groups.starP, nc = groups.noteC;
        if (o > 0.5) return project(beadOf(n));
        const p = formPos([anchor[n * 3], anchor[n * 3 + 1], anchor[n * 3 + 2]], [nc[n * 3], nc[n * 3 + 1], nc[n * 3 + 2]], [0, 0, 0]);
        return project([lerp(p[0], sp[n * 3], t), lerp(p[1], sp[n * 3 + 1], t), lerp(p[2], sp[n * 3 + 2], t)]);
      },
      galaxyEase: gEase, orreryEase: oEase,
      zoomLevel() { return zoom >= 0.85 ? 'FAR' : zoom < 0.45 ? 'CLOSE' : 'MID'; },
      orreryInfo() { return { toLink: orr.toLink, active: orr.active.map((g) => g.name) }; },
      project,
      resetView() { zoomTarget = 1; S.pitch = 0; },
      replayIntro() { S.intro = 0; S.introDone = false; S.yaw = 0; },
      pick,
      // deterministic stepping for tests / captures
      manual(step) { manualStep = step || 1 / 60; if (manualTime == null) { cancelAnimationFrame(raf); manualTime = performance.now(); } },
      step(n) { for (let i = 0; i < (n || 1); i++) { manualTime += manualStep * 1000; frame(manualTime); } },
      destroy() { cancelAnimationFrame(raf); }
    };
    resize(); baseDist = fitDist();
    raf = requestAnimationFrame((t) => { last = t; frame(t); });
    return api;
  }

  root.BrainEngine = { create, hexToRgb };
})(typeof window !== 'undefined' ? window : globalThis);
