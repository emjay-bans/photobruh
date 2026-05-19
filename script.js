// ==============================
// COMPATIBILITY CHECK
// ==============================
(function checkCompatibility() {
  const missing = [];
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    missing.push("Camera API (getUserMedia)");
  if (!window.WebGLRenderingContext)
    missing.push("WebGL");
  if (!window.indexedDB)
    missing.push("IndexedDB");
  if (typeof Worker === "undefined")
    missing.push("Web Workers (needed for strip)");

  if (missing.length > 0) {
    document.body.innerHTML = `
      <div style="max-width:600px; margin:100px auto; text-align:center; font-family:sans-serif;">
        <h2>⚠️ Browser Not Supported</h2>
        <p>Your browser is missing the following features:</p>
        <ul style="text-align:left; display:inline-block;">
          ${missing.map(f => `<li>${f}</li>`).join("")}
        </ul>
        <p>Please use a modern browser like Chrome, Edge, or Firefox.</p>
      </div>`;
    throw new Error("Incompatible browser – stopped loading.");
  }
})();

// ==============================
// DOM ELEMENTS
// ==============================
const cameraFeed  = document.getElementById('cameraFeed');
const mirrorer    = document.getElementById('mirrorer');
const snap        = document.getElementById('snap');
const effects     = document.getElementById('effects');
const canvas      = document.getElementById('preview');
const photo       = document.getElementById('photo');
const countdown   = document.getElementById('countdown');
const glCanvas    = document.getElementById("glCanvas");
const themeBtn = document.getElementById("themeBtn");
const crtBtn = document.getElementById("toggleCRT");
const contrastBtn = document.getElementById("contrastBtn");
const recordVideoBtn = document.getElementById("recordVideoBtn");
const recordGifBtn = document.getElementById("recordGifBtn");
const recordBoomerangBtn = document.getElementById("recordBoomerangBtn");

// ==============================
// GLOBAL STATE
// ==============================
let currentFacingMode   = "user";
let currentStream       = null;
let mirrored            = false;

// Face filters
let activeFaceFilters = [];   // now allows multiple filters from different groups
let activeAnimatedFilter = null;
let activeARFilter      = null;   // reserved for future AR-only filters
let faceModelsLoaded    = false;

// MediaPipe
let faceMesh            = null;
let mediaPipeReady      = false;
let currentFaceData     = null;
let lastValidFaceData   = null;
let lastFaceTime        = 0;
let lastMediaPipeSend   = 0;
const MEDIAPIPE_INTERVAL = 60;
const FACE_HOLD_DURATION = 500;

// Transforms & smoothing
let dogTransforms       = [];
const FILTER_SMOOTHING  = 0.65;
const ANGLE_SMOOTHING   = 0.9;

// Snapshots for photo capture
let snapshotFaces       = null;
let snapshotTransforms  = [];

// Animated particles
let animationFrameCount = 0;
const animatedParticles = [];

// Distortion & warp
let distortionMode      = 0;
let distortionStrength  = 0.0;
let faceWarpEnabled     = false;
let faceWarpMode        = 0;

// Original photo & editor
let originalCapturedPhoto = null;

// Video, GIF, and Boomerang recording variables
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// GIF worker
let gifWorkerBlobURL    = null;

// Themes of website
const themes = ["win95", "amber", "matrix", "vaporwave"];
let currentTheme = 0;

// Overlay dirty
let overlayDirty = true;   // start dirty so first frame draws

// Overlay intervals
let lastOverlayFrame = 0;
const OVERLAY_INTERVAL = 33;

// ==============================
// WEBCANVAS / OVERLAY CANVAS
// ==============================
const gl = glCanvas.getContext("webgl", {
  premultipliedAlpha: false,
  antialias: false,
  preserveDrawingBuffer: true,
  willReadFrequently: true
});

// Live overlay canvas
const overlayCanvas = document.createElement("canvas");
overlayCanvas.id = "filterOverlay";
overlayCanvas.width = 1280;
overlayCanvas.height = 720;
overlayCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;background:transparent;";
document.getElementById("cameraWrapper").appendChild(overlayCanvas);
const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });

// Hidden recording canvas
const recordCanvas = document.createElement("canvas");
recordCanvas.width  = glCanvas.width;
recordCanvas.height = glCanvas.height;
const recordCtx = recordCanvas.getContext("2d", { willReadFrequently: true });
let recordingRAF = null;

// ==============================
// WEBCANVAS UNIFORM LOCATIONS
// ==============================
let glProgram, videoTexture, glBuffer;
let uGray, uBright, uContrast, uHue, uInvert, uSaturate, uSepia;
let uResolution, uTexture, uTime, uAnimMode, uMirror;
let uWarpEnabled, uDistortMode, uDistortStrength, uFaceWarpEnabled;
let uLeftEye, uRightEye, uMouthCenter, uNoseTip;
let uFaceWarpMode, uFaceWarpRadius, uMouthLeft, uMouthRight;
let uCropOrigin, uCropScale;

