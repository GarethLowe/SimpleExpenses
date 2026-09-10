import { useEffect, useRef, useState } from "react";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import { openPdf, renderPage, type PdfDocument } from "../pdf";

interface Props {
  url: string;
  contentType: string;
  filename: string;
}

/**
 * Cross-device receipt preview: pinch/scroll zoom and pan for images, PDFs
 * rendered page by page with pdf.js (iOS Safari cannot scroll an embedded
 * PDF), plus rotate and "open original".
 */
export function ReceiptViewer({ url, contentType, filename }: Props) {
  const [rotation, setRotation] = useState(0);
  const isPdf = contentType === "application/pdf";
  return (
    <div className="viewer">
      <TransformWrapper minScale={0.5} maxScale={8} centerOnInit limitToBounds={rotation % 180 === 0} doubleClick={{ mode: "zoomIn" }} wheel={{ step: 0.15 }} key={rotation}>
        <Toolbar onRotate={() => setRotation((r) => (r + 90) % 360)} url={url} filename={filename} />
        <TransformComponent wrapperClass="viewer-wrap" contentClass="viewer-content">
          <div style={{ transform: `rotate(${rotation}deg)`, transition: "transform 150ms" }}>
            {isPdf ? <PdfPages url={url} /> : <img src={url} alt={filename} draggable={false} />}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

function Toolbar({ onRotate, url, filename }: { onRotate: () => void; url: string; filename: string }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="viewer-toolbar">
      <button type="button" className="btn small" onClick={() => zoomOut()} aria-label="Zoom out">−</button>
      <button type="button" className="btn small" onClick={() => zoomIn()} aria-label="Zoom in">+</button>
      <button type="button" className="btn small" onClick={() => resetTransform()}>Fit</button>
      <button type="button" className="btn small" onClick={onRotate} aria-label="Rotate">⟳</button>
      <a className="btn small" href={url} target="_blank" rel="noreferrer" download={filename}>Open</a>
    </div>
  );
}

function PdfPages({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error: string | null }>({ pages: 0, error: null });

  useEffect(() => {
    let cancelled = false;
    let doc: PdfDocument | null = null;
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    (async () => {
      try {
        doc = await openPdf(url);
        if (cancelled) return;
        const viewer = el.closest<HTMLElement>(".viewer");
        const width = Math.min((viewer?.clientWidth ?? el.clientWidth ?? 600) - 16, 1400);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i++) {
          const canvas = await renderPage(doc, i, width, ratio);
          if (cancelled) return;
          canvas.className = "pdf-page";
          el.appendChild(canvas);
          setState({ pages: i, error: null });
        }
      } catch (err) {
        if (!cancelled) setState({ pages: 0, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
  }, [url]);

  return (
    <div className="pdf-host">
      {state.error && (
        <p className="error">
          Could not render this PDF ({state.error}). <a href={url} target="_blank" rel="noreferrer">Open it directly</a>.
        </p>
      )}
      {!state.error && state.pages === 0 && <p className="muted">Rendering PDF…</p>}
      <div ref={host} />
    </div>
  );
}
