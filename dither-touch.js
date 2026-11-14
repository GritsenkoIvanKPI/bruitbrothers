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
const TRAIL_LIFE = 1.2;      // s (desktop trail decays 5.7% per frame: ~1s to fade out)
const ENTER = 2;             // s (desktop enterDuration)
const ENTER_PIXEL = 20;      // starting pixel size (desktop enterPixelSize)
const DPR = Math.min(window.devicePixelRatio || 1, 2);

const VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision highp float;
// Same maths as dither-hover.js (desktop), so phones and desktop look identical.
varying vec2 uv;
uniform sampler2D tex;
uniform vec2 scale, offset, res;
uniform vec3 dark, light;
uniform float pixel, bias, time, now, aspect, vk;
uniform vec4 pts[${MAX_POINTS}];
float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
float b8(vec2 a){ return b4(0.5 * a) * 0.25 + b2(a); }
// Classic Perlin 3D Noise — Stefan Gustavson
vec4 permute(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t){ return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec3 P){
  vec3 Pi0 = floor(P);
  vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod(Pi0, 289.0);
  Pi1 = mod(Pi1, 289.0);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 / 7.0;
  vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 / 7.0;
  vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
  vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
  vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
  vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
  vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
  vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
  vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
  vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}
void main(){
  vec2 st = vec2(uv.x, 1.0 - uv.y);                 // 0..1, top-left origin
  // finger trail, built like the desktop cursor trail: radius 0.066 + v*0.015 and soft border 0.129 + v*0.054
  // (in screen-height units; vk converts image units to screen units), strength = speed, decaying 5.7% per frame
  float trail = 0.0;
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    vec4 q = pts[i];
    float age = now - q.z;
    if (q.z > 0.0 && age < ${TRAIL_LIFE.toFixed(2)}) {
      vec2 d = (st - q.xy) * vec2(aspect, 1.0) * vk;
      float r = 0.066 + q.w * 0.015, br = 0.129 + q.w * 0.054;
      trail = max(trail, smoothstep(r + br, r - br, length(d)) * q.w * pow(0.943, age * 60.0));
    }
  }
  trail = clamp(trail * 1.02, 0.0, 1.0);
  vec2 cuv = st * scale + offset;
  // luminance from a cell that grows up to 7.7x inside the trail (desktop pixelSizeMultiplier)
  vec2 cell = mix(pixel, pixel * 7.7, trail) / res;
  vec3 c = texture2D(tex, (floor(st / cell) * cell) * scale + offset).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // animated threshold, desktop pattern (noise scale 1.4, weights 0.77 / 0.87), toned down below
  // phones: same shimmer pattern as desktop but much calmer (strength 0.29 -> 0.07, slower drift and pulse),
  // because on a phone screen the full-strength flicker reads as flashing
  float n = cnoise(vec3(cuv * 1.4, time * 2.0));
  float pulse = sin(time * 1.2) * 0.5 + 0.5;
  float ab = bias + (n * 0.77 + pulse * 0.87) * 0.07;
  float th = trail < 0.5 ? b4(gl_FragCoord.xy) : b8(gl_FragCoord.xy);
  float v = th + ab * (1.0 + 2.0 * trail);
  gl_FragColor = vec4(lum >= v ? light : dark, 1.0);
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
    touchTarget.addEventListener('pointerdown', e => { last = e; item.vel = 0; addPoint(e, 0.3); }, { passive: true });
    touchTarget.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && !e.buttons) return;
      // desktop velocity: screen-normalised step, smoothed 0.63, amplified 32x, capped at 1
      const step = last ? Math.hypot((e.clientX - last.clientX) / innerWidth, (e.clientY - last.clientY) / innerHeight) : 0;
      item.vel = (item.vel || 0) + (step - (item.vel || 0)) * 0.63;
      last = e; addPoint(e, Math.min(item.vel * 32, 1));
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
    const u = {}; ['scale', 'offset', 'res', 'dark', 'light', 'pixel', 'bias', 'time', 'now', 'aspect', 'vk', 'pts'].forEach(n => u[n] = gl.getUniformLocation(prog, n));
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
    // honour the img's CSS object-position (percentages), like object-fit: cover would
    const op = getComputedStyle(item.el).objectPosition.split(' ').map(v => v.endsWith('%') ? parseFloat(v) / 100 : 0.5);
    const px = op[0] ?? 0.5, py = op[1] ?? 0.5;
    if (ta > pa) { gl.uniform2f(u.scale, pa / ta, 1); gl.uniform2f(u.offset, (1 - pa / ta) * px, 0); }
    else { gl.uniform2f(u.scale, 1, ta / pa); gl.uniform2f(u.offset, 0, (1 - ta / pa) * py); }
    // reveal (as on the reference): waits until the image's top is 15% into the screen and the preloader is gone,
    // then pixels 20 -> 1, threshold 1 -> bias and opacity 0 -> 1 over 2s, power4.out
    if (item.armed && !item.entered) { item.entered = true; item.enterStart = t; }
    const p = item.entered ? easeOut(Math.min((t - item.enterStart) / ENTER, 1)) : 0;
    item.canvas.style.opacity = p.toFixed(3);
    gl.uniform2f(u.res, item.w, item.h);
    gl.uniform1f(u.pixel, ENTER_PIXEL + (1 - ENTER_PIXEL) * p); // ends at 1 buffer px, like desktop pixelSize
    gl.uniform1f(u.bias, 1 + (bias - 1) * p);
    gl.uniform1f(u.time, t); gl.uniform1f(u.now, t);
    gl.uniform1f(u.aspect, item.w / item.h);
    gl.uniform1f(u.vk, item.h / DPR / window.innerHeight); // image height in screen heights
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
  const pageReady = () => !document.documentElement.classList.contains('is-loading');
  const armIO = new IntersectionObserver(es => es.forEach(e => {
    const it = byEl.get(e.target);
    if (!e.isIntersecting || it.armed) return;
    const arm = () => { it.armed = true; armIO.unobserve(it.el); };
    if (pageReady()) arm(); else addEventListener('page:ready', arm, { once: true });
  }), { rootMargin: '0px 0px -15% 0px' });
  items.forEach(it => { nearIO.observe(it.el); visIO.observe(it.el); armIO.observe(it.el); });

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
      // the dither threshold shimmers all the time on desktop, so keep drawing every visible image
      if (true || entering || trailing || videoDue || sizeChanged || !it.drawnOnce) {
        draw(it, t); it.lastDraw = t; if (it.uploaded) it.drawnOnce = true;
      }
    }
  })();
}
