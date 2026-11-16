import { describe, expect, it } from 'vitest';
import { assemblePageText, type TextItemLike } from './assemble';

const item = (str: string, y: number, hasEOL = false, height = 12): TextItemLike => ({
  str,
  hasEOL,
  transform: [12, 0, 0, 12, 72, y],
  height,
});

describe('assemblePageText', () => {
  it('breaks lines at hasEOL and keeps items on one line together', () => {
    expect(
      assemblePageText([item('Provide ', 700), item('water', 700, true), item('daily.', 686)]),
    ).toBe('Provide water\ndaily.');
  });

  it('inserts a blank line when the gap between lines is large', () => {
    expect(assemblePageText([item('Heading', 700, true), item('Body text.', 660)])).toBe(
      'Heading\n\nBody text.',
    );
  });

  it('starts a new line when the baseline moves without hasEOL', () => {
    expect(assemblePageText([item('Left', 700), item('Next', 686)])).toBe('Left\nNext');
  });

  it('skips marked-content items and empty items', () => {
    const marked = { type: 'beginMarkedContent' };
    expect(
      assemblePageText([marked, item('A', 700, true), item('', 0, true), item('B', 686)]),
    ).toBe('A\nB');
  });

  it('removes spaces before line breaks', () => {
    expect(assemblePageText([item('end   ', 700, true), item('next', 686)])).toBe('end\nnext');
  });
});
