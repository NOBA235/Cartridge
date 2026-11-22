/**
 * The Exam Day report. Ready if, on the held-out questions, the test pass rate
 * for critical rules reaches readyCriticalPassRate (0.9) and out-of-scope
 * questions are answered NONE at least readyOutOfScopeRate (0.8) of the time.
 * A missing group (no critical or no out-of-scope question in held-out) means
 * not ready, unless the cartridge has no critical rules at all.
 */
import { runtimeConfig } from '@/ai/remoteConfig';
import type { ExamReport, Rule } from '@/cartridge/types';
import type { ExamItem, ExamResult } from './types';

export interface Tally {
  passed: number;
  total: number;
}

export function tally(
  results: readonly ExamResult[],
  keep: (r: ExamResult) => boolean = () => true,
): Tally {
  const r = results.filter(keep);
  return { passed: r.filter((x) => x.pass).length, total: r.length };
}

const rate = (t: Tally) => (t.total === 0 ? 0 : t.passed / t.total);

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export interface ReportInput {
  cartridge: { rules: readonly Rule[] };
  items: readonly ExamItem[];
  practiceStart: readonly ExamResult[];
  practice: readonly ExamResult[];
  heldOut: readonly ExamResult[];
  measuredOn: 'device' | 'mock';
  tutorRounds: number;
  notes?: readonly string[];
  now?: Date;
  thresholds?: { criticalPassRate: number; outOfScopeRate: number };
}

export function buildReport(input: ReportInput): ExamReport {
  const rc = runtimeConfig.values();
  const thresholds = input.thresholds ?? {
    criticalPassRate: rc.examReadyCriticalPassRate,
    outOfScopeRate: rc.examReadyOutOfScopeRate,
  };
  const category = new Map(input.items.map((i) => [i.id, i.category]));
  const counts = {
    practiceStart: tally(input.practiceStart),
    practice: tally(input.practice),
    heldOut: tally(input.heldOut),
    heldOutCritical: tally(input.heldOut, (r) => category.get(r.itemId) === 'critical'),
    heldOutOutOfScope: tally(input.heldOut, (r) => category.get(r.itemId) === 'out-of-scope'),
  };
  const notes = [...(input.notes ?? [])];
  const hasCriticalRules = input.cartridge.rules.some((r) => r.severity === 'critical');

  let criticalPassRate = rate(counts.heldOutCritical);
  let criticalOk = criticalPassRate >= thresholds.criticalPassRate;
  if (counts.heldOutCritical.total === 0) {
    if (hasCriticalRules) {
      criticalOk = false;
      notes.push(
        'No critical question was in the held-out set, so critical rules could not be checked.',
      );
    } else {
      criticalPassRate = 1;
      criticalOk = true;
      notes.push('This cartridge has no critical rules.');
    }
  }
  const outOfScopeRate = rate(counts.heldOutOutOfScope);
  let outOfScopeOk = outOfScopeRate >= thresholds.outOfScopeRate;
  if (counts.heldOutOutOfScope.total === 0) {
    outOfScopeOk = false;
    notes.push('No out-of-scope question was in the held-out set, so this could not be checked.');
  }

  const passRate = rate(counts.practice);
  const heldOutPassRate = rate(counts.heldOut);
  if (counts.heldOut.total > 0 && passRate - heldOutPassRate > 0.15) {
    notes.push(
      'The held-out test pass rate is well below practice: some of the tutor’s changes may only fit the practice questions.',
    );
  }

  const asked = [...input.practice, ...input.heldOut].filter((r) => r.reason !== 'LOW_RETRIEVAL');
  const medianLatencyMs = median(asked.map((r) => r.latencyMs));
  const failures = [
    ...input.practice.filter((r) => !r.pass).map((r) => ({ r, set: 'practice' as const })),
    ...input.heldOut.filter((r) => !r.pass).map((r) => ({ r, set: 'held-out' as const })),
  ].map(({ r, set }) => ({
    question: r.question,
    expected: r.expected,
    predicted: r.predicted,
    set,
  }));

  return {
    ranAt: (input.now ?? new Date()).toISOString(),
    measuredOn: input.measuredOn,
    passRate,
    criticalPassRate,
    outOfScopeRate,
    heldOutPassRate,
    failures,
    ready: criticalOk && outOfScopeOk,
    counts,
    thresholds,
    tutorRounds: input.tutorRounds,
    ...(medianLatencyMs !== undefined ? { medianLatencyMs: Math.round(medianLatencyMs) } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}
