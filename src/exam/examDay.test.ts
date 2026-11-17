/**
 * Exam Day end to end with the test-only stand-in device (results labelled
 * 'mock') and a fake cloud. Checks the loop, not Gemini Nano's quality.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import { TUTOR_IMMUTABLE_FIELDS, type Rule } from '@/cartridge/types';
import type { Public } from '@/privacy';
import { FIELD_EXAM_QUESTIONS } from '@/testing/examFixture';
import { FIELD_CARTRIDGE, FIELD_RULES, FIELD_SOURCE } from '@/testing/fieldFixture';
import { MockDeviceModel } from '@/testing/mockDevice';
import { runExamDay, type ExamProgress } from './examDay';
import type { ExamSet } from './types';

const STOP = new Set(
  'how what which does many much must should where when with from that this have each every for the and per can our are near'.split(
    ' ',
  ),
);

/** A fake tutor: adds the failing question's distinctive single words as keywords of the expected rule. */
function helpfulTutor(prompt: string): unknown {
  const failures = JSON.parse(prompt.split('Failures:\n')[1] ?? '[]') as Array<{
    question: string;
    expectedRuleId: string;
  }>;
  const byRule = new Map<string, string[]>();
  for (const f of failures) {
    if (f.expectedRuleId === 'NONE') continue;
    const words = f.question
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));
    byRule.set(f.expectedRuleId, [...(byRule.get(f.expectedRuleId) ?? []), ...words]);
  }
  return {
    patches: [...byRule].map(([ruleId, words]) => {
      const rule = FIELD_RULES.find((r) => r.id === ruleId) as Rule;
      return {
        ruleId,
        keywords: [...new Set(words)].concat(rule.keywords),
        why: 'Add the words people use.',
      };
    }),
  };
}

function setup(tutor: (prompt: string) => unknown | Error = helpfulTutor) {
  const calls: Array<{ task: string; prompt: Public<string> }> = [];
  const cloud: CloudJson = async (task, prompt, schema) => {
    calls.push({ task: task.name, prompt });
    const reply = task.name === 'EXAM' ? { questions: FIELD_EXAM_QUESTIONS } : tutor(prompt.value);
    if (reply instanceof Error) throw reply;
    return { data: schema.parse(reply), inferenceSource: 'in_cloud', attempts: 1 };
  };
  const model = new MockDeviceModel({ errorRate: 0 });
  const select = vi.spyOn(model, 'selectRule');
  const events: ExamProgress[] = [];
  const written: ExamSet[] = [];
  const deps = {
    cloud,
    device: { model, ready: true },
    source: FIELD_SOURCE,
    onProgress: (p: ExamProgress) => events.push(p),
    onExamWritten: (e: ExamSet) => {
      written.push(e);
    },
    now: () => new Date('2026-11-16T10:00:00Z'),
  };
  return { deps, calls, select, events, written };
}

