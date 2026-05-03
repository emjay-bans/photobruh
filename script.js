const cameraFeed = document.getElementById('cameraFeed');
const mirrorer = document.getElementById('mirrorer');
const snap = document.getElementById('snap');
const effects = document.getElementById('effects');
const canvas = document.getElementById('preview');
const photo = document.getElementById('photo');
const countdown = document.getElementById('countdown');

let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

let mirrored = false;
let activeFaceFilter = null;
let faceModelsLoaded = false;

let trackedFaces = [];
const SMOOTHING = 0.55; // higher = smoother, lower = more responsive

let originalCapturedPhoto = null;

let dogTransforms = [];

const FILTER_SMOOTHING = 0.75;

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

// =========================
// CAMERA STARTUP
// =========================
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => {
    cameraFeed.srcObject = stream;
    cameraFeed.play();
    loadFaceModels();
    renderOverlayLoop();
  })
  .catch(error => {
    console.error('Error accessing camera:', error);
  });

// =========================
// FACE API MODEL LOADING
// =========================
async function loadFaceModels() {
  const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);

    faceModelsLoaded = true;
    detectFaceLoop();
  } catch (err) {
    console.error("Failed to load face models:", err);
  }
}

async function detectFaceLoop() {
  if (!faceModelsLoaded) return;

  if (cameraFeed.readyState >= 2) {
    try {
      const detections = await faceapi
        .detectAllFaces(cameraFeed, new faceapi.TinyFaceDetectorOptions())
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

      // trim extra transforms if fewer faces remain
      dogTransforms.length = trackedFaces.length;

    } catch (err) {
      console.error("Face detection error:", err);
    }
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

  requestAnimationFrame(renderOverlayLoop);
}

// =========================
// MIRROR CAMERA
// =========================
mirrorer.addEventListener('click', () => {
  mirrored = !mirrored;
  cameraFeed.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
});

// =========================
// SNAP COUNTDOWN
// =========================
snap.addEventListener('click', () => {
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
// EFFECTS PANEL TOGGLE
// =========================
effects.addEventListener('click', () => {
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
// DRAW DOG FILTER
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
  }

// place ears relative to eyebrow line instead of hardcoded lift
const browOffsetY = browCenterY - eyeCenterY;

  // one clean vertical offset for ears
  let earsY = browOffsetY - (195 * finalScale);
  if (filterType == 'minion') {
  earsY = browOffsetY - (195 * finalScale) + (100 * finalScale);
} else if (filterType == 'rabbid') {
  earsY = browOffsetY - (195 * finalScale) - (120 * finalScale);
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

if (filterType != 'minion') {
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
// TAKE PHOTO
// =========================
function takePhoto() {
  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    console.error('Video not ready yet');
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
    return;
  }

  downloadImage(originalCapturedPhoto, "photobruh-original.png");
}

function downloadEditedPhoto() {
  if (!editorBaseImage) {
    alert("No edited photo available to download.");
    return;
  }

  const editedDataURL = editorCanvas.toDataURL("image/png");
  downloadImage(editedDataURL, "photobruh-edited.png");
}

document.getElementById("downloadOriginalBtn").addEventListener("click", downloadOriginalPhoto);
document.getElementById("downloadEditedBtn").addEventListener("click", downloadEditedPhoto);

function handleFadeEnd() {
  photo.classList.remove("fade-out");
  photo.style.display = "none";
  photo.style.opacity = "1";
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
      delete takenPhotos[key];

      const updatedPhotos = {};
      Object.values(takenPhotos).forEach((photo, index) => {
        updatedPhotos[index + 1] = photo;
      });

      localStorage.setItem("savedCanvasImage", JSON.stringify(updatedPhotos));
      displayTakenPhotos();
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
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  displayTakenPhotos();
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