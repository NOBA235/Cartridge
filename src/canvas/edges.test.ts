import { describe, expect, it } from 'vitest';
import { FIELD_RULES } from '@/testing/fieldFixture';
import { decide, formatEdge, sameText, type EdgeFacts } from './edges';

const found = FIELD_RULES.find((r) => r.id === 'R004');
if (!found) throw new Error('fixture changed: R004 missing');
const TOILETS = found;
const facts = (o: Partial<EdgeFacts> = {}): EdgeFacts => ({
  matchedRuleId: 'R004',
  triggersWhenCondition: true,
  matchesException: false,
  matchedExceptionText: null,
  outOfScope: false,
  ...o,
});

describe('decide', () => {
  it('flags a connection that meets the situation and no exception', () => {
    expect(decide(facts(), TOILETS)).toBe('VIOLATION');
  });

  it('allows it when a listed exception applies, copied in other spacing or case', () => {
    expect(
      decide(
        facts({
          matchesException: true,
          matchedExceptionText: 'short stays of under 3 days may use  shared facilities',
        }),
        TOILETS,
      ),
    ).toBe('COMPLIANT_VIA_EXCEPTION');
  });

  it('is uncertain when the exception named is not one the rule lists', () => {
    expect(
      decide(facts({ matchesException: true, matchedExceptionText: 'Emergencies' }), TOILETS),
    ).toBe('UNCERTAIN');
    expect(decide(facts({ matchesException: true }), TOILETS)).toBe('UNCERTAIN');
  });

  it('is compliant when the situation is not met', () => {
    expect(decide(facts({ triggersWhenCondition: false }), TOILETS)).toBe('COMPLIANT');
  });

  it('is not covered without a rule', () => {
    expect(decide(facts({ outOfScope: true }), TOILETS)).toBe('OUT_OF_SCOPE');
    expect(decide(facts({ matchedRuleId: null }), TOILETS)).toBe('OUT_OF_SCOPE');
    expect(decide(facts(), undefined)).toBe('OUT_OF_SCOPE');
  });
});

describe('edge text', () => {
  it('is one plain line', () => {
    expect(formatEdge({ from: ' Latrine ', to: 'Borehole', label: '12 m' })).toBe(
      'Latrine --> Borehole (12 m)',
    );
    expect(formatEdge({ from: 'A', to: 'B', label: '  ' })).toBe('A --> B');
  });

  it('compares exception text without end punctuation, never empty', () => {
    expect(sameText('Only in winter.', 'only in winter')).toBe(true);
    expect(sameText('Only in winter.', 'Only in summer')).toBe(false);
    expect(sameText('.', '')).toBe(false);
    expect(sameText('x', null)).toBe(false);
  });
});
