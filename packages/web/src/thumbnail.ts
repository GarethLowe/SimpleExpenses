import { openPdf, renderPage } from "./pdf";

export const THUMB_SIZE = 400;

/**
 * Small JPEG for list views, generated on the device so the backend needs no
 * image libraries. Returns null when the browser cannot decode the file; the
 * upload proceeds without a thumbnail.
 */
export async function makeThumbnail(blob: Blob, contentType: string): Promise<Blob | null> {
  try {
    if (contentType === "application/pdf") {
      const doc = await openPdf(await blob.arrayBuffer());
      try {
        const canvas = await renderPage(doc, 1, THUMB_SIZE);
        return await encode(canvas);
      } finally {
        await doc.destroy();
      }
    }
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const scale = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return await encode(canvas);
  } catch {
    return null;
  }
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.8));
}
