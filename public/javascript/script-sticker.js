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

stickerAssets.parentalAdv.src = "https://emjay-bans.github.io/photobruh/public/assets/stickers/parentalAdv.png";
stickerAssets.sunglasses.src = "https://emjay-bans.github.io/photobruh/public/assets/stickers/sunglasses.png";
stickerAssets.swag.src = "https://emjay-bans.github.io/photobruh/public/assets/stickers/swag.png";
stickerAssets.waitImGoated.src = "https://emjay-bans.github.io/photobruh/public/assets/stickers/waitImGoated.png";

function addSticker(type) {
  const img = stickerAssets[type];
  if (!img) return;

  editorObjects.push({
    type: "sticker",
    img,
    x: editorCanvas.width / 2 - 60,
    y: editorCanvas.height / 2 - 60,
    width: 240,
    height: 240,
    rotation: 0
  });

  soundManager.play("click");
  
  redrawEditorCanvas();
}

function addText() {
  const userText = prompt("Enter your text:");
  if (!userText) return;

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

function redrawEditorCanvas() {
  if (!editorBaseImage) return;

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

    // delete
    editorCtx.fillStyle = "#ff4d4d";
    editorCtx.fillRect(
      -obj.width / 2 - HANDLE_SIZE / 2,
      -obj.height / 2 - HANDLE_SIZE / 2,
      HANDLE_SIZE,
      HANDLE_SIZE
    );

    // rotate
    editorCtx.fillStyle = "#ffd24d";
    editorCtx.fillRect(
      -HANDLE_SIZE / 2,
      -obj.height / 2 - 30,
      HANDLE_SIZE,
      HANDLE_SIZE
    );

    // resize
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