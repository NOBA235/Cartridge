import { describe, expect, it } from 'vitest';
import { applyCap, assignIds, dedupe, ruleId, titleSimilarity, type Candidate } from './reduce';
import { RuleSchema, type Severity } from './types';

let pos = 0;
function cand(
  title: string,
  quote: string,
  opts: { severity?: Severity; keywords?: string[]; start?: number } = {},
): Candidate {
  const start = opts.start ?? (pos += 100);
  return {
    draft: {
      title,
      when: `When ${title}`,
      then: `Do ${title}.`,
      exceptions: [],
      severity: opts.severity ?? 'major',
      keywords: opts.keywords ?? [title.toLowerCase()],
    },
    quote,
    start,
    end: start + quote.length,
    section: 'S',
    chunkIndex: 0,
  };
}

describe('titleSimilarity', () => {
  it('ignores case, punctuation and small words', () => {
    expect(
      titleSimilarity('Water quantity per person, per day', 'water quantity per person per day'),
    ).toBe(1);
  });
  it('scores different subjects low', () => {
    expect(titleSimilarity('Water quantity per person', 'Water quantity per patient')).toBeCloseTo(
      0.5,
    );
    expect(titleSimilarity('Toilet distance', 'Food storage')).toBe(0);
    expect(titleSimilarity('', 'x')).toBe(0);
  });
});

describe('dedupe', () => {
  it('drops a rule with the same quote, ignoring case and whitespace, and keeps the first', () => {
    const a = cand('Water per person', 'Provide 15 litres per person.', { start: 10 });
    const b = cand('Daily water ration', 'provide  15 LITRES per person.', { start: 50 });
    const { kept, dropped } = dedupe([b, a], 0.8);
    expect(kept.map((k) => k.draft.title)).toEqual(['Water per person']);
    expect(dropped).toEqual([
      expect.objectContaining({ title: 'Daily water ration', reason: 'DUPLICATE' }),
    ]);
    expect(dropped[0]?.detail).toContain('same quote');
  });

  it('drops a rule with a very similar title', () => {
    const { kept, dropped } = dedupe(
      [
        cand('Toilets per number of people', 'One toilet per 20 people.'),
        cand('Toilets per people number', 'Twenty people share a toilet.'),
      ],
      0.8,
    );
    expect(kept).toHaveLength(1);
    expect(dropped[0]?.detail).toContain('very similar title');
  });

  it('keeps rules whose titles only partly overlap', () => {
    const { kept } = dedupe(
      [
        cand('Water quantity per person', 'A.'),
        cand('Water quantity per patient', 'B.'),
        cand('Minimum water quantity per person', 'C.'),
      ],
      0.8,
    );
    expect(kept).toHaveLength(3);
  });

  it('merges keywords into the kept rule, up to 10', () => {
    const many = Array.from({ length: 8 }, (_, i) => `k${i}`);
    const { kept } = dedupe(
      [
        cand('A rule', 'Same.', { keywords: many }),
        cand('Other', 'same.', { keywords: ['k0', 'x1', 'x2', 'x3'] }),
      ],
      0.8,
    );
    expect(kept[0]?.draft.keywords).toEqual([...many, 'x1', 'x2']);
  });
});

describe('applyCap', () => {
  it('keeps critical, then major, then minor, and returns them in source order', () => {
    const c = [
      cand('Minor A', 'a', { severity: 'minor', start: 1 }),
      cand('Critical B', 'b', { severity: 'critical', start: 2 }),
      cand('Major C', 'c', { severity: 'major', start: 3 }),
      cand('Critical D', 'd', { severity: 'critical', start: 4 }),
    ];
    const { kept, dropped } = applyCap(c, 3);
    expect(kept.map((k) => k.draft.title)).toEqual(['Critical B', 'Major C', 'Critical D']);
    expect(dropped.map((d) => [d.title, d.reason])).toEqual([['Minor A', 'OVER_CAP']]);
  });

  it('changes nothing under the cap', () => {
    const c = [cand('One', 'a'), cand('Two', 'b')];
    expect(applyCap(c, 120)).toEqual({ kept: c, dropped: [] });
  });
});

describe('IDs', () => {
  it('uses at least three digits and widens past 999', () => {
    expect(ruleId(0, 41)).toBe('R001');
    expect(ruleId(119, 120)).toBe('R120');
    expect(ruleId(0, 1000)).toBe('R0001');
    expect(ruleId(999, 1000)).toBe('R1000');
  });

  it('numbers rules in source order and builds valid rules', () => {
    const rules = assignIds([
      cand('Second', 'b', { start: 200 }),
      cand('First', 'a', { start: 100 }),
    ]);
    expect(rules.map((r) => [r.id, r.title])).toEqual([
      ['R001', 'First'],
      ['R002', 'Second'],
    ]);
    for (const r of rules) expect(RuleSchema.safeParse(r).success).toBe(true);
  });
});
