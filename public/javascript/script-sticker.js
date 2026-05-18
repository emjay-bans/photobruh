const editorCanvas = document.getElementById("editorCanvas");
const placeholder = document.getElementById("placeholder");

let editorCtx = null;  

if (editorCanvas) {
  editorCtx = editorCanvas.getContext("2d");
}

let editorBaseImage = null;
let editorObjects = [];
let activeSticker = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

let interactionMode = null; 
// "move" | "resize" | "rotate"

const HANDLE_SIZE = 18;

const stickerAssets = {
  parentalAdv: new Image(),
  sunglasses: new Image(),
  swag: new Image(),
  waitImGoated: new Image()
};

stickerAssets.parentalAdv.src = "public/assets/stickers/parentalAdv.png";
stickerAssets.sunglasses.src = "public/assets/stickers/sunglasses.png";
stickerAssets.swag.src = "public/assets/stickers/swag.png";
stickerAssets.waitImGoated.src = "public/assets/stickers/waitImGoated.png";

function resizeEditorCanvas(baseImage) {
  if (!baseImage) return;

  const maxWidth = 1140; // keep the same max width as before
  const naturalAspect = baseImage.naturalWidth / baseImage.naturalHeight;

  // Calculate new canvas dimensions maintaining the image's aspect ratio
  let canvasWidth = maxWidth;
  let canvasHeight = maxWidth / naturalAspect;

  // If the height would exceed the previous height (641.25), scale by height instead
  // (optional – you can decide to keep width fixed)
  // For better UX, we'll limit the height to 641.25 as well to avoid extreme tall canvases.
  const maxHeight = 641.25;
  if (canvasHeight > maxHeight) {
    canvasHeight = maxHeight;
    canvasWidth = maxHeight * naturalAspect;
  }

  editorCanvas.width = canvasWidth;
  editorCanvas.height = canvasHeight;

  // Also update placeholder to match (just for visual consistency)
  const placeholder = document.getElementById("placeholder");
  if (placeholder) {
    placeholder.width = canvasWidth;
    placeholder.height = canvasHeight;
  }

  // Update the CSS of the parent so it scales nicely
  const wrapper = editorCanvas.parentElement;
  if (wrapper) {
    wrapper.style.width = canvasWidth + "px";
    wrapper.style.height = canvasHeight + "px";
  }

  // Redraw after resize
  redrawEditorCanvas();
}

function addSticker(type) {
  const img = stickerAssets[type];
  if (!img) return;

  // Wait for the image to be loaded if it hasn't already
  if (!img.complete) {
    img.onload = () => placeSticker(img);
  } else {
    placeSticker(img);
  }

  soundManager.play("click");
}

function placeSticker(img) {
  const MAX_SIZE = 240; // maximum width or height
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > height) {
    if (width > MAX_SIZE) {
      height = (MAX_SIZE / width) * height;
      width = MAX_SIZE;
    }
  } else {
    if (height > MAX_SIZE) {
      width = (MAX_SIZE / height) * width;
      height = MAX_SIZE;
    }
  }

  editorObjects.push({
    type: "sticker",
    img,
    x: editorCanvas.width / 2 - width / 2,
    y: editorCanvas.height / 2 - height / 2,
    width,
    height,
    rotation: 0
  });

  redrawEditorCanvas();
}

function addText() {
  const input = document.getElementById("textInputOverlay");
  if (!input) return;

  input.style.display = "block";
  input.value = "";
  input.focus({ preventScroll: true });

  const commitText = () => {
    const userText = input.value.trim();
    input.style.display = "none";
    input.removeEventListener("blur", commitText);
    input.removeEventListener("keydown", onKey);
    input.removeEventListener("pointerdown", preventClose);

    if (userText) {
      editorObjects.push({
        type: "text",
        text: userText,
        x: editorCanvas.width / 2 - 150,
        y: editorCanvas.height / 2 - 40,
        width: 300,
        height: 80,
        rotation: 0,
        fontSize: 64,
        fontFamily: "Impact",
        color: "white",
        stroke: "black"
      });
      redrawEditorCanvas();
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText();
    }
  };

  const preventClose = (e) => {
    e.stopPropagation();
  };

  input.addEventListener("blur", commitText);
  input.addEventListener("keydown", onKey);
  input.addEventListener("pointerdown", preventClose);
}

