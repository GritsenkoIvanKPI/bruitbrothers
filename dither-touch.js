/*!
 * dither-touch.js
 * Touch-device version of dither-hover.js.
 * Each image/video gets its own small WebGL canvas inside its own box, so it always scrolls
 * with the page (no shared full-screen overlay to keep in sync on mobile browsers).
 *  - enter animation: coarse pixels resolve into the fine dither when the image appears
 *  - idle: slow, subtle shimmer of the dither threshold
 *  - touch: tap / drag leaves a fading trail of larger pixels (the finger version of the cursor trail)
 * Only images on or near the screen hold a WebGL context.
 */

const MAX_POINTS = 24;       // remembered touch points per image
const TRAIL_LIFE = 1.4;      // s
const ENTER = 1.4;           // s
const ENTER_PIXEL = 18;      // starting pixel size (device px)
const DPR = Math.min(window.devicePixelRatio || 1, 2);

const VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 scale, offset, res;
uniform vec3 dark, light;
uniform float pixel, bias, time, now, aspect;
uniform vec4 pts[${MAX_POINTS}];
float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
float b8(vec2 a){ return b4(0.5 * a) * 0.25 + b2(a); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 st = vec2(uv.x, 1.0 - uv.y);                 // 0..1, top-left origin
  float trail = 0.0;
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    vec4 q = pts[i];
    float age = now - q.z;
    if (q.z > 0.0 && age < ${TRAIL_LIFE.toFixed(2)}) {
      vec2 d = (st - q.xy) * vec2(aspect, 1.0);
      float r = 0.035 + q.w * 0.03;
      float life = 1.0 - age / ${TRAIL_LIFE.toFixed(2)};
      // soft round falloff, eased fade-out
      trail += smoothstep(r + 0.16, r, length(d)) * life * life * 0.55;
    }
  }
  trail = clamp(trail, 0.0, 0.85);
  float px = mix(pixel, pixel * 3.5, trail);
  vec2 cell = px / res;
  vec2 suv = (floor(st / cell) + 0.5) * cell;
  vec3 c = texture2D(tex, suv * scale + offset).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float n = noise(st * 1.4 + time * 0.25) - 0.5;
  float pulse = sin(time * 0.5) * 0.5 + 0.5;
  float b = bias + (n * 0.77 + pulse * 0.87) * 0.06;
  float t = b8(floor(gl_FragCoord.xy / max(1.0, floor(px * 0.5 + 0.5)))) + b * (1.0 + 0.5 * trail);
  gl_FragColor = vec4(lum > t ? light : dark, 1.0);
}`;

const hexToRgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); };
const easeOut = t => 1 - Math.pow(1 - t, 5);

export function initTouchDither({ colorDark = '#15209f', colorLight = '#f0ede5', bias = 0.1, selector = '[data-dither]' } = {}) {
  const dark = hexToRgb(colorDark), light = hexToRgb(colorLight);
  const items = [];

  function makeItem(el) {
    const isVideo = el.tagName === 'VIDEO';
    // the image's own frame (figure / hero media / video box) has exactly the image's size
    let host = el.parentElement;
    if (host.tagName === 'PICTURE') host = host.parentElement;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const touchTarget = el.closest('figure, .hero, .listen__stage, li, article') || el.parentElement;
    const item = { el, isVideo, host, touchTarget, canvas: null, gl: null, entered: false, enterStart: 0,
                   near: false, visible: false, pts: new Float32Array(MAX_POINTS * 4), ptIndex: 0, source: null, ready: false };

    // touch trail (does not block scrolling)
    let last = null;
    const addPoint = (e, vel) => {
      const r = item.host.getBoundingClientRect();
      if (!r.width) return;
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return;
      const i = item.ptIndex++ % MAX_POINTS;
      item.pts.set([x, y, performance.now() / 1000, vel], i * 4);
      item.activeUntil = performance.now() / 1000 + TRAIL_LIFE;
    };
    touchTarget.addEventListener('pointerdown', e => { last = e; addPoint(e, 0.3); }, { passive: true });
    touchTarget.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && !e.buttons) return;
      const v = last ? Math.min(Math.hypot(e.clientX - last.clientX, e.clientY - last.clientY) / 30, 1) : 0.5;
      last = e; addPoint(e, v);
    }, { passive: true });

    // load the source once (image or video)
    if (isVideo) {
      item.source = el;
      const ok = () => { item.ready = true; };
      el.readyState >= 2 ? ok() : el.addEventListener('loadeddata', ok, { once: true });
    } else {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { item.source = img; item.ready = true; if (item.gl) upload(item); };
      img.src = el.currentSrc || el.src;
    }
    return item;
  }

  function createGL(item) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dither-touch';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    item.host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) { canvas.remove(); return false; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = {}; ['scale', 'offset', 'res', 'dark', 'light', 'pixel', 'bias', 'time', 'now', 'aspect', 'pts'].forEach(n => u[n] = gl.getUniformLocation(prog, n));
    gl.uniform3fv(u.dark, dark); gl.uniform3fv(u.light, light);
    Object.assign(item, { canvas, gl, u, uploaded: false, w: 0, h: 0, drawnOnce: false });
    if (item.ready && !item.isVideo) upload(item);
    return true;
  }

  function upload(item) {
    const { gl } = item;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, item.source);
    item.uploaded = true;
  }

  function destroyGL(item) {
    if (!item.gl) return;
    item.gl.getExtension('WEBGL_lose_context')?.loseContext();
    item.canvas.remove();
    Object.assign(item, { canvas: null, gl: null, uploaded: false });
    item.el.style.opacity = '';
  }

  function layout(item) {
    const { host, canvas, gl } = item;
    const w = host.clientWidth, h = host.clientHeight;
    const cw = Math.max(1, Math.round(w * DPR)), ch = Math.max(1, Math.round(h * DPR));
    if (cw !== item.w || ch !== item.h) { canvas.width = item.w = cw; canvas.height = item.h = ch; gl.viewport(0, 0, cw, ch); }
  }

  function draw(item, t) {
    const { gl, u, source } = item;
    if (!gl || !item.ready) return;
    layout(item);
    if (item.isVideo) { if (source.readyState >= 2) upload(item); } else if (!item.uploaded) upload(item);
    if (!item.uploaded) return;
    item.el.style.opacity = '0';
    const sw = item.isVideo ? source.videoWidth : source.naturalWidth, shh = item.isVideo ? source.videoHeight : source.naturalHeight;
    const ta = sw / shh, pa = item.w / item.h;
    if (ta > pa) { gl.uniform2f(u.scale, pa / ta, 1); gl.uniform2f(u.offset, (1 - pa / ta) / 2, 0); }
    else { gl.uniform2f(u.scale, 1, ta / pa); gl.uniform2f(u.offset, 0, (1 - ta / pa) / 2); }
    if (!item.entered) { item.entered = true; item.enterStart = t; }
    const p = easeOut(Math.min((t - item.enterStart) / ENTER, 1));
    gl.uniform2f(u.res, item.w, item.h);
    gl.uniform1f(u.pixel, ENTER_PIXEL + (DPR - ENTER_PIXEL) * p);
    gl.uniform1f(u.bias, 1 + (bias - 1) * p);
    gl.uniform1f(u.time, t); gl.uniform1f(u.now, t);
    gl.uniform1f(u.aspect, item.w / item.h);
    gl.uniform4fv(u.pts, item.pts);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  document.querySelectorAll(selector).forEach(el => items.push(makeItem(el)));
  const byEl = new Map(items.map(i => [i.el, i]));

  // near = within ~1 screen: hold a context. visible = on screen: animate.
  const nearIO = new IntersectionObserver(es => es.forEach(e => {
    const it = byEl.get(e.target); it.near = e.isIntersecting;
    if (it.near && !it.gl) createGL(it);
    if (!it.near) destroyGL(it);
  }), { rootMargin: '100% 0px' });
  const visIO = new IntersectionObserver(es => es.forEach(e => {
    const it = byEl.get(e.target); it.visible = e.isIntersecting;
    if (it.isVideo) it.visible ? it.el.play().catch(() => {}) : it.el.pause();
  }));
  items.forEach(it => { nearIO.observe(it.el); visIO.observe(it.el); });

  // Render on demand: during the reveal, while a finger trail is fading, for video frames (max 30 fps),
  // and once after any size change. A still image costs nothing after it has been drawn.
  (function loop() {
    requestAnimationFrame(loop);
    const t = performance.now() / 1000;
    for (const it of items) {
      if (!it.visible || !it.gl) continue;
      const sizeChanged = Math.round(it.host.clientWidth * DPR) !== it.w || Math.round(it.host.clientHeight * DPR) !== it.h;
      const entering = !it.entered || t - it.enterStart < ENTER + 0.05;
      const trailing = (it.activeUntil || 0) > t;
      const videoDue = it.isVideo && !it.el.paused && t - (it.lastDraw || 0) > 1 / 30;
      if (entering || trailing || videoDue || sizeChanged || !it.drawnOnce) {
        draw(it, t); it.lastDraw = t; if (it.uploaded) it.drawnOnce = true;
      }
    }
  })();
}
