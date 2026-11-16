import { describe, expect, it } from 'vitest';
import { normalize, normalizeWithMap } from './normalize';
import { joinPages } from './source';
import { prepareSource, verifyQuote, type VerifyResult } from './verifyQuote';

function ok(r: VerifyResult): Extract<VerifyResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected a match, got ${r.reason}`);
  return r;
}

/** Asserts the quote verifies and returns the original passage it matched. */
function matched(quote: string, source: string): string {
  const r = ok(verifyQuote(quote, source));
  return source.slice(r.start, r.end);
}

describe('normalize', () => {
  it('lower-cases, unifies quotes and dashes, collapses whitespace and trims', () => {
    expect(normalize('  “Hello” said Ann’s\t\nTEAM  ')).toBe('"hello" said ann\'s team');
  });

  it('drops spaces next to dashes, so dash spacing does not matter', () => {
    expect(normalize('water – sanitation')).toBe('water-sanitation');
    expect(normalize('water—sanitation')).toBe('water-sanitation');
    expect(normalize('10 -20')).toBe('10-20');
  });

  it('expands ligatures', () => {
    expect(normalize('ﬁrst ﬂow oﬀ eﬃcient Æsop œuvre')).toBe(
      'first flow off efficient aesop oeuvre',
    );
  });

  it('removes soft hyphens and zero-width characters', () => {
    expect(normalize('sani\u00ADtation wa\u200Bter\uFEFF')).toBe('sanitation water');
  });

  it('joins words hyphenated across a line break, including CRLF and soft hyphens', () => {
    expect(normalize('commu-\nnity')).toBe('community');
    expect(normalize('commu- \r\n  nity')).toBe('community');
    expect(normalize('commu\u00AD\nnity')).toBe('community');
    expect(normalize('commu\u2010\nnity')).toBe('community');
  });

  it('never joins words at a dash, or at a hyphen next to a number', () => {
    expect(normalize('water—\nsanitation')).toBe('water-sanitation');
    expect(normalize('pages 10-\n12')).toBe('pages 10-12');
  });

  it('maps every output character back to its original range', () => {
    const src = 'Eﬃcient  use';
    const n = normalizeWithMap(src);
    expect(n.text).toBe('efficient use');
    // 'f','f','i' all come from the single ligature character at index 1.
    expect([n.starts[1], n.ends[1], n.starts[3], n.ends[3]]).toEqual([1, 2, 1, 2]);
    expect(src.slice(n.starts[0], n.ends[n.text.length - 1])).toBe(src);
  });
});

describe('verifyQuote', () => {
  const source =
    'Water supply standard 1.1: Access and water quantity.\n' +
    'People have equitable and affordable access to a sufficient quantity of safe water.\n\n' +
    'Provide at least 15 litres of water per person per day.\n';

  it('1. finds an exact quote and returns the original passage', () => {
    expect(matched('at least 15 litres of water per person per day', source)).toBe(
      'at least 15 litres of water per person per day',
    );
  });

  it('2. ignores case', () => {
    expect(verifyQuote('PROVIDE AT LEAST 15 LITRES', source).ok).toBe(true);
  });

  it('3. treats curly and straight single quotes as the same', () => {
    expect(matched("the community's water point", 'Keep the community’s water point clean.')).toBe(
      'the community’s water point',
    );
  });

  it('4. treats curly, straight and guillemet double quotes as the same', () => {
    const src = 'Label it “safe water” in the local language.';
    expect(verifyQuote('label it "safe water"', src).ok).toBe(true);
    expect(verifyQuote('label it «safe water»', src).ok).toBe(true);
  });

  it('5. treats en dash, em dash, minus and hyphen as the same', () => {
    const src = 'Distance – no more than 500 metres — from any household; range 10−20.';
    expect(verifyQuote('distance - no more than 500 metres - from any household', src).ok).toBe(
      true,
    );
    expect(verifyQuote('range 10-20', src).ok).toBe(true);
  });

  it('6. matches a plain quote against a ligature in the source', () => {
    expect(matched('sufficient flow for the first week', 'A suﬃcient ﬂow for the ﬁrst week.')).toBe(
      'suﬃcient ﬂow for the ﬁrst week',
    );
  });

  it('7. matches a ligature in the quote against plain source text', () => {
    expect(verifyQuote('eﬃcient ﬁltration', 'Use efficient filtration methods.').ok).toBe(true);
  });

  it('8. ignores soft hyphens inside words', () => {
    expect(
      verifyQuote('sanitation facilities', 'Build sani\u00ADtation facil\u00ADities first.').ok,
    ).toBe(true);
  });

  it('9. joins a word hyphenated across a line break', () => {
    const src = 'Each household needs a commu-\nnity water point within 500 metres.';
    expect(matched('a community water point', src)).toBe('a commu-\nnity water point');
  });

  it('10. joins across CRLF line breaks and soft hyphens at the line end', () => {
    expect(verifyQuote('a community water point', 'a commu-\r\nnity water point').ok).toBe(true);
    expect(verifyQuote('a community water point', 'a commu\u00AD\nnity water point').ok).toBe(true);
  });

  it('11. matches a real compound word that the source split at a line end', () => {
    const r = ok(verifyQuote('a well-known risk', 'This is a well-\nknown risk for children.'));
    expect(r.matchedBy).toBe('hyphen-insensitive');
  });

  it('12. collapses runs of spaces, tabs, newlines and no-break spaces', () => {
    const src = 'Provide   at\tleast\n\n15\u00A0litres\u2009of water.';
    expect(matched('provide at least 15 litres of water', src)).toBe(
      'Provide   at\tleast\n\n15\u00A0litres\u2009of water',
    );
  });

  it('13. ignores leading and trailing whitespace in the quote', () => {
    expect(verifyQuote('   at least 15 litres  \n', source).ok).toBe(true);
  });

  it('14. handles composed and decomposed accents, full-width digits and ellipses', () => {
    expect(verifyQuote('café water point', 'The cafe\u0301 water point.').ok).toBe(true);
    expect(verifyQuote('at least 15 litres', 'at least １５ litres').ok).toBe(true);
    expect(verifyQuote('and so on...', 'and so on… more').ok).toBe(true);
  });

  it('15. ignores zero-width characters copied from PDFs', () => {
    expect(verifyQuote('safe water', 'safe\u200B water').ok).toBe(true);
  });

  it('16. fails when the text is not in the source', () => {
    expect(verifyQuote('provide at least 20 litres', source)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(verifyQuote('boil all water for ten minutes', source)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });

  it('17. fails when one number differs', () => {
    expect(verifyQuote('at least 16 litres of water per person per day', source).ok).toBe(false);
  });

  it('18. fails when the quote starts or ends inside a word or number', () => {
    expect(verifyQuote('5 litres of water', source).ok).toBe(false);
    expect(verifyQuote('at least 1', source).ok).toBe(false);
    expect(verifyQuote('rovide at least', source).ok).toBe(false);
  });

  it('19. does not join words across a dash at a line end', () => {
    expect(verifyQuote('watersanitation', 'water—\nsanitation').ok).toBe(false);
    expect(verifyQuote('water — sanitation', 'water—\nsanitation').ok).toBe(true);
    expect(verifyQuote('water—sanitation', 'water—\nsanitation').ok).toBe(true);
  });

  it('20. rejects an empty or whitespace-only quote', () => {
    expect(verifyQuote('', source)).toEqual({ ok: false, reason: 'EMPTY_QUOTE' });
    expect(verifyQuote(' \n\u00AD ', source)).toEqual({ ok: false, reason: 'EMPTY_QUOTE' });
  });

  it('21. reports the page the passage starts on, across a page break', () => {
    const src = joinPages(['Intro.', 'Provide at least 15 litres', 'of water per person per day.']);
    const r = ok(verifyQuote('at least 15 litres of water per person', src));
    expect(r.page).toBe(2);
    expect(src.text.slice(r.start, r.end)).toBe('at least 15 litres\n\nof water per person');
  });

  it('22. counts how many times the passage occurs', () => {
    expect(ok(verifyQuote('wash hands', 'Wash hands. Then wash hands again.')).occurrences).toBe(2);
  });

  it('24. prefers an occurrence inside a given range, else the first', () => {
    const src = joinPages(['Wash hands with soap.', 'Other text.', 'Wash hands with soap.']);
    const third = src.pages[2];
    if (!third) throw new Error('page missing');
    expect(ok(verifyQuote('wash hands with soap', src, { preferRange: third })).page).toBe(3);
    expect(ok(verifyQuote('wash hands with soap', src)).page).toBe(1);
    expect(
      ok(verifyQuote('wash hands with soap', src, { preferRange: { start: 0, end: 1 } })).page,
    ).toBe(1);
  });

  it('23. reuses a prepared source', () => {
    const prepared = prepareSource({ text: source });
    expect(verifyQuote('safe water', prepared).ok).toBe(true);
    expect(verifyQuote('unsafe water', prepared).ok).toBe(false);
  });
});
