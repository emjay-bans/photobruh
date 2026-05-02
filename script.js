const cameraFeed = document.getElementById('cameraFeed');
const mirrorer = document.getElementById('mirrorer');
const snap = document.getElementById('snap');
const effects = document.getElementById('effects');
const canvas = document.getElementById('preview');
const photo = document.getElementById('photo');
const countdown = document.getElementById('countdown');
const dogFilterBtn = document.getElementById('dogFilterBtn');

let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

let mirrored = false;
let dogFilterEnabled = false;
let faceModelsLoaded = false;

let trackedFace = null;
let noFaceFrames = 0;
const SMOOTHING = 0.55; // higher = smoother, lower = more responsive

let originalCapturedPhoto = null;

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
// DOG FILTER ASSETS
// =========================
const dogEars = new Image();
const dogNose = new Image();

dogEars.src = "./public/assets/filters/dogEars.png";
dogNose.src = "./public/assets/filters/dogNose.png";

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

      if (detections.length > 0) {
        const newFace = detections[0];

        if (!trackedFace) {
          trackedFace = newFace;
        } else {
          trackedFace = smoothFace(trackedFace, newFace);
        }

        noFaceFrames = 0;
      } else {
        noFaceFrames++;

        // keep last face briefly to prevent flicker
        if (noFaceFrames > 8) {
          trackedFace = null;
        }
      }

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

// =========================
// LIVE OVERLAY RENDER LOOP
// =========================
function renderOverlayLoop() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (dogFilterEnabled && trackedFace) {
    overlayCtx.save();

    if (mirrored) {
      overlayCtx.translate(overlayCanvas.width, 0);
      overlayCtx.scale(-1, 1);
    }

    drawDogFilter(overlayCtx, trackedFace);

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
// DOG FILTER TOGGLE
// =========================
dogFilterBtn.addEventListener('click', () => {
  dogFilterEnabled = !dogFilterEnabled;
  dogFilterBtn.textContent = dogFilterEnabled ? "Dog Filter ON" : "Dog Filter";
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
function drawDogFilter(context, detection, captureMode = false) {
  if (!detection) return;

  const landmarks = detection.landmarks;

  const leftEye = landmarks.getLeftEye()[0];
  const rightEye = landmarks.getRightEye()[3];
  const noseTip = landmarks.getNose()[3];

  let leftEyeX, leftEyeY, rightEyeX, rightEyeY, noseX, noseY;

  if (captureMode) {
  // RAW VIDEO → FULL CAPTURE CANVAS
    const scaleX = context.canvas.width / cameraFeed.videoWidth;
    const scaleY = context.canvas.height / cameraFeed.videoHeight;

    leftEyeX = leftEye.x * scaleX;
    leftEyeY = leftEye.y * scaleY;

    rightEyeX = rightEye.x * scaleX;
    rightEyeY = rightEye.y * scaleY;

    noseX = noseTip.x * scaleX;
    noseY = noseTip.y * scaleY;
  } else {
  // RAW VIDEO → VISIBLE DISPLAY RECT
    const { offsetX, offsetY, drawW, drawH, displayW, displayH } = getVisibleVideoRect();

    const lx = (leftEye.x - offsetX) / drawW;
    const ly = (leftEye.y - offsetY) / drawH;

    const rx = (rightEye.x - offsetX) / drawW;
    const ry = (rightEye.y - offsetY) / drawH;

    const nx = (noseTip.x - offsetX) / drawW;
    const ny = (noseTip.y - offsetY) / drawH;

    leftEyeX = lx * displayW;
    leftEyeY = ly * displayH;

    rightEyeX = rx * displayW;
    rightEyeY = ry * displayH;

    noseX = nx * displayW;
    noseY = ny * displayH;
  }

  // Face center + geometry
  const eyeCenterX = (leftEyeX + rightEyeX) / 2;
  const eyeCenterY = (leftEyeY + rightEyeY) / 2;

  const dx = rightEyeX - leftEyeX;
  const dy = rightEyeY - leftEyeY;

  const angle = Math.atan2(dy, dx);
  const eyeDistance = Math.abs(dx);

  const faceWidth = eyeDistance * 1.3;

  // =========================
  // EARS
  // =========================
  const earsWidth = faceWidth * 1.4;
  const earsHeight = earsWidth * 0.8;

  context.save();
  context.translate(eyeCenterX, eyeCenterY);
  context.rotate(angle);

  context.drawImage(
    dogEars,
    -earsWidth / 2,
    -earsHeight - 60,
    earsWidth,
    earsHeight
  );

  context.restore();

  // =========================
  // NOSE
  // =========================
  const noseWidth = faceWidth * 0.35;
  const noseHeight = noseWidth * 0.75;

  const tiltIntensity = Math.min(Math.abs(angle), 0.6);
  const noseScale = 1 + tiltIntensity * 0.25;

  const scaledNoseWidth = noseWidth * noseScale;
  const scaledNoseHeight = noseHeight * noseScale;

  context.save();
  context.translate(noseX, noseY);
  context.rotate(angle);

  if (captureMode){
    context.drawImage(
      dogNose,
      -scaledNoseWidth / 2,
      -scaledNoseHeight / 2,
      scaledNoseWidth,
      scaledNoseHeight
    );
  } else {
    context.drawImage(
      dogNose,
      -scaledNoseWidth / 2,
      -scaledNoseHeight / 2 - 48,
      scaledNoseWidth,
      scaledNoseHeight
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
  const width = cameraFeed.videoWidth;
  const height = cameraFeed.videoHeight;

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

  context.drawImage(cameraFeed, 0, 0, width, height);

  if (dogFilterEnabled && trackedFace) {
    drawDogFilter(context, trackedFace, true);
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
cameraFeed.addEventListener("loadedmetadata", syncOverlaySize);
syncOverlaySize();