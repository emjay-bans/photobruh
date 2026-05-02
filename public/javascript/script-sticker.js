const editorCanvas = document.getElementById("editorCanvas");
const placeholder = document.getElementById("placeholder");
const editorCtx = editorCanvas.getContext("2d");

let editorBaseImage = null;
let stickers = [];
let activeSticker = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

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

  stickers.push({
    img,
    x: editorCanvas.width / 2 - 60,
    y: editorCanvas.height / 2 - 60,
    width: 240,
    height: 240,
    rotation: 0
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
  stickers.forEach(sticker => {
    editorCtx.save();
    editorCtx.translate(sticker.x + sticker.width / 2, sticker.y + sticker.height / 2);
    editorCtx.rotate(sticker.rotation);

    editorCtx.drawImage(
      sticker.img,
      -sticker.width / 2,
      -sticker.height / 2,
      sticker.width,
      sticker.height
    );

    editorCtx.restore();
  });
}

editorCanvas.addEventListener("mousedown", (e) => {
  const rect = editorCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  activeSticker = null;

  for (let i = stickers.length - 1; i >= 0; i--) {
    const s = stickers[i];

    if (
      mx >= s.x &&
      mx <= s.x + s.width &&
      my >= s.y &&
      my <= s.y + s.height
    ) {
      activeSticker = s;
      dragOffsetX = mx - s.x;
      dragOffsetY = my - s.y;
      break;
    }
  }
});

editorCanvas.addEventListener("mousemove", (e) => {
  if (!activeSticker) return;

  const rect = editorCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  activeSticker.x = mx - dragOffsetX;
  activeSticker.y = my - dragOffsetY;

  redrawEditorCanvas();
});

editorCanvas.addEventListener("mouseup", () => {
  activeSticker = null;
});

function saveEditedPhoto() {
  const finalImage = editorCanvas.toDataURL("image/png");
  photo.src = finalImage;
}