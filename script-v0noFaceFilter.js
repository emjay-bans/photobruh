const cameraFeed = document.getElementById('cameraFeed');
const mirrorer = document.getElementById('mirrorer');
const snap = document.getElementById('snap');
const effects = document.getElementById('effects');
const canvas = document.getElementById('preview');
const photo = document.getElementById('photo');
const countdown = document.getElementById('countdown');

let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

let mirrored = false;

// Start Camera
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => {
    cameraFeed.srcObject = stream;
    cameraFeed.play(); // ensure video starts
  })
  .catch(error => {
    console.error('Error accessing camera:', error);
  });

// Mirror Camera Feed
mirrorer.addEventListener('click', () => {
  mirrored = !mirrored;
  cameraFeed.style.transform = mirrored ? 'scaleX(-1)' : 'scaleX(1)';
});

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

// =====================================================
// =============== EFFECTS MANAGEMENT ==================
// =====================================================

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
    // Attach listeners to all sliders
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
  
  // Preset effects
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

// Initialize effects manager
const effectsManager = new EffectsManager();

// Effects panel toggle
effects.addEventListener('click', () => {
  const effectsList = document.getElementById('effectsList');
  if (effectsList.style.display === 'block') {
    effectsList.style.display = 'none';
  } else {
    effectsList.style.display = 'block';
  }
});

// Actual Photo Capture
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
    context.restore();

    const dataURL = canvas.toDataURL('image/webp');

    photo.src = dataURL;
    photo.style.display = "block";
    photo.style.opacity = "1";

    let photoList = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};
    photoList[Object.keys(photoList).length + 1] = dataURL;
    localStorage.setItem("savedCanvasImage", JSON.stringify(photoList));

    displayTakenPhotos(JSON.stringify(photoList));

    setTimeout(() => {
        photo.classList.add("fade-out");

        photo.addEventListener("transitionend", handleFadeEnd(), { once: true });
    }, 2000);

}

function handleFadeEnd() {
    photo.classList.remove("fade-out");
    photo.style.display = "none";
    photo.style.opacity = "1";

    busyTakingPhoto = false;
    snap.disabled = false;
}

function displayTakenPhotos() {
    const photoContainer = document.getElementById("photoContainer");
    const takenPhotos = JSON.parse(localStorage.getItem("savedCanvasImage")) || {};

    photoContainer.innerHTML = "";

    const photoEntries = Object.entries(takenPhotos);

    if (photoEntries.length === 0) {
        photoContainer.innerHTML = "<p>No saved photos yet.</p>";
        return;
    }

    photoEntries.forEach(([key, photo], index) => {
        const wrapper = document.createElement("div");
        wrapper.classList.add("photo-item");

        const img = document.createElement("img");
        img.src = photo;
        img.alt = `Saved Photo ${index + 1}`;
        img.classList.add("saved-photo");

        img.addEventListener("click", () => {
            openPhotoModal(photo);
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.classList.add("delete-btn");

        deleteBtn.addEventListener("click", () => {
            // Remove selected photo
            delete takenPhotos[key];

            // Rebuild object with updated sequential keys
            const updatedPhotos = {};
            Object.values(takenPhotos).forEach((photo, index) => {
                updatedPhotos[index + 1] = photo;
            });

            // Save updated object
            localStorage.setItem("savedCanvasImage", JSON.stringify(updatedPhotos));

            // Refresh display
            displayTakenPhotos();
        });

        wrapper.appendChild(img);
        wrapper.appendChild(deleteBtn);
        photoContainer.appendChild(wrapper);
    });
}

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

document.addEventListener("DOMContentLoaded", () => {
    displayTakenPhotos(JSON.stringify(photoList))
})