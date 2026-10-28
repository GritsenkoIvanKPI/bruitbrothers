/*!
 * dither-hover.js
 * WebGL-ефект дізерингу картинок зі слідом за курсором і показом оригіналу при ховері.
 *
 * ПІДКЛЮЧЕННЯ (перед </body>):
 *
 *   <script type="module">
 *     import { initDitherHover } from './dither-hover.js';
 *     initDitherHover({
 *       colorDark:  '#1925aa',   // ← свій темний колір
 *       colorLight: '#b7b9d3',   // ← свій світлий колір
 *     });
 *   </script>
 *
 * РОЗМІТКА:
 *   <img data-dither src="photo.jpg" alt="">                      — дізер + слід курсора
 *   <img data-dither data-hover-original src="photo.jpg" alt="">  — + оригінал при наведенні
 *
 *   Картинка має займати свій блок (width/height або object-fit: cover на контейнері) —
 *   WebGL малює її рівно в межах <img>.
 *   Картинки з іншого домену мають віддаватися з CORS-заголовками.
 *
 * Якщо WebGL недоступний — картинки просто лишаються звичайними.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

/* =====================================================================
   ПАРАМЕТРИ ЕФЕКТУ (без змін, 1:1 з референсу)
   ===================================================================== */
const PARAMS = {
  matrixSize: 8,
  bias: 0.1,
  scaleResolution: 1,
  zoom: 1,
  pixelSize: 1,
  pixelSizeMultiplier: 7.7,
  trailIntensityMultiplier: 1.02,
  biasNoiseScale: 1.4,
  biasNoiseSpeed: 94,
  biasPulseSpeed: 3.1,
  biasNoiseWeight: 0.77,
  biasPulseWeight: 0.87,
  biasAnimationStrength: 0.29,

  trail: {
    initialRadius: 0.066,
    initialRadiusMultiplier: 0.015,
    borderSize: 0.129,
    borderSizeMultiplier: 0.054,
    decayRate: 0.057,
    velocitySmoothing: 0.63,
    velocityAmplifier: 32,
  },

  hoverDuration: 0.5,  // с — перехід дізер ↔ оригінал
  enterDuration: 2,    // с — анімація появи
  enterPixelSize: 20,  // стартовий розмір пікселя при появі
  enterBias: 1,        // стартовий bias при появі
};

const DEFAULTS = {
  colorDark: '#1925aa',
  colorLight: '#b7b9d3',
  selector: 'img[data-dither]',
  zIndex: 1,
  maxPixelRatio: 2,
};

/* =====================================================================
   ШЕЙДЕРИ
   ===================================================================== */
