self.onmessage = async (e) => {
  const { images } = e.data;

  if (!images || !images.length) return;

  const stripWidth = 600;
  const frameHeight = 400;
  const padding = 20;
  const footerHeight = 80;

  const stripHeight =
    images.length * frameHeight +
    (images.length + 1) * padding +
    footerHeight;

  const canvas = new OffscreenCanvas(stripWidth, stripHeight);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, stripWidth, stripHeight);

  for (let i = 0; i < images.length; i++) {
    const res = await fetch(images[i]);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const y = padding + i * (frameHeight + padding);

    ctx.drawImage(
      bitmap,
      padding,
      y,
      stripWidth - padding * 2,
      frameHeight
    );
  }

  // footer
  ctx.fillStyle = "#008081";
  ctx.font = "italic bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("PhotoBruh", stripWidth / 2, stripHeight - 30);

  const finalBlob = await canvas.convertToBlob({ type: "image/png" });

  self.postMessage({ blob: finalBlob });
};