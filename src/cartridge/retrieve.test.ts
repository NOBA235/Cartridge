import { describe, expect, it } from 'vitest';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import { formatPassages, buildPassageIndex } from './passages';
import { buildRuleIndex } from './retrieve';
import { processTerm } from './searchTerms';

const index = buildRuleIndex(FIELD_CARTRIDGE);

describe('retrieve', () => {
  it('returns at most 5 candidates, best first', () => {
    const r = index.search('How many toilets do we need for 400 people near the water point?');
    expect(r.hits.length).toBeLessThanOrEqual(5);
    expect(r.hits[0]?.rule.id).toBe('R004');
    expect(r.confident).toBe(true);
    const scores = r.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('is not confident for a question no rule is close to', () => {
    for (const q of [
      'What is the radio frequency for the base camp?',
      'who is the camp manager',
      'how many generators do we need',
    ]) {
      expect(index.search(q).confident, q).toBe(false);
    }
  });

  it('matches word beginnings and light misspellings', () => {
    expect(index.search('chlorin level').hits[0]?.rule.id).toBe('R003');
    expect(index.search('latrnes for 200 ppl').hits[0]?.rule.id).toBe('R004');
  });

  it('weights keywords above other fields', () => {
    // 'borehole' appears only in R005's keywords.
    expect(index.search('borehole').hits[0]?.rule.id).toBe('R005');
  });

  it('respects topK and minScore options', () => {
    expect(index.search('water', { topK: 2 }).hits).toHaveLength(2);
    expect(index.search('water', { minScore: 1e9 }).confident).toBe(false);
  });

  it('drops question words and keeps numbers', () => {
    expect(processTerm('How')).toBeNull();
    expect(processTerm('many')).toBeNull();
    expect(processTerm('5')).toBe('5');
    expect(processTerm('Toilets')).toBe('toilets');
  });
});

describe('passages', () => {
  it('finds rulebook paragraphs with their page', () => {
    const [first] = buildPassageIndex(FIELD_SOURCE).search('groundwater toilets distance');
    expect(first?.text).toBe('Toilets must be at least 30 metres from any groundwater source.');
    expect(first?.page).toBe(2);
    expect(formatPassages(first ? [first] : [])).toBe(
      '[p. 2] Toilets must be at least 30 metres from any groundwater source.',
    );
    expect(formatPassages([])).toBe('(none)');
  });

  it('cuts long paragraphs', () => {
    const long = { text: `${'word '.repeat(600)}end.` };
    const [p] = buildPassageIndex(long, 100).search('word');
    expect(p?.text.length).toBe(100);
  });
});
