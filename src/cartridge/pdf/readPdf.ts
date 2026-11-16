/**
 * Browser entry point for PDFs. pdf.js and its worker are loaded on demand,
 * so they are not part of the main bundle. The worker file is bundled by Vite
 * as a local asset, so this works offline once the app is cached.
 *
 * We use pdf.js's legacy build: the modern worker calls
 * Uint8Array.prototype.toHex(), which Chrome only has from version 140, and we
 * support Chrome 139. The legacy build polyfills it.
 */
import { extractPdfPages, type PdfLibLike, type PdfProgress } from './extractPdf';

let libPromise: Promise<PdfLibLike> | undefined;

function loadPdfJs(): Promise<PdfLibLike> {
  libPromise ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfLibLike;
  });
  return libPromise;
}

export async function readPdfFile(
  file: Blob,
  onProgress?: (p: PdfProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const [lib, buffer] = await Promise.all([loadPdfJs(), file.arrayBuffer()]);
  return extractPdfPages(lib, new Uint8Array(buffer), onProgress, signal);
}