const mediaVertex = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const mediaFragment = /* glsl */`
precision highp float;

uniform sampler2D tMap;
uniform vec2 uTextureSize;
uniform vec2 uPlaneSize;
uniform vec2 uResolution;
uniform vec3 uColorDark;
uniform vec3 uColorLight;
uniform float uMatrixSize;
uniform float uBias;
uniform float uDitherAmount;
uniform float uScaleResolution;
uniform float uOpacity;
uniform float uZoom;
uniform vec2 uZoomCenter;
uniform float uPixelSize;
uniform float uPixelSizeMultiplier;
uniform float uTime;
uniform sampler2D uTrail;
uniform float uTrailIntensityMultiplier;
uniform float uBiasNoiseScale;
uniform float uBiasNoiseSpeed;
uniform float uBiasPulseSpeed;
uniform float uBiasNoiseWeight;
uniform float uBiasPulseWeight;
uniform float uBiasAnimationStrength;

varying vec2 vUv;

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

const float bayerMatrix2x2[4] = float[4](
  0.0/4.0, 2.0/4.0,
  3.0/4.0, 1.0/4.0
);

const float bayerMatrix4x4[16] = float[16](
   0.0/16.0,  8.0/16.0,  2.0/16.0, 10.0/16.0,
  12.0/16.0,  4.0/16.0, 14.0/16.0,  6.0/16.0,
   3.0/16.0, 11.0/16.0,  1.0/16.0,  9.0/16.0,
  15.0/16.0,  7.0/16.0, 13.0/16.0,  5.0/16.0
);

const float bayerMatrix8x8[64] = float[64](
   0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0, 16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0, 19.0/64.0, 47.0/64.0, 31.0/64.0,
   8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0, 59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0, 24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0, 27.0/64.0, 39.0/64.0, 23.0/64.0,
   2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0, 49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0, 18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0, 17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0, 58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0, 57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0, 26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0, 25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 orderedDither(vec2 uv, float lum, float trailIntensity, float animatedBias) {
  float threshold = 0.0;
  if (uMatrixSize == 2.0) {
    int x = int(mod(floor(uv.x * uResolution.x), 2.0));
    int y = int(mod(floor(uv.y * uResolution.y), 2.0));
    threshold = bayerMatrix2x2[y * 2 + x];
  } else if (trailIntensity < 0.5) {
    int x = int(mod(floor(uv.x * uResolution.x), 4.0));
    int y = int(mod(floor(uv.y * uResolution.y), 4.0));
    threshold = bayerMatrix4x4[y * 4 + x];
  } else {
    int x = int(mod(floor(uv.x * uResolution.x), 8.0));
    int y = int(mod(floor(uv.y * uResolution.y), 8.0));
    threshold = bayerMatrix8x8[y * 8 + x];
  }
  float value = threshold + animatedBias * (1.0 + 2.0 * trailIntensity);
  return mix(uColorDark, uColorLight, step(value, lum));
}

void main() {
  float textureAspect = uTextureSize.x / uTextureSize.y;
  float planeAspect   = uPlaneSize.x / uPlaneSize.y;
  vec2 scale; vec2 offset;
  if (textureAspect > planeAspect) {
    float s = planeAspect / textureAspect;
    scale  = vec2(s, 1.0);
    offset = vec2((1.0 - s) * 0.5, 0.0);
  } else {
    float s = textureAspect / planeAspect;
    scale  = vec2(1.0, s);
    offset = vec2(0.0, (1.0 - s) * 0.5);
  }

  // zoom around uZoomCenter (default (0,1) = top-left, as before)
  vec2 zoomedUv = (vUv - uZoomCenter) / uZoom + uZoomCenter;
  vec2 coverUv = zoomedUv * scale + offset;
  vec2 safeUv = clamp(coverUv, 0.0, 1.0);

  vec2 screenUv = gl_FragCoord.xy / uResolution.xy;
  float trailIntensity = texture2D(uTrail, screenUv).r;

  vec2 normalizedPixelSize = uPixelSize / uResolution;
  vec2 uvPixel = normalizedPixelSize * floor(safeUv / normalizedPixelSize);
  vec4 color = texture2D(tMap, uvPixel);

  float dynamicPixelSize = mix(uPixelSize, uPixelSize * uPixelSizeMultiplier, trailIntensity);
  vec2 normalizedDynamicPixelSize = dynamicPixelSize / uResolution;
  vec2 uvPixelDynamic = normalizedDynamicPixelSize * floor(safeUv / normalizedDynamicPixelSize);
  vec4 colorForLum = texture2D(tMap, uvPixelDynamic);
  float lum = dot(vec3(0.2126, 0.7152, 0.0722), colorForLum.rgb);

  float noiseValue = cnoise(vec3(safeUv * uBiasNoiseScale, uTime * uBiasNoiseSpeed));
  float timePulse = sin(uTime * uBiasPulseSpeed) * 0.5 + 0.5;
  float animatedBias = uBias + (noiseValue * uBiasNoiseWeight + timePulse * uBiasPulseWeight) * uBiasAnimationStrength;

  vec3 dither = orderedDither(
    gl_FragCoord.xy / (uResolution.xy * uScaleResolution),
    lum,
    trailIntensity * uTrailIntensityMultiplier,
    animatedBias
  );

  color.rgb = mix(color.rgb, dither.rgb, uDitherAmount);
  color.a = uOpacity;
  gl_FragColor = color;
}`;

const trailVertex = /* glsl */`
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * .5 + .5;
  gl_Position = vec4(position, 1.0);
}`;

