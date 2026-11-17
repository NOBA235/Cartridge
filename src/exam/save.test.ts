import { describe, expect, it } from 'vitest';
import type { ExamReport } from '@/cartridge/types';
import { FIELD_CARTRIDGE, FIELD_RULES } from '@/testing/fieldFixture';
import { cartridgeAfterExam, isMarkedReady, overrideReady } from './save';
import type { TutorChange } from './types';

const report: ExamReport = {
  ranAt: '2026-11-16T10:00:00.000Z',
  measuredOn: 'device',
  passRate: 0.8,
  criticalPassRate: 0.75,
  outOfScopeRate: 1,
  heldOutPassRate: 0.7,
  failures: [],
  ready: false,
};

const change = (ruleId: string, field: TutorChange['field'], reverted = false): TutorChange => ({
  round: 1,
  ruleId,
  field,
  before: 'a',
  after: 'b',
  why: '',
  reverted,
});

describe('cartridgeAfterExam', () => {
  it('attaches the report to the tested version when nothing changed', () => {
    const res = cartridgeAfterExam(FIELD_CARTRIDGE, {
      rules: FIELD_RULES,
      changes: [change('R001', 'title', true)],
      report,
    });
    expect(res.newVersion).toBe(false);
    expect(res.cartridge).toEqual({ ...FIELD_CARTRIDGE, report });
  });

  it('makes version N+1 with the tutor’s rules, a changelog line and the report', () => {
    const rules = FIELD_RULES.map((r) =>
      r.id === 'R005' ? { ...r, keywords: ['latrine distance'] } : r,
    );
    const res = cartridgeAfterExam(
      FIELD_CARTRIDGE,
      {
        rules,
        changes: [
          change('R005', 'keywords'),
          change('R005', 'notWhen'),
          change('R002', 'title', true),
        ],
        report,
      },
      new Date('2026-11-16T11:00:00Z'),
    );
    expect(res.newVersion).toBe(true);
    expect(res.cartridge).toMatchObject({
      version: 2,
      parentVersion: 1,
      createdAt: '2026-11-16T11:00:00.000Z',
      report,
    });
    expect(res.cartridge.rules.find((r) => r.id === 'R005')?.keywords).toEqual([
      'latrine distance',
    ]);
    expect(res.cartridge.changelog.at(-1)).toBe(
      'Version 2: the Exam Day tutor changed 1 rule (R005): keywords, not-when hints only.',
    );
  });
});

describe('override', () => {
  it('marks a below-the-bar report as ready by the user, keeping ready false', () => {
    const c = overrideReady({ ...FIELD_CARTRIDGE, report }, new Date('2026-11-16T12:00:00Z'));
    expect(c.report).toMatchObject({
      ready: false,
      overridden: { at: '2026-11-16T12:00:00.000Z' },
    });
    expect(isMarkedReady(c.report)).toBe(true);
    expect(isMarkedReady(report)).toBe(false);
    expect(() => overrideReady(FIELD_CARTRIDGE)).toThrow(/no Exam Day report/);
  });
});
