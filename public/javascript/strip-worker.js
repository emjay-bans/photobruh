self.onmessage = async (e) => {
  const { images, template = {} } = e.data;

  if (!images || !images.length) return;

  // Destructure with defaults
  const {
    stripWidth = 600,
    frameHeight = 400,
    padding = 20,
    footerHeight = 80,
    footerText = "PhotoBruh",
    footerColor = "#008081",
    backgroundColor = "white",
    frameCount = 4
  } = template;

  // Only use the first `frameCount` images
  const imagesToUse = images.slice(0, frameCount);

  const stripHeight =
    imagesToUse.length * frameHeight +
    (imagesToUse.length + 1) * padding +
    footerHeight;

  const canvas = new OffscreenCanvas(stripWidth, stripHeight);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, stripWidth, stripHeight);

  // Draw each photo
  for (let i = 0; i < imagesToUse.length; i++) {
    const res = await fetch(imagesToUse[i]);
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

  // Footer
  ctx.fillStyle = footerColor;
  ctx.font = "italic bold 28px sans-serif";
  ctx.textAlign = "center";
  // Vertically centre the text in the footer area
  const textY = stripHeight - footerHeight / 2 + 8;
  ctx.fillText(footerText, stripWidth / 2, textY);

  const finalBlob = await canvas.convertToBlob({ type: "image/png" });
  self.postMessage({ blob: finalBlob });
};