const trailFragment = /* glsl */`
precision highp float;
uniform sampler2D u_texture;
uniform vec2 uPointer;
uniform vec2 uLastPointer;
uniform float uAspect;
uniform float uVelocity;
uniform float uInitialRadius;
uniform float uInitialRadiusMultiplier;
uniform float uBorderSize;
uniform float uBorderSizeMultiplier;
uniform float uDecayRate;
in vec2 vUv;
layout(location = 0) out vec4 gColor;

float circle(vec2 uv, vec2 c, float r, float border) {
  uv -= c;
  uv.x *= uAspect;
  float dist = sqrt(dot(uv, uv));
  return smoothstep(r + border, r - border, dist);
}

float lineSegment(vec2 p, vec2 a, vec2 b, float radius, float border) {
  p.x *= uAspect; a.x *= uAspect; b.x *= uAspect;
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float dist = length(pa - ba * h);
  return smoothstep(radius + border, radius - border, dist);
}

void main() {
  vec4 color = texture(u_texture, vUv);
  float r  = uInitialRadius + uVelocity * uInitialRadiusMultiplier;
  float br = uBorderSize + uVelocity * uBorderSizeMultiplier;
  float line = lineSegment(vUv, uLastPointer, uPointer, r, br);
  float currentCircle = circle(vUv, uPointer, r, br);
  color.rgb += max(line, currentCircle) * uVelocity;
  color.rgb = mix(color.rgb, vec3(0.0), uDecayRate);
  color.rgb = clamp(color.rgb, vec3(0.0), vec3(1.0));
  color.a = 1.0;
  gColor = color;
}`;

/* =====================================================================
   ДОПОМІЖНЕ
   ===================================================================== */
function hexToVec3(input) {
  const c = new THREE.Color(input);
  c.convertLinearToSRGB(); // THREE.Color зберігає лінійні значення — повертаємо «як у CSS»
  return new THREE.Vector3(c.r, c.g, c.b);
}

// Мінімальний tween (замість GSAP), щоб файл не мав залежностей
const tweens = new Set();
const ease = {
  power4Out: t => 1 - Math.pow(1 - t, 5),
  linear: t => t,
};
function tween(uniform, to, duration, easing = ease.power4Out, from) {
  for (const tw of tweens) if (tw.uniform === uniform) tweens.delete(tw); // overwrite
  tweens.add({ uniform, from: from ?? uniform.value, to, duration: duration * 1000, start: performance.now(), easing });
}
function updateTweens(now) {
  for (const tw of tweens) {
    const p = Math.min((now - tw.start) / tw.duration, 1);
    tw.uniform.value = tw.from + (tw.to - tw.from) * tw.easing(p);
    if (p >= 1) tweens.delete(tw);
  }
}

function supportsWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

/* =====================================================================
   ІНІЦІАЛІЗАЦІЯ
   ===================================================================== */
