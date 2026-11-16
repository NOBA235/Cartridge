import { describe, expect, it } from 'vitest';
import { draftFromFile, draftFromPaste, kindOfFile, MAX_FILE_BYTES } from './loadSource';
import { SourceError } from './source';

describe('loading a source', () => {
  it('recognises PDF, Markdown and text files by type or extension', () => {
    expect(kindOfFile({ name: 'a.PDF', type: '' })).toBe('pdf');
    expect(kindOfFile({ name: 'x', type: 'application/pdf' })).toBe('pdf');
    expect(kindOfFile({ name: 'notes.md', type: '' })).toBe('markdown');
    expect(kindOfFile({ name: 'rules.txt', type: 'text/plain' })).toBe('text');
    expect(
      kindOfFile({ name: 'sheet.docx', type: 'application/vnd.openxmlformats' }),
    ).toBeUndefined();
  });

  it('reads .md and .txt files', async () => {
    const md = await draftFromFile(new File(['# Rules\r\n\r\nWash hands.'], 'r.md'));
    expect(md).toMatchObject({ kind: 'markdown', text: '# Rules\n\nWash hands.', name: 'r.md' });
  });

  it('refuses unsupported and oversized files', async () => {
    await expect(draftFromFile(new File(['x'], 'a.docx'))).rejects.toBeInstanceOf(SourceError);
    const big = new File(['x'], 'big.txt');
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    await expect(draftFromFile(big)).rejects.toThrow(/limit is 50 MB/);
  });

  it('names pasted text and refuses empty text', async () => {
    expect((await draftFromPaste('  ', 'Some rules.')).name).toBe('Pasted text');
    await expect(draftFromPaste('n', '  ')).rejects.toBeInstanceOf(SourceError);
  });
});
