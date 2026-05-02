// =========================
// PHOTO STRIP STATE
// =========================
const stripCanvas = document.createElement("canvas");
const stripCtx = stripCanvas.getContext("2d");

let photoStripImages = [];
let latestPhotoStrip = null;
let stripModeEnabled = false;
let stripShotCount = 4;

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
downloadStripBtn.addEventListener("click", downloadPhotoStrip);

// =========================
// PHOTO STRIP CAPTURE FLOW
// =========================
function startPhotoStripCapture() {
  let currentShot = 0;

  function captureNextShot() {
    if (currentShot >= stripShotCount) {
      stripModeEnabled = false;
      buildPhotoStrip(photoStripImages);
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
    return null;
  }

  const context = canvas.getContext("2d");
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
    const face = getCurrentFace();

    if (face) {
      drawDogFilter(context, face, cameraFeed);
    }
    console.log("Strip face:", trackedFace);
  }

  context.restore();

  return canvas.toDataURL("image/png");
}

// =========================
// BUILD PHOTO STRIP
// =========================
function buildPhotoStrip(images) {
  if (!images || images.length === 0) return;

  const stripWidth = 600;
  const frameHeight = 400;
  const padding = 20;
  const footerHeight = 80;

  const stripHeight = images.length * frameHeight + (images.length + 1) * padding + footerHeight;

  stripCanvas.width = stripWidth;
  stripCanvas.height = stripHeight;

  stripCtx.clearRect(0, 0, stripWidth, stripHeight);

  // white strip background
  stripCtx.fillStyle = "white";
  stripCtx.fillRect(0, 0, stripWidth, stripHeight);

  let loaded = 0;
  const imgObjects = [];

  images.forEach((src, index) => {
    const img = new Image();

    img.onload = () => {
      imgObjects[index] = img;
      loaded++;

      if (loaded === images.length) {
        imgObjects.forEach((image, i) => {
          const y = padding + i * (frameHeight + padding);

          stripCtx.drawImage(
            image,
            padding,
            y,
            stripWidth - padding * 2,
            frameHeight
          );
        });

        // Footer text
        stripCtx.fillStyle = "#008081";
        stripCtx.font = "italic bold 28px Dos";
        stripCtx.textAlign = "center";
        stripCtx.fillText("PhotoBruh", stripWidth / 2, stripHeight - 30);

        latestPhotoStrip = stripCanvas.toDataURL("image/png");

        // Preview strip
        photo.src = latestPhotoStrip;
        photo.style.display = "block";
        photo.style.opacity = "1";
        cameraFeed.style.display = "none";

        setTimeout(() => {
            photo.style.display = "none";
            cameraFeed.style.display = "block";
        }, 3000);

        downloadStripBtn.disabled = false;
      }
    };

    img.src = src;
  });
}

// =========================
// DOWNLOAD PHOTO STRIP
// =========================
function downloadPhotoStrip() {
  if (!latestPhotoStrip) {
    alert("No photo strip available to download.");
    return;
  }

  downloadImage(latestPhotoStrip, "photobruh-strip.png");
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
  const scaleX = canvas.width / video.videoWidth;
  const scaleY = canvas.height / video.videoHeight;

  return {
    x: point.x * scaleX,
    y: point.y * scaleY
  };
}

function getCurrentFace() {
  return trackedFace ? trackedFace : null;
}