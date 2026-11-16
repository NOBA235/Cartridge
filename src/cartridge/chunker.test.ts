import { describe, expect, it } from 'vitest';
import { chunkSource, pageMarker, paragraphs, stripPageMarkers, type Chunk } from './chunker';
import { joinPages, type SourceText } from './source';

const para = (label: string, words: number) =>
  `${label} ${Array.from({ length: words }, (_, i) => `w${i}`).join(' ')}.`;

/** Every paragraph of the source must sit inside some chunk's new (non-overlap) part. */
function expectFullCoverage(source: SourceText, chunks: readonly Chunk[]) {
  for (const p of paragraphs(source.text)) {
    const covered = chunks.some((c) => c.ownStart <= p.start && p.end <= c.end);
    const split = chunks.filter((c) => c.ownStart < p.end && c.end > p.start).length > 1;
    expect(covered || split, `paragraph at ${p.start} not covered`).toBe(true);
  }
}

describe('paragraphs', () => {
  it('splits on blank lines and trims trailing whitespace', () => {
    const text = 'One line.\nStill one.\n\n  \nTwo.\n\nThree.  \n';
    expect(paragraphs(text).map((p) => text.slice(p.start, p.end))).toEqual([
      'One line.\nStill one.',
      'Two.',
      'Three.',
    ]);
  });
});

describe('chunkSource', () => {
  it('returns one chunk equal to a short source', () => {
    const src = { text: 'Rule one.\n\nRule two.' };
    const chunks = chunkSource(src);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      index: 0,
      start: 0,
      end: src.text.length,
      ownStart: 0,
      text: src.text,
    });
  });

  it('keeps every chunk at or under the limit, with page markers counted', () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      [para(`P${i}a`, 60), para(`P${i}b`, 60), para(`P${i}c`, 60)].join('\n\n'),
    );
    const src = joinPages(pages);
    const chunks = chunkSource(src, { maxChars: 2000 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2000);
    expectFullCoverage(src, chunks);
  });

  it('starts each chunk after the first with the last paragraph of the previous one', () => {
    const text = Array.from({ length: 20 }, (_, i) => para(`Para${i}`, 40)).join('\n\n');
    const chunks = chunkSource({ text }, { maxChars: 1500 });
    expect(chunks.length).toBeGreaterThan(2);
    for (let k = 1; k < chunks.length; k++) {
      const prev = chunks[k - 1] as Chunk;
      const cur = chunks[k] as Chunk;
      const prevParas = paragraphs(text, { start: prev.start, end: prev.end });
      const lastPrev = prevParas.at(-1);
      expect(cur.start).toBe(lastPrev?.start);
      expect(cur.ownStart).toBeGreaterThan(cur.start);
      expect(cur.ownStart).toBe(prev.end + text.slice(prev.end).search(/\S/));
    }
  });

  it('adds [p. N] markers where pages start and records the page range', () => {
    const src = joinPages(['Alpha page text.', 'Beta page text.', 'Gamma page text.']);
    const [chunk] = chunkSource(src);
    expect(chunk?.text).toBe(
      `${pageMarker(1)}Alpha page text.\n\n${pageMarker(2)}Beta page text.\n\n${pageMarker(3)}Gamma page text.`,
    );
    expect(chunk).toMatchObject({ pageStart: 1, pageEnd: 3 });
  });

  it('gives later chunks the page they start on', () => {
    const pages = Array.from({ length: 6 }, (_, i) => para(`Page${i + 1}`, 120));
    const src = joinPages(pages);
    const chunks = chunkSource(src, { maxChars: 1600 });
    for (const c of chunks) {
      expect(c.text.startsWith(`[p. ${c.pageStart}]`)).toBe(true);
      expect(c.pageEnd).toBeGreaterThanOrEqual(c.pageStart ?? 0);
    }
    expect(chunks.at(-1)?.pageEnd).toBe(6);
  });

  it('starts chunks at markdown headings and never splits a section that fits', () => {
    const names = ['Water', 'Sanitation', 'Hygiene', 'Shelter', 'Food'];
    const sections = names.map((h) => `# ${h}\n\n${para(`${h}1`, 50)}\n\n${para(`${h}2`, 50)}`);
    const text = sections.join('\n\n');
    const chunks = chunkSource({ text }, { maxChars: 1200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(text.slice(c.ownStart, c.end).startsWith('# ')).toBe(true);
      expect(names).toContain(c.heading);
    }
    let at = 0;
    for (const s of sections) {
      const start = text.indexOf(s, at);
      const end = start + s.length;
      at = end;
      expect(chunks.some((c) => c.ownStart <= start && end <= c.end)).toBe(true);
    }
    expectFullCoverage({ text }, chunks);
  });

  it('packs several small sections into one chunk', () => {
    const text = ['# A', 'a.', '# B', 'b.', '# C', 'c.'].join('\n\n');
    const chunks = chunkSource({ text });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.heading).toBe('A');
  });

  it('hard-splits a paragraph that is longer than a chunk, at whitespace', () => {
    const text = para('Huge', 2000);
    const chunks = chunkSource({ text }, { maxChars: 3000 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(3000);
      expect(/^\s/.test(text.slice(c.ownStart))).toBe(false);
    }
    expect(chunks.at(-1)?.end).toBe(text.length);
  });

  it('uses 30,000 characters by default', () => {
    const text = Array.from({ length: 600 }, (_, i) => para(`Long${i}`, 30)).join('\n\n');
    expect(text.length).toBeGreaterThan(60_000);
    const chunks = chunkSource({ text });
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(30_000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('returns nothing for whitespace-only text', () => {
    expect(chunkSource({ text: ' \n\n ' })).toEqual([]);
  });
});

describe('stripPageMarkers', () => {
  it('removes markers a model may copy into a quote', () => {
    expect(stripPageMarkers('per person [p. 13]\nper day')).toBe('per person per day');
    expect(stripPageMarkers('[p. 2]\nAlpha')).toBe('Alpha');
  });
});
