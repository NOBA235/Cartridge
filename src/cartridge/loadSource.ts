/** Turns a user-picked file or pasted text into a SourceDraft. Browser only (uses pdf.js). */
import type { PdfProgress } from './pdf/extractPdf';
import {
  buildDraftFromPages,
  buildDraftFromText,
  SourceError,
  type SourceDraft,
  type SourceKind,
} from './source';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function kindOfFile(file: { name: string; type: string }): SourceKind | undefined {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.md') || name.endsWith('.markdown') || file.type === 'text/markdown')
    return 'markdown';
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'text';
  return undefined;
}

export async function draftFromFile(
  file: File,
  onProgress?: (p: PdfProgress) => void,
  signal?: AbortSignal,
): Promise<SourceDraft> {
  const kind = kindOfFile(file);
  if (!kind) throw new SourceError('Only PDF, .txt and .md files are supported.');
  if (file.size > MAX_FILE_BYTES) {
    throw new SourceError(
      `This file is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 50 MB.`,
    );
  }
  if (kind === 'pdf') {
    const { readPdfFile } = await import('./pdf/readPdf');
    return buildDraftFromPages(file.name, await readPdfFile(file, onProgress, signal));
  }
  return buildDraftFromText(file.name, await file.text(), kind);
}

/** Pasted text limit, in characters (a pasted rulebook larger than this is better loaded as a file). */
export const MAX_PASTE_CHARS = 5_000_000;

export function draftFromPaste(name: string, text: string): Promise<SourceDraft> {
  if (text.length > MAX_PASTE_CHARS) {
    return Promise.reject(
      new SourceError(
        `This text has ${text.length.toLocaleString('en')} characters. The limit for pasted text is ${MAX_PASTE_CHARS.toLocaleString('en')}; load it as a file instead.`,
      ),
    );
  }
  return buildDraftFromText(name.trim() || 'Pasted text', text, 'text');
}
