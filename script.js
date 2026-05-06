const cameraFeed = document.getElementById('cameraFeed');
const mirrorer = document.getElementById('mirrorer');
const snap = document.getElementById('snap');
const effects = document.getElementById('effects');
const canvas = document.getElementById('preview');
const photo = document.getElementById('photo');
const countdown = document.getElementById('countdown');

let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

let currentFacingMode = "user"; // "user" = front, "environment" = back
let currentStream = null;

let mirrored = false;
let activeFaceFilter = null;
let faceModelsLoaded = false;

let trackedFaces = [];
const SMOOTHING = 0.55; // higher = smoother, lower = more responsive

let lastDetectionTime = 0;
const DETECTION_INTERVAL = 100; // ms (10 detections/sec)
let detectionInProgress = false;

let originalCapturedPhoto = null;

let dogTransforms = [];

let activeAnimatedFilter = null;
let animationFrameCount = 0;

const animatedParticles = [];

let distortionMode = 0;       // 0=none, 1=bulge, 2=swirl, 3=pinch
let distortionStrength = 0.0; // controllable range e.g. 0–1
let faceWarpEnabled = false;

const FILTER_SMOOTHING = 0.75;

// =========================
// INDEXED DB
// =========================
const DB_NAME = "PhotoBruhDB";
const DB_VERSION = 1;
const STORE_NAME = "photos";

let dbPromise = null;

function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function addPhotoToDB(blob, type = "photo") {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const request = store.add({
      blob,
      type,
      createdAt: Date.now()
    });

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAllPhotosFromDB() {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result.sort((a, b) => b.createdAt - a.createdAt);
      resolve(results);
    };

    request.onerror = () => reject(request.error);
  });
}

