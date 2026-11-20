import { describe, expect, it } from 'vitest';
import { FIELD_RULES } from '@/testing/fieldFixture';
import { decide, formatEdge, matchedException, type EdgeFacts } from './edges';

const found = FIELD_RULES.find((r) => r.id === 'R004');
if (!found) throw new Error('fixture changed: R004 missing');
const TOILETS = found;
const facts = (o: Partial<EdgeFacts> = {}): EdgeFacts => ({
  matchedRuleId: 'R004',
  triggersWhenCondition: true,
  matchesException: false,
  matchedExceptionIndex: null,
  outOfScope: false,
  ...o,
});

describe('decide', () => {
  it('flags a connection that meets the situation and no exception', () => {
    expect(decide(facts(), TOILETS)).toBe('VIOLATION');
  });

  it('allows it when a listed exception index applies and resolves its exact text from the rule', () => {
    const f = facts({ matchesException: true, matchedExceptionIndex: 0 });
    expect(decide(f, TOILETS)).toBe('COMPLIANT_VIA_EXCEPTION');
    expect(matchedException(f, TOILETS)).toBe(TOILETS.exceptions[0]);
  });

  it('is uncertain when the exception index is missing, negative, non-integer, or out of range', () => {
    expect(decide(facts({ matchesException: true, matchedExceptionIndex: 1 }), TOILETS)).toBe(
      'UNCERTAIN',
    );
    expect(decide(facts({ matchesException: true, matchedExceptionIndex: -1 }), TOILETS)).toBe(
      'UNCERTAIN',
    );
    expect(decide(facts({ matchesException: true, matchedExceptionIndex: 0.5 }), TOILETS)).toBe(
      'UNCERTAIN',
    );
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
});
