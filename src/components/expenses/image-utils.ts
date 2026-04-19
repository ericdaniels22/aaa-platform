// Canvas-based image downscale + JPEG encode. Runs entirely in the browser.
// Used by the Log Expense modal to produce (1) a capped original and
// (2) a 200px-wide thumbnail from whatever the user picks or captures,
// normalizing HEIC/PNG/etc to JPEG so the storage path `.jpg` is accurate.

export interface DownscaledImage {
  blob: Blob;
  width: number;
  height: number;
}

async function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image"));
      el.src = url;
    });
    return img;
  } finally {
    // Revoke after a tick so the browser has time to pull pixels into the canvas.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encode failed"))),
      "image/jpeg",
      quality,
    );
  });
}

async function downscale(img: HTMLImageElement, maxEdge: number, quality: number): Promise<DownscaledImage> {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create 2D context");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await canvasToJpegBlob(canvas, quality);
  return { blob, width, height };
}

export async function prepareReceiptUploads(file: File): Promise<{ original: DownscaledImage; thumbnail: DownscaledImage }> {
  const img = await loadImageFromFile(file);
  const original = await downscale(img, 2048, 0.85);

  // Thumbnail: scale so width = 200 (preserve aspect).
  const thumbScale = 200 / img.width;
  const thumbCanvas = document.createElement("canvas");
  thumbCanvas.width = 200;
  thumbCanvas.height = Math.max(1, Math.round(img.height * thumbScale));
  const thumbCtx = thumbCanvas.getContext("2d");
  if (!thumbCtx) throw new Error("Could not create 2D context");
  thumbCtx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumbBlob = await canvasToJpegBlob(thumbCanvas, 0.85);

  return {
    original,
    thumbnail: { blob: thumbBlob, width: thumbCanvas.width, height: thumbCanvas.height },
  };
}