async function deletePhotoFromDB(id) {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function countPhotosInDB() {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// =========================
// LOCALSTORAGE TO INDEXEDDB MIGRATION (if any)
// =========================

async function migrateLocalStorageToIndexedDB() {
  const oldPhotos = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};
  const values = Object.values(oldPhotos);

  if (!values.length) return;

  for (const dataURL of values) {
    const res = await fetch(dataURL);
    const blob = await res.blob();
    await addPhotoToDB(blob, "photo");
  }

  localStorage.removeItem("savedCanvasImage");
}

// =========================
// WEBGL RENDERER
// =========================

const glCanvas = document.getElementById("glCanvas");
const gl = glCanvas.getContext("webgl", {
  premultipliedAlpha: false,
  antialias: false,
  preserveDrawingBuffer: true,
  willReadFrequently: true
});

let glProgram;
let videoTexture;
let glBuffer;

let uGray, uBright, uContrast, uHue, uInvert, uSaturate, uSepia;
let uResolution, uTexture, uTime, uAnimMode, uMirror;

// =========================
// SHADER SETUP
// =========================

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

// Shaders

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

  uniform int uDistortMode;
  uniform float uDistortStrength;
  uniform float uFaceWarpEnabled;
  uniform vec2 uLeftEye;
  uniform vec2 uRightEye;
  uniform vec2 uMouthCenter;
  uniform vec2 uNoseTip;

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
          vec2 features[4];
          features[0] = uLeftEye;
          features[1] = uRightEye;
          features[2] = uMouthCenter;
          features[3] = uNoseTip;
          float radii[4];
          radii[0] = 0.06;  // eye region radius (normalised)
          radii[1] = 0.06;
          radii[2] = 0.08;
          radii[3] = 0.07;

          for (int i = 0; i < 4; i++) {
              vec2 delta = st - features[i];
              float dist = length(delta);
              float r = radii[i];

              if (dist < r) {
                  // Simple bulge in the region
                  float factor = 1.0 - (dist / r);
                  factor = factor * factor * 0.15; // strength
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
      vec2 warpedUV = warpCoord(uv);

      // Add a soft clamp to avoid sampling beyond the texture border
      warpedUV = clamp(warpedUV, vec2(0.001), vec2(0.999));

      vec4 tex = texture2D(uTexture, warpedUV);
      vec3 color = tex.rgb;

      // [ ... all your existing colour processing (gray, contrast, etc.) remains here ... ]

      // Your original animated‑effects call:
      color = applyAnimatedFX(uv, color);   // keep as‑is (uses original uv)

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), tex.a);
  }
  `;

// =========================
// WEBGL INITIALIZATION
// =========================

function initWebGL() {
  glProgram = createProgram(gl, vertexShaderSource, fragmentShaderSource);
  gl.useProgram(glProgram);

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

  // Face warp feature points (normalised 0–1 coords)
  uLeftEye       = gl.getUniformLocation(glProgram, "uLeftEye");
  uRightEye      = gl.getUniformLocation(glProgram, "uRightEye");
  uMouthCenter   = gl.getUniformLocation(glProgram, "uMouthCenter");
  uNoseTip       = gl.getUniformLocation(glProgram, "uNoseTip");
  uFaceWarpEnabled = gl.getUniformLocation(glProgram, "uFaceWarpEnabled");
}

// Filter Helper

function getAnimatedFilterMode() {
  switch (activeAnimatedFilter) {
    case "scanlines": return 1;
    default: return 0;
  }
}

// =========================
// LIVE WEBGL RENDER LOOP
// =========================

function renderWebGL() {
  if (cameraFeed.readyState >= 2) {
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);

    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      cameraFeed
    );

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

    // --- Distortion uniforms ---
    gl.uniform1i(uDistortMode, distortionMode);
    gl.uniform1f(uDistortStrength, distortionStrength);
    gl.uniform1f(uFaceWarpEnabled, faceWarpEnabled ? 1.0 : 0.0);

    // --- Face warp feature points (normalised 0–1) ---
    if (faceWarpEnabled && trackedFaces.length > 0) {
        const face = trackedFaces[0];  // use first face
        const lm = face.landmarks;

        // Helper: normalise a pixel point from the video
        const norm = (p) => ({
            x: p.x / cameraFeed.videoWidth,
            y: p.y / cameraFeed.videoHeight
        });

        const leftEye   = norm(getAveragePoint(lm.getLeftEye()));
        const rightEye  = norm(getAveragePoint(lm.getRightEye()));
        const mouth     = norm(getAveragePoint(lm.positions.slice(48, 68))); // outer mouth
        const noseTip   = norm(lm.positions[30]);

        gl.uniform2f(uLeftEye,     leftEye.x,   leftEye.y);
        gl.uniform2f(uRightEye,    rightEye.x,  rightEye.y);
        gl.uniform2f(uMouthCenter, mouth.x,     mouth.y);
        gl.uniform2f(uNoseTip,     noseTip.x,   noseTip.y);
    } else {
        // Set dummy values to avoid undefined behaviour
        gl.uniform2f(uLeftEye,     -1.0, -1.0);
        gl.uniform2f(uRightEye,    -1.0, -1.0);
        gl.uniform2f(uMouthCenter, -1.0, -1.0);
        gl.uniform2f(uNoseTip,     -1.0, -1.0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  requestAnimationFrame(renderWebGL);
}

// ==============
// LOADING SCREEN
// ==============
const loadingScreen = document.getElementById("loadingScreen");

function updateBootLine(id, text, done = false) {
  const line = document.getElementById(id);
  if (!line) return;

  line.textContent = `${done ? "[✓]" : "[ ]"} ${text}`;
}

function hideLoadingScreen() {
  loadingScreen.classList.add("hidden");

  setTimeout(() => {
    loadingScreen.style.display = "none";
  }, 600);
}

// =========================
// LIVE FILTER OVERLAY CANVAS
// =========================
const overlayCanvas = document.createElement("canvas");
const offCtx = overlayCanvas.getContext("2d", {
  willReadFrequently: true
});
overlayCanvas.id = "filterOverlay";
overlayCanvas.width = 1280;
overlayCanvas.height = 720;

overlayCanvas.style.position = "absolute";
overlayCanvas.style.top = "0";
overlayCanvas.style.left = "0";
overlayCanvas.style.width = "1280px";
overlayCanvas.style.height = "720px";
overlayCanvas.style.zIndex = "2";
overlayCanvas.style.pointerEvents = "none";
overlayCanvas.style.background = "transparent";

document.getElementById("cameraWrapper").appendChild(overlayCanvas);

const overlayCtx = overlayCanvas.getContext("2d", {
  willReadFrequently: true
});

// =========================
// FILTER ASSETS
// =========================
const faceFilterAssets = {
  dog: {
    ears: new Image(),
    nose: new Image()
  },
  cat: {
    ears: new Image(),
    nose: new Image()
  },
  mustache: {
    nose: new Image()
  },
  rabbid: {
    ears: new Image(),
    nose: new Image()
  },
  lorax: {
    nose: new Image()
  },
  minion: {
    ears: new Image()
  },
  woah: {
    nose: new Image()
  },
  shrek: {
    ears: new Image()
  }
};

faceFilterAssets.dog.ears.src = "public/assets/filters/dogEars.png";
faceFilterAssets.dog.nose.src = "public/assets/filters/dogNose.png";

faceFilterAssets.cat.ears.src = "public/assets/filters/catEars.png";
faceFilterAssets.cat.nose.src = "public/assets/filters/catNose.png";

faceFilterAssets.mustache.nose.src = "public/assets/filters/mustache.png";

faceFilterAssets.rabbid.ears.src = "public/assets/filters/rabbidEars.png";
faceFilterAssets.rabbid.nose.src = "public/assets/filters/rabbidMouth.png";

faceFilterAssets.lorax.nose.src = "public/assets/filters/lorax.png";

faceFilterAssets.minion.ears.src = "public/assets/filters/minionGlasses.png"

faceFilterAssets.woah.nose.src = "public/assets/filters/woahShocked.png"

faceFilterAssets.shrek.ears.src = "public/assets/filters/shrekEars.png"

// =========================
// CAMERA AND LOADING STARTUP
// =========================
async function startCamera(facingMode = currentFacingMode) {
  try {
    // stop previous stream
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
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
  } catch (error) {
    console.error("Error accessing camera:", error);
  }
}

(async () => {
  initWebGL();
  await startCamera("user");
  await loadFaceModels();
  updateBootLine("boot1", "Initializing Camera...", true);

  renderWebGL();
  renderOverlayLoop();
})();

// =========================
// FACE API MODEL LOADING
// =========================
async function loadFaceModels() {
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);

    updateBootLine("boot2", "Loading Face Tracker...", true);
    updateBootLine("boot3", "Loading Filters...", true);

    faceModelsLoaded = true;
    detectFaceLoop();

    setTimeout(() => {
      updateBootLine("boot4", "Starting PhotoBruh...", true);

      setTimeout(() => {
        hideLoadingScreen();
      }, 500);
    }, 300);

  } catch (err) {
    console.error("Failed to load face models:", err);
  }
}

async function detectFaceLoop() {
  if (!faceModelsLoaded) return;

  const now = performance.now();

  // skip if detection is already running
  if (detectionInProgress) {
    requestAnimationFrame(detectFaceLoop);
    return;
  }

  // skip until enough time has passed
  if (now - lastDetectionTime < DETECTION_INTERVAL) {
    requestAnimationFrame(detectFaceLoop);
    return;
  }

  if (cameraFeed.readyState >= 2) {
    detectionInProgress = true;
    lastDetectionTime = now;

    try {
      const detections = await faceapi
        .detectAllFaces(
          cameraFeed,
          new faceapi.TinyFaceDetectorOptions({
            inputSize: 224,
            scoreThreshold: 0.5
          })
        )
        .withFaceLandmarks(true);

      trackedFaces = detections.map((face, i) => {
        if (!dogTransforms[i]) {
          dogTransforms[i] = {
            x: 0,
            y: 0,
            angle: 0,
            scale: 1,
            noseOffsetX: 0,
            noseOffsetY: 0
          };
        }

        return face;
      });

      dogTransforms.length = trackedFaces.length;
    } catch (err) {
      console.error("Face detection error:", err);
    }

    detectionInProgress = false;
  }

  requestAnimationFrame(detectFaceLoop);
}

function smoothFace(oldFace, newFace) {
  const oldPts = oldFace.landmarks.positions;
  const newPts = newFace.landmarks.positions;

  const blended = newPts.map((pt, i) => {
    const old = oldPts[i] || pt;

    return {
      x: old.x * SMOOTHING + pt.x * (1 - SMOOTHING),
      y: old.y * SMOOTHING + pt.y * (1 - SMOOTHING)
    };
  });

  return {
    ...newFace,
    landmarks: {
      ...newFace.landmarks,
      positions: blended,
      getLeftEye: () => blended.slice(36, 42),
      getRightEye: () => blended.slice(42, 48),
      getNose: () => blended.slice(27, 36)
    }
  };
}

function getAveragePoint(points) {
  let x = 0;
  let y = 0;

  for (const p of points) {
    x += p.x;
    y += p.y;
  }

  return {
    x: x / points.length,
    y: y / points.length
  };
}

function lerp(a, b, t) {
  return a * (1 - t) + b * t;
}

// =========================
// LIVE OVERLAY RENDER LOOP
// =========================
function renderOverlayLoop() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // Face filters
  if (activeFaceFilter && trackedFaces.length) {
    overlayCtx.save();

    trackedFaces.forEach((face, i) => {
      drawFaceFilter(
        overlayCtx,
        face,
        cameraFeed,
        dogTransforms[i],
        activeFaceFilter,
        true
      );
    });

    overlayCtx.restore();
  }

  // Animated overlays (always independent)
  if (activeAnimatedFilter) {
    overlayCtx.save();
    drawAnimatedFilter(overlayCtx);
    overlayCtx.restore();
  }

  animationFrameCount++;
  requestAnimationFrame(renderOverlayLoop);
}

function drawAnimatedFilter(ctx) {
  switch (activeAnimatedFilter) {
    case "scanlines":
      drawScanlines(ctx);
      break;
    case "sparkles":
      drawSparkles(ctx);
      break;
    case "snow":
      drawSnow(ctx);
      break;
    case "hearts":
      drawHearts(ctx);
      break;
    case "matrix":
      drawMatrix(ctx);
      break;
  }
}

// =========================
// MIRROR CAMERA
// =========================
mirrorer.addEventListener('click', () => {
  soundManager.play("click");
  mirrored = !mirrored;
  syncOverlayMirror();
});

// =========================
// SWITCH CAMERA
// =========================
const switchCameraBtn = document.getElementById("switchCameraBtn");

switchCameraBtn.addEventListener("click", async () => {
  soundManager.play("click");
  const nextMode = currentFacingMode === "user" ? "environment" : "user";

  await startCamera(nextMode);
});


// =========================
// SNAP COUNTDOWN
// =========================
snap.addEventListener('click', () => {
  soundManager.play("click");
  soundManager.play("tick");
  isBooth = false;
  let timeLeft = 3;

  countdown.style.display = "flex";
  countdown.textContent = timeLeft;

  snap.disabled = true;

  const timer = setInterval(() => {
    timeLeft--;

    if (timeLeft > 0) {
      countdown.textContent = timeLeft;
    } else {
      clearInterval(timer);
      countdown.style.display = "none";
      takePhoto();
      snap.disabled = false;
    }
  }, 1000);
});

// =========================
// FILTER TOGGLE
// =========================
document.querySelectorAll(".face-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const selected = btn.dataset.filter;
    activeFaceFilter = selected === "none" ? null : selected;
    console.log("Active filter:", activeFaceFilter);
  });
});

document.querySelectorAll(".animated-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const selected = btn.dataset.anim;
    activeAnimatedFilter = selected === "none" ? null : selected;

    resetAnimatedFilterState();
    console.log("Animated filter:", activeAnimatedFilter);
  });
});

// =========================
// EFFECTS MANAGEMENT
// =========================
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
      bw: { grayscale: 100, brightness: 100, blur: 0, contrast: 100, hue: 0, invert: 0, saturate: 0, sepia: 0 },
      sepia: { grayscale: 0, brightness: 100, blur: 0, contrast: 100, hue: 0, invert: 0, saturate: 100, sepia: 100 },
      cool: { grayscale: 0, brightness: 100, blur: 0, contrast: 120, hue: 200, invert: 0, saturate: 80, sepia: 0 },
      warm: { grayscale: 0, brightness: 110, blur: 0, contrast: 90, hue: 30, invert: 0, saturate: 120, sepia: 20 },
      night: { grayscale: 0, brightness: 150, blur: 0, contrast: 140, hue: 200, invert: 0, saturate: 50, sepia: 0 },
      vivid: { grayscale: 0, brightness: 100, blur: 0, contrast: 150, hue: 0, invert: 0, saturate: 150, sepia: 0 }
    };

    if (presets[presetName]) {
      this.effects = { ...presets[presetName] };
      this.updateSliderUI();
      this.applyEffects();
    }
  }

  updateSliderUI() {
    Object.entries(this.sliders).forEach(([key, slider]) => {
      slider.value = this.effects[key];
    });
  }

  reset() {
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
    this.updateSliderUI();
    this.applyEffects();
  }

  hasActiveEffects() {
    return Object.entries(this.effects).some(([key, value]) => {
      const defaults = { brightness: 100, contrast: 100, saturate: 100 };
      const defaultValue = defaults[key] ?? 0;
      return value !== defaultValue;
    });
  }
}

const effectsManager = new EffectsManager();

// =========================
// RESET ANIMATED STATE
// =========================

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

// =========================
// EFFECTS PANEL TOGGLE
// =========================
effects.addEventListener('click', () => {
  soundManager.play("click");
  const effectsList = document.getElementById('effectsList');
  effectsList.style.display = effectsList.style.display === 'block' ? 'none' : 'block';
});

function getVisibleVideoRect() {
  const videoW = cameraFeed.videoWidth;
  const videoH = cameraFeed.videoHeight;

  // Use actual render surface, not DOM CSS box
  const displayW = glCanvas.width;
  const displayH = glCanvas.height;

  const videoAspect = videoW / videoH;
  const displayAspect = displayW / displayH;

  let drawW, drawH, offsetX, offsetY;

  if (videoAspect > displayAspect) {
    // video wider than viewport
    drawH = videoH;
    drawW = videoH * displayAspect;
    offsetX = (videoW - drawW) / 2;
    offsetY = 0;
  } else {
    // video taller than viewport
    drawW = videoW;
    drawH = videoW / displayAspect;
    offsetX = 0;
    offsetY = (videoH - drawH) / 2;
  }

  return {
    offsetX,
    offsetY,
    drawW,
    drawH,
    displayW,
    displayH
  };
}

// =========================
// DRAW FACE FILTER (not animated)
// =========================
function drawFaceFilter(context, detection, videoElement, transform, filterType, useSmoothing = true) {
  const assets = faceFilterAssets[filterType];
  if (!assets) return;

  const earsImg = assets.ears;
  const noseImg = assets.nose;
  if (!detection) return;

  const canvas = context.canvas;
  const landmarks = detection.landmarks.positions;

  // Stable anchor points
  const leftEye = mapLandmarkToCanvas(
    getAveragePoint(landmarks.slice(36, 42)),
    videoElement,
    canvas
  );

  const rightEye = mapLandmarkToCanvas(
    getAveragePoint(landmarks.slice(42, 48)),
    videoElement,
    canvas
  );

  const nose = mapLandmarkToCanvas(
    landmarks[30], // nose tip
    videoElement,
    canvas
  );

  const leftBrow = mapLandmarkToCanvas(
    getAveragePoint(landmarks.slice(17, 22)),
    videoElement,
    canvas
  );

  const rightBrow = mapLandmarkToCanvas(
    getAveragePoint(landmarks.slice(22, 27)),
    videoElement,
    canvas
  );

  const jawLeft = mapLandmarkToCanvas(landmarks[0], videoElement, canvas);
  const jawRight = mapLandmarkToCanvas(landmarks[16], videoElement, canvas);

  // Face geometry
  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;

  const browCenterX = (leftBrow.x + rightBrow.x) / 2;
  const browCenterY = (leftBrow.y + rightBrow.y) / 2;

  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;

  let angle = Math.atan2(dy, dx);

  const faceWidth = Math.abs(jawRight.x - jawLeft.x);

  // restore original proportional scaling
  let scale = faceWidth / 200;

  // Smooth full transform
  const finalX = useSmoothing
    ? (transform.x = lerp(transform.x, eyeCenterX, 1 - FILTER_SMOOTHING))
    : eyeCenterX;

  const finalY = useSmoothing
    ? (transform.y = lerp(transform.y, eyeCenterY, 1 - FILTER_SMOOTHING))
    : eyeCenterY;

  const finalAngle = useSmoothing
    ? (transform.angle = lerp(transform.angle, angle, 1 - FILTER_SMOOTHING))
    : angle;

  const finalScale = useSmoothing
    ? (transform.scale = lerp(transform.scale, scale, 1 - FILTER_SMOOTHING))
    : scale;


  // ===== EARS =====
  context.save();
  context.translate(finalX, finalY);
  context.rotate(finalAngle);

  let earsWidth = 260 * finalScale;
  let earsHeight = 180 * finalScale;
  if (filterType == 'minion') {
    earsWidth = 216 * finalScale
    earsHeight = 270 * finalScale
  } else if (filterType == 'rabbid') {
    earsWidth = 300 * finalScale
    earsHeight = 300 * finalScale
  }  else if (filterType == 'shrek') {
    earsWidth = 240 * finalScale
    earsHeight = 200 * finalScale
  }

// place ears relative to eyebrow line instead of hardcoded lift
  const browOffsetY = browCenterY - eyeCenterY;

  // one clean vertical offset for ears
  let earsY = browOffsetY - (195 * finalScale);
  if (filterType == 'minion') {
    earsY = browOffsetY - (195 * finalScale) + (100 * finalScale);
  } else if (filterType == 'rabbid') {
    earsY = browOffsetY - (195 * finalScale) - (120 * finalScale);
  } else if (filterType == 'shrek') {
    earsY = browOffsetY - (195 * finalScale) - (50 * finalScale);
  }

  if (filterType != 'mustache' && filterType != 'lorax' && filterType != 'woah') {
    context.drawImage(
      earsImg,
      -earsWidth / 2,
      earsY,
      earsWidth,
      earsHeight
    );
  }


  context.restore();

  // ===== NOSE =====
  context.save();
  context.translate(finalX, finalY);
  context.rotate(finalAngle);

  // nose offset relative to face center (LOCAL face space)
  const rawNoseOffsetX = nose.x - eyeCenterX;
  const rawNoseOffsetY = nose.y - eyeCenterY;

  const noseOffsetX = useSmoothing
    ? (transform.noseOffsetX = lerp(transform.noseOffsetX, rawNoseOffsetX, 1 - FILTER_SMOOTHING))
    : rawNoseOffsetX;

  let noseOffsetY = useSmoothing
    ? (transform.noseOffsetY = lerp(transform.noseOffsetY, rawNoseOffsetY, 1 - FILTER_SMOOTHING))
    : rawNoseOffsetY;

  const filterNoseYOffset = {
    dog: 0,
    cat: 20,
    mustache: 35,
    rabbid: 60,
    lorax: -10,
    minion: 0
  };

  noseOffsetY += (filterNoseYOffset[filterType] || 0) * finalScale;

  let noseWidth;
  if (filterType == 'dog') {
    noseWidth = 90 * finalScale;
  } else if (filterType == 'cat') {
    noseWidth = 210 * finalScale;
  } else if (filterType == 'mustache') {
    noseWidth = 200 * finalScale;
  } else if (filterType == 'rabbid') {
    noseWidth = 200 * finalScale;
  } else if (filterType == 'lorax') {
    noseWidth = 410 * finalScale;
  } else if (filterType == 'woah') {
    noseWidth = 300 * finalScale;
  } else {
    noseWidth = 90 * finalScale;
  }


  let noseHeight;
  if (filterType == 'dog' || filterType == 'mustache') {
    noseHeight = 65 * finalScale;
  } else if (filterType == 'cat') {
    noseHeight = 120 * finalScale;
  } else if (filterType == 'rabbid') {
    noseHeight = 200 * finalScale;
  } else if (filterType == 'lorax') {
    noseHeight = 410 * finalScale;
  } else if (filterType == 'woah') {
    noseHeight = 300 * finalScale;
  } else {
    noseHeight = 65 * finalScale;
  }

  if (filterType != 'minion' && filterType != 'shrek') {
    context.drawImage(
      noseImg,
      noseOffsetX - noseWidth / 2,
      noseOffsetY - noseHeight / 2,
      noseWidth,
      noseHeight
    );
  }

  context.restore();
}

function getVideoDisplayRect() {
  const rect = cameraFeed.getBoundingClientRect();

  return {
    width: rect.width,
    height: rect.height,
    left: rect.left,
    top: rect.top
  };
}

// =========================
// ADD ANIMATION EFFECTS
// =========================

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

// =========================
// TAKE PHOTO
// =========================
function takePhoto() {
  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    console.error("Video not ready yet");
    soundManager.play("error");
    return;
  }

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const visible = getVisibleVideoRect();

  // Final saved image should match visible preview aspect
  const outputWidth = 1280;
  const outputHeight = Math.round(outputWidth * (visible.displayH / visible.displayW));

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  context.clearRect(0, 0, outputWidth, outputHeight);
  context.save();


  if (effectsManager.hasActiveEffects()) {
    context.filter = effectsManager.buildFilterString();
  }

  soundManager.play("shutter");

  context.drawImage(
    glCanvas,
    visible.offsetX, visible.offsetY, visible.drawW, visible.drawH,
    0, 0, outputWidth, outputHeight
  );

  // Mirror the filter layer to match the mirrored base image
  if (mirrored) {
      context.save();
      context.translate(outputWidth, 0);
      context.scale(-1, 1);
  }

  if (activeFaceFilter && trackedFaces.length) {
      trackedFaces.forEach((face, i) => {
          drawFaceFilter(context, face, cameraFeed, dogTransforms[i], activeFaceFilter, false);
      });
  }

  if (
      activeAnimatedFilter &&
      ["sparkles", "snow", "hearts", "matrix"].includes(activeAnimatedFilter)
  ) {
      drawAnimatedFilter(context);
  }

  if (mirrored) {
      context.restore();
  }

  context.restore();

  canvas.toBlob(async (blob) => {
    if (!blob) return;

    const objectURL = URL.createObjectURL(blob);

    originalCapturedPhoto = objectURL;

    photo.src = objectURL;
    photo.style.display = "block";
    photo.style.opacity = "1";

    const testImg = new Image();
    testImg.onload = () => {
      console.log("Captured size:", testImg.naturalWidth, testImg.naturalHeight);
    };
    testImg.src = objectURL;

    await addPhotoToDB(blob, "photo");

    await displayTakenPhotos();
    await updatePhotoCounter();

    editorBaseImage = new Image();
    editorBaseImage.onload = () => {
      editorCanvas.style.display = "block";
      stickers = [];
      redrawEditorCanvas();
    };
    editorBaseImage.src = objectURL;
  }, "image/webp", 0.95);

  setTimeout(() => {
    photo.classList.add("fade-out");
    photo.addEventListener("transitionend", handleFadeEnd(), { once: true });
  }, 2000);

}

function downloadImage(dataURL, filename) {
  const link = document.createElement("a");
  link.href = dataURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadOriginalPhoto() {
  if (!originalCapturedPhoto) {
    alert("No photo available to download.");
    soundManager.play("error");
    return;
  }

  downloadImage(originalCapturedPhoto, "photobruh-original.png");
  soundManager.play("success");
}

function downloadEditedPhoto() {
  if (!editorBaseImage) {
    alert("No edited photo available to download.");
    soundManager.play("error");
    return;
  }

  const editedDataURL = editorCanvas.toDataURL("image/png");
  downloadImage(editedDataURL, "photobruh-edited.png");
  soundManager.play("success");
}

document.getElementById("downloadOriginalBtn").addEventListener("click", () => {
  soundManager.play("click");
  downloadOriginalPhoto();
});
document.getElementById("downloadEditedBtn").addEventListener("click", () => {
  soundManager.play("click");
  downloadEditedPhoto();
});

function handleFadeEnd() {
  photo.classList.remove("fade-out");
  photo.style.display = "none";
  photo.style.opacity = "1";
}

// =========================
// PHOTO COUNTER
// =========================

async function updatePhotoCounter() {
  const total = await countPhotosInDB();
  const counter = document.getElementById("photoCounter");
  counter.textContent = `Photos Taken: ${total}`;
}

// =========================
// GALLERY
// =========================
async function displayTakenPhotos() {
  const photoContainer = document.getElementById("photoContainer");
  const photos = await getAllPhotosFromDB();

  photoContainer.innerHTML = "";

  if (!photos.length) {
    photoContainer.innerHTML = "<p>No saved photos yet.</p>";
    return;
  }

  photos.forEach((entry, index) => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("photo-item");

    const img = document.createElement("img");
    const objectURL = URL.createObjectURL(entry.blob);

    img.src = objectURL;
    img.alt = `Saved Photo ${index + 1}`;
    img.classList.add("saved-photo");

    img.addEventListener("click", () => openPhotoModal(objectURL));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.classList.add("delete-btn");

    deleteBtn.addEventListener("click", async () => {
      soundManager.play("delete");
      await deletePhotoFromDB(entry.id);
      await displayTakenPhotos();
      await updatePhotoCounter();
    });

    wrapper.appendChild(img);
    wrapper.appendChild(deleteBtn);
    photoContainer.appendChild(wrapper);
  });
}

// =========================
// MODAL
// =========================
function openPhotoModal(imageSrc) {
  const modal = document.getElementById("photoModal");
  const modalImg = document.getElementById("modalImage");

  modalImg.src = imageSrc;
  modal.style.display = "flex";
}

function closePhotoModal() {
  const modal = document.getElementById("photoModal");
  const modalImg = document.getElementById("modalImage");

  modal.style.display = "none";
  modalImg.src = "";
}

document.getElementById("modalImage").addEventListener("click", (e) => {
  e.stopPropagation();
});

// =========================
// THEME TOGGLE
// =========================
const themeBtn = document.getElementById("themeBtn");

const themes = ["win95", "amber", "matrix", "vaporwave"];
let currentTheme = 0;

themeBtn.addEventListener("click", () => {
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


// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", async () => {
  await initDB();
  await migrateLocalStorageToIndexedDB();
  await displayTakenPhotos();
  await updatePhotoCounter();
  syncOverlayMirror();
});

function syncOverlaySize() {
  const rect = glCanvas.getBoundingClientRect();
  overlayCanvas.width = rect.width;
  overlayCanvas.height = rect.height;
}

// In script.js

function syncOverlayMirror() {
  overlayCanvas.style.transform = mirrored ? "scaleX(-1)" : "scaleX(1)";
}

window.addEventListener("resize", syncOverlaySize);
window.addEventListener("orientationchange", syncOverlaySize);
cameraFeed.addEventListener("loadedmetadata", syncOverlaySize);
syncOverlaySize();