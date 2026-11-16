/**
 * Text extraction with pdf.js. Parsing and text extraction run in pdf.js's own
 * Web Worker (pdf.worker.mjs); this module only asks for each page's text
 * items and joins them. Kept independent of how pdf.js is loaded, so the same
 * code runs in the browser (./readPdf.ts) and in Node tests.
 */
import { assemblePageText } from './assemble';

export interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup?(): unknown;
}

export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

/** In pdf.js 6 the loading task, not the document, owns destroy(). */
export interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void>;
}

export interface PdfLibLike {
  getDocument(src: {
    data: Uint8Array;
    verbosity?: number;
    disableFontFace?: boolean;
    useSystemFonts?: boolean;
  }): PdfLoadingTaskLike;
}

export interface PdfProgress {
  page: number;
  pageCount: number;
}

export class PdfError extends Error {
  override readonly name = 'PdfError';
  readonly code: 'PASSWORD' | 'INVALID' | 'FAILED';
  constructor(message: string, code: PdfError['code']) {
    super(message);
    this.code = code;
  }
}

function toPdfError(e: unknown): PdfError {
  const name = (e as { name?: string }).name;
  if (name === 'PasswordException') {
    return new PdfError(
      'This PDF is password-protected. Remove the password and try again.',
      'PASSWORD',
    );
  }
  if (name === 'InvalidPDFException')
    return new PdfError('This file is not a valid PDF.', 'INVALID');
  return new PdfError(`Could not read this PDF: ${(e as Error).message ?? String(e)}`, 'FAILED');
}

/** Returns one string per page, in order. */
export async function extractPdfPages(
  lib: PdfLibLike,
  data: Uint8Array,
  onProgress?: (p: PdfProgress) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  // verbosity 0 = errors only; fonts are never rendered, so no font faces.
  const task = lib.getDocument({
    data,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
  });
  let doc: PdfDocumentLike;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    throw toPdfError(e);
  }
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new PdfError('Stopped.', 'FAILED');
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(assemblePageText(content.items));
      page.cleanup?.();
      onProgress?.({ page: n, pageCount: doc.numPages });
    }
    return pages;
  } catch (e) {
    throw e instanceof PdfError ? e : toPdfError(e);
  } finally {
    await task.destroy();
  }
}