// ==============================
// SHADERS
// ==============================
const vertexShaderSource = `
  attribute vec2 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;

  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
    vTexCoord = aTexCoord;
  }
  `;

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D uTexture;
  uniform vec2 uResolution;

  uniform vec2 uCropOrigin;
  uniform vec2 uCropScale;

  uniform float uGray;
  uniform float uBright;
  uniform float uContrast;
  uniform float uHue;
  uniform float uInvert;
  uniform float uSaturate;
  uniform float uSepia;

  uniform float uTime;
  uniform int uAnimMode;
  uniform float uMirror;

  uniform int uWarpEnabled;

  uniform int uDistortMode;
  uniform float uDistortStrength;
  uniform float uFaceWarpEnabled;
  uniform vec2 uLeftEye;
  uniform vec2 uRightEye;
  uniform vec2 uMouthCenter;
  uniform vec2 uNoseTip;

  uniform int uFaceWarpMode;
  uniform float uFaceWarpRadius;
  uniform vec2 uMouthLeft;
  uniform vec2 uMouthRight;

  varying vec2 vTexCoord;

  float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
  }

  vec3 applyHue(vec3 color, float angle) {
    float s = sin(angle);
    float c = cos(angle);

    mat3 m = mat3(
      0.213 + c * 0.787 - s * 0.213,
      0.715 - c * 0.715 - s * 0.715,
      0.072 - c * 0.072 + s * 0.928,

      0.213 - c * 0.213 + s * 0.143,
      0.715 + c * 0.285 + s * 0.140,
      0.072 - c * 0.072 - s * 0.283,

      0.213 - c * 0.213 - s * 0.787,
      0.715 - c * 0.715 + s * 0.715,
      0.072 + c * 0.928 + s * 0.072
    );

    return clamp(m * color, 0.0, 1.0);
  }

  vec3 applyAnimatedFX(vec2 uv, vec3 color) {
    vec2 p = uv * uResolution;

    // scanlines
    if (uAnimMode == 1) {
      float line = sin(p.y * 1.8 + uTime * 8.0) * 0.08;
      color -= line;
    }

    // sparkles
    else if (uAnimMode == 2) {
      float sparkle = step(0.996, rand(floor(p / 8.0) + floor(uTime * 8.0)));
      color += vec3(sparkle);
    }

    // snow
    else if (uAnimMode == 3) {
      vec2 snowUV = uv;
      snowUV.y += uTime * 0.25;
      float snow = step(0.985, rand(floor(snowUV * vec2(120.0, 80.0))));
      color += vec3(snow);
    }

    // hearts
    else if (uAnimMode == 4) {
      vec2 gv = fract(uv * 12.0) - 0.5;
      vec2 id = floor(uv * 12.0);

      float t = uTime * 0.6;
      gv.y += fract(t + rand(id)) - 0.5;

      float x = gv.x;
      float y = gv.y;

      float heart = pow(x*x + y*y - 0.08, 3.0) - x*x*y*y*y;
      float mask = smoothstep(0.01, -0.01, heart);

      color = mix(color, vec3(1.0, 0.25, 0.45), mask * 0.75);
    }

    // matrix
    else if (uAnimMode == 5) {
      vec2 grid = vec2(24.0, 18.0);
      vec2 cell = floor(uv * grid);

      float drop = fract(uTime * 0.8 + rand(vec2(cell.x, 0.0)) * 4.0);
      float yPos = 1.0 - fract(cell.y / grid.y + drop);

      float head = smoothstep(0.08, 0.0, abs(yPos - 0.5));
      float trail = smoothstep(0.35, 0.0, abs(yPos - 0.5));

      vec3 matrixColor = vec3(0.0, 1.0, 0.35) * trail;
      matrixColor += vec3(0.7, 1.0, 0.8) * head;

      color = mix(color, color + matrixColor, 0.65);
    }

    return color;
  }

  // ---- New warp function ----
  vec2 warpCoord(vec2 uv) {
      vec2 st = uv;    // final texture coordinate

      // --- Global distortions ---
      if (uDistortMode == 1) { // Bulge / fish‑eye
          vec2 center = vec2(0.5, 0.5);
          vec2 delta = uv - center;
          float dist = length(delta);
          float factor = dist * dist * uDistortStrength * 0.5;
          st = uv + delta * factor;
      }
      else if (uDistortMode == 2) { // Swirl
          vec2 center = vec2(0.5, 0.5);
          vec2 delta = uv - center;
          float dist = length(delta);
          float angle = uDistortStrength * dist * 4.0;
          float s = sin(angle);
          float c = cos(angle);
          st = center + vec2(delta.x * c - delta.y * s,
                            delta.x * s + delta.y * c);
      }
      else if (uDistortMode == 3) { // Pinch
          vec2 center = vec2(0.5, 0.5);
          vec2 delta = uv - center;
          float dist = length(delta);
          float factor = dist * uDistortStrength * 0.4;
          st = uv - delta * factor;
      }

      // --- Face‑specific warps (applied on top of global) ---
      if (uFaceWarpEnabled > 0.5) {
        vec2 faceCenter = (uLeftEye + uRightEye) * 0.5;

        // --- Mode 1: Original bulge (eyes, mouth, nose) ---
        if (uFaceWarpMode == 1) {
            vec2 features[4];
            features[0] = uLeftEye;
            features[1] = uRightEye;
            features[2] = uMouthCenter;
            features[3] = uNoseTip;
            float radii[4];
            radii[0] = 0.06;
            radii[1] = 0.06;
            radii[2] = 0.08;
            radii[3] = 0.07;

            for (int i = 0; i < 4; i++) {
                vec2 delta = st - features[i];
                float dist = length(delta);
                float r = radii[i];
                if (dist < r) {
                    float factor = 1.0 - (dist / r);
                    factor = factor * factor * 0.55;
                    st -= delta * factor;
                }
            }
        }

        // --- Mode 2: Frog Face (wide mouth, enlarged eyes) ---
        else if (uFaceWarpMode == 2) {
            // Wide mouth: stretch horizontally away from mouth centre
            vec2 mouthDelta = st - uMouthCenter;
            float mouthDist = length(mouthDelta);
            float mouthRadius = length(uMouthLeft - uMouthRight) * 0.8;
            if (mouthDist < mouthRadius) {
                // strong horizontal stretch
                float factor = 1.0 - (mouthDist / mouthRadius);
                factor = pow(factor, 2.0) * 0.5;
                st.x -= mouthDelta.x * factor * 5.5;
            }

            // Big eyes: bulge both eyes with larger radius
            float eyeRadius = 0.14;
            vec2 deltaL = st - uLeftEye;
            float distL = length(deltaL);
            if (distL < eyeRadius) {
                float f = 1.0 - (distL / eyeRadius);
                f = f * f * 0.3;
                st -= deltaL * f;
            }
            vec2 deltaR = st - uRightEye;
            float distR = length(deltaR);
            if (distR < eyeRadius) {
                float f = 1.0 - (distR / eyeRadius);
                f = f * f * 0.3;
                st -= deltaR * f;
            }
        }

        // --- Mode 3: Fisheye centred on the face ---
        else if (uFaceWarpMode == 3) {
            vec2 delta = st - faceCenter;
            float dist = length(delta);
            float radius = uFaceWarpRadius;
            if (radius < 0.01) radius = 0.3; // fallback
            if (dist < radius) {
                float r = dist / radius;
                float factor = r * r * 0.6;
                st = faceCenter + delta * (1.0 - factor);
            }
        }

        // --- Mode 4: Alien (huge eyes, pinched mouth) ---
        else if (uFaceWarpMode == 4) {
            // Huge eyes
            float bigEyeRad = 0.18;
            vec2 dL = st - uLeftEye;
            float distL = length(dL);
            if (distL < bigEyeRad) {
                float f = 1.0 - (distL / bigEyeRad);
                f = f * f * 0.4;
                st -= dL * f;
            }
            vec2 dR = st - uRightEye;
            float distR = length(dR);
            if (distR < bigEyeRad) {
                float f = 1.0 - (distR / bigEyeRad);
                f = f * f * 0.4;
                st -= dR * f;
            }

            // Pinched mouth (suck in)
            vec2 mouthD = st - uMouthCenter;
            float mouthDist = length(mouthD);
            float mouthRad = 0.12;
            if (mouthDist < mouthRad) {
                float f = 1.0 - (mouthDist / mouthRad);
                f = f * f * 0.5;
                st += mouthD * f;  // shrink toward centre
            }
        }

        // --- Mode 5: Big Nose (only bulge the nose) ---
        else if (uFaceWarpMode == 5) {
            vec2 delta = st - uNoseTip;
            float dist = length(delta);
            float rad = 0.09;
            if (dist < rad) {
                float f = 1.0 - (dist / rad);
                f = f * f * 0.35;
                st -= delta * f;
            }
        }

        // --- Mode 6: Squeeze everything toward face centre ---
        else if (uFaceWarpMode == 6) {
            vec2 delta = st - faceCenter;
            float dist = length(delta);
            float maxRad = length(uMouthCenter - faceCenter) * 1.2;
            if (dist < maxRad) {
                float factor = 1.0 - (dist / maxRad);
                factor = factor * 0.4;
                st += delta * factor;
            }
        }
    }

      return st;
  }

  void main() {
      vec2 uv = vTexCoord;

      // --- Mirror handling (your existing logic) ---
      if (uMirror > 0.5) {
          uv.x = 1.0 - uv.x;
      }

      // --- Warp texture coordinate (NEW) ---
      vec2 warpedUV;
      if (uWarpEnabled == 1) {
          warpedUV = warpCoord(uv);
      } else {
          warpedUV = uv;
      }

      // Add a soft clamp to avoid sampling beyond the texture border
      warpedUV = clamp(warpedUV, vec2(0.001), vec2(0.999));

      // Crop to preserve video aspect ratio (cover)
      vec2 cropUV = uCropOrigin + warpedUV * uCropScale;
      cropUV = clamp(cropUV, 0.001, 0.999);
      vec4 tex = texture2D(uTexture, cropUV);
      vec3 color = tex.rgb;

      // Apply color adjustments (visual filters)
      float gray = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, vec3(gray), uGray);

      color = (color - 0.5) * uContrast + 0.5;
      color *= uBright;

      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luma), color, uSaturate);

      color = applyHue(color, uHue);

      vec3 sep = vec3(
          dot(color, vec3(0.393, 0.769, 0.189)),
          dot(color, vec3(0.349, 0.686, 0.168)),
          dot(color, vec3(0.272, 0.534, 0.131))
      );
      color = mix(color, sep, uSepia);

      color = mix(color, 1.0 - color, uInvert);

      // Your original animated‑effects call:
      color = applyAnimatedFX(uv, color);   // keep as‑is (uses original uv)

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), tex.a);
  }
  `;

// ==============================
// WEBCANVAS HELPERS
// ==============================
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return null;
  }

  return program;
}

function getAnimatedFilterMode() {
  switch (activeAnimatedFilter) {
    case "scanlines": return 1;
    default: return 0;
  }
}

// ==============================
// EFFECTS MANAGER
// ==============================
class EffectsManager {
  constructor() {
    this.effects = {
      grayscale: 0,
      brightness: 100,
      blur: 0,
      contrast: 100,
      hue: 0,
      invert: 0,
      saturate: 100,
      sepia: 0
    };

    this.sliders = {
      grayscale: document.getElementById('graySlider'),
      brightness: document.getElementById('brightSlider'),
      blur: document.getElementById('blurSlider'),
      contrast: document.getElementById('contrastSlider'),
      hue: document.getElementById('hueSlider'),
      invert: document.getElementById('invertSlider'),
      saturate: document.getElementById('saturSlider'),
      sepia: document.getElementById('sepiaSlider')
    };

    this.init();
  }

  init() {
    Object.entries(this.sliders).forEach(([key, slider]) => {
      slider.addEventListener('input', (e) => this.updateEffect(key, e.target.value));
    });
  }

  updateEffect(key, value) {
    this.effects[key] = value;
    this.applyEffects();
    this.syncOverlayFilter();
  }

  applyEffects() {
    const filterString = this.buildFilterString();
    photo.style.filter = filterString;
  }

  buildFilterString() {
    const { grayscale, brightness, blur, contrast, hue, invert, saturate, sepia } = this.effects;
    return `
      grayscale(${grayscale}%)
      brightness(${brightness}%)
      blur(${blur}px)
      contrast(${contrast}%)
      hue-rotate(${hue}deg)
      invert(${invert}%)
      saturate(${saturate}%)
      sepia(${sepia}%)
    `;
  }

  applyPreset(presetName) {
    const presets = {
      bw:    { grayscale: 100, brightness: 100, blur: 0, contrast: 100, hue: 0, invert: 0, saturate: 0, sepia: 0 },
      sepia: { grayscale: 0, brightness: 100, blur: 0, contrast: 100, hue: 0, invert: 0, saturate: 100, sepia: 100 },
      cool:  { grayscale: 0, brightness: 100, blur: 0, contrast: 120, hue: 200, invert: 0, saturate: 80, sepia: 0 },
      warm:  { grayscale: 0, brightness: 110, blur: 0, contrast: 90, hue: 30, invert: 0, saturate: 120, sepia: 20 },
      night: { grayscale: 0, brightness: 150, blur: 0, contrast: 140, hue: 200, invert: 0, saturate: 50, sepia: 0 },
      vivid: { grayscale: 0, brightness: 100, blur: 0, contrast: 150, hue: 0, invert: 0, saturate: 150, sepia: 0 }
    };

    if (presets[presetName]) {
      this.effects = { ...presets[presetName] };
      this.updateSliderUI();
      this.applyEffects();
      this.syncOverlayFilter();
    }
  }

  updateSliderUI() {
    Object.entries(this.sliders).forEach(([key, slider]) => {
      slider.value = this.effects[key];
    });
  }

  reset() {
    this.effects = {
      grayscale: 0, brightness: 100, blur: 0, contrast: 100,
      hue: 0, invert: 0, saturate: 100, sepia: 0
    };
    this.updateSliderUI();
    this.applyEffects();
    this.syncOverlayFilter();
  }

  hasActiveEffects() {
    return Object.entries(this.effects).some(([key, value]) => {
      const defaults = { brightness: 100, contrast: 100, saturate: 100 };
      const defaultValue = defaults[key] ?? 0;
      return value !== defaultValue;
    });
  }

  syncOverlayFilter() {
    const filterString = this.buildFilterString();
    overlayCanvas.style.filter = filterString;
  }
}

const effectsManager = new EffectsManager();

// ==============================
// WEBCANVAS INIT
// ==============================

function initWebGL() {
  glProgram = createProgram(gl, vertexShaderSource, fragmentShaderSource);
  gl.useProgram(glProgram);
  console.log(gl.getProgramInfoLog(glProgram));

  const vertices = new Float32Array([
    -1, -1,  0, 1,
     1, -1,  1, 1,
    -1,  1,  0, 0,
     1,  1,  1, 0
  ]);

  glBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(glProgram, "aPosition");
  const aTexCoord = gl.getAttribLocation(glProgram, "aTexCoord");

  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

  gl.enableVertexAttribArray(aTexCoord);
  gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

  videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  uTexture = gl.getUniformLocation(glProgram, "uTexture");
  uResolution = gl.getUniformLocation(glProgram, "uResolution");

  uGray = gl.getUniformLocation(glProgram, "uGray");
  uBright = gl.getUniformLocation(glProgram, "uBright");
  uContrast = gl.getUniformLocation(glProgram, "uContrast");
  uHue = gl.getUniformLocation(glProgram, "uHue");
  uInvert = gl.getUniformLocation(glProgram, "uInvert");
  uSaturate = gl.getUniformLocation(glProgram, "uSaturate");
  uSepia = gl.getUniformLocation(glProgram, "uSepia");

  uTime = gl.getUniformLocation(glProgram, "uTime");
  uAnimMode = gl.getUniformLocation(glProgram, "uAnimMode");
  uMirror = gl.getUniformLocation(glProgram, "uMirror");

  // Distortion / warp uniforms
  uDistortMode   = gl.getUniformLocation(glProgram, "uDistortMode");
  uDistortStrength = gl.getUniformLocation(glProgram, "uDistortStrength");
  uWarpEnabled = gl.getUniformLocation(glProgram, "uWarpEnabled");

  // Face warp feature points (normalised 0–1 coords)
  uLeftEye       = gl.getUniformLocation(glProgram, "uLeftEye");
  uRightEye      = gl.getUniformLocation(glProgram, "uRightEye");
  uMouthCenter   = gl.getUniformLocation(glProgram, "uMouthCenter");
  uNoseTip       = gl.getUniformLocation(glProgram, "uNoseTip");
  uFaceWarpMode   = gl.getUniformLocation(glProgram, "uFaceWarpMode");
  uFaceWarpRadius = gl.getUniformLocation(glProgram, "uFaceWarpRadius");
  uMouthLeft      = gl.getUniformLocation(glProgram, "uMouthLeft");
  uMouthRight     = gl.getUniformLocation(glProgram, "uMouthRight");
  uFaceWarpEnabled = gl.getUniformLocation(glProgram, "uFaceWarpEnabled");

  // Crop uniforms (maintain video aspect ratio)
  uCropOrigin = gl.getUniformLocation(glProgram, "uCropOrigin");
  uCropScale  = gl.getUniformLocation(glProgram, "uCropScale");
}

// ==============================
// WEBCANVAS RENDER LOOP
// ==============================
function renderWebGL() {
  if (cameraFeed.readyState >= 2) {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cameraFeed);

    const fx = effectsManager.effects;
    gl.uniform1i(uTexture, 0);
    gl.uniform2f(uResolution, glCanvas.width, glCanvas.height);
    gl.uniform1f(uGray, fx.grayscale / 100);
    gl.uniform1f(uBright, fx.brightness / 100);
    gl.uniform1f(uContrast, fx.contrast / 100);
    gl.uniform1f(uHue, (fx.hue / 200.0) * 6.28318);
    gl.uniform1f(uInvert, fx.invert / 100);
    gl.uniform1f(uSaturate, fx.saturate / 100);
    gl.uniform1f(uSepia, fx.sepia / 100);
    gl.uniform1f(uTime, performance.now() * 0.001);
    gl.uniform1i(uAnimMode, getAnimatedFilterMode());
    gl.uniform1f(uMirror, mirrored ? 1.0 : 0.0);

    gl.uniform1i(uDistortMode, distortionMode);
    gl.uniform1f(uDistortStrength, distortionStrength);
    gl.uniform1f(uFaceWarpEnabled, faceWarpEnabled ? 1.0 : 0.0);
    gl.uniform1i(uWarpEnabled, (distortionMode !== 0 || faceWarpEnabled) ? 1 : 0);
    gl.uniform1i(uFaceWarpMode, faceWarpMode);

    // Face warp points from MediaPipe
    let warpFace = null;
    if (currentFaceData && currentFaceData.faces.length > 0) {
      warpFace = currentFaceData.faces[0];
    } else if (lastValidFaceData && lastValidFaceData.faces.length > 0) {
      warpFace = lastValidFaceData.faces[0];
    }

    if (faceWarpEnabled && warpFace) {
      const lm = warpFace.landmarks;
      const norm = (idx) => ({ x: lm[idx].x, y: lm[idx].y });
      const leftEye = norm(33), rightEye = norm(263), noseTip = norm(1);
      const mouthLeft = norm(61), mouthRight = norm(291);
      const mouthCenter = { x: (mouthLeft.x + mouthRight.x) / 2, y: (mouthLeft.y + mouthRight.y) / 2 };
      const faceCenterX = (leftEye.x + rightEye.x) / 2;
      const faceCenterY = (leftEye.y + rightEye.y) / 2;
      const dx = mouthCenter.x - faceCenterX, dy = mouthCenter.y - faceCenterY;
      const faceRadius = Math.sqrt(dx*dx + dy*dy) * 1.3;

      gl.uniform2f(uLeftEye, leftEye.x, leftEye.y);
      gl.uniform2f(uRightEye, rightEye.x, rightEye.y);
      gl.uniform2f(uMouthCenter, mouthCenter.x, mouthCenter.y);
      gl.uniform2f(uNoseTip, noseTip.x, noseTip.y);
      gl.uniform2f(uMouthLeft, mouthLeft.x, mouthLeft.y);
      gl.uniform2f(uMouthRight, mouthRight.x, mouthRight.y);
      gl.uniform1f(uFaceWarpRadius, faceRadius);
    } else {
      gl.uniform2f(uLeftEye, -1, -1);
      gl.uniform2f(uRightEye, -1, -1);
      gl.uniform2f(uMouthCenter, -1, -1);
      gl.uniform2f(uNoseTip, -1, -1);
      gl.uniform2f(uMouthLeft, -1, -1);
      gl.uniform2f(uMouthRight, -1, -1);
      gl.uniform1f(uFaceWarpRadius, 0.3);
    }

    // Crop
    const videoW = cameraFeed.videoWidth || 1280;
    const videoH = cameraFeed.videoHeight || 720;
    const canvasW = glCanvas.width, canvasH = glCanvas.height;
    const videoAspect = videoW / videoH, canvasAspect = canvasW / canvasH;
    let cropX = 0, cropY = 0, cropW = 1, cropH = 1;
    if (videoAspect > canvasAspect) {
      cropW = canvasAspect / videoAspect;
      cropX = (1 - cropW) / 2;
    } else {
      cropH = videoAspect / canvasAspect;
      cropY = (1 - cropH) / 2;
    }
    gl.uniform2f(uCropOrigin, cropX, cropY);
    gl.uniform2f(uCropScale, cropW, cropH);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(renderWebGL);
}

// ==============================
// LOADING SCREEN
// ==============================
const loadingScreen = document.getElementById("loadingScreen");
function updateBootLine(id, text, done = false) {
  const line = document.getElementById(id);
  if (line) line.textContent = `${done ? "[✓]" : "[ ]"} ${text}`;
}
function hideLoadingScreen() {
  loadingScreen.classList.add("hidden");
  setTimeout(() => { loadingScreen.style.display = "none"; }, 600);
}

// ==============================
// FILTER ASSETS
// ==============================
const faceFilterAssets = {
  dog:      { ears: new Image(), nose: new Image() },
  cat:      { ears: new Image(), nose: new Image() },
  mustache: { nose: new Image() },
  rabbid:   { ears: new Image(), nose: new Image() },
  lorax:    { nose: new Image() },
  minion:   { ears: new Image() },
  woah:     { nose: new Image() },
  shrek:    { ears: new Image() },
  glasses:  { ears: new Image() }   // image is loaded below
};

faceFilterAssets.dog.ears.src      = "public/assets/filters/dogEars.png";
faceFilterAssets.dog.nose.src      = "public/assets/filters/dogNose.png";
faceFilterAssets.cat.ears.src      = "public/assets/filters/catEars.png";
faceFilterAssets.cat.nose.src      = "public/assets/filters/catNose.png";
faceFilterAssets.mustache.nose.src = "public/assets/filters/mustache.png";
faceFilterAssets.rabbid.ears.src   = "public/assets/filters/rabbidEars.png";
faceFilterAssets.rabbid.nose.src   = "public/assets/filters/rabbidMouth.png";
faceFilterAssets.lorax.nose.src    = "public/assets/filters/lorax.png";
faceFilterAssets.minion.ears.src   = "public/assets/filters/minionGlasses.png";
faceFilterAssets.woah.nose.src     = "public/assets/filters/woahShocked.png";
faceFilterAssets.shrek.ears.src    = "public/assets/filters/shrekEars.png";
faceFilterAssets.glasses.ears.src  = "public/assets/filters/sunglasses.png";

// Slots used by each filter – filters sharing a slot are mutually exclusive
const filterSlots = {
  dog:      ['ears', 'nose'],
  cat:      ['ears', 'nose'],
  rabbid:   ['ears', 'nose'],
  minion:   ['ears'],
  shrek:    ['ears'],
  mustache: ['mustache'],
  lorax:    ['nose'],
  woah:     ['nose'],
  glasses:  ['glasses']
};

// ==============================
// CAMERA
// ==============================
const cameraErrorOverlay = document.createElement("div");
cameraErrorOverlay.id = "cameraErrorOverlay";
cameraErrorOverlay.style.cssText = `
  position:fixed;inset:0;background:rgba(0,0,0,0.9);display:none;align-items:center;
  justify-content:center;z-index:100000;color:white;font-family:'Dos',monospace;
  flex-direction:column;text-align:center;`;
cameraErrorOverlay.innerHTML = `
  <div style="background:#000080;padding:30px;border:outset 4px #c0c0c0;max-width:500px;">
    <h2 style="margin-top:0;">Camera Access Required</h2>
    <p id="cameraErrorMsg">Unable to access the camera.</p>
    <p style="font-size:14px;">Check your browser settings and make sure a camera is connected.</p>
    <button id="retryCameraBtn" style="margin-top:15px;font-size:18px;">🔄 Retry</button>
  </div>`;
document.body.appendChild(cameraErrorOverlay);
document.getElementById("retryCameraBtn").addEventListener("click", () => {
  cameraErrorOverlay.style.display = "none";
  startCamera(currentFacingMode);
});

async function startCamera(facingMode = currentFacingMode) {
  try {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 360 } }
    });
    currentStream = stream;
    currentFacingMode = facingMode;
    cameraFeed.srcObject = stream;
    await cameraFeed.play();
    if (!/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      switchCameraBtn.style.display = "none";
    }
    mirrored = currentFacingMode === "user";
    syncOverlayMirror();
    syncOverlaySize();
    cameraErrorOverlay.style.display = "none";
  } catch (error) {
    console.error("Camera error:", error);
    cameraErrorOverlay.style.display = "flex";
    document.getElementById("cameraErrorMsg").textContent = error.message || "Cannot access camera.";
    hideLoadingScreen();
    renderWebGL();
  }
}

// ==============================
// MEDIAPIPE FACE MESH
// ==============================
async function initMediaPipe() {
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  faceMesh.setOptions({
    maxNumFaces: 2, refineLandmarks: true,
    minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
  });
  faceMesh.onResults((results) => {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
      const faces = results.multiFaceLandmarks.map(landmarks => ({ landmarks,
        headPose: results.multiFaceGeometry ? results.multiFaceGeometry[results.multiFaceLandmarks.indexOf(landmarks)] : null
      }));
      currentFaceData = { faces };
      overlayDirty = true
      lastValidFaceData = currentFaceData;
      lastFaceTime = performance.now();
    } else {
      currentFaceData = null;
    }
  });
  await faceMesh.initialize();
  mediaPipeReady = true;
}

function sendFrameToMediaPipe() {
  if (!mediaPipeReady || !faceMesh || cameraFeed.readyState < 2) return;
  faceMesh.send({ image: cameraFeed });
}

// ==============================
// GIF WORKER
// ==============================
async function loadGifWorker() {
  if (gifWorkerBlobURL) return;
  const workerUrl = "https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js";
  try {
    const response = await fetch(workerUrl);
    const text = await response.text();
    const blob = new Blob([text], { type: "application/javascript" });
    gifWorkerBlobURL = URL.createObjectURL(blob);
    document.getElementById("recordGifBtn").disabled = false;
    document.getElementById("recordBoomerangBtn").disabled = false;
  } catch (err) {
    console.error("Failed to load GIF worker:", err);
  }
}

// ==============================
// INDEXED DB
// ==============================
const DB_NAME = "PhotoBruhDB", DB_VERSION = 1, STORE_NAME = "photos";
let dbPromise = null;

function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function addPhotoToDB(blob, type = "photo", posterCanvas = null) {
  const db = await initDB();
  let thumbnailBlob = null;
  try {
    if (type === "video" || type === "gif") {
      if (posterCanvas) thumbnailBlob = await new Promise(r => posterCanvas.toBlob(r, "image/jpeg", 0.7));
    } else {
      const img = await createImageBitmap(blob);
      const tc = document.createElement("canvas");
      const max = 200;
      let w = img.width, h = img.height;
      if (w > h) { if (w > max) { h = h * (max / w); w = max; } }
      else { if (h > max) { w = w * (max / h); h = max; } }
      tc.width = w; tc.height = h;
      tc.getContext("2d").drawImage(img, 0, 0, w, h);
      thumbnailBlob = await new Promise(r => tc.toBlob(r, "image/jpeg", 0.7));
    }
  } catch (e) { console.warn("Thumbnail error:", e); }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.add({ blob, type, thumbnail: thumbnailBlob, createdAt: Date.now() });
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => {
      if (request.error?.name === "QuotaExceededError") alert("Storage full! Please delete some photos.");
      reject(request.error);
    };
  });
}

async function getAllPhotosFromDB(filter = {}) {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      let results = request.result;
      if (filter.type) results = results.filter(item => item.type === filter.type);
      if (filter.sort === "oldest") results.sort((a, b) => a.createdAt - b.createdAt);
      else results.sort((a, b) => b.createdAt - a.createdAt);
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deletePhotoFromDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id).onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function countPhotosInDB() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function migrateLocalStorageToIndexedDB() {
  const old = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};
  const values = Object.values(old);
  for (const dataURL of values) {
    const res = await fetch(dataURL);
    await addPhotoToDB(await res.blob(), "photo");
  }
  if (values.length) localStorage.removeItem("savedCanvasImage");
}

// ==============================
// HELPER FUNCTIONS
// ==============================
function lerp(a, b, t) { return a * (1 - t) + b * t; }
function getAveragePoint(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p.x; y += p.y; }
  return { x: x / points.length, y: y / points.length };
}

// ==============================
// FACE FILTER DRAWING (MediaPipe)
// ==============================
function drawFaceFilterMediaPipe(ctx, face, transform, filterType, useSmoothing = true) {
  const assets = faceFilterAssets[filterType];
  if (!assets) return;

  const landmarks = face.landmarks;
  const toCanvas = (lm) => ({ x: lm.x * ctx.canvas.width, y: lm.y * ctx.canvas.height });

  const leftEyeOuter  = toCanvas(landmarks[33]);
  const rightEyeOuter = toCanvas(landmarks[263]);
  const noseTip       = toCanvas(landmarks[1]);
  const leftBrow      = toCanvas(landmarks[105]);
  const rightBrow     = toCanvas(landmarks[334]);

  const eyeCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
  const eyeCenterY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
  const dx = rightEyeOuter.x - leftEyeOuter.x;
  const dy = rightEyeOuter.y - leftEyeOuter.y;
  const angle = Math.atan2(dy, dx);
  const eyeDist = Math.sqrt(dx * dx + dy * dy);
  const EYE_DIST_DIVISOR = 150;
  const baseScale = eyeDist / EYE_DIST_DIVISOR;

  const finalX = useSmoothing ? (transform.x = lerp(transform.x, eyeCenterX, 1 - FILTER_SMOOTHING)) : eyeCenterX;
  const finalY = useSmoothing ? (transform.y = lerp(transform.y, eyeCenterY, 1 - FILTER_SMOOTHING)) : eyeCenterY;
  const finalAngle = useSmoothing ? (transform.angle = lerp(transform.angle, angle, 1 - ANGLE_SMOOTHING)) : angle;
  const finalScale = useSmoothing ? (transform.scale = lerp(transform.scale, baseScale, 1 - FILTER_SMOOTHING)) : baseScale;

  // --- GLASSES ---
  if (filterType === 'glasses') {
    const gw = 250 * finalScale, gh = gw * 1;
    ctx.save(); ctx.translate(finalX, finalY); ctx.rotate(finalAngle);
    ctx.drawImage(assets.ears, -gw/2, -gh/2 + 10, gw, gh);
    ctx.restore();
    return;
  }

  // --- EARS ---
  if (assets.ears && filterType !== 'mustache' && filterType !== 'lorax' && filterType !== 'woah') {
    let ew = 280 * finalScale, eh = 200 * finalScale;
    if (filterType === 'minion') { ew = 216 * finalScale; eh = 270 * finalScale; }
    else if (filterType === 'rabbid') { ew = 300 * finalScale; eh = 300 * finalScale; }
    else if (filterType === 'shrek')  { ew = 240 * finalScale; eh = 200 * finalScale; }

    const browCenterY = (leftBrow.y + rightBrow.y) / 2;
    const browOffsetY = browCenterY - eyeCenterY;
    let earsY = browOffsetY - (195 * finalScale);
    if (filterType === 'minion') earsY += 100 * finalScale;
    else if (filterType === 'rabbid') earsY -= 120 * finalScale;
    else if (filterType === 'shrek')  earsY -= 50 * finalScale;

    ctx.save(); ctx.translate(finalX, finalY); ctx.rotate(finalAngle);
    ctx.drawImage(assets.ears, -ew/2, earsY, ew, eh);
    ctx.restore();
  }

  // --- NOSE ---
  if (assets.nose && filterType !== 'minion' && filterType !== 'shrek') {
    const rawDx = noseTip.x - eyeCenterX;
    const rawDy = noseTip.y - eyeCenterY;
    const cosA = Math.cos(-finalAngle), sinA = Math.sin(-finalAngle);
    const localX = rawDx * cosA - rawDy * sinA;
    const localY = rawDx * sinA + rawDy * cosA;

    if (!transform.noseLocalX) transform.noseLocalX = 0;
    if (!transform.noseLocalY) transform.noseLocalY = 0;
    const noseOffX = useSmoothing ? (transform.noseLocalX = lerp(transform.noseLocalX, localX, 1 - FILTER_SMOOTHING)) : localX;
    let noseOffY = useSmoothing ? (transform.noseLocalY = lerp(transform.noseLocalY, localY, 1 - FILTER_SMOOTHING)) : localY;

    const yOff = { dog: 0, cat: 20, mustache: 25, rabbid: 60, lorax: -10 };
    noseOffY += (yOff[filterType] || 0) * finalScale;

    let nw, nh;
    if (filterType === 'dog') { nw = 90 * finalScale; nh = 65 * finalScale; }
    else if (filterType === 'cat') { nw = 210 * finalScale; nh = 120 * finalScale; }
    else if (filterType === 'mustache') { nw = 200 * finalScale; nh = 65 * finalScale; }
    else if (filterType === 'rabbid') { nw = 200 * finalScale; nh = 200 * finalScale; }
    else if (filterType === 'lorax') { nw = 410 * finalScale; nh = 410 * finalScale; }
    else if (filterType === 'woah') { nw = 300 * finalScale; nh = 300 * finalScale; }
    else { nw = 90 * finalScale; nh = 65 * finalScale; }

    ctx.save(); ctx.translate(finalX, finalY); ctx.rotate(finalAngle);
    ctx.drawImage(assets.nose, noseOffX - nw/2, noseOffY - nh/2, nw, nh);
    ctx.restore();
  }
}

// ==============================
// ANIMATED FILTERS
// ==============================
function drawScanlines(ctx) {
  ctx.save();
  ctx.globalAlpha = 0.15;

  for (let y = 0; y < overlayCanvas.height; y += 4) {
    ctx.fillStyle = (y + animationFrameCount) % 8 === 0 ? "#000" : "#111";
    ctx.fillRect(0, y, overlayCanvas.width, 2);
  }

  ctx.restore();
}

function drawSparkles(ctx) {
  ctx.save();

  animatedParticles.forEach(p => {
    p.alpha += 0.03 * p.speed;
    const glow = (Math.sin(p.alpha) + 1) / 2;

    ctx.globalAlpha = glow;
    ctx.fillStyle = "white";

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * glow, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawSnow(ctx) {
  ctx.save();
  ctx.fillStyle = "white";

  animatedParticles.forEach(p => {
    p.y += p.speed;
    if (p.y > overlayCanvas.height) {
      p.y = -10;
      p.x = Math.random() * overlayCanvas.width;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawHearts(ctx) {
  ctx.save();
  ctx.fillStyle = "rgba(255,80,120,0.8)";

  animatedParticles.forEach(p => {
    p.y -= p.speed;
    p.x += p.drift;

    if (p.y < -30) {
      p.y = overlayCanvas.height + 30;
      p.x = Math.random() * overlayCanvas.width;
    }

    ctx.font = `${p.size}px Arial`;
    ctx.fillText("❤", p.x, p.y);
  });

  ctx.restore();
}

function drawMatrix(ctx) {
  ctx.save();
  ctx.fillStyle = "#00ff66";
  ctx.font = "20px monospace";

  animatedParticles.forEach(p => {
    p.y += p.speed;

    for (let i = 0; i < 20; i++) {
      const char = String.fromCharCode(0x30A0 + Math.random() * 96);
      ctx.globalAlpha = 1 - i / 20;
      ctx.fillText(char, p.x, p.y - i * 22);
    }

    if (p.y > overlayCanvas.height + 400) {
      p.y = -200;
    }
  });

  ctx.restore();
}

function drawAnimatedFilter(ctx) {
  switch (activeAnimatedFilter) {
    case "scanlines": drawScanlines(ctx); break;
    case "sparkles": drawSparkles(ctx); break;
    case "snow": drawSnow(ctx); break;
    case "hearts": drawHearts(ctx); break;
    case "matrix": drawMatrix(ctx); break;
  }
}

function resetAnimatedFilterState() {
  animatedParticles.length = 0;

  if (activeAnimatedFilter === "sparkles") {
    for (let i = 0; i < 40; i++) {
      animatedParticles.push({
        x: Math.random() * overlayCanvas.width,
        y: Math.random() * overlayCanvas.height,
        size: Math.random() * 4 + 1,
        speed: Math.random() * 0.8 + 0.2,
        alpha: Math.random()
      });
    }
  }

  if (activeAnimatedFilter === "snow") {
    for (let i = 0; i < 60; i++) {
      animatedParticles.push({
        x: Math.random() * overlayCanvas.width,
        y: Math.random() * overlayCanvas.height,
        size: Math.random() * 5 + 2,
        speed: Math.random() * 1.5 + 0.5
      });
    }
  }

  if (activeAnimatedFilter === "hearts") {
    for (let i = 0; i < 25; i++) {
      animatedParticles.push({
        x: Math.random() * overlayCanvas.width,
        y: overlayCanvas.height + Math.random() * 300,
        size: Math.random() * 18 + 12,
        speed: Math.random() * 1.2 + 0.5,
        drift: (Math.random() - 0.5) * 1.2
      });
    }
  }

  if (activeAnimatedFilter === "matrix") {
    for (let i = 0; i < 40; i++) {
      animatedParticles.push({
        x: i * 32,
        y: Math.random() * -800,
        speed: Math.random() * 4 + 3
      });
    }
  }
}

// ==============================
// OVERLAY RENDER LOOP
// ==============================
function renderOverlayLoop() {
  const now = performance.now();

  if (now - lastOverlayFrame < OVERLAY_INTERVAL) {
    requestAnimationFrame(renderOverlayLoop);
    return;
  }
  lastOverlayFrame = now;

  // If no filters are active and nothing has changed, skip
  if (!activeAnimatedFilter && activeFaceFilters.length === 0 && !overlayDirty) {
    requestAnimationFrame(renderOverlayLoop);
    return;
  }

  overlayDirty = false;   // we are about to draw, mark clean

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const faceLostTooLong = now - lastFaceTime > FACE_HOLD_DURATION;
  let facesToDraw = [];
  if (currentFaceData && currentFaceData.faces.length > 0) {
    facesToDraw = currentFaceData.faces;
  } else if (!faceLostTooLong && lastValidFaceData) {
    facesToDraw = lastValidFaceData.faces;
  }

  // Sync transforms
  while (dogTransforms.length < facesToDraw.length) {
    dogTransforms.push({ x:0, y:0, angle:0, scale:1, noseLocalX:0, noseLocalY:0 });
  }
  dogTransforms.length = facesToDraw.length;

  // Draw face filters (only if active)
  if (activeFaceFilters.length > 0 && facesToDraw.length > 0) {
    overlayCtx.save();
    facesToDraw.forEach((face, i) => {
      activeFaceFilters.forEach(filterType => {
        drawFaceFilterMediaPipe(overlayCtx, face, dogTransforms[i], filterType, true);
      });
    });
    overlayCtx.restore();
  }

  // Animated overlays
  if (activeAnimatedFilter) {
    overlayCtx.save();
    drawAnimatedFilter(overlayCtx);
    overlayCtx.restore();
  }

  animationFrameCount++;
  requestAnimationFrame(renderOverlayLoop);
}

// ==============================
// TAKE PHOTO
// ==============================
function takePhoto() {
  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    soundManager.play("error"); return;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  const outputWidth = glCanvas.width, outputHeight = glCanvas.height;
  canvas.width = outputWidth; canvas.height = outputHeight;
  context.clearRect(0, 0, outputWidth, outputHeight);
  context.save();

  if (effectsManager.hasActiveEffects()) context.filter = effectsManager.buildFilterString();
  soundManager.play("shutter");
  context.drawImage(glCanvas, 0, 0);

  // Use snapshot
  const facesToDraw = snapshotFaces || [];
  const transformsToUse = snapshotTransforms || [];

  if (mirrored) { context.save(); context.translate(outputWidth, 0); context.scale(-1, 1); }

  if (activeFaceFilters.length > 0 && facesToDraw.length > 0) {
    facesToDraw.forEach((face, i) => {
      const t = transformsToUse[i] || { x:0,y:0,angle:0,scale:1,noseLocalX:0,noseLocalY:0 };
      activeFaceFilters.forEach(filterType => {
        drawFaceFilterMediaPipe(context, face, t, filterType, false);
      });
    });
  }

  if (activeAnimatedFilter && ["sparkles","snow","hearts","matrix"].includes(activeAnimatedFilter)) {
    drawAnimatedFilter(context);
  }

  if (mirrored) context.restore();
  context.restore();

  canvas.toBlob(async (blob) => {
    if (!blob) return;
    const objectURL = URL.createObjectURL(blob);
    originalCapturedPhoto = objectURL;
    photo.src = objectURL;
    photo.style.display = "block";
    photo.style.opacity = "1";
    photo.onclick = () => {
      photo.classList.add("fade-out");
      photo.addEventListener("transitionend", handleFadeEnd(), { once: true });
    };
    await addPhotoToDB(blob, "photo");
    await displayTakenPhotos();
    await updatePhotoCounter();

    editorBaseImage = new Image();
    editorBaseImage.onload = () => {
      resizeEditorCanvas(editorBaseImage);
      editorCanvas.style.display = "block";
      editorObjects = [];
      redrawEditorCanvas();
    };
    editorBaseImage.src = objectURL;
  }, "image/webp", 0.95);

  setTimeout(() => {
    photo.classList.add("fade-out");
    photo.addEventListener("transitionend", handleFadeEnd(), { once: true });
  }, 2000);
}

function handleFadeEnd() {
  photo.classList.remove("fade-out");
  photo.style.display = "none";
  photo.style.opacity = "1";
}

// ==============================
// GALLERY
// ==============================
async function displayTakenPhotos(photosArray = null) {
  const photos = photosArray || await getAllPhotosFromDB();

  const photoContainer = document.getElementById("photoContainer");
  photoContainer.innerHTML = "";

  if (!photos.length) {
    photoContainer.innerHTML = "<p>No saved photos yet.</p>";
    return;
  }

  photos.forEach(entry => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("photo-item");

    // Checkbox for batch delete
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("photo-checkbox");
    checkbox.dataset.id = entry.id;
    checkbox.style.cssText = "position:absolute; top:5px; left:5px; z-index:5;";

    const img = document.createElement("img");
    // Use thumbnail if available, else full blob
    const thumbnailBlob = entry.thumbnail || entry.blob;
    const objectURL = URL.createObjectURL(thumbnailBlob);
    img.src = objectURL;
    img.alt = `Photo ${entry.id}`;
    img.classList.add("saved-photo");

    img.addEventListener("click", () => {
      openPhotoModal(URL.createObjectURL(entry.blob), entry.type);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.setAttribute("aria-label", "Delete photo");
    deleteBtn.textContent = "Delete";
    deleteBtn.classList.add("delete-btn");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      soundManager.play("delete");
      await deletePhotoFromDB(entry.id);
      await displayTakenPhotos();
      await updatePhotoCounter();
    });

    wrapper.appendChild(checkbox);
    wrapper.appendChild(img);
    wrapper.appendChild(deleteBtn);
    photoContainer.appendChild(wrapper);

    updateStorageInfo()
  });
}

async function updatePhotoCounter() {
  const total = await countPhotosInDB();
  const counter = document.getElementById("photoCounter");
  counter.textContent = `Photos Taken: ${total}`;

  updateStorageInfo()
}

function openPhotoModal(src, type = 'photo') {
  const modal = document.getElementById("photoModal");
  const container = document.getElementById("modalContent");
  if (!container) return;

  // Clear previous content
  container.innerHTML = '';

  let element;
  if (type === 'video') {
    element = document.createElement('video');
    element.src = src;
    element.controls = true;
    element.autoplay = true;
    element.loop = true;
  } else {
    // photo, gif, strip – all can be shown as images
    element = document.createElement('img');
    element.src = src;
    element.alt = 'Expanded photo';
  }

  // Common styling
  element.style.maxWidth = '100%';
  element.style.maxHeight = '90vh';
  element.style.borderRadius = '12px';
  element.style.objectFit = 'contain';
  element.style.cursor = 'default';
  element.addEventListener('click', (e) => e.stopPropagation());

  container.appendChild(element);
  modal.style.display = "flex";

  // Move focus to close button for accessibility
  const closeBtn = modal.querySelector(".close-modal");
  if (closeBtn) closeBtn.focus();
}

function closePhotoModal() {
  const modal = document.getElementById("photoModal");
  const container = document.getElementById("modalContent");
  if (container) container.innerHTML = '';
  modal.style.display = "none";
}

// ==============================
// COMPOSITE & RECORDING
// ==============================
function compositeFrame() {
  if (!recordCtx) return;
  recordCtx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
  recordCtx.drawImage(glCanvas, 0, 0);
  if (mirrored) {
    recordCtx.save(); recordCtx.translate(recordCanvas.width, 0); recordCtx.scale(-1, 1);
  }
  recordCtx.drawImage(overlayCanvas, 0, 0);
  if (mirrored) recordCtx.restore();
}

// ==============================
// VIDEO RECORDING
// ==============================
function startVideoRecording() {
  compositeFrame();                          // initial frame
  const stream = recordCanvas.captureStream(30);
  recordedChunks = [];

  const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
    ? 'video/webm; codecs=vp9'
    : 'video/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: mimeType });
    await addPhotoToDB(blob, "video", recordCanvas);
    await displayTakenPhotos();
    await updatePhotoCounter();
    stream.getTracks().forEach(track => track.stop());
    isRecording = false;
    document.getElementById("recordingStatus").style.display = "none";
    cancelAnimationFrame(recordingRAF);
  };

  const updateFrameLoop = () => {
    if (!isRecording) return;
    compositeFrame();
    recordingRAF = requestAnimationFrame(updateFrameLoop);
  };
  recordingRAF = requestAnimationFrame(updateFrameLoop);

  mediaRecorder.start();
  isRecording = true;
  document.getElementById("recordingStatus").style.display = "inline";
  soundManager.play("shutter");

  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }, 5000);
}

function stopVideoRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
  }
}

// ==============================
// GIF RECORDING
// ==============================
async function recordGIF() {
  if (!gifWorkerBlobURL) {
    alert("GIF worker not ready yet.");
    return;
  }

  const status = document.getElementById("recordingStatus");
  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: recordCanvas.width,
    height: recordCanvas.height,
    workerScript: gifWorkerBlobURL
  });

  const fps = 10;
  const duration = 3000;
  const frameCount = (fps * duration) / 1000;
  const frameInterval = 1000 / fps;

  soundManager.play("shutter");
  status.textContent = "🔴 Capturing frames...";
  status.style.display = "inline";

  for (let i = 0; i < frameCount; i++) {
    compositeFrame();
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = recordCanvas.width;
    tempCanvas.height = recordCanvas.height;
    tempCanvas.getContext("2d").drawImage(recordCanvas, 0, 0);
    gif.addFrame(tempCanvas, { delay: frameInterval });
    await new Promise(resolve => setTimeout(resolve, frameInterval));
  }

  const posterCanvas = document.createElement("canvas");
  posterCanvas.width = recordCanvas.width;
  posterCanvas.height = recordCanvas.height;
  posterCanvas.getContext("2d").drawImage(recordCanvas, 0, 0);

  status.textContent = "⏳ Processing GIF...";

  gif.on('finished', async (blob) => {
    await addPhotoToDB(blob, "gif", posterCanvas);
    await displayTakenPhotos();
    await updatePhotoCounter();
    status.style.display = "none";
    soundManager.play("success");
  });

  gif.render();
}

// ==============================
// BOOMERANG RECORDING
// ==============================
async function recordBoomerang() {
  if (!gifWorkerBlobURL) {
    alert("GIF worker not ready yet.");
    return;
  }

  const status = document.getElementById("recordingStatus");
  const fps = 15;
  const recordDuration = 1500;
  const frameInterval = 1000 / fps;
  const totalFrames = Math.floor((fps * recordDuration) / 1000);

  soundManager.play("shutter");
  status.textContent = "🔴 Capturing boomerang...";
  status.style.display = "inline";

  const forwardFrames = [];

  for (let i = 0; i < totalFrames; i++) {
    compositeFrame();
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = recordCanvas.width;
    tempCanvas.height = recordCanvas.height;
    tempCanvas.getContext("2d").drawImage(recordCanvas, 0, 0);
    forwardFrames.push(tempCanvas);
    await new Promise(resolve => setTimeout(resolve, frameInterval));
  }

  const posterCanvas = document.createElement("canvas");
  posterCanvas.width = recordCanvas.width;
  posterCanvas.height = recordCanvas.height;
  posterCanvas.getContext("2d").drawImage(recordCanvas, 0, 0);

  status.textContent = "⏳ Processing boomerang...";

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: recordCanvas.width,
    height: recordCanvas.height,
    workerScript: gifWorkerBlobURL
  });

  forwardFrames.forEach(canvas => gif.addFrame(canvas, { delay: frameInterval }));
  for (let i = forwardFrames.length - 2; i >= 0; i--) {
    gif.addFrame(forwardFrames[i], { delay: frameInterval });
  }

  gif.on('finished', async (blob) => {
    await addPhotoToDB(blob, "gif", posterCanvas);
    await displayTakenPhotos();
    await updatePhotoCounter();
    status.style.display = "none";
    soundManager.play("success");
  });

  gif.render();
}

// ==============================
// MIRROR / SYNC
// ==============================
function syncOverlayMirror() {
  overlayCanvas.style.transform = mirrored ? "scaleX(-1)" : "scaleX(1)";
}
function syncOverlaySize() {
  const rect = glCanvas.getBoundingClientRect();
  overlayCanvas.width = rect.width;
  overlayCanvas.height = rect.height;
}

// ==============================
// MAIN INITIALIZATION
// ==============================
(async () => {
  initWebGL();
  await initMediaPipe();
  await loadGifWorker();
  await startCamera("user");
  await new Promise((resolve) => {
    if (cameraFeed.readyState >= 2) resolve();
    else cameraFeed.addEventListener("loadeddata", resolve, { once: true });
  });

  faceModelsLoaded = true;
  renderWebGL();
  renderOverlayLoop();

  function mediaPipeLoop() {
    const now = performance.now();
    if (mediaPipeReady && cameraFeed.readyState >= 2 && now - lastMediaPipeSend >= MEDIAPIPE_INTERVAL) {
      sendFrameToMediaPipe();
      lastMediaPipeSend = now;
    }
    requestAnimationFrame(mediaPipeLoop);
  }
  mediaPipeLoop();

  effectsManager.syncOverlayFilter();

  updateBootLine("boot1", "Initializing Camera...", true);
  updateBootLine("boot2", "Loading Face Tracker...", true);
  updateBootLine("boot3", "Loading Filters...", true);
  setTimeout(() => {
    updateBootLine("boot4", "Starting PhotoBruh...", true);
    setTimeout(hideLoadingScreen, 500);
  }, 300);
})();

// Safety timeout
setTimeout(() => {
  const loading = document.getElementById("loadingScreen");
  if (loading && loading.style.display !== "none") {
    hideLoadingScreen();
    cameraErrorOverlay.style.display = "flex";
  }
}, 15000);

// ==============================
// EVENT LISTENERS
// ==============================
document.addEventListener("DOMContentLoaded", async () => {
  await initDB();
  await migrateLocalStorageToIndexedDB();
  await displayTakenPhotos();
  await updatePhotoCounter();
  syncOverlayMirror();
});

// Mirror button
mirrorer.addEventListener('click', () => {
  soundManager.play("click");
  mirrored = !mirrored;
  syncOverlayMirror();
});

// Switch camera
const switchCameraBtn = document.getElementById("switchCameraBtn");
switchCameraBtn.addEventListener("click", async () => {
  soundManager.play("click");
  await startCamera(currentFacingMode === "user" ? "environment" : "user");
});

// Snap button
if (snap) {
  snap.addEventListener('click', () => {
    soundManager.play("click"); soundManager.play("tick");
    isBooth = false;

    // Snapshot current face data
    let facesToUse = null;
    if (currentFaceData && currentFaceData.faces.length > 0) facesToUse = currentFaceData.faces;
    else if (lastValidFaceData) facesToUse = lastValidFaceData.faces;
    snapshotFaces = facesToUse ? facesToUse.slice() : [];
    snapshotTransforms = dogTransforms.map(t => ({ ...t }));

    let timeLeft = 3;
    countdown.style.display = "flex";
    countdown.textContent = timeLeft;
    snap.disabled = true;
    const timer = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) { countdown.textContent = timeLeft; }
      else {
        clearInterval(timer);
        countdown.style.display = "none";
        takePhoto();
        snap.disabled = false;
      }
    }, 1000);
  });
}

// Face filter buttons
document.querySelectorAll(".face-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const selected = btn.dataset.filter;

    if (selected === "none") {
      // Clear all
      activeFaceFilters = [];
    } else {
      const slots = filterSlots[selected] || [];
      // Remove any active filter that shares a slot with the new one
      activeFaceFilters = activeFaceFilters.filter(existing => {
        const existingSlots = filterSlots[existing] || [];
        return !slots.some(slot => existingSlots.includes(slot));
      });
      // Toggle the clicked filter
      const index = activeFaceFilters.indexOf(selected);
      if (index > -1) {
        activeFaceFilters.splice(index, 1);   // already active → remove
      } else {
        activeFaceFilters.push(selected);     // add it
      }
    }

    // Update button active states
    document.querySelectorAll(".face-filter-btn").forEach(b => {
      b.classList.remove("active");
    });
    activeFaceFilters.forEach(f => {
      const button = document.querySelector(`.face-filter-btn[data-filter="${f}"]`);
      if (button) button.classList.add("active");
    });

    overlayDirty = true
  });
});

// Animated filter buttons
document.querySelectorAll(".animated-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    activeAnimatedFilter = btn.dataset.anim === "none" ? null : btn.dataset.anim;
    resetAnimatedFilterState();
  });

  overlayDirty = true
});

// Face warp buttons
document.querySelectorAll(".face-warp-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    faceWarpMode = parseInt(btn.dataset.mode);
    faceWarpEnabled = true;
    document.getElementById("faceWarpToggleBtn").textContent = "Face Warp: On";
  });
});
document.getElementById("faceWarpToggleBtn").addEventListener("click", () => {
  faceWarpEnabled = !faceWarpEnabled;
  document.getElementById("faceWarpToggleBtn").textContent = "Face Warp: " + (faceWarpEnabled ? "On" : "Off");
  if (!faceWarpEnabled) faceWarpMode = 0;
});

// Effects panel toggle
if (effects) {
  effects.addEventListener('click', () => {
    soundManager.play("click");
    const el = document.getElementById('effectsList');
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
  });
}

// Gallery controls
document.getElementById("deleteSelectedBtn").addEventListener("click", async () => {
  const cbs = document.querySelectorAll(".photo-checkbox:checked");
  if (!cbs.length) return alert("No photos selected.");
  if (!confirm(`Delete ${cbs.length} photo(s)?`)) return;
  soundManager.play("delete");
  for (const cb of cbs) await deletePhotoFromDB(Number(cb.dataset.id));
  await displayTakenPhotos(); await updatePhotoCounter();
});

document.getElementById("clearAllBtn").addEventListener("click", async () => {
  if (!confirm("Delete ALL photos?")) return;
  soundManager.play("delete");
  const photos = await getAllPhotosFromDB();
  for (const p of photos) await deletePhotoFromDB(p.id);
  await displayTakenPhotos(); await updatePhotoCounter();
});

document.getElementById("sortSelect").addEventListener("change", async (e) => {
  const v = e.target.value;
  let filter = {};
  if (v === "oldest") filter.sort = "oldest";
  else if (v === "photos") filter.type = "photo";
  else if (v === "strips") filter.type = "strip";
  await displayTakenPhotos(await getAllPhotosFromDB(filter));
});

document.getElementById("exportZipBtn").addEventListener("click", async () => {
  soundManager.play("click");
  const photos = await getAllPhotosFromDB();
  if (!photos.length) return alert("No photos to export.");
  const zip = new JSZip();
  const folder = zip.folder("photobruh-photos");
  photos.forEach((entry, i) => {
    const ext = entry.type === "strip" ? "png" : "webp";
    folder.file(`photo_${i+1}.${ext}`, entry.blob);
  });
  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(content);
  a.download = "photobruh-photos.zip";
  a.click();
  soundManager.play("success");
});

// Theme / UI toggles
document.getElementById("themeBtn").addEventListener("click", () => {
  currentTheme = (currentTheme + 1) % themes.length;
  const nextTheme = themes[currentTheme];

  if (nextTheme === "win95") {
      document.body.removeAttribute("data-theme");
      themeBtn.textContent = "Theme: Win95";
  } else {
      document.body.setAttribute("data-theme", nextTheme);
      themeBtn.textContent = `Theme: ${nextTheme.charAt(0).toUpperCase() + nextTheme.slice(1)}`;
  }
});

document.getElementById("toggleCRT").addEventListener("click", () => {
  document.body.classList.toggle("no-crt");
  crtBtn.textContent = document.body.classList.contains("no-crt") ? "CRT Effect: Off" : "CRT Effect: On";
});

document.getElementById("contrastBtn").addEventListener("click", () => {
  document.body.classList.toggle("high-contrast");
  const isHC = document.body.classList.contains("high-contrast");
  contrastBtn.textContent = isHC ? "High Contrast: On" : "High Contrast: Off";
});

document.getElementById("muteBtn").addEventListener("click", () => {
  soundManager.toggle();
  muteBtn.textContent = soundManager.enabled ? "Sound: On" : "Sound: Off";
});

// Download buttons
document.getElementById("downloadOriginalBtn").addEventListener("click", () => {
  soundManager.play("click");
  if (!originalCapturedPhoto) return alert("No photo available.");
  const a = document.createElement("a");
  a.href = originalCapturedPhoto; a.download = "photobruh-original.png";
  a.click();
});
document.getElementById("downloadEditedBtn").addEventListener("click", () => {
  soundManager.play("click");
  if (!editorBaseImage) return alert("No edited photo available.");
  const a = document.createElement("a");
  a.href = editorCanvas.toDataURL("image/png");
  a.download = "photobruh-edited.png";
  a.click();
});

// Video / GIF / Boomerang buttons
recordVideoBtn.addEventListener("click", () => {
  if (isRecording) return;
  soundManager.play("click");
  startVideoRecording();
});

recordGifBtn.addEventListener("click", () => {
  soundManager.play("click");
  recordGIF();
});

recordBoomerangBtn.addEventListener("click", () => {
  soundManager.play("click");
  recordBoomerang();
});

// Storage info
async function updateStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) {
    document.getElementById("storageInfo").textContent = "Storage info not available.";
    return;
  }
  const estimate = await navigator.storage.estimate();
  const usedMB = (estimate.usage / 1024 / 1024).toFixed(1);
  const quotaMB = (estimate.quota / 1024 / 1024).toFixed(1);
  document.getElementById("storageInfo").textContent = 
    `Storage: ${usedMB} MB used of ${quotaMB} MB`;
}

// Resize listeners
window.addEventListener("resize", syncOverlaySize);
window.addEventListener("orientationchange", syncOverlaySize);
cameraFeed.addEventListener("loadedmetadata", syncOverlaySize);
syncOverlaySize();