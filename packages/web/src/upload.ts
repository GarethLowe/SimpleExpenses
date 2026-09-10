import { MAX_UPLOAD_BYTES, type AllowedContentType, type Expense } from "@simple-expenses/shared";
import type { ApiClient } from "./api";

/** Claude's per-image cap is 5 MB; we stay comfortably under it. */
const TARGET_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_DIMENSION = 2200;

export interface PreparedFile {
  blob: Blob;
  contentType: AllowedContentType;
  filename: string;
}

/**
 * Normalise a captured/selected file for upload: photos are downscaled and
 * re-encoded as JPEG when large, PDFs pass through unchanged.
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("PDF is larger than 20 MB");
    return { blob: file, contentType: "application/pdf", filename: file.name };
  }
  const isSupported = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (isSupported && file.size <= TARGET_IMAGE_BYTES) {
    const dims = await imageDimensions(file).catch(() => null);
    if (dims && Math.max(dims.width, dims.height) <= MAX_DIMENSION) {
      return { blob: file, contentType: file.type as AllowedContentType, filename: file.name };
    }
  }
  // Re-encode (also converts HEIC on browsers that can decode it, i.e. Safari).
  const bitmap = await decode(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  let quality = 0.88;
  let blob = await toBlob(canvas, quality);
  while (blob.size > TARGET_IMAGE_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  const base = file.name.replace(/\.[^.]+$/, "") || "receipt";
  return { blob, contentType: "image/jpeg", filename: `${base}.jpg` };
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`Cannot read ${file.name}. Use a JPEG, PNG, WebP or PDF.`);
  }
}

function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality);
  });
}

export interface UploadOptions {
  company?: string | null;
  category?: string | null;
  onProgress?: (fraction: number) => void;
}

/** Create the record, then PUT the bytes to the presigned URL. */
export async function uploadReceipt(api: ApiClient, file: File, opts: UploadOptions = {}): Promise<Expense> {
  const prepared = await prepareFile(file);
  const created = await api.createExpense({
    filename: prepared.filename,
    contentType: prepared.contentType,
    size: prepared.blob.size,
    company: opts.company ?? null,
    category: opts.category ?? null,
  });
  await putWithProgress(created.uploadUrl, created.uploadHeaders, prepared.blob, opts.onProgress);
  return created.expense;
}

function putWithProgress(url: string, headers: Record<string, string>, body: Blob, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(body);
  });
}
