import { describe, expect, it } from 'vitest';
import type { CloudJson } from '@/ai/cloud';
import { TUTOR_IMMUTABLE_FIELDS, type Rule } from '@/cartridge/types';
import { isPublic, type Public } from '@/privacy';
import { FIELD_RULES } from '@/testing/fieldFixture';
import { applyPatches, askTutor, buildTutorPrompt, copiesQuestion, involvedRuleIds } from './tutor';
import type { ExamItem, ExamResult } from './types';

const QUESTIONS = ['How far must the latrine pit be from a water point?'];

const failure = (overrides: Partial<ExamResult> = {}): ExamResult => ({
  itemId: 'e1',
  question: QUESTIONS[0] as string,
  expected: 'R005',
  predicted: 'R002',
  verified: true,
  pass: false,
  latencyMs: 10,
  candidates: ['R002', 'R005', 'R004'],
  ...overrides,
});

const items: ExamItem[] = [
  {
    id: 'e1',
    question: QUESTIONS[0] as string,
    expectedRuleId: 'R005',
    split: 'practice',
    category: 'critical',
  },
  {
    id: 'e2',
    question: 'A held-out question about soap?',
    expectedRuleId: 'R007',
    split: 'held-out',
    category: 'standard',
  },
];

const apply = (patches: unknown[]) =>
  applyPatches(FIELD_RULES, patches, { round: 1, questions: QUESTIONS });
const rule = (rules: readonly Rule[], id: string) => rules.find((r) => r.id === id) as Rule;

describe('applyPatches', () => {
  it('changes only title, when, keywords and notWhen, and records each change', () => {
    const res = apply([
      {
        ruleId: 'R005',
        title: 'Latrine distance from water sources',
        when: 'Choosing where to dig a latrine near any water source',
        notWhen: 'Asking how far households walk to fetch water',
        keywords: ['Latrine distance', 'latrine distance', 'pit near water', ' groundwater '],
        why: 'The device confused it with the water point rule.',
        // None of these may reach the rule:
        then: 'Anything goes.',
        exceptions: ['None'],
        severity: 'minor',
        source: { section: 'x', quote: 'x' },
        calc: { op: 'divide', factor: 1 },
      },
    ]);
    const before = rule(FIELD_RULES, 'R005');
    const after = rule(res.rules, 'R005');
    for (const f of TUTOR_IMMUTABLE_FIELDS) expect(after[f]).toEqual(before[f]);
    expect(after).toMatchObject({
      title: 'Latrine distance from water sources',
      notWhen: 'Asking how far households walk to fetch water',
      keywords: ['latrine distance', 'pit near water', 'groundwater'],
    });
    expect(res.changes.map((c) => c.field)).toEqual(['title', 'when', 'notWhen', 'keywords']);
    expect(res.changes[0]).toMatchObject({
      round: 1,
      ruleId: 'R005',
      before: before.title,
      why: 'The device confused it with the water point rule.',
      reverted: false,
    });
    // Other rules are untouched, and the input is not modified.
    expect(res.rules.filter((r) => r.id !== 'R005')).toEqual(
      FIELD_RULES.filter((r) => r.id !== 'R005'),
    );
    expect(rule(FIELD_RULES, 'R005').title).toBe('Toilet distance from groundwater');
  });

  it('rejects unknown rules, copied question text and over-long fields', () => {
    const res = apply([
      { ruleId: 'R999', title: 'x', why: '' },
      {
        ruleId: 'R005',
        when: 'When asked how far must the latrine pit be from a water point',
        why: '',
      },
      { ruleId: 'R005', keywords: ['latrine pit be from a water point', 'pit'], why: '' },
      { ruleId: 'R005', title: 'x'.repeat(200), why: '' },
      'not an object',
    ]);
    expect(res.rejected.map((r) => [r.ruleId, r.field ?? '', r.reason.slice(0, 20)])).toEqual([
      ['R999', '', 'Not a rule in this c'],
      ['R005', 'when', 'It copies exam quest'],
      ['R005', 'keywords', "'latrine pit be from"],
      ['R005', 'title', 'Longer than 120 char'],
      ['?', '', 'In the wrong shape.'],
    ]);
    expect(rule(res.rules, 'R005').keywords).toEqual(['pit']);
  });

  it('caps keywords at 10 and skips edits that change nothing', () => {
    const many = Array.from({ length: 14 }, (_, i) => `word ${i}`);
    const res = apply([
      { ruleId: 'R001', keywords: many, why: '' },
      { ruleId: 'R002', title: rule(FIELD_RULES, 'R002').title, why: '' },
    ]);
    expect(rule(res.rules, 'R001').keywords).toHaveLength(10);
    expect(res.changes.map((c) => c.ruleId)).toEqual(['R001']);
  });
});

describe('copiesQuestion', () => {
  it('catches six words in a row, or a whole short question', () => {
    expect(copiesQuestion('the latrine pit be from a water source', QUESTIONS)).toBe(true);
    expect(copiesQuestion('latrine distance from water', QUESTIONS)).toBe(false);
    expect(copiesQuestion('please say people per toilet', ['People per toilet?'])).toBe(true);
    expect(copiesQuestion('toilet', ['People per toilet?'])).toBe(false);
  });
});

describe('askTutor', () => {
  it('sends a Public prompt with only the rules involved and the practice failures', async () => {
    let sent: Public<string> | undefined;
    const cloud: CloudJson = async (task, prompt, schema) => {
      sent = prompt;
      expect(task.name).toBe('TUTOR');
      return { data: schema.parse({ patches: [] }), inferenceSource: 'in_cloud', attempts: 1 };
    };
    await askTutor([failure()], items, FIELD_RULES, cloud);
    expect(sent && isPublic(sent)).toBe(true);
    expect(involvedRuleIds([failure()], FIELD_RULES)).toEqual(['R002', 'R004', 'R005']);
    expect(sent?.value).toContain('"id": "R005"');
    expect(sent?.value).not.toContain('"id": "R001"');
    expect(sent?.value).toContain(QUESTIONS[0]);
    expect(sent?.value).not.toContain('A held-out question about soap?');
    // Quotes are not needed to fix selection and are not sent.
    expect(sent?.value).not.toContain('"quote"');
  });

  it('refuses to send a held-out question', async () => {
    const cloud: CloudJson = async () => {
      throw new Error('must not be called');
    };
    await expect(
      askTutor(
        [failure({ itemId: 'e2', question: 'A held-out question about soap?' })],
        items,
        FIELD_RULES,
        cloud,
      ),
    ).rejects.toThrow(/held-out question/);
  });

  it('names device errors plainly in the failures', () => {
    const { prompt } = buildTutorPrompt([failure({ predicted: 'ERROR' })], FIELD_RULES);
    expect(prompt.value).toContain('no answer (device error)');
  });
});
