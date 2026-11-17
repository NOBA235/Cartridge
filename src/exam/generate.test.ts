import { describe, expect, it } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import { NONE, type Cartridge, type Rule } from '@/cartridge/types';
import { isPublic, type Public } from '@/privacy';
import { FIELD_EXAM_QUESTIONS } from '@/testing/examFixture';
import { FIELD_CARTRIDGE, FIELD_RULES } from '@/testing/fieldFixture';
import { checkQuestions, generateExam, planExam, splitExam, usableExam } from './generate';
import { ExamError } from './types';

const OPTS = { questionCount: 40, outOfScopeShare: 0.2 };

function rules(n: number, critical = 0): Rule[] {
  const base = FIELD_RULES[0] as Rule;
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `R${String(i + 1).padStart(3, '0')}`,
    title: `Rule ${i + 1}`,
    severity: i < critical ? 'critical' : 'minor',
  }));
}

function fakeCloud(reply: unknown) {
  const calls: Array<{ task: string; prompt: Public<string> }> = [];
  const cloud: CloudJson = async (task, prompt, schema) => {
    calls.push({ task: task.name, prompt });
    if (reply instanceof Error) throw reply;
    return { data: schema.parse(reply), inferenceSource: 'in_cloud', attempts: 1 };
  };
  return { cloud, calls };
}

describe('planExam', () => {
  it('asks 32 in-scope and 8 out-of-scope questions, each fixture rule 4 times', () => {
    const plan = planExam(FIELD_RULES, OPTS);
    expect(plan.slots).toHaveLength(32);
    expect(plan.outOfScope).toBe(8);
    for (const r of FIELD_RULES) expect(plan.slots.filter((s) => s.id === r.id)).toHaveLength(4);
    // Critical rules come first in the rotation.
    expect(plan.slots.slice(0, 3).map((s) => s.severity)).toEqual([
      'critical',
      'critical',
      'critical',
    ]);
  });

  it('with more rules than questions, keeps every critical rule and spreads the rest', () => {
    const plan = planExam(rules(50, 10), OPTS);
    expect(plan.slots).toHaveLength(32);
    expect(new Set(plan.slots.map((s) => s.id)).size).toBe(32);
    expect(plan.slots.filter((s) => s.severity === 'critical')).toHaveLength(10);
    expect(plan.slots.some((s) => s.id === 'R050')).toBe(false);
    expect(plan.slots.some((s) => s.id === 'R049' || s.id === 'R048')).toBe(true);
  });

  it('caps a small cartridge at 4 questions per rule and keeps about 20% out of scope', () => {
    const plan = planExam(rules(3), OPTS);
    expect(plan.slots).toHaveLength(12);
    expect(plan.outOfScope).toBe(3);
  });

  it('refuses a cartridge without rules', () => {
    expect(() => planExam([], OPTS)).toThrow(ExamError);
  });
});

describe('checkQuestions', () => {
  it('drops unknown rules, rule IDs, copied quotes, repeats and bad shapes', () => {
    const quote = FIELD_CARTRIDGE.rules[3]?.source.quote ?? '';
    const { questions, dropped } = checkQuestions(
      [
        { question: 'How many toilets for 400 people?', expectedRuleId: 'R004' },
        { question: 'how many toilets for 400 people?', expectedRuleId: 'R004' },
        { question: 'What does R004 say about toilets?', expectedRuleId: 'R004' },
        { question: `Is it true that we must ${quote}`, expectedRuleId: 'R004' },
        { question: 'Something about rule nine?', expectedRuleId: 'R099' },
        { question: 'Hi', expectedRuleId: 'R001' },
        { expectedRuleId: 'R001' },
        { question: 'What is the radio frequency?', expectedRuleId: NONE },
      ],
      FIELD_CARTRIDGE,
    );
    expect(questions.map((q) => q.expectedRuleId)).toEqual(['R004', NONE]);
    expect(dropped.map((d) => d.reason)).toEqual([
      'It repeats another question.',
      'It names a rule ID.',
      'It copies the rule’s quote.',
      'Expects R099, which is not in this cartridge.',
      'Incomplete or in the wrong shape.',
      'Incomplete or in the wrong shape.',
    ]);
  });
});

