/**
 * Exam Day, end to end:
 * 1. The cloud writes the exam (or the saved exam is reused, so the held-out
 *    questions stay the same between runs).
 * 2. The device takes the practice questions.
 * 3. Up to 2 tutor rounds: practice failures and the rules involved go to the
 *    cloud; code applies title/when/keywords/notWhen edits; the device retakes
 *    practice. A round that lowers the practice score is undone.
 * 4. The device takes the held-out questions once, with the final rules.
 * 5. The report.
 * The held-out questions never reach the tutor.
 */
import type { CloudJson } from '@/ai/cloud';
import type { AskContext, DeviceHandle } from '@/cartridge/ask';
import { buildRuleIndex } from '@/cartridge/retrieve';
import type { SourceText } from '@/cartridge/source';
import type { Cartridge, ExamReport, Rule } from '@/cartridge/types';
import { prepareSource } from '@/cartridge/verifyQuote';
import { config } from '@/config';
import { generateExam, usableExam } from './generate';
import { buildReport } from './report';
import { measuredOn, runExam } from './run';
import { applyPatches, askTutor, TutorError, type Rejection } from './tutor';
import {
  ExamError,
  type ExamItem,
  type ExamResult,
  type ExamSet,
  type ExamSplit,
  type TutorChange,
} from './types';

export type ExamProgress =
  | { step: 'writing' }
  | { step: 'answering'; set: ExamSplit; round: number; results: ExamResult[]; total: number }
  | { step: 'tutoring'; round: number }
  | { step: 'finishing' };

export interface ExamDayDeps {
  cloud: CloudJson;
  device: DeviceHandle;
  /** The rulebook on this device: needed to check every answer's quote. */
  source: SourceText | undefined;
  /** A saved exam to reuse, if it still fits the cartridge. */
  exam?: ExamSet;
  /** Called as soon as a new exam is written, so it can be saved. */
  onExamWritten?: (exam: ExamSet) => void | Promise<void>;
  onProgress?: (p: ExamProgress) => void;
  signal?: AbortSignal;
  options?: Partial<typeof config.exam>;
  now?: () => Date;
  clock?: () => number;
}

export interface ExamDayResult {
  exam: ExamSet;
  /** True when this run wrote a new exam. */
  wroteExam: boolean;
  report: ExamReport;
  /** The rules after the tutor's kept changes. */
  rules: Rule[];
  changes: TutorChange[];
  rejected: Rejection[];
  practiceStart: ExamResult[];
  practice: ExamResult[];
  heldOut: ExamResult[];
}

export async function runExamDay(cartridge: Cartridge, deps: ExamDayDeps): Promise<ExamDayResult> {
  const opts = { ...config.exam, ...deps.options };
  const now = deps.now ?? (() => new Date());
  if (!deps.source) {
    throw new ExamError(
      'The rulebook for this cartridge is not on this device, so answers cannot be checked.',
      'NO_SOURCE',
    );
  }
  if (!deps.device.ready) {
    throw new ExamError(
      'Gemini Nano is not ready on this device. Prepare this device first.',
      'DEVICE_UNAVAILABLE',
    );
  }
  const progress = deps.onProgress ?? (() => {});
  const source = deps.source;
  const prepared = prepareSource(source);
  const contextFor = (rules: Rule[]): AskContext => {
    const working = { ...cartridge, rules };
    // Built fresh: patched rules share the cartridge id and version, so no cached index.
    return { cartridge: working, index: buildRuleIndex(working), source, prepared };
  };

  let exam = usableExam(deps.exam, cartridge, opts.minQuestions);
  let wroteExam = false;
  if (!exam) {
    progress({ step: 'writing' });
    exam = await generateExam(cartridge, { cloud: deps.cloud, now }, opts);
    wroteExam = true;
    await deps.onExamWritten?.(exam);
  }
  const practiceItems = exam.items.filter((i) => i.split === 'practice');
  const heldOutItems = exam.items.filter((i) => i.split === 'held-out');

  const answer = (items: ExamItem[], rules: Rule[], set: ExamSplit, round: number) => {
    const partial: ExamResult[] = [];
    progress({ step: 'answering', set, round, results: [], total: items.length });
    return runExam(items, contextFor(rules), {
      device: deps.device,
      maxConsecutiveDeviceErrors: opts.maxConsecutiveDeviceErrors,
      ...(deps.clock ? { clock: deps.clock } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
      onResult: (r) => {
        partial.push(r);
        progress({ step: 'answering', set, round, results: [...partial], total: items.length });
      },
    });
  };

  let rules = [...cartridge.rules];
  const practiceStart = await answer(practiceItems, rules, 'practice', 0);
  let practice = practiceStart;
  const changes: TutorChange[] = [];
  const rejected: Rejection[] = [];
  const notes: string[] = [];
  const practiceQuestions = practiceItems.map((i) => i.question);
  let rounds = 0;

  for (let round = 1; round <= opts.tutorRounds; round++) {
    const failures = practice.filter((r) => !r.pass);
    if (failures.length === 0) break;
    if (deps.signal?.aborted) throw new ExamError('Stopped.', 'STOPPED');
    progress({ step: 'tutoring', round });
    let patches: unknown[];
    try {
      patches = await askTutor(failures, exam.items, rules, deps.cloud);
    } catch (e) {
      if (e instanceof TutorError) {
        notes.push(e.offline ? 'The tutor was skipped: no signal.' : e.message);
        break;
      }
      throw e;
    }
    rounds = round;
    const applied = applyPatches(rules, patches, { round, questions: practiceQuestions });
    rejected.push(...applied.rejected);
    if (applied.changes.length === 0) {
      notes.push(`Tutor round ${round} proposed no usable change.`);
      break;
    }
    const retest = await answer(practiceItems, applied.rules, 'practice', round);
    const before = practice.filter((r) => r.pass).length;
    const after = retest.filter((r) => r.pass).length;
    if (after < before) {
      changes.push(...applied.changes.map((c) => ({ ...c, reverted: true })));
      notes.push(
        `Tutor round ${round} was undone: the practice score went from ${before} to ${after}.`,
      );
      continue;
    }
    changes.push(...applied.changes);
    rules = applied.rules;
    practice = retest;
  }

  const heldOut = await answer(heldOutItems, rules, 'held-out', rounds);
  progress({ step: 'finishing' });
  const report = buildReport({
    cartridge: { rules },
    items: exam.items,
    practiceStart,
    practice,
    heldOut,
    measuredOn: measuredOn(deps.device),
    tutorRounds: rounds,
    notes,
    now: now(),
  });
  return { exam, wroteExam, report, rules, changes, rejected, practiceStart, practice, heldOut };
}
