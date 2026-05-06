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
photoStripBtn.addEventListener("click", () => {
  if (stripModeEnabled) return;

  stripModeEnabled = true;
  photoStripImages = [];
  latestPhotoStrip = null;
  downloadStripBtn.disabled = true;

  startPhotoStripCapture();
});

// Download generated strip
downloadStripBtn.addEventListener("click", () => {
  soundManager.play("click");
  downloadPhotoStrip();
  soundManager.play("success");
});

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
    glCanvas,
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

  if (
    activeAnimatedFilter &&
    ["sparkles", "snow", "hearts", "matrix"].includes(activeAnimatedFilter)
  ) {
    drawAnimatedFilter(context);
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

function mapLandmarkToCanvas(point, video, canvas) {
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;

  if (!videoW || !videoH) {
    return { x: 0, y: 0 };
  }

  // normalize landmark into video space
  const nx = point.x / videoW;
  const ny = point.y / videoH;

  // map directly into overlay canvas space
  return {
    x: nx * canvas.width,
    y: ny * canvas.height
  };
}

function getCurrentFace() {
  return trackedFace ? trackedFace : null;
}