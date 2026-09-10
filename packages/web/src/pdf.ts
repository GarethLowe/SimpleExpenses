/**
 * pdf.js is ~400 KB, so it is loaded on demand: only when a PDF is previewed
 * or a PDF thumbnail is generated at upload time. The legacy build is used
 * because the modern one relies on very recent JS APIs (e.g.
 * Map.prototype.getOrInsertComputed) that older iOS/Android browsers lack.
 */
export type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
export type PdfDocument = import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy;

let loader: Promise<PdfJs> | undefined;

export function loadPdfJs(): Promise<PdfJs> {
  loader ??= (async () => {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return loader;
}

export async function openPdf(data: ArrayBuffer | string): Promise<PdfDocument> {
  const pdfjs = await loadPdfJs();
  const task = typeof data === "string" ? pdfjs.getDocument({ url: data }) : pdfjs.getDocument({ data: new Uint8Array(data) });
  return task.promise;
}

/** Render one page to a canvas whose CSS width is `targetWidth` (backing store scaled by `pixelRatio`). */
export async function renderPage(doc: PdfDocument, pageNumber: number, targetWidth: number, pixelRatio = 1): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = targetWidth / base.width;
  const viewport = page.getViewport({ scale: scale * pixelRatio });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.round(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.round(viewport.height / pixelRatio)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}
