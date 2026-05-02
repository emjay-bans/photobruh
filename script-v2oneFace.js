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
let latestDetection = null;

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
      latestDetection = await faceapi
        .detectSingleFace(cameraFeed, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks(true);
      console.log(latestDetection);
    } catch (err) {
      console.error("Face detection error:", err);
    }
  }

  requestAnimationFrame(detectFaceLoop);
}

// =========================
// LIVE OVERLAY RENDER LOOP
// =========================
function renderOverlayLoop() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (dogFilterEnabled && latestDetection) {
    overlayCtx.save();

    if (mirrored) {
      overlayCtx.translate(overlayCanvas.width, 0);
      overlayCtx.scale(-1, 1);
    }

    drawDogFilter(overlayCtx, latestDetection);

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

// =========================
// DRAW DOG FILTER
// =========================
function drawDogFilter(context, detection) {
  if (!detection) return;

  const scaleX = context.canvas.width / cameraFeed.videoWidth;
  const scaleY = context.canvas.height / cameraFeed.videoHeight;

  const landmarks = detection.landmarks;

  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();

  const leftEyeX = leftEye[0].x * scaleX;
  const leftEyeY = leftEye[0].y * scaleY;
  const rightEyeX = rightEye[3].x * scaleX;
  const rightEyeY = rightEye[3].y * scaleY;
  const noseTip = nose[3];

  const rawEyeDistance = Math.abs(rightEyeX - leftEyeX);

  const eyeCenterX = (leftEyeX + rightEyeX) / 2;
  const eyeCenterY = (leftEyeY + rightEyeY) / 2;

  const faceWidth = rawEyeDistance * 1.3;

  const earsWidth = faceWidth * 1.4;
  const earsHeight = earsWidth * 0.8;

  
  context.drawImage(
    dogEars,
    eyeCenterX - earsWidth / 2,
    eyeCenterY - earsHeight - 60,
    earsWidth,
    earsHeight
  );

  const noseWidth = faceWidth * 0.35;
  const noseHeight = noseWidth * 0.75;

  context.drawImage(
    dogNose,
    noseTip.x * scaleX - noseWidth / 2,
    noseTip.y * scaleY - noseHeight / 3,
    noseWidth,
    noseHeight
  );
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

  if (dogFilterEnabled && latestDetection) {
    drawDogFilter(context, latestDetection);
  }

  context.restore();

  const dataURL = canvas.toDataURL('image/webp');

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
}

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