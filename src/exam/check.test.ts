/**
 * The check after approving a rule, with the test-only stand-in device
 * (results labelled 'mock') and a fake cloud.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import type { DeviceModel } from '@/ai/deviceModel';
import type { Cartridge, Rule } from '@/cartridge/types';
import { versionWithRule } from '@/cartridge/versions';
import { isPrivate, isPublic, type Public } from '@/privacy';
import { FIELD_EXAM_QUESTIONS } from '@/testing/examFixture';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import { MockDeviceModel } from '@/testing/mockDevice';
import { appendToExam, runRuleCheck, selectCheckItems, summarise, type CheckItem } from './check';
import { splitExam } from './generate';
import type { ExamResult, ExamSet } from './types';

const NEW_RULE: Rule = {
  id: 'R009',
  title: 'Shared toilets for short stays',
  when: 'A group stays only a few days',
  then: 'Short stays of under 3 days may use shared facilities.',
  exceptions: [],
  severity: 'minor',
  keywords: ['short stay', 'shared toilets', 'transit', 'few days', 'temporary'],
  source: {
    section: 'Sanitation',
    page: 2,
    quote: 'Short stays of under 3 days may use shared facilities.',
  },
};

const after: Cartridge = versionWithRule(
  FIELD_CARTRIDGE,
  NEW_RULE,
  new Date('2026-11-17T09:00:00Z'),
);

const exam: ExamSet = {
  cartridgeId: FIELD_CARTRIDGE.id,
  createdAt: '2026-11-16T09:00:00.000Z',
  ruleIds: FIELD_CARTRIDGE.rules.map((r) => r.id),
  items: splitExam(FIELD_EXAM_QUESTIONS, FIELD_CARTRIDGE, 0.3),
  dropped: [],
};

const NEW_QUESTIONS = [
  { question: 'Can a transit group share toilets for a few days?', expectedRuleId: 'R009' },
  { question: 'Do temporary short stay visitors need their own toilets?', expectedRuleId: 'R009' },
  { question: 'Is a shared toilet fine for a group staying two nights?', expectedRuleId: 'R009' },
  { question: 'A question for another rule that must be ignored?', expectedRuleId: 'R004' },
];

function fakeCloud(reply: unknown | Error) {
  const calls: Array<{ task: string; prompt: Public<string> }> = [];
  const cloud: CloudJson = async (task, prompt, schema) => {
    calls.push({ task: task.name, prompt });
    if (reply instanceof Error) throw reply;
    return { data: schema.parse(reply), inferenceSource: 'in_cloud', attempts: 1 };
  };
  return { cloud, calls };
}

describe('selectCheckItems', () => {
  const items = selectCheckItems({
    after,
    changedIds: ['R009'],
    exam,
    userQuestion: {
      text: 'Can a transit group share toilets for two nights?',
      expectedRuleId: 'R009',
    },
    regressionSize: 8,
  });
  const by = (g: CheckItem['group']) => items.filter((i) => i.group === g);

  it('takes the user’s question (kept Private), the affected questions and a regression sample', () => {
    expect(by('your-question')).toEqual([
      expect.objectContaining({
        id: 'your-question',
        expectedRuleId: 'R009',
        fromUser: true,
        category: 'standard',
      }),
    ]);
    expect(by('new-rule')).toEqual([]);
    expect(by('affected').length).toBeGreaterThan(0);
    expect(by('regression')).toHaveLength(8);
    // Every affected question now has the new rule among its candidates; regression ones do not.
    expect(
      by('affected').every((i) => /toilet|latrine|cubicle|people|share/i.test(i.question)),
    ).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('is the same every time for the same version', () => {
    const again = selectCheckItems({ after, changedIds: ['R009'], exam, regressionSize: 8 });
    expect(again.filter((i) => i.group === 'regression').map((i) => i.id)).toEqual(
      by('regression').map((i) => i.id),
    );
  });

  it('works without a saved exam', () => {
    const only = selectCheckItems({
      after,
      changedIds: ['R009'],
      exam: undefined,
      userQuestion: { text: 'q?', expectedRuleId: 'R009' },
      regressionSize: 8,
    });
    expect(only.map((i) => i.group)).toEqual(['your-question']);
  });
});

describe('appendToExam', () => {
  it('adds questions with new IDs, splits them, and skips repeats', () => {
    const more = appendToExam(
      exam,
      [
        ...NEW_QUESTIONS.slice(0, 3),
        { question: 'How many toilets for 400 people?', expectedRuleId: 'R004' },
      ],
      after,
      0.3,
    );
    const added = more.items.slice(exam.items.length);
    expect(added.map((i) => i.id)).toEqual(['e41', 'e42', 'e43']);
    expect(added.filter((i) => i.split === 'held-out')).toHaveLength(1);
    expect(more.ruleIds).toContain('R009');
    expect(more.items.slice(0, exam.items.length)).toEqual(exam.items);
  });
});

describe('runRuleCheck', () => {
  it('writes questions for the new rule, saves them, and checks on this device', async () => {
    const { cloud, calls } = fakeCloud({ questions: NEW_QUESTIONS });
    const model = new MockDeviceModel({ errorRate: 0 });
    const select = vi.spyOn(model, 'selectRule');
    const saved: ExamSet[] = [];
    const summary = await runRuleCheck({
      after,
      changedIds: ['R009'],
      exam,
      source: FIELD_SOURCE,
      device: { model, ready: true },
      cloud,
      userQuestion: {
        text: 'Can a transit group share toilets for two nights?',
        expectedRuleId: 'R009',
      },
      onExamUpdated: (e) => {
        saved.push(e);
      },
      now: () => new Date('2026-11-17T10:00:00Z'),
    });

    expect(calls.map((c) => c.task)).toEqual(['EXAM']);
    const prompt = calls[0]?.prompt;
    expect(prompt && isPublic(prompt)).toBe(true);
    expect(prompt?.value).toContain('Below are 3 rules');
    expect(prompt?.value).toContain('Also write 0 questions');
    expect(prompt?.value).not.toContain('Can a transit group share toilets for two nights?');

    expect(saved).toHaveLength(1);
    expect(saved[0]?.items).toHaveLength(43);

    expect(summary).toMatchObject({
      version: 2,
      measuredOn: 'mock',
      ranAt: '2026-11-17T10:00:00.000Z',
    });
    const groups = Object.fromEntries(summary.groups.map((g) => [g.group, g.total]));
    expect(groups).toMatchObject({ 'new-rule': 3, 'your-question': 1, regression: 8 });
    expect(groups.affected).toBeGreaterThan(0);

    // The user's question reached the device as Private; exam questions as Public.
    const userCall = select.mock.calls.find(
      ([input]) => input.question.value === 'Can a transit group share toilets for two nights?',
    );
    expect(userCall && isPrivate(userCall[0].question)).toBe(true);
    expect(select.mock.calls.filter(([input]) => isPublic(input.question)).length).toBeGreaterThan(
      0,
    );
  });

  it('still checks the user’s question and the affected ones without signal', async () => {
    const summary = await runRuleCheck({
      after,
      changedIds: ['R009'],
      exam,
      source: FIELD_SOURCE,
      device: { model: new MockDeviceModel({ errorRate: 0 }), ready: true },
      userQuestion: {
        text: 'Can a transit group share toilets for two nights?',
        expectedRuleId: 'R009',
      },
    });
    expect(summary.notes[0]).toMatch(/No signal/);
    expect(summary.groups.map((g) => g.group)).not.toContain('new-rule');
    expect(summary.groups.map((g) => g.group)).toContain('your-question');
  });

  it('reports a cloud failure and goes on', async () => {
    const summary = await runRuleCheck({
      after,
      changedIds: ['R009'],
      exam,
      source: FIELD_SOURCE,
      device: { model: new MockDeviceModel({ errorRate: 0 }), ready: true },
      cloud: fakeCloud(new CloudError('quota', 'FAILED', 3)).cloud,
    });
    expect(summary.notes[0]).toMatch(/could not write questions/);
    expect(summary.groups.length).toBeGreaterThan(0);
  });

  it('runs the new questions without saving them when there is no exam yet', async () => {
    const saved: ExamSet[] = [];
    const summary = await runRuleCheck({
      after,
      changedIds: ['R009'],
      exam: undefined,
      source: FIELD_SOURCE,
      device: { model: new MockDeviceModel({ errorRate: 0 }), ready: true },
      cloud: fakeCloud({ questions: NEW_QUESTIONS }).cloud,
      onExamUpdated: (e) => {
        saved.push(e);
      },
    });
    expect(saved).toHaveLength(0);
    expect(summary.groups).toEqual([expect.objectContaining({ group: 'new-rule', total: 3 })]);
    expect(summary.notes.some((n) => n.includes('no saved exam'))).toBe(true);
  });

  it('refuses to run without a ready device', async () => {
    const device: DeviceModel = new MockDeviceModel({ errorRate: 0 });
    await expect(
      runRuleCheck({
        after,
        changedIds: ['R009'],
        exam,
        source: FIELD_SOURCE,
        device: { model: device, ready: false },
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' });
  });
});

describe('summarise', () => {
  it('lists out-of-scope questions the device now answers with the new rule', () => {
    const items: CheckItem[] = [
      {
        id: 'e1',
        question: 'Can visitors share a toilet?',
        expectedRuleId: 'NONE',
        split: 'practice',
        category: 'out-of-scope',
        group: 'affected',
      },
      {
        id: 'e2',
        question: 'q2',
        expectedRuleId: 'R004',
        split: 'practice',
        category: 'standard',
        group: 'regression',
      },
    ];
    const result = (itemId: string, expected: string, predicted: string): ExamResult => ({
      itemId,
      question: items.find((i) => i.id === itemId)?.question ?? '',
      expected,
      predicted,
      verified: true,
      pass: expected === predicted,
      latencyMs: 1,
      candidates: [],
    });
    const s = summarise(items, [result('e1', 'NONE', 'R009'), result('e2', 'R004', 'R004')], {
      version: 2,
      measuredOn: 'device',
      changedIds: ['R009'],
      notes: [],
      now: new Date('2026-11-17T10:00:00Z'),
    });
    expect(s.maybeCovered).toEqual(['Can visitors share a toilet?']);
    expect(s.groups).toEqual([
      { group: 'affected', passed: 0, total: 1 },
      { group: 'regression', passed: 1, total: 1 },
    ]);
    expect(s.failures).toEqual([
      {
        question: 'Can visitors share a toilet?',
        expected: 'NONE',
        predicted: 'R009',
        group: 'affected',
      },
    ]);
  });
});
