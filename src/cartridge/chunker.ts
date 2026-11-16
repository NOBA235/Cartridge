/**
 * Splits a source into chunks for the cloud compiler.
 *
 * - Units: sections that start at markdown headings ("# ...") when the text
 *   has any; otherwise pages (PDFs); otherwise the whole text.
 * - Units are packed into chunks of at most `maxChars` characters (default
 *   30,000), counting the page markers. A unit that is too big is split at
 *   paragraph boundaries, and a paragraph that is too big at whitespace.
 * - Every chunk after the first starts with the last paragraph of the chunk
 *   before it (one paragraph of overlap), unless that paragraph is longer
 *   than `maxOverlapChars`.
 * - Chunk text carries page markers like "[p. 12]" where each page starts, as
 *   COMPILE_PROMPT expects. Use stripPageMarkers() on quotes before verifying.
 */
import { pageAt, type PageSpan, type SourceText } from './source';

export interface Chunk {
  readonly index: number;
  /** [start, end) offsets into the source text, including the overlap. */
  readonly start: number;
  readonly end: number;
  /** Where the new (non-overlap) part starts. Equals start for the first chunk. */
  readonly ownStart: number;
  readonly pageStart?: number;
  readonly pageEnd?: number;
  /** Heading of the first section in the chunk, if the source has headings. */
  readonly heading?: string;
  /** Prompt text: the source slice with page markers. */
  readonly text: string;
}

export interface ChunkOptions {
  maxChars?: number;
  maxOverlapChars?: number;
}

export const DEFAULT_MAX_CHUNK_CHARS = 30_000;

interface Span {
  start: number;
  end: number;
}

const HEADING = /^#{1,6}[ \t]+\S.*$/gm;
const PAGE_MARKER = /\s*\[p\. \d+\]\s*/g;

export function pageMarker(page: number): string {
  return `[p. ${page}]\n`;
}

/** Removes "[p. N]" markers a model may have copied into a quote. */
export function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER, ' ').trim();
}

/** Paragraphs: maximal runs of text separated by blank lines. */
export function paragraphs(text: string, range: Span = { start: 0, end: text.length }): Span[] {
  const out: Span[] = [];
  const slice = text.slice(range.start, range.end);
  const re = /\S[\s\S]*?(?=\n[ \t]*\n|$(?![\s\S]))/g;
  for (const m of slice.matchAll(re)) {
    const s = range.start + m.index;
    let e = s + m[0].length;
    while (e > s && /\s/.test(text[e - 1] as string)) e--;
    out.push({ start: s, end: e });
  }
  return out;
}