export function initDitherHover(options = {}) {
  const opts = { ...DEFAULTS, ...options };
  // Optional overrides of the effect parameters: initDitherHover({ params: { biasNoiseSpeed: 0.3, trail: { decayRate: 0.08 } } })
  if (options.params) {
    const { trail, ...rest } = options.params;
    Object.assign(PARAMS, rest);
    if (trail) Object.assign(PARAMS.trail, trail);
  }
  if (!supportsWebGL2()) return null; // фолбек: звичайні картинки

  // Стилі: ховаємо <img> тільки коли WebGL реально працює
  const style = document.createElement('style');
  style.textContent = `
    html.dither-ready ${opts.selector} { opacity: 0 !important; }
    .dither-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: ${opts.zIndex}; }
  `;
  document.head.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.className = 'dither-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  const resolution = { value: new THREE.Vector2() };
  const colorDark = { value: hexToVec3(opts.colorDark) };
  const colorLight = { value: hexToVec3(opts.colorLight) };

  /* ---------- Слід курсора (ping-pong FBO) ---------- */
  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: false };
  const trailRT = [
    new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, rtOpts),
    new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, rtOpts),
  ];
  let trailIndex = 0;
  const trailScene = new THREE.Scene();
  const trailCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const T = PARAMS.trail;
  const trailMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: trailVertex,
    fragmentShader: trailFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      u_texture: { value: trailRT[0].texture },
      uPointer: { value: new THREE.Vector2() },
      uLastPointer: { value: new THREE.Vector2() },
      uAspect: { value: window.innerWidth / window.innerHeight },
      uVelocity: { value: 0 },
      uInitialRadius: { value: T.initialRadius },
      uInitialRadiusMultiplier: { value: T.initialRadiusMultiplier },
      uBorderSize: { value: T.borderSize },
      uBorderSizeMultiplier: { value: T.borderSizeMultiplier },
      uDecayRate: { value: T.decayRate },
    },
  });
  trailScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMaterial));

  const pointerTarget = new THREE.Vector2();
  const lastPointer = new THREE.Vector2();
  let velocity = 0;
  let skipNextDraw = true;

  const onPointerMove = e => {
    const nx = e.clientX / window.innerWidth;
    const ny = 1 - e.clientY / window.innerHeight;
    if (skipNextDraw) { lastPointer.set(nx, ny); skipNextDraw = false; }
    pointerTarget.set(nx, ny);
  };
  const onPointerLeave = () => { skipNextDraw = true; velocity = 0; };
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);

  function updateTrail() {
    const dx = pointerTarget.x - lastPointer.x;
    const dy = pointerTarget.y - lastPointer.y;
    velocity += (Math.sqrt(dx * dx + dy * dy) - velocity) * T.velocitySmoothing;
    const u = trailMaterial.uniforms;
    u.uVelocity.value = Math.min(velocity * T.velocityAmplifier, 1);
    u.uLastPointer.value.copy(lastPointer);
    u.uPointer.value.copy(pointerTarget);
    lastPointer.copy(pointerTarget);

    u.u_texture.value = trailRT[trailIndex].texture;
    renderer.setRenderTarget(trailRT[1 - trailIndex]);
    renderer.render(trailScene, trailCamera);
    renderer.setRenderTarget(null);
    trailIndex = 1 - trailIndex;
  }

  /* ---------- Картинки ---------- */
  const geometry = new THREE.PlaneGeometry(1, 1);
  const loader = new THREE.TextureLoader();
  const medias = new Map(); // img → media

  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      const m = medias.get(e.target);
      if (m && e.isIntersecting && !m.entered && m.loaded) enter(m);
      if (m) m.inView = e.isIntersecting;
    }
  }, { threshold: 0.15 });

  function enter(m) {
    m.entered = true;
    const u = m.material.uniforms;
    tween(u.uBias, PARAMS.bias, PARAMS.enterDuration, ease.power4Out, PARAMS.enterBias);
    tween(u.uPixelSize, PARAMS.pixelSize, PARAMS.enterDuration, ease.power4Out, PARAMS.enterPixelSize);
    tween(u.uOpacity, 1, PARAMS.enterDuration, ease.power4Out, 0);
  }

  function addImage(img) {
    if (medias.has(img)) return;
    const material = new THREE.ShaderMaterial({
      vertexShader: mediaVertex,
      fragmentShader: mediaFragment,
      transparent: true,
      uniforms: {
        tMap: { value: null },
        uTextureSize: { value: new THREE.Vector2(1, 1) },
        uPlaneSize: { value: new THREE.Vector2(1, 1) },
        uResolution: resolution,
        uTrail: { value: trailRT[0].texture },
        uColorDark: colorDark,
        uColorLight: colorLight,
        uMatrixSize: { value: PARAMS.matrixSize },
        uBias: { value: PARAMS.enterBias },
        uDitherAmount: { value: 1 },
        uScaleResolution: { value: PARAMS.scaleResolution },
        uOpacity: { value: 0 },
        uZoom: { value: PARAMS.zoom },
        uZoomCenter: { value: new THREE.Vector2(0, 1) },
        uPixelSize: { value: PARAMS.enterPixelSize },
        uPixelSizeMultiplier: { value: PARAMS.pixelSizeMultiplier },
        uTime: { value: 0 },
        uTrailIntensityMultiplier: { value: PARAMS.trailIntensityMultiplier },
        uBiasNoiseScale: { value: PARAMS.biasNoiseScale },
        uBiasNoiseSpeed: { value: PARAMS.biasNoiseSpeed },
        uBiasPulseSpeed: { value: PARAMS.biasPulseSpeed },
        uBiasNoiseWeight: { value: PARAMS.biasNoiseWeight },
        uBiasPulseWeight: { value: PARAMS.biasPulseWeight },
        uBiasAnimationStrength: { value: PARAMS.biasAnimationStrength },
      },
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = false;
    scene.add(mesh);

    const m = { img, mesh, material, entered: false, loaded: false, inView: false, handlers: null };
    medias.set(img, m);

    if (img.tagName === 'VIDEO') {
      // <video data-dither>: live texture, updated every frame
      const tex = new THREE.VideoTexture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const onReady = () => {
        material.uniforms.tMap.value = tex;
        material.uniforms.uTextureSize.value.set(img.videoWidth, img.videoHeight);
        m.loaded = true;
        if (m.inView && !m.entered) enter(m);
        img.play?.().catch(() => {});
      };
      if (img.readyState >= 2) onReady(); else img.addEventListener('loadeddata', onReady, { once: true });
    } else {
      loader.load(img.currentSrc || img.src, tex => {
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        material.uniforms.tMap.value = tex;
        material.uniforms.uTextureSize.value.set(tex.image.naturalWidth || tex.image.width, tex.image.naturalHeight || tex.image.height);
        m.loaded = true;
        if (m.inView && !m.entered) enter(m);
      }, undefined, () => {
        // не вдалося завантажити (наприклад, CORS) — повертаємо звичайну картинку
        removeImage(img);
        img.style.setProperty('opacity', '1', 'important');
      });
    }

    if (img.hasAttribute('data-hover-original')) {
      const target = img.closest('a, [data-dither-hover-target]') || img.parentElement;
      const onEnter = () => tween(material.uniforms.uDitherAmount, 0, PARAMS.hoverDuration, ease.linear);
      const onLeave = () => tween(material.uniforms.uDitherAmount, 1, PARAMS.hoverDuration, ease.linear);
      target.addEventListener('mouseenter', onEnter);
      target.addEventListener('mouseleave', onLeave);
      m.handlers = { target, onEnter, onLeave };
    }

    io.observe(img);
  }

  function removeImage(img) {
    const m = medias.get(img);
    if (!m) return;
    io.unobserve(img);
    scene.remove(m.mesh);
    m.material.uniforms.tMap.value?.dispose();
    m.material.dispose();
    if (m.handlers) {
      m.handlers.target.removeEventListener('mouseenter', m.handlers.onEnter);
      m.handlers.target.removeEventListener('mouseleave', m.handlers.onLeave);
    }
    medias.delete(img);
  }

  // Підхоплюємо нові картинки (слайдери, AJAX, «завантажити ще»)
  const scan = () => {
    document.querySelectorAll(opts.selector).forEach(addImage);
    for (const img of medias.keys()) if (!img.isConnected) removeImage(img);
  };
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });
  scan();

  /* ---------- Розміри та синхронізація з DOM ---------- */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.left = -w / 2; camera.right = w / 2;
    camera.top = h / 2;   camera.bottom = -h / 2;
    camera.updateProjectionMatrix();
    renderer.getDrawingBufferSize(resolution.value);
    trailRT.forEach(rt => rt.setSize(w, h));
    trailMaterial.uniforms.uAspect.value = w / h;
  }
  window.addEventListener('resize', resize);
  resize();

  function syncMesh(m) {
    const r = m.img.getBoundingClientRect();
    const w = window.innerWidth, h = window.innerHeight;
    const visible = m.loaded && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < h && r.right > 0 && r.left < w;
    m.mesh.visible = visible;
    if (!visible) return;
    m.mesh.scale.set(r.width, r.height, 1);
    m.mesh.position.set(r.left + r.width / 2 - w / 2, h / 2 - (r.top + r.height / 2), 0);
    m.material.uniforms.uPlaneSize.value.set(r.width, r.height);
    // optional per-element zoom: data-zoom="1.4" data-zoom-center="0.28,0.62" (x,y from top-left)
    const z = parseFloat(m.img.dataset.zoom);
    m.material.uniforms.uZoom.value = z > 0 ? z : PARAMS.zoom;
    const c = (m.img.dataset.zoomCenter || '').split(',').map(Number);
    if (c.length === 2 && !c.some(isNaN)) m.material.uniforms.uZoomCenter.value.set(c[0], 1 - c[1]);
  }

  document.documentElement.classList.add('dither-ready');

  let raf = 0;
  function tick(now) {
    updateTweens(now);
    updateTrail();
    const t = now * 0.001;
    const trailTex = trailRT[trailIndex].texture;
    for (const m of medias.values()) {
      syncMesh(m);
      m.material.uniforms.uTime.value = t;
      m.material.uniforms.uTrail.value = trailTex;
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  /* ---------- Публічне API ---------- */
  return {
    /** Змінити кольори на льоту: setColors('#000', '#fff') */
    setColors(dark, light) {
      if (dark) colorDark.value = hexToVec3(dark);
      if (light) colorLight.value = hexToVec3(light);
    },
    /** Примусово пересканувати сторінку */
    refresh: scan,
    /** Повністю вимкнути ефект */
    destroy() {
      cancelAnimationFrame(raf);
      mo.disconnect();
      io.disconnect();
      for (const img of [...medias.keys()]) removeImage(img);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);
      trailRT.forEach(rt => rt.dispose());
      trailMaterial.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      style.remove();
      document.documentElement.classList.remove('dither-ready');
    },
  };
}