function redrawEditorCanvas() {
  // Lazy‑init the context if it hasn’t been set yet
  if (!editorCtx && editorCanvas) {
    editorCtx = editorCanvas.getContext("2d");
  }

  if (!editorBaseImage || !editorCtx) {
    console.warn("Editor not ready – image or context missing", {
      baseImage: !!editorBaseImage,
      ctx: !!editorCtx
    });
    return;
  }

  placeholder.style.display = "none";
  editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

  // draw photo
  editorCtx.drawImage(editorBaseImage, 0, 0, editorCanvas.width, editorCanvas.height);

  // draw stickers
  editorObjects.forEach(obj => {
    editorCtx.save();
    editorCtx.translate(obj.x + obj.width / 2, obj.y + obj.height / 2);
    editorCtx.rotate(obj.rotation);

    if (obj.type === "sticker") {
      editorCtx.drawImage(
        obj.img,
        -obj.width / 2,
        -obj.height / 2,
        obj.width,
        obj.height
      );
    }
    else if (obj.type === "text") {
      editorCtx.font = `${obj.fontSize}px ${obj.fontFamily}`;
      editorCtx.textAlign = "center";
      editorCtx.textBaseline = "middle";
      editorCtx.lineWidth = Math.max(2, obj.fontSize / 12);

      editorCtx.strokeStyle = obj.stroke;
      editorCtx.strokeText(obj.text, 0, 0);

      editorCtx.fillStyle = obj.color;
      editorCtx.fillText(obj.text, 0, 0);
    }

    if (obj === activeSticker) {
      editorCtx.strokeStyle = "#00a8ff";
      editorCtx.lineWidth = 2;
      editorCtx.strokeRect(
        -obj.width / 2,
        -obj.height / 2,
        obj.width,
        obj.height
      );

      // delete handle
      editorCtx.fillStyle = "#ff4d4d";
      editorCtx.fillRect(
        -obj.width / 2 - HANDLE_SIZE / 2,
        -obj.height / 2 - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE
      );

      // rotate handle
      editorCtx.fillStyle = "#ffd24d";
      editorCtx.fillRect(
        -HANDLE_SIZE / 2,
        -obj.height / 2 - 30,
        HANDLE_SIZE,
        HANDLE_SIZE
      );

      // resize handle
      editorCtx.fillStyle = "#4dff88";
      editorCtx.fillRect(
        obj.width / 2 - HANDLE_SIZE / 2,
        obj.height / 2 - HANDLE_SIZE / 2,
        HANDLE_SIZE,
        HANDLE_SIZE
      );
    }

    editorCtx.restore();
  });
}

