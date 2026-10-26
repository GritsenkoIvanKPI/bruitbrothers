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

  /* ---------- video ---------- */
  document.querySelectorAll(`video${selector}`).forEach(video => {
    const host = video.parentElement;
    const canvas = document.createElement('canvas');
    canvas.className = 'dither-video';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    video.style.opacity = '0';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const SCALE = 1; // one dot per CSS pixel
    let visible = false, last = 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) video.play().catch(() => {}); else video.pause(); }).observe(host);
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || video.readyState < 2 || now - last < 40) return; // ~25 fps
      last = now;
      const w = Math.max(1, Math.round(host.clientWidth * SCALE)), h = Math.max(1, Math.round(host.clientHeight * SCALE));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      drawCover(ctx, video, video.videoWidth, video.videoHeight, w, h);
      ditherPixels(ctx, w, h, dark, light, bias);
    }
    requestAnimationFrame(frame);
  });
}
