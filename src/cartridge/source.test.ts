import { describe, expect, it } from 'vitest';
import {
  buildDraftFromPages,
  buildDraftFromText,
  confirmSource,
  joinPages,
  looksScanned,
  pageAt,
  SCANNED_WARNING,
  sha256Hex,
  SourceError,
  sourceIdFromHash,
} from './source';

describe('source helpers', () => {
  it('joins pages with a blank line and records exact offsets', () => {
    const { text, pages } = joinPages(['one', 'two', '']);
    expect(text).toBe('one\n\ntwo\n\n');
    expect(pages).toEqual([
      { page: 1, start: 0, end: 3 },
      { page: 2, start: 5, end: 8 },
      { page: 3, start: 10, end: 10 },
    ]);
    expect(text.slice(pages[1]?.start, pages[1]?.end)).toBe('two');
  });

  it('finds the page for an offset', () => {
    const { pages } = joinPages(['aaa', 'bbb', 'ccc']);
    expect([0, 2, 4, 5, 7, 10, 999].map((o) => pageAt(pages, o))).toEqual([1, 1, 1, 2, 2, 3, 3]);
    expect(pageAt(undefined, 3)).toBeUndefined();
  });

  it('computes SHA-256 as lower-case hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('flags PDFs with almost no text', () => {
    expect(looksScanned(['', '  ', 'p. 3'])).toBe(true);
    expect(looksScanned(['x'.repeat(400), 'y'.repeat(400)])).toBe(false);
    expect(looksScanned(['x'.repeat(400), '', '', ''])).toBe(true);
  });

  it('builds a PDF draft with pages, hash and warnings', async () => {
    const draft = await buildDraftFromPages('a.pdf', [
      'First page text '.repeat(10),
      'Second\r\npage '.repeat(10),
    ]);
    expect(draft.kind).toBe('pdf');
    expect(draft.pageCount).toBe(2);
    expect(draft.text.includes('\r')).toBe(false);
    expect(draft.hash).toBe(await sha256Hex(draft.text));
    expect(draft.warnings).toEqual([]);
  });

  it('warns about a scanned-looking PDF and refuses one with no text at all', async () => {
    expect((await buildDraftFromPages('s.pdf', ['12', '', ''])).warnings).toEqual([
      SCANNED_WARNING,
    ]);
    await expect(buildDraftFromPages('empty.pdf', ['', ' '])).rejects.toBeInstanceOf(SourceError);
  });

  it('builds a text draft with unified line endings', async () => {
    const draft = await buildDraftFromText('a.md', '# Title\r\n\r\nBody\r', 'markdown');
    expect(draft.text).toBe('# Title\n\nBody\n');
    expect(draft.pages).toBeUndefined();
    await expect(buildDraftFromText('x.txt', '   ', 'text')).rejects.toThrow(/no text/);
  });

  it('needs a licence to confirm a source, and derives the id from the hash', async () => {
    const draft = await buildDraftFromText('a.txt', 'Some public rules.', 'text');
    expect(() => confirmSource(draft, '  ')).toThrow(SourceError);
    const doc = confirmSource(draft, 'CC BY-SA 4.0', new Date('2026-11-16T00:00:00Z'));
    expect(doc).toMatchObject({
      id: sourceIdFromHash(draft.hash),
      licence: 'CC BY-SA 4.0',
      publicConfirmed: true,
      createdAt: '2026-11-16T00:00:00.000Z',
    });
  });
});