describe('splitExam', () => {
  const split = splitExam(FIELD_EXAM_QUESTIONS, FIELD_CARTRIDGE, 0.3);

  it('puts about 30% in held-out, stratified by category', () => {
    const held = split.filter((i) => i.split === 'held-out');
    expect(held.length).toBe(12);
    const by = (c: string) => split.filter((i) => i.category === c);
    for (const c of ['critical', 'standard', 'out-of-scope']) {
      const group = by(c);
      expect(group.filter((i) => i.split === 'held-out').length).toBe(
        Math.round(group.length * 0.3),
      );
    }
    expect(by('critical')).toHaveLength(12);
    expect(by('out-of-scope')).toHaveLength(8);
  });

  it('is the same every time for the same cartridge', () => {
    expect(splitExam(FIELD_EXAM_QUESTIONS, FIELD_CARTRIDGE, 0.3)).toEqual(split);
    const other: Cartridge = { ...FIELD_CARTRIDGE, id: 'ctg-other' };
    expect(splitExam(FIELD_EXAM_QUESTIONS, other, 0.3).map((i) => i.split)).not.toEqual(
      split.map((i) => i.split),
    );
  });
});

describe('generateExam', () => {
  it('sends one Public prompt with the counts, rules without quotes, and all titles', async () => {
    const { cloud, calls } = fakeCloud({ questions: FIELD_EXAM_QUESTIONS });
    const exam = await generateExam(FIELD_CARTRIDGE, {
      cloud,
      now: () => new Date('2026-11-16T09:00:00Z'),
    });
    expect(exam).toMatchObject({ cartridgeId: 'ctg-field', createdAt: '2026-11-16T09:00:00.000Z' });
    expect(exam.items).toHaveLength(40);
    const call = calls[0];
    expect(calls.map((c) => c.task)).toEqual(['EXAM']);
    expect(call && isPublic(call.prompt)).toBe(true);
    expect(call?.prompt.value).toContain('Below are 32 rules');
    expect(call?.prompt.value).toContain('Also write 8 questions');
    expect(call?.prompt.value).toContain('R008: Covered living space per person');
    expect(call?.prompt.value).not.toContain('"quote"');
    // R002's quote is worded differently from its instruction, so it must not appear.
    expect(call?.prompt.value).not.toContain(FIELD_RULES[1]?.source.quote);
  });

  it('refuses when too few usable questions come back', async () => {
    const { cloud } = fakeCloud({ questions: FIELD_EXAM_QUESTIONS.slice(0, 5) });
    await expect(generateExam(FIELD_CARTRIDGE, { cloud })).rejects.toMatchObject({
      code: 'TOO_FEW',
    });
  });

  it('reports no signal and cloud failures', async () => {
    await expect(
      generateExam(FIELD_CARTRIDGE, fakeCloud(new CloudError('x', 'OFFLINE', 0))),
    ).rejects.toMatchObject({ code: 'OFFLINE' });
    await expect(
      generateExam(FIELD_CARTRIDGE, fakeCloud(new CloudError('quota', 'FAILED', 3))),
    ).rejects.toMatchObject({ code: 'CLOUD' });
  });

  it('refuses a cartridge too small to test', async () => {
    const tiny: Cartridge = { ...FIELD_CARTRIDGE, rules: FIELD_RULES.slice(0, 1) };
    await expect(generateExam(tiny, fakeCloud({ questions: [] }))).rejects.toMatchObject({
      code: 'TOO_SMALL',
    });
  });
});

describe('usableExam', () => {
  it('reuses a saved exam, minus questions for rules that no longer exist', async () => {
    const exam = await generateExam(
      FIELD_CARTRIDGE,
      fakeCloud({ questions: FIELD_EXAM_QUESTIONS }),
    );
    const fewer: Cartridge = {
      ...FIELD_CARTRIDGE,
      rules: FIELD_RULES.filter((r) => r.id !== 'R008'),
    };
    const reused = usableExam(exam, fewer, 10);
    expect(reused?.items).toHaveLength(36);
    expect(usableExam(exam, { ...FIELD_CARTRIDGE, id: 'other' }, 10)).toBeUndefined();
    expect(usableExam(undefined, FIELD_CARTRIDGE, 10)).toBeUndefined();
  });
});