describe('Exam Day loop with the stand-in device', () => {
  it('writes the exam, takes practice, tutors, retakes, and runs held-out once', async () => {
    const t = setup();
    const res = await runExamDay(FIELD_CARTRIDGE, t.deps);

    expect(res.wroteExam).toBe(true);
    expect(t.written).toHaveLength(1);
    expect(res.exam.items).toHaveLength(40);
    expect(res.report.measuredOn).toBe('mock');

    const counts = res.report.counts;
    expect(counts?.practice.total).toBe(28);
    expect(counts?.heldOut.total).toBe(12);
    expect(res.practiceStart.some((r) => !r.pass && r.expected !== 'NONE')).toBe(true);
    expect(counts?.practice.passed).toBeGreaterThan(counts?.practiceStart.passed ?? 0);
    expect(res.report.tutorRounds).toBeGreaterThanOrEqual(1);
    expect(res.report.tutorRounds).toBeLessThanOrEqual(2);

    // The tutor only ever saw practice questions.
    const heldOut = res.exam.items.filter((i) => i.split === 'held-out').map((i) => i.question);
    const tutorPrompts = t.calls.filter((c) => c.task === 'TUTOR').map((c) => c.prompt.value);
    expect(tutorPrompts.length).toBe(res.report.tutorRounds);
    for (const p of tutorPrompts) for (const q of heldOut) expect(p).not.toContain(q);

    // Held-out was run exactly once, after the tutor, with the final rules.
    const heldOutRuns = t.events.filter(
      (e) => e.step === 'answering' && e.set === 'held-out' && e.results.length === 0,
    );
    expect(heldOutRuns).toHaveLength(1);
    const order = t.events
      .map((e) => (e.step === 'answering' ? `${e.set}` : e.step))
      .filter((s, i, a) => s !== a[i - 1]);
    expect(order[0]).toBe('writing');
    expect(order.at(-2)).toBe('held-out');
    expect(order.at(-1)).toBe('finishing');
    expect(res.heldOut).toHaveLength(12);

    // The tutor changed only keywords here, and never the immutable fields.
    expect(res.changes.length).toBeGreaterThan(0);
    expect(new Set(res.changes.map((c) => c.field))).toEqual(new Set(['keywords']));
    for (const r of res.rules) {
      const before = FIELD_RULES.find((x) => x.id === r.id) as Rule;
      for (const f of TUTOR_IMMUTABLE_FIELDS) expect(r[f]).toEqual(before[f]);
    }
  });

  it('reuses a saved exam without asking the cloud to write one', async () => {
    const first = await runExamDay(FIELD_CARTRIDGE, setup().deps);
    const t = setup();
    const res = await runExamDay(FIELD_CARTRIDGE, { ...t.deps, exam: first.exam });
    expect(res.wroteExam).toBe(false);
    expect(t.calls.some((c) => c.task === 'EXAM')).toBe(false);
    expect(res.exam.items.map((i) => i.split)).toEqual(first.exam.items.map((i) => i.split));
  });

  it('undoes a tutor round that lowers the practice score', async () => {
    const harmful = () => ({
      patches: [
        {
          ruleId: 'R008',
          keywords: [
            'toilets',
            'latrines',
            'water',
            'soap',
            'chlorine',
            'handwashing',
            'groundwater',
            'litres',
            'metres',
            'distance',
          ],
          why: 'Bad advice.',
        },
      ],
    });
    const res = await runExamDay(FIELD_CARTRIDGE, setup(harmful).deps);
    expect(res.changes.length).toBeGreaterThan(0);
    expect(res.changes.every((c) => c.reverted)).toBe(true);
    expect(res.rules).toEqual(FIELD_RULES);
    expect(res.report.counts?.practice).toEqual(res.report.counts?.practiceStart);
    expect(res.report.notes?.some((n) => n.includes('was undone'))).toBe(true);
  });

  it('skips the tutor without signal and still runs held-out', async () => {
    const res = await runExamDay(
      FIELD_CARTRIDGE,
      setup(() => new CloudError('No signal', 'OFFLINE', 0)).deps,
    );
    expect(res.report.tutorRounds).toBe(0);
    expect(res.report.notes).toContain('The tutor was skipped: no signal.');
    expect(res.heldOut).toHaveLength(12);
    expect(res.rules).toEqual(FIELD_RULES);
  });

  it('refuses to start without the rulebook or without a ready device', async () => {
    const t = setup();
    await expect(
      runExamDay(FIELD_CARTRIDGE, { ...t.deps, source: undefined }),
    ).rejects.toMatchObject({ code: 'NO_SOURCE' });
    await expect(
      runExamDay(FIELD_CARTRIDGE, { ...t.deps, device: { ...t.deps.device, ready: false } }),
    ).rejects.toMatchObject({
      code: 'DEVICE_UNAVAILABLE',
    });
    expect(t.calls).toHaveLength(0);
  });
});
