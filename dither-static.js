/*!
 * dither-static.js
 * Touch-device version of the dither effect (no cursor, so no trail).
 * Images: dithered once into the <img> itself, so they always scroll with the page.
 * Video: dithered frame by frame into a canvas inside the video's own box.
 * Same 8x8 ordered (Bayer) dither and two colours as dither-hover.js.
 */

const BAYER8 = [
   0, 48, 12, 60,  3, 51, 15, 63,
  32, 16, 44, 28, 35, 19, 47, 31,
   8, 56,  4, 52, 11, 59,  7, 55,
  40, 24, 36, 20, 43, 27, 39, 23,
   2, 50, 14, 62,  1, 49, 13, 61,
  34, 18, 46, 30, 33, 17, 45, 29,
  10, 58,  6, 54,  9, 57,  5, 53,
  42, 26, 38, 22, 41, 25, 37, 21,
].map(v => v / 64);

const hexToRgb = hex => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/* draw source into ctx with object-fit: cover */
function drawCover(ctx, src, sw, sh, w, h) {
  const s = Math.max(w / sw, h / sh);
  const dw = sw * s, dh = sh * s;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function ditherPixels(ctx, w, h, dark, light, bias) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const row = (y & 7) * 8;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const c = lum > BAYER8[row + (x & 7)] + bias ? light : dark;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function initStaticDither({ colorDark = '#15209f', colorLight = '#f0ede5', bias = 0.12, selector = '[data-dither]' } = {}) {
  const dark = hexToRgb(colorDark), light = hexToRgb(colorLight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  /* ---------- images ---------- */
  const images = [...document.querySelectorAll(`img${selector}`)];
  const originals = new Map();

  function renderImage(img) {
    const box = img.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const srcUrl = originals.get(img) || img.currentSrc || img.src;
    originals.set(img, srcUrl);
    const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
    if (img.dataset.ditherSize === `${w}x${h}`) return;
    const source = new Image();
    source.decoding = 'async';
    source.onload = () => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      drawCover(ctx, source, source.naturalWidth, source.naturalHeight, w, h);
      ditherPixels(ctx, w, h, dark, light, bias);
      // drop <source> elements so the browser keeps our dithered version
      img.closest('picture')?.querySelectorAll('source').forEach(s => s.remove());
      img.removeAttribute('srcset');
      img.src = c.toDataURL('image/png');
      img.dataset.ditherSize = `${w}x${h}`;
      img.classList.add('is-dithered');
    };
    source.src = srcUrl;
  }

  // render when an image gets close to the viewport (lazy, keeps first paint fast)
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { renderImage(e.target); io.unobserve(e.target); }
  }, { rootMargin: '600px 0px' });
  images.forEach(img => io.observe(img));

  // re-render rendered images if their box changes (rotation, resize)
  let t;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => images.filter(i => i.dataset.ditherSize).forEach(renderImage), 250);
  });

  /* ---------- video ----------
     WebGL canvas inside the video's own box: the GPU does the dither, and the canvas
     scrolls with the page like any element (no global overlay to keep in sync). */
  document.querySelectorAll(`video${selector}`).forEach(video => {
    const host = video.parentElement;
    const canvas = document.createElement('canvas');
    canvas.className = 'dither-video';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { canvas.remove(); return; } // no WebGL: plain video stays visible
    video.style.opacity = '0';

    const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0.0, 1.0); }';
    const fs = `precision mediump float;
      varying vec2 uv; uniform sampler2D tex; uniform vec2 scale; uniform vec2 offset;
      uniform vec3 dark; uniform vec3 light; uniform float bias;
      float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
      float b8(vec2 a){ return b4(0.5 * a) * 0.25 + b2(a); }
      void main(){
        vec3 c = texture2D(tex, uv * scale + offset).rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(lum > b8(gl_FragCoord.xy) + bias ? light : dark, 1.0);
      }`;
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform3f(u('dark'), dark[0] / 255, dark[1] / 255, dark[2] / 255);
    gl.uniform3f(u('light'), light[0] / 255, light[1] / 255, light[2] / 255);
    gl.uniform1f(u('bias'), bias);

    let visible = false, w = 0, h = 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) video.play().catch(() => {}); else video.pause(); }).observe(host);
    function size() {
      const nw = Math.round(host.clientWidth * dpr), nh = Math.round(host.clientHeight * dpr);
      if (nw === w && nh === h) return;
      w = canvas.width = nw; h = canvas.height = nh; gl.viewport(0, 0, w, h);
    }
    function frame() {
      requestAnimationFrame(frame);
      if (!visible || video.readyState < 2 || !video.videoWidth) return;
      size();
      // object-fit: cover
      const ta = video.videoWidth / video.videoHeight, pa = w / h;
      if (ta > pa) { gl.uniform2f(u('scale'), pa / ta, 1); gl.uniform2f(u('offset'), (1 - pa / ta) / 2, 0); }
      else { gl.uniform2f(u('scale'), 1, ta / pa); gl.uniform2f(u('offset'), 0, (1 - ta / pa) / 2); }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
  });
}