function headingUnits(text: string): Array<Span & { heading: string }> | undefined {
  const starts = [...text.matchAll(HEADING)].map((m) => ({
    at: m.index,
    heading: m[0].replace(/^#+\s*/, '').trim(),
  }));
  if (starts.length === 0) return undefined;
  const units: Array<Span & { heading: string }> = [];
  const first = starts[0] as { at: number; heading: string };
  if (text.slice(0, first.at).trim() !== '') units.push({ start: 0, end: first.at, heading: '' });
  starts.forEach((h, i) => {
    const end = i + 1 < starts.length ? (starts[i + 1] as { at: number }).at : text.length;
    units.push({ start: h.at, end, heading: h.heading });
  });
  return units;
}

/** Cost of a slice in the chunk text, including markers for pages starting inside it. */
function markerCost(
  pages: readonly PageSpan[] | undefined,
  start: number,
  end: number,
  isChunkStart: boolean,
): number {
  if (!pages) return 0;
  let cost = 0;
  for (const p of pages) {
    if (p.start > start && p.start < end) cost += pageMarker(p.page).length;
  }
  if (isChunkStart) {
    const first = pageAt(pages, start);
    if (first !== undefined) cost += pageMarker(first).length;
  }
  return cost;
}

/** Splits an oversized span into pieces of at most `limit` characters, at whitespace when possible. */
function hardSplit(text: string, span: Span, limit: number): Span[] {
  const out: Span[] = [];
  let s = span.start;
  while (span.end - s > limit) {
    let cut = s + limit;
    const ws = text.lastIndexOf(' ', cut);
    const nl = text.lastIndexOf('\n', cut);
    const best = Math.max(ws, nl);
    if (best > s + limit / 2) cut = best;
    out.push({ start: s, end: cut });
    s = cut;
    while (s < span.end && /\s/.test(text[s] as string)) s++;
  }
  if (s < span.end) out.push({ start: s, end: span.end });
  return out;
}

function renderChunkText(source: SourceText, start: number, end: number): string {
  const { text, pages } = source;
  if (!pages) return text.slice(start, end);
  let out = '';
  let cursor = start;
  const first = pageAt(pages, start);
  if (first !== undefined) out += pageMarker(first);
  for (const p of pages) {
    if (p.start > start && p.start < end) {
      out += text.slice(cursor, p.start) + pageMarker(p.page);
      cursor = p.start;
    }
  }
  return out + text.slice(cursor, end);
}

export function chunkSource(source: SourceText, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const maxOverlap = options.maxOverlapChars ?? Math.floor(maxChars / 4);
  if (maxChars < 200) throw new Error('maxChars must be at least 200');
  const { text, pages } = source;

  // 1. Units.
  const headed = headingUnits(text);
  const units: Array<Span & { heading?: string }> =
    headed ??
    (pages && pages.length > 0
      ? pages.map((p) => ({ start: p.start, end: p.end }))
      : [{ start: 0, end: text.length }]);

  // 2. Paragraph pieces per unit, never longer than the budget for new text.
  const pieceLimit = maxChars - maxOverlap - 64;
  interface Piece extends Span {
    unitIndex: number;
    heading?: string;
  }
  const pieces: Piece[] = [];
  units.forEach((u, unitIndex) => {
    for (const para of paragraphs(text, u)) {
      for (const part of para.end - para.start > pieceLimit
        ? hardSplit(text, para, pieceLimit)
        : [para]) {
        pieces.push({ ...part, unitIndex, ...(u.heading ? { heading: u.heading } : {}) });
      }
    }
  });
  if (pieces.length === 0) return [];

  // 3. Pack pieces into chunks. A new unit starts a new chunk when it does not fit whole.
  const unitEnd = new Map<number, number>();
  pieces.forEach((p, i) => unitEnd.set(p.unitIndex, i));

  const chunks: Chunk[] = [];
  let i = 0;
  let prevLast: Span | undefined;
  while (i < pieces.length) {
    const firstPiece = pieces[i] as Piece;
    const fitsFrom = (s: number, e: number) => e - s + markerCost(pages, s, e, true) <= maxChars;
    const overlap =
      prevLast &&
      prevLast.end - prevLast.start <= maxOverlap &&
      fitsFrom(prevLast.start, firstPiece.end)
        ? prevLast
        : undefined;
    const start = overlap ? overlap.start : firstPiece.start;
    const ownStart = firstPiece.start;
    let end = firstPiece.end;
    let j = i + 1;
    const fits = (e: number) => fitsFrom(start, e);

    while (j < pieces.length) {
      const next = pieces[j] as Piece;
      if (next.unitIndex !== (pieces[j - 1] as Piece).unitIndex) {
        // Starting a new unit: take it only if the whole unit fits.
        const lastOfUnit = pieces[unitEnd.get(next.unitIndex) as number] as Piece;
        if (!fits(lastOfUnit.end)) break;
      }
      if (!fits(next.end)) break;
      end = next.end;
      j++;
    }

    chunks.push({
      index: chunks.length,
      start,
      end,
      ownStart,
      ...pageRange(pages, start, end),
      ...(firstPiece.heading ? { heading: firstPiece.heading } : {}),
      text: renderChunkText(source, start, end),
    });
    const last = pieces[j - 1] as Piece;
    prevLast = { start: last.start, end: last.end };
    i = j;
  }
  return chunks;
}

function pageRange(
  pages: readonly PageSpan[] | undefined,
  start: number,
  end: number,
): { pageStart?: number; pageEnd?: number } {
  const a = pageAt(pages, start);
  const b = pageAt(pages, Math.max(start, end - 1));
  return a === undefined || b === undefined ? {} : { pageStart: a, pageEnd: b };
}
