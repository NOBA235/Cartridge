/**
 * Runs the real pdf.js (pdfjs-dist) in Node on generated PDFs. In Node,
 * pdf.js runs its worker code in-thread ("fake worker"); in the browser the
 * same extractPdfPages() talks to the real Web Worker.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDraftFromPages, SCANNED_WARNING } from '../source';
import { verifyQuote } from '../verifyQuote';
import { extractPdfPages, PdfError, type PdfLibLike } from './extractPdf';
import { makeTextPdf } from './testPdf';

let lib: PdfLibLike;

beforeAll(async () => {
  // Same legacy build as the browser code (see readPdf.ts).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href;
  lib = pdfjs as unknown as PdfLibLike;
});

describe('extractPdfPages with real pdf.js', () => {
  it('keeps pages apart and in order, with line and paragraph breaks', async () => {
    const pdf = makeTextPdf([
      ['Water supply', '', 'Provide at least 15 litres', 'per person per day.'],
      ['Sanitation', '', 'One toilet for every', '20 people.'],
    ]);
    const progress: number[] = [];
    const pages = await extractPdfPages(lib, pdf, (p) => progress.push(p.page));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toBe('Water supply\n\nProvide at least 15 litres\nper person per day.');
    expect(pages[1]).toBe('Sanitation\n\nOne toilet for every\n20 people.');
    expect(progress).toEqual([1, 2]);
  });

  it('verifies a quote across a line break and reports its page', async () => {
    const pages = await extractPdfPages(
      lib,
      makeTextPdf([
        ['Intro page.'],
        ['Each household needs a commu-', 'nity water point within 500 metres.'],
      ]),
    );
    const draft = await buildDraftFromPages('t.pdf', pages);
    const r = verifyQuote('a community water point within 500 metres', draft);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.page).toBe(2);
      expect(draft.text.slice(r.start, r.end)).toBe('a commu-\nnity water point within 500 metres');
    }
  });

  it('warns when a PDF has almost no text', async () => {
    const pages = await extractPdfPages(lib, makeTextPdf([['p. 1'], [''], ['']]));
    const draft = await buildDraftFromPages('scan.pdf', pages);
    expect(draft.warnings).toEqual([SCANNED_WARNING]);
  });

  it('rejects a file that is not a PDF', async () => {
    const err = await extractPdfPages(lib, new TextEncoder().encode('just text')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PdfError);
    expect((err as PdfError).code).toBe('INVALID');
  });
});