function getObjectBounds(obj) {
  return {
    left: obj.x,
    top: obj.y,
    right: obj.x + obj.width,
    bottom: obj.y + obj.height,
    centerX: obj.x + obj.width / 2,
    centerY: obj.y + obj.height / 2
  };
}
if (editorCanvas) {
  editorCanvas.addEventListener("mousedown", (e) => {
    const rect = editorCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    activeSticker = null;
    interactionMode = null;

    for (let i = editorObjects.length - 1; i >= 0; i--) {
      const s = editorObjects[i];
      const b = getObjectBounds(s);

      // delete handle
      if (
        mx >= b.left - HANDLE_SIZE / 2 &&
        mx <= b.left + HANDLE_SIZE / 2 &&
        my >= b.top - HANDLE_SIZE / 2 &&
        my <= b.top + HANDLE_SIZE / 2
      ) {
        soundManager.play("delete");
        editorObjects.splice(i, 1);
        redrawEditorCanvas();
        return;
      }

      // rotate handle
      if (
        mx >= b.centerX - HANDLE_SIZE / 2 &&
        mx <= b.centerX + HANDLE_SIZE / 2 &&
        my >= b.top - 30 &&
        my <= b.top - 30 + HANDLE_SIZE
      ) {
        activeSticker = s;
        interactionMode = "rotate";
        return;
      }

      // resize handle
      if (
        mx >= b.right - HANDLE_SIZE &&
        mx <= b.right + HANDLE_SIZE &&
        my >= b.bottom - HANDLE_SIZE &&
        my <= b.bottom + HANDLE_SIZE
      ) {
        activeSticker = s;
        interactionMode = "resize";
        return;
      }

      // move
      if (
        mx >= b.left &&
        mx <= b.right &&
        my >= b.top &&
        my <= b.bottom
      ) {
        activeSticker = s;
        interactionMode = "move";
        dragOffsetX = mx - s.x;
        dragOffsetY = my - s.y;
        redrawEditorCanvas();
        return;
      }
    }

    redrawEditorCanvas();
  });

  editorCanvas.addEventListener("mousemove", (e) => {
    if (!activeSticker || !interactionMode) return;

    const rect = editorCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (interactionMode === "move") {
      activeSticker.x = mx - dragOffsetX;
      activeSticker.y = my - dragOffsetY;
    }

    else if (interactionMode === "resize") {
      activeSticker.width = Math.max(40, mx - activeSticker.x);
      activeSticker.height = Math.max(40, my - activeSticker.y);

      if (activeSticker.type === "text") {
        activeSticker.fontSize = Math.max(20, activeSticker.height * 0.8);
      }
    }

    else if (interactionMode === "rotate") {
      const cx = activeSticker.x + activeSticker.width / 2;
      const cy = activeSticker.y + activeSticker.height / 2;
      activeSticker.rotation = Math.atan2(my - cy, mx - cx);
    }

    redrawEditorCanvas();
  });

  editorCanvas.addEventListener("mouseup", () => {
    interactionMode = null;
  });

//TOUCH

  editorCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();

    const rect = editorCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    const mx = touch.clientX - rect.left;
    const my = touch.clientY - rect.top;

    activeSticker = null;
    interactionMode = null;

    for (let i = editorObjects.length - 1; i >= 0; i--) {
      const s = editorObjects[i];
      const b = getObjectBounds(s);

      // delete handle
      if (
        mx >= b.left - HANDLE_SIZE / 2 &&
        mx <= b.left + HANDLE_SIZE / 2 &&
        my >= b.top - HANDLE_SIZE / 2 &&
        my <= b.top + HANDLE_SIZE / 2
      ) {
        soundManager.play("delete");
        editorObjects.splice(i, 1);
        redrawEditorCanvas();
        return;
      }

      // rotate handle
      if (
        mx >= b.centerX - HANDLE_SIZE / 2 &&
        mx <= b.centerX + HANDLE_SIZE / 2 &&
        my >= b.top - 30 &&
        my <= b.top - 30 + HANDLE_SIZE
      ) {
        activeSticker = s;
        interactionMode = "rotate";
        redrawEditorCanvas();
        return;
      }

      // resize handle
      if (
        mx >= b.right - HANDLE_SIZE &&
        mx <= b.right + HANDLE_SIZE &&
        my >= b.bottom - HANDLE_SIZE &&
        my <= b.bottom + HANDLE_SIZE
      ) {
        activeSticker = s;
        interactionMode = "resize";
        redrawEditorCanvas();
        return;
      }

      // move
      if (
        mx >= b.left &&
        mx <= b.right &&
        my >= b.top &&
        my <= b.bottom
      ) {
        activeSticker = s;
        interactionMode = "move";
        dragOffsetX = mx - s.x;
        dragOffsetY = my - s.y;
        redrawEditorCanvas();
        return;
      }
    }

    redrawEditorCanvas();
  }, { passive: false });


  editorCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!activeSticker || !interactionMode) return;

    const rect = editorCanvas.getBoundingClientRect();
    const touch = e.touches[0];
    const mx = touch.clientX - rect.left;
    const my = touch.clientY - rect.top;

    if (interactionMode === "move") {
      activeSticker.x = mx - dragOffsetX;
      activeSticker.y = my - dragOffsetY;
    }

    else if (interactionMode === "resize") {
      activeSticker.width = Math.max(40, mx - activeSticker.x);
      activeSticker.height = Math.max(40, my - activeSticker.y);

      if (activeSticker.type === "text") {
        activeSticker.fontSize = Math.max(20, activeSticker.height * 0.8);
      }
    }

    else if (interactionMode === "rotate") {
      const cx = activeSticker.x + activeSticker.width / 2;
      const cy = activeSticker.y + activeSticker.height / 2;
      activeSticker.rotation = Math.atan2(my - cy, mx - cx);
    }

    redrawEditorCanvas();
  }, { passive: false });


  editorCanvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    interactionMode = null;
  }, { passive: false });

}

function saveEditedPhoto() {
  const finalImage = editorCanvas.toDataURL("image/png");
  photo.src = finalImage;
}