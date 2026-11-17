import { describe, expect, it } from 'vitest';
import { FIELD_CARTRIDGE, FIELD_RULES } from '@/testing/fieldFixture';
import type { Cartridge, ExamReport, Rule } from './types';
import {
  diffRules,
  formatField,
  isEmptyDiff,
  nextRuleId,
  restoreVersion,
  versionWithRule,
  VersionError,
} from './versions';

const rule = (id: string): Rule => FIELD_RULES.find((r) => r.id === id) as Rule;

const NEW_RULE: Rule = {
  id: 'R009',
  title: 'Shared toilets for short stays',
  when: 'A group stays only a few days',
  then: 'Short stays of under 3 days may use shared facilities.',
  exceptions: [],
  severity: 'minor',
  keywords: ['short stay'],
  source: {
    section: 'Sanitation',
    page: 2,
    quote: 'Short stays of under 3 days may use shared facilities.',
  },
};

const report: ExamReport = {
  ranAt: '2026-11-16T10:00:00.000Z',
  measuredOn: 'device',
  passRate: 1,
  criticalPassRate: 1,
  outOfScopeRate: 1,
  heldOutPassRate: 1,
  failures: [],
  ready: true,
};

describe('diffRules', () => {
  it('finds added, removed and changed rules, field by field, in ID order', () => {
    const after: Rule[] = [
      ...FIELD_RULES.filter((r) => r.id !== 'R003').map((r) =>
        r.id === 'R005'
          ? { ...r, title: 'Latrine distance from water sources', keywords: ['latrine', 'well'] }
          : r,
      ),
      NEW_RULE,
    ];
    const d = diffRules(FIELD_RULES, after);
    expect(d.added.map((r) => r.id)).toEqual(['R009']);
    expect(d.removed.map((r) => r.id)).toEqual(['R003']);
    expect(d.changed).toEqual([
      {
        id: 'R005',
        title: 'Latrine distance from water sources',
        fields: [
          {
            field: 'title',
            before: 'Toilet distance from groundwater',
            after: 'Latrine distance from water sources',
          },
          { field: 'keywords', before: rule('R005').keywords.join(', '), after: 'latrine, well' },
        ],
      },
    ]);
    expect(d.unchanged).toBe(6);
    expect(isEmptyDiff(d)).toBe(false);
  });

  it('sees changes to the quote, the page and the calculation', () => {
    const r4 = rule('R004');
    const changed: Rule = {
      ...r4,
      source: { ...r4.source, page: 3 },
      calc: { ...(r4.calc as NonNullable<Rule['calc']>), factor: 25 },
    };
    const [c] = diffRules([r4], [changed]).changed;
    expect(c?.fields.map((f) => f.field)).toEqual(['source', 'calc']);
    expect(c?.fields[0]).toMatchObject({
      before: 'Sanitation, p. 2: “Provide one toilet for every 20 people.”',
      after: 'Sanitation, p. 3: “Provide one toilet for every 20 people.”',
    });
    expect(c?.fields[1]?.after).toBe('toilets = people ÷ 25, rounded up');
  });

  it('ignores key order inside a field, and reports nothing for identical versions', () => {
    const r4 = rule('R004');
    const calc = r4.calc as NonNullable<Rule['calc']>;
    const reversed = Object.fromEntries(Object.entries(calc).reverse()) as typeof calc;
    expect(Object.keys(reversed)).not.toEqual(Object.keys(calc));
    const reordered: Rule = { ...r4, calc: reversed };
    expect(isEmptyDiff(diffRules([r4], [reordered]))).toBe(true);
    expect(diffRules(FIELD_RULES, FIELD_RULES)).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: 8,
    });
  });

  it('formats fields as plain text', () => {
    expect(formatField(rule('R004'), 'exceptions')).toBe(
      'Short stays of under 3 days may use shared facilities.',
    );
    expect(formatField(rule('R001'), 'notWhen')).toBe('');
    expect(formatField(rule('R001'), 'calc')).toBe(
      'water per day (litres) = people × 15, rounded up',
    );
  });
});

describe('nextRuleId', () => {
  it('counts every ID ever used, so IDs are never reused', () => {
    expect(nextRuleId(['R001', 'R008'])).toBe('R009');
    expect(nextRuleId(['R001', 'R012', 'R003'])).toBe('R013');
    expect(nextRuleId([])).toBe('R001');
  });

  it('keeps the width of wide IDs', () => {
    expect(nextRuleId(['R0999'])).toBe('R1000');
    expect(nextRuleId(['R0007'])).toBe('R0008');
    expect(nextRuleId(['R999'])).toBe('R1000');
  });
});

describe('versionWithRule (approve creates version N+1)', () => {
  it('adds the rule as N+1 with its parent, a changelog line and no old report', () => {
    const v1: Cartridge = { ...FIELD_CARTRIDGE, report };
    const v2 = versionWithRule(v1, NEW_RULE, new Date('2026-11-17T09:00:00Z'));
    expect(v2).toMatchObject({
      id: v1.id,
      version: 2,
      parentVersion: 1,
      createdAt: '2026-11-17T09:00:00.000Z',
    });
    expect(v2.rules.map((r) => r.id)).toEqual([...FIELD_RULES.map((r) => r.id), 'R009']);
    expect(v2.report).toBeUndefined();
    expect(v2.changelog.at(-1)).toBe(
      'Version 2: added R009 ‘Shared toilets for short stays’, suggested by the cloud and approved by you.',
    );
    // The old version is untouched.
    expect(v1.rules).toHaveLength(8);
    expect(v1.report).toBe(report);
  });

  it('refuses an ID that is already used', () => {
    expect(() => versionWithRule(FIELD_CARTRIDGE, { ...NEW_RULE, id: 'R004' })).toThrow(
      VersionError,
    );
  });
});

describe('restoreVersion', () => {
  const v1: Cartridge = { ...FIELD_CARTRIDGE, report };
  const v2 = versionWithRule(v1, NEW_RULE, new Date('2026-11-17T09:00:00Z'));

  it('makes version N+1 with the old rules and their report, keeping all history', () => {
    const v3 = restoreVersion(v2, v1, new Date('2026-11-18T09:00:00Z'));
    expect(v3).toMatchObject({
      version: 3,
      parentVersion: 2,
      createdAt: '2026-11-18T09:00:00.000Z',
      report,
    });
    expect(v3.rules).toEqual(v1.rules);
    expect(v3.changelog.at(-1)).toBe('Version 3: restored the rules of version 1.');
    expect(v3.changelog.at(-2)).toMatch(/^Version 2: added R009/);
    expect(diffRules(v2.rules, v3.rules).removed.map((r) => r.id)).toEqual(['R009']);
  });

  it('restores a version without a report without inventing one', () => {
    const v3 = restoreVersion(v2, v1);
    const v4 = restoreVersion(v3, v2);
    expect(v4.report).toBeUndefined();
    expect(v4.rules.map((r) => r.id)).toContain('R009');
  });

  it('refuses the current version, another cartridge, or another rulebook', () => {
    expect(() => restoreVersion(v2, v2)).toThrow(/already the current version/);
    expect(() => restoreVersion(v2, { ...v1, id: 'other' })).toThrow(/another cartridge/);
    expect(() => restoreVersion(v2, { ...v1, sourceHash: 'different' })).toThrow(
      /different rulebook/,
    );
  });
});
