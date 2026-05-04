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

const FILTER_SMOOTHING = 0.75;

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
overlayCanvas.id = "filterOverlay";
overlayCanvas.width = 1280;
overlayCanvas.height = 720;

document.getElementById("cameraWrapper").appendChild(overlayCanvas);

const overlayCtx = overlayCanvas.getContext("2d");

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

    if (currentFacingMode === "user") {
      mirrored = true;
      cameraFeed.style.transform = "scaleX(-1)";
    } else {
      mirrored = false;
      cameraFeed.style.transform = "scaleX(1)";
    }

    syncOverlaySize();
  } catch (error) {
    console.error("Error accessing camera:", error);
  }
}

(async () => {
  await startCamera("user");
  await loadFaceModels();
  updateBootLine("boot1", "Initializing Camera...", true);
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

  if (activeFaceFilter && trackedFaces.length) {
  overlayCtx.save();

  if (mirrored) {
    overlayCtx.translate(overlayCanvas.width, 0);
    overlayCtx.scale(-1, 1);
  }

  trackedFaces.forEach((face, i) => {
    drawFaceFilter(overlayCtx, face, cameraFeed, dogTransforms[i], activeFaceFilter, true);
  });

  overlayCtx.restore();
}

  if (activeAnimatedFilter) {
    drawAnimatedFilter(overlayCtx);
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
  cameraFeed.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
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
    cameraFeed.style.filter = filterString;
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

  const rect = cameraFeed.getBoundingClientRect();
  const displayW = rect.width;
  const displayH = rect.height;

  const videoAspect = videoW / videoH;
  const displayAspect = displayW / displayH;

  let drawW, drawH, offsetX, offsetY;

  // Video is wider than display → crop left/right
  if (videoAspect > displayAspect) {
    drawH = videoH;
    drawW = videoH * displayAspect;

    offsetX = (videoW - drawW) / 2;
    offsetY = 0;
  }
  // Video is taller than display → crop top/bottom
  else {
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

  const angle = Math.atan2(dy, dx);

  const faceWidth = Math.abs(jawRight.x - jawLeft.x);
  const scale = faceWidth / 220;

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
    console.error('Video not ready yet');
    soundManager.play("error");
    return;
  }

  const context = canvas.getContext('2d');
  const visible = getVisibleVideoRect();

  const width = visible.drawW;
  const height = visible.drawH;

  canvas.width = width;
  canvas.height = height;

  context.clearRect(0, 0, width, height);
  context.save();

  if (mirrored) {
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  if (effectsManager.hasActiveEffects()) {
    context.filter = effectsManager.buildFilterString();
  }

  soundManager.play("shutter");


  context.drawImage(
    cameraFeed,
    visible.offsetX,   // source x
    visible.offsetY,   // source y
    visible.drawW,     // source width
    visible.drawH,     // source height
    0,                 // destination x
    0,                 // destination y
    width,             // destination width
    height             // destination height
  );

  if (activeFaceFilter && trackedFaces.length) {
    trackedFaces.forEach((face, i) => {
      drawFaceFilter(context, face, cameraFeed, dogTransforms[i], activeFaceFilter, false);
    });
  }

  if (activeAnimatedFilter) {
    drawAnimatedFilter(context);
  }

  context.restore();

  const dataURL = canvas.toDataURL('image/webp');

  originalCapturedPhoto = dataURL;

  photo.src = dataURL;
  photo.style.display = "block";
  
  photo.style.opacity = "1";

  let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};
  photoList[Object.keys(photoList).length + 1] = dataURL;
  localStorage.setItem("savedCanvasImage", JSON.stringify(photoList));

  displayTakenPhotos();

  updatePhotoCounter();

  setTimeout(() => {
    photo.classList.add("fade-out");
    photo.addEventListener("transitionend", handleFadeEnd(), { once: true });
  }, 2000);

  editorBaseImage = new Image();
  editorBaseImage.onload = () => {
    editorCanvas.style.display = "block";
    stickers = [];
    redrawEditorCanvas();
  };
  editorBaseImage.src = dataURL;
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

function updatePhotoCounter() {
  const savedPhotos = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};
  const total = Object.keys(savedPhotos).length;

  const counter = document.getElementById("photoCounter");
  counter.textContent = `Photos Taken: ${total}`;
}

// =========================
// GALLERY
// =========================
function displayTakenPhotos() {
  const photoContainer = document.getElementById("photoContainer");
  const takenPhotos = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

  photoContainer.innerHTML = "";

  const photoEntries = Object.entries(takenPhotos);

  if (photoEntries.length === 0) {
    photoContainer.innerHTML = "<p>No saved photos yet.</p>";
    return;
  }

  photoEntries.forEach(([key, photoSrc], index) => {
    const wrapper = document.createElement("div");
    wrapper.classList.add("photo-item");

    const img = document.createElement("img");
    img.src = photoSrc;
    img.alt = `Saved Photo ${index + 1}`;
    img.classList.add("saved-photo");

    img.addEventListener("click", () => openPhotoModal(photoSrc));

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.classList.add("delete-btn");

    deleteBtn.addEventListener("click", () => {
      soundManager.play("delete");
      delete takenPhotos[key];

      const updatedPhotos = {};
      Object.values(takenPhotos).forEach((photo, index) => {
        updatedPhotos[index + 1] = photo;
      });

      localStorage.setItem("savedCanvasImage", JSON.stringify(updatedPhotos));
      displayTakenPhotos();
      updatePhotoCounter();
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
document.addEventListener("DOMContentLoaded", () => {
  displayTakenPhotos();
  updatePhotoCounter();
});

function syncOverlaySize() {
  const rect = cameraFeed.getBoundingClientRect();
  overlayCanvas.width = rect.width;
  overlayCanvas.height = rect.height;
}

window.addEventListener("resize", syncOverlaySize);
window.addEventListener("orientationchange", syncOverlaySize);
cameraFeed.addEventListener("loadedmetadata", syncOverlaySize);
syncOverlaySize();