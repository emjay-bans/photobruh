let isBooth;

// =========================
// PHOTO STRIP STATE
// =========================
const stripCanvas = document.createElement("canvas");
const stripCtx = stripCanvas.getContext("2d", {
  willReadFrequently: true
});

let photoStripImages = [];
let latestPhotoStrip = null;
let stripModeEnabled = false;
let stripShotCount = 4;

const stripWorker = new Worker("public/javascript/strip-worker.js");

// =========================
// PHOTO STRIP BUTTONS
// =========================
const photoStripBtn = document.getElementById("photoStripBtn");
const downloadStripBtn = document.getElementById("downloadStripBtn");

downloadStripBtn.disabled = true;

// Start strip capture mode
if (photoStripBtn) {
  photoStripBtn.addEventListener("click", () => {
    if (stripModeEnabled) return;

    stripModeEnabled = true;
    photoStripImages = [];
    latestPhotoStrip = null;
    downloadStripBtn.disabled = true;

    startPhotoStripCapture();
  });
}

// Download generated strip
if (downloadStripBtn) {
  downloadStripBtn.addEventListener("click", () => {
    soundManager.play("click");
    downloadPhotoStrip();
    soundManager.play("success");
  });
}

// =========================
// PHOTO STRIP CAPTURE FLOW
// =========================
function startPhotoStripCapture() {
  let currentShot = 0;
  const counter = document.getElementById("photoCounter");

  function captureNextShot() {
    soundManager.play("shutter");
    counter.textContent = `Strip Shot ${currentShot + 1} / ${stripShotCount}`;
    if (currentShot >= stripShotCount) {
      stripModeEnabled = false;
      buildPhotoStrip(photoStripImages);
      updatePhotoCounter();
      soundManager.play("success");
      return;
    }

    startStripCountdown(() => {
      const shotData = capturePhotoToDataURL();
      if (shotData) {
        photoStripImages.push(shotData);
      }

      currentShot++;
      captureNextShot();
    });
  }

  captureNextShot();
}

// =========================
// STRIP COUNTDOWN
// =========================
function startStripCountdown(callback) {
  soundManager.play("tick");
  let timeLeft = 3;

  countdown.style.display = "flex";
  countdown.textContent = timeLeft;

  const timer = setInterval(() => {
    timeLeft--;

    if (timeLeft > 0) {
      countdown.textContent = timeLeft;
    } else {
      clearInterval(timer);
      countdown.style.display = "none";

      flashCaptureEffect();
      callback();
    }
  }, 1000);
}

// =========================
// CAPTURE SINGLE PHOTO
// =========================
function capturePhotoToDataURL() {
  if (cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
    console.error("Video not ready yet");
    soundManager.play("error");
    return null;
  }

  const context = canvas.getContext("2d");
  const width = glCanvas.width;   // 1280
  const height = glCanvas.height; // 720
  canvas.width = width;
  canvas.height = height;

  context.clearRect(0, 0, width, height);
  context.save();

  // Apply visual filters (brightness, contrast, etc.)
  if (effectsManager.hasActiveEffects()) {
    context.filter = effectsManager.buildFilterString();
  }

  // 1. Draw the main WebGL canvas (which already has crop + visual effects)
  context.drawImage(glCanvas, 0, 0);

  // 2. Grab live face data (no snapshot needed for strip – it captures instantly)
  let facesToDraw = [];
  if (currentFaceData && currentFaceData.faces.length > 0) {
    facesToDraw = currentFaceData.faces;
  } else if (lastValidFaceData) {
    facesToDraw = lastValidFaceData.faces;
  }

  // Use the current smoothed transforms
  const transformsToUse = dogTransforms.slice();

  // Mirror if needed
    if (mirrored) {
    context.save();
    context.translate(width, 0);
    context.scale(-1, 1);
  }

  if (distortionMode === 4) {
    if (effectsManager.hasActiveEffects()) {
      context.filter = effectsManager.buildFilterString();
    }
    context.drawImage(overlayCanvas, 0, 0, width, height);
    context.filter = 'none';
  } else {
    // Normal mode: draw filters manually
    let facesToDraw = [];
    if (currentFaceData && currentFaceData.faces.length > 0) {
      facesToDraw = currentFaceData.faces;
    } else if (lastValidFaceData) {
      facesToDraw = lastValidFaceData.faces;
    }
    const transformsToUse = dogTransforms;

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

    drawImageOverlay(context, width, height, false);
  }

  if (mirrored) {
    context.restore();
  }

  context.restore();

  return canvas.toDataURL("image/png");
}

// =========================
// BUILD PHOTO STRIP
// =========================
function buildPhotoStrip(images) {
  isBooth = true;
  if (!images || images.length === 0) return;

  stripWorker.postMessage({ images });

  stripWorker.onmessage = async (e) => {
    const blob = e.data.blob;
    const stripURL = URL.createObjectURL(blob);

    latestPhotoStrip = stripURL;

    await addPhotoToDB(blob, "strip");

    await displayTakenPhotos();
    await updatePhotoCounter();

    photo.src = stripURL;
    photo.style.display = "block";
    photo.style.opacity = "1";
    cameraFeed.style.display = "none";
    photo.style.objectFit = "contain";

    setTimeout(() => {
      photo.style.display = "none";
      cameraFeed.style.display = "block";
    }, 3000);

    downloadStripBtn.disabled = false;
  };
}

// =========================
// DOWNLOAD PHOTO STRIP
// =========================
function downloadPhotoStrip() {
  if (!latestPhotoStrip) {
    alert("No photo strip available to download.");
    soundManager.play("error");
    return;
  }

  const link = document.createElement("a");
  link.href = latestPhotoStrip;
  link.download = "photobruh-strip.png";
  link.click();
}

// =========================
// FLASH EFFECT
// =========================
function flashCaptureEffect() {
  const flash = document.createElement("div");

  flash.style.position = "fixed";
  flash.style.top = "0";
  flash.style.left = "0";
  flash.style.width = "100vw";
  flash.style.height = "100vh";
  flash.style.background = "white";
  flash.style.opacity = "0.9";
  flash.style.zIndex = "9999";
  flash.style.pointerEvents = "none";

  document.body.appendChild(flash);

  setTimeout(() => {
    flash.style.transition = "opacity 0.25s ease";
    flash.style.opacity = "0";
  }, 30);

  setTimeout(() => {
    flash.remove();
  }, 300);
}

function mapLandmarkToCanvas(point, videoElement, canvas) {
  const x = (point.x / cameraFeed.videoWidth) * canvas.width;
  const y = (point.y / cameraFeed.videoHeight) * canvas.height;

  return { x, y };
}

function getCurrentFace() {
  return trackedFace ? trackedFace : null;
}