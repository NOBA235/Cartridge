import { describe, expect, it } from 'vitest';
import type { Rule } from '@/cartridge/types';
import { FIELD_RULES } from '@/testing/fieldFixture';
import { buildReport, tally } from './report';
import type { ExamCategory, ExamItem, ExamResult } from './types';

let n = 0;
function make(category: ExamCategory, split: ExamItem['split'], pass: boolean, latencyMs = 100) {
  const id = `e${++n}`;
  const expected = category === 'out-of-scope' ? 'NONE' : 'R001';
  const item: ExamItem = { id, question: `q${n}`, expectedRuleId: expected, split, category };
  const result: ExamResult = {
    itemId: id,
    question: item.question,
    expected,
    predicted: pass ? expected : 'R002',
    verified: pass,
    pass,
    latencyMs,
    candidates: [],
  };
  return { item, result };
}

function exam(spec: ReadonlyArray<readonly [ExamCategory, ExamItem['split'], boolean]>) {
  const made = spec.map(([c, s, p]) => make(c, s, p));
  return {
    items: made.map((m) => m.item),
    practice: made.filter((m) => m.item.split === 'practice').map((m) => m.result),
    heldOut: made.filter((m) => m.item.split === 'held-out').map((m) => m.result),
  };
}

const base = {
  cartridge: { rules: FIELD_RULES },
  measuredOn: 'device' as const,
  tutorRounds: 1,
  now: new Date('2026-11-16T10:00:00Z'),
};

describe('buildReport', () => {
  it('computes the rates from practice and held-out, and is ready above the bar', () => {
    const e = exam([
      ...Array.from({ length: 10 }, () => ['critical', 'held-out', true] as const),
      ['out-of-scope', 'held-out', true],
      ['out-of-scope', 'held-out', true],
      ['standard', 'held-out', false],
      ['standard', 'practice', true],
      ['standard', 'practice', false],
    ]);
    const r = buildReport({ ...base, ...e, practiceStart: e.practice });
    expect(r).toMatchObject({
      measuredOn: 'device',
      passRate: 0.5,
      criticalPassRate: 1,
      outOfScopeRate: 1,
      heldOutPassRate: 12 / 13,
      ready: true,
      thresholds: { criticalPassRate: 0.9, outOfScopeRate: 0.8 },
      tutorRounds: 1,
      medianLatencyMs: 100,
      ranAt: '2026-11-16T10:00:00.000Z',
    });
    expect(r.counts?.heldOutCritical).toEqual({ passed: 10, total: 10 });
    expect(r.failures).toEqual([
      expect.objectContaining({ set: 'practice', expected: 'R001', predicted: 'R002' }),
      expect.objectContaining({ set: 'held-out' }),
    ]);
  });

  it('needs review when critical rules fall below 90% or out of scope below 80% on held-out', () => {
    const lowCritical = exam([
      ...Array.from({ length: 9 }, () => ['critical', 'held-out', true] as const),
      ['critical', 'held-out', false],
      ['critical', 'held-out', false],
      ['out-of-scope', 'held-out', true],
    ]);
    expect(buildReport({ ...base, ...lowCritical, practiceStart: [] }).ready).toBe(false);
    const lowOut = exam([
      ['critical', 'held-out', true],
      ['out-of-scope', 'held-out', true],
      ['out-of-scope', 'held-out', false],
    ]);
    expect(buildReport({ ...base, ...lowOut, practiceStart: [] }).ready).toBe(false);
  });

  it('uses configurable thresholds', () => {
    const e = exam([
      ['critical', 'held-out', true],
      ['critical', 'held-out', false],
      ['out-of-scope', 'held-out', true],
    ]);
    expect(
      buildReport({
        ...base,
        ...e,
        practiceStart: [],
        thresholds: { criticalPassRate: 0.5, outOfScopeRate: 0.5 },
      }).ready,
    ).toBe(true);
  });

  it('is not ready when held-out has no critical or no out-of-scope question', () => {
    const noCritical = exam([
      ['out-of-scope', 'held-out', true],
      ['standard', 'held-out', true],
    ]);
    const r1 = buildReport({ ...base, ...noCritical, practiceStart: [] });
    expect(r1.ready).toBe(false);
    expect(r1.notes).toContain(
      'No critical question was in the held-out set, so critical rules could not be checked.',
    );
    const noOut = exam([['critical', 'held-out', true]]);
    expect(buildReport({ ...base, ...noOut, practiceStart: [] }).ready).toBe(false);
  });

  it('does not need critical questions when the cartridge has no critical rules', () => {
    const rules: Rule[] = FIELD_RULES.map((r) => ({ ...r, severity: 'minor' }));
    const e = exam([
      ['out-of-scope', 'held-out', true],
      ['standard', 'held-out', true],
    ]);
    const r = buildReport({ ...base, ...e, cartridge: { rules }, practiceStart: [] });
    expect(r).toMatchObject({ ready: true, criticalPassRate: 1 });
    expect(r.notes).toContain('This cartridge has no critical rules.');
  });

  it('warns when held-out is well below practice', () => {
    const e = exam([
      ['standard', 'practice', true],
      ['standard', 'practice', true],
      ['critical', 'held-out', false],
      ['out-of-scope', 'held-out', true],
    ]);
    expect(
      buildReport({ ...base, ...e, practiceStart: e.practice }).notes?.some((x) =>
        x.includes('well below practice'),
      ),
    ).toBe(true);
  });

  it('leaves questions that never reached the device out of the median time', () => {
    const e = exam([
      ['critical', 'held-out', true],
      ['out-of-scope', 'held-out', true],
    ]);
    const first = e.heldOut[0] as ExamResult;
    e.heldOut[0] = { ...first, latencyMs: 900 };
    e.heldOut[1] = { ...(e.heldOut[1] as ExamResult), latencyMs: 1, reason: 'LOW_RETRIEVAL' };
    expect(buildReport({ ...base, ...e, practiceStart: [] }).medianLatencyMs).toBe(900);
  });

  it('tally counts passes', () => {
    expect(tally([])).toEqual({ passed: 0, total: 0 });
  });
});
