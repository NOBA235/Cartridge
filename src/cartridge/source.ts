/**
 * A loaded rulebook ("source"). The stored text is exactly what quotes are
 * verified against, and what the SHA-256 source hash is computed over.
 */

export interface PageSpan {
  /** 1-based page number. */
  readonly page: number;
  /** [start, end) offsets into the source text. */
  readonly start: number;
  readonly end: number;
}

export interface SourceText {
  readonly text: string;
  /** Present for PDFs. Sorted by start, non-overlapping. */
  readonly pages?: readonly PageSpan[];
}

export type SourceKind = 'pdf' | 'text' | 'markdown';

export type SourceWarning = {
  code: 'MOSTLY_NO_TEXT';
  message: string;
};

export interface SourceDraft extends SourceText {
  readonly name: string;
  readonly kind: SourceKind;
  /** SHA-256 of `text`, lower-case hex. */
  readonly hash: string;
  readonly charCount: number;
  readonly pageCount?: number;
  readonly warnings: readonly SourceWarning[];
}

export interface SourceDoc extends SourceDraft {
  /** Derived from the hash, so loading the same text twice keeps one copy. */
  readonly id: string;
  readonly createdAt: string;
  /**
   * The user confirmed this is a public, openly licensed or public-domain
   * document. Only confirmed sources may be sent to the cloud for compiling.
   */
  readonly publicConfirmed: true;
  readonly licence: string;
}

/** Pages are joined with a blank line, so a paragraph never runs across pages. */
export const PAGE_SEPARATOR = '\n\n';

export function joinPages(pageTexts: readonly string[]): { text: string; pages: PageSpan[] } {
  let text = '';
  const pages: PageSpan[] = [];
  pageTexts.forEach((raw, i) => {
    if (i > 0) text += PAGE_SEPARATOR;
    const start = text.length;
    text += raw;
    pages.push({ page: i + 1, start, end: text.length });
  });
  return { text, pages };
}

/** Line endings to \n. Applied once at ingest, before hashing. */
export function unifyLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Page containing `offset`, or undefined. Binary search over sorted spans. */
export function pageAt(pages: readonly PageSpan[] | undefined, offset: number): number | undefined {
  if (!pages || pages.length === 0) return undefined;
  let lo = 0;
  let hi = pages.length - 1;
  let found: PageSpan | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid] as PageSpan;
    if (p.start <= offset) {
      found = p;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found?.page;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sourceIdFromHash(hash: string): string {
  return `src-${hash.slice(0, 16)}`;
}

const nonWhitespace = (s: string) => s.replace(/\s+/g, '').length;

/**
 * Thresholds for 'almost no text': fewer than 50 visible characters per page
 * on average, or at least half the pages with fewer than 10.
 */
export const SCANNED_AVG_CHARS = 50;
export const SCANNED_EMPTY_PAGE_CHARS = 10;
export const SCANNED_EMPTY_PAGE_RATIO = 0.5;

export function looksScanned(pageTexts: readonly string[]): boolean {
  if (pageTexts.length === 0) return false;
  const counts = pageTexts.map(nonWhitespace);
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const empty = counts.filter((c) => c < SCANNED_EMPTY_PAGE_CHARS).length / counts.length;
  return avg < SCANNED_AVG_CHARS || empty >= SCANNED_EMPTY_PAGE_RATIO;
}

export const SCANNED_WARNING: SourceWarning = {
  code: 'MOSTLY_NO_TEXT',
  message:
    'This PDF has almost no text. It may be a scanned document. Scanned PDFs are not supported: rules can only be checked against text the PDF actually contains.',
};

export class SourceError extends Error {
  override readonly name = 'SourceError';
}

export async function buildDraftFromPages(
  name: string,
  pageTexts: readonly string[],
): Promise<SourceDraft> {
  const pagesClean = pageTexts.map(unifyLineEndings);
  const { text, pages } = joinPages(pagesClean);
  if (nonWhitespace(text) === 0) {
    throw new SourceError('No text found in this PDF. Scanned PDFs are not supported.');
  }
  return {
    name,
    kind: 'pdf',
    text,
    pages,
    hash: await sha256Hex(text),
    charCount: text.length,
    pageCount: pages.length,
    warnings: looksScanned(pagesClean) ? [SCANNED_WARNING] : [],
  };
}

export async function buildDraftFromText(
  name: string,
  raw: string,
  kind: Exclude<SourceKind, 'pdf'>,
): Promise<SourceDraft> {
  const text = unifyLineEndings(raw);
  if (nonWhitespace(text) === 0) throw new SourceError('There is no text to load.');
  return { name, kind, text, hash: await sha256Hex(text), charCount: text.length, warnings: [] };
}

export function confirmSource(draft: SourceDraft, licence: string, now = new Date()): SourceDoc {
  const l = licence.trim();
  if (l === '') throw new SourceError('Say which licence the document is published under.');
  return {
    ...draft,
    id: sourceIdFromHash(draft.hash),
    createdAt: now.toISOString(),
    publicConfirmed: true,
    licence: l,
  };
}
