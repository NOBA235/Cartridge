/**
 * The check after a suggested rule is approved: re-run the exam
 * for the changed rules plus a regression subset, on this device.
 *
 * 1. If there is signal, the cloud writes a few questions for each new rule
 *    (EXAM_PROMPT, public rule text only). They are added to the saved exam,
 *    split 70/30 like the rest, so later Exam Days cover the new rule too.
 * 2. Gemini Nano answers, through the Ask pipeline and never the cloud:
 *    - new-rule: exam questions for the changed rules;
 *    - your-question: the question that led to the suggestion (kept Private);
 *    - affected: other exam questions whose candidates now include a changed rule;
 *    - regression: a fixed sample of the remaining exam questions.
 * 3. Out-of-scope exam questions that the device now answers with a changed
 *    rule are listed: the new rule may really cover them.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import type { DeviceHandle } from '@/cartridge/ask';
import type { CheckSummary } from '@/cartridge/proposals';
import { buildRuleIndex } from '@/cartridge/retrieve';
import type { SourceText } from '@/cartridge/source';
import { NONE, type Cartridge, type Rule } from '@/cartridge/types';
import { prepareSource } from '@/cartridge/verifyQuote';
import { config } from '@/config';
import { hashString, seededRandom, shuffled } from '@/lib/random';
import { buildExamPrompt, checkQuestions, splitExam } from './generate';
import { ExamReply, examTask } from './prompts';
import { measuredOn, runExam, type RunItem } from './run';
import type { ExamCategory, ExamItem, ExamResult, ExamSet } from './types';

export type CheckGroup = CheckSummary['groups'][number]['group'];

export interface CheckItem extends RunItem {
  group: CheckGroup;
}

function categoryOf(expected: string, rules: readonly Rule[]): ExamCategory {
  if (expected === NONE) return 'out-of-scope';
  return rules.find((r) => r.id === expected)?.severity === 'critical' ? 'critical' : 'standard';
}

export function selectCheckItems(input: {
  after: Cartridge;
  changedIds: readonly string[];
  exam: ExamSet | undefined;
  userQuestion?: { text: string; expectedRuleId: string };
  regressionSize: number;
}): CheckItem[] {
  const { after } = input;
  const changed = new Set(input.changedIds);
  const known = new Set(after.rules.map((r) => r.id));
  const examItems = (input.exam?.cartridgeId === after.id ? input.exam.items : []).filter(
    (i) => i.expectedRuleId === NONE || known.has(i.expectedRuleId),
  );
  const index = buildRuleIndex(after);
  const out: CheckItem[] = [];
  const rest: ExamItem[] = [];
  for (const item of examItems) {
    if (changed.has(item.expectedRuleId)) out.push({ ...item, group: 'new-rule' });
    else if (index.search(item.question).hits.some((h) => changed.has(h.rule.id))) {
      out.push({ ...item, group: 'affected' });
    } else rest.push(item);
  }
  if (input.userQuestion) {
    out.push({
      id: 'your-question',
      question: input.userQuestion.text,
      expectedRuleId: input.userQuestion.expectedRuleId,
      split: 'practice',
      category: categoryOf(input.userQuestion.expectedRuleId, after.rules),
      group: 'your-question',
      fromUser: true,
    });
  }
  const random = seededRandom(hashString(`${after.id}@${after.version}`));
  for (const item of shuffled(rest, random).slice(0, input.regressionSize)) {
    out.push({ ...item, group: 'regression' });
  }
  return out;
}

/** The cloud writes `perRule` questions for each rule. Only questions for those rules are kept. */
export async function writeQuestionsFor(
  after: Cartridge,
  rules: readonly Rule[],
  cloud: CloudJson,
  perRule: number,
): Promise<Array<{ question: string; expectedRuleId: string }>> {
  if (rules.length === 0) return [];
  const slots = rules.flatMap((r) => Array.from({ length: perRule }, () => r));
  const reply = await cloud(
    examTask(after.rules.map((r) => r.id)),
    buildExamPrompt(after, { slots, outOfScope: 0 }),
    ExamReply,
  );
  const ids = new Set(rules.map((r) => r.id));
  return checkQuestions(reply.data.questions, after).questions.filter((q) =>
    ids.has(q.expectedRuleId),
  );
}

/** Adds questions to a saved exam with new IDs, split 70/30 with a seed of their own. */
export function appendToExam(
  exam: ExamSet,
  questions: ReadonlyArray<{ question: string; expectedRuleId: string }>,
  after: Cartridge,
  heldOutShare: number,
): ExamSet {
  const known = new Set(exam.items.map((i) => i.question.trim().toLowerCase()));
  const fresh = questions.filter((q) => !known.has(q.question.trim().toLowerCase()));
  const base = exam.items.reduce((m, i) => Math.max(m, Number(i.id.slice(1)) || 0), 0);
  const split = splitExam(
    fresh,
    { ...after, id: `${after.id}#${exam.items.length}` },
    heldOutShare,
  );
  return {
    ...exam,
    ruleIds: after.rules.map((r) => r.id),
    items: [...exam.items, ...split.map((item, i) => ({ ...item, id: `e${base + i + 1}` }))],
  };
}

export function summarise(
  items: readonly CheckItem[],
  results: readonly ExamResult[],
  ctx: {
    version: number;
    measuredOn: 'device' | 'mock';
    changedIds: readonly string[];
    notes: string[];
    now: Date;
  },
): CheckSummary {
  const groupOf = new Map(items.map((i) => [i.id, i.group]));
  const order: CheckGroup[] = ['new-rule', 'your-question', 'affected', 'regression'];
  const groups = order
    .map((group) => {
      const r = results.filter((x) => groupOf.get(x.itemId) === group);
      return { group, passed: r.filter((x) => x.pass).length, total: r.length };
    })
    .filter((g) => g.total > 0);
  const changed = new Set(ctx.changedIds);
  return {
    ranAt: ctx.now.toISOString(),
    version: ctx.version,
    measuredOn: ctx.measuredOn,
    groups,
    failures: results
      .filter((r) => !r.pass)
      .map((r) => ({
        question: r.question,
        expected: r.expected,
        predicted: r.predicted,
        group: groupOf.get(r.itemId) ?? '',
      })),
    maybeCovered: results
      .filter((r) => r.expected === NONE && changed.has(r.predicted))
      .map((r) => r.question),
    notes: ctx.notes,
  };
}

export interface CheckDeps {
  after: Cartridge;
  changedIds: readonly string[];
  exam: ExamSet | undefined;
  source: SourceText;
  device: DeviceHandle;
  /** Omit to skip writing questions (no signal). */
  cloud?: CloudJson;
  userQuestion?: { text: string; expectedRuleId: string };
  /** Called when questions for the new rule were added to the saved exam. */
  onExamUpdated?: (exam: ExamSet) => void | Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  now?: () => Date;
  options?: Partial<typeof config.versions>;
}

export async function runRuleCheck(deps: CheckDeps): Promise<CheckSummary> {
  const opts = { ...config.versions, ...deps.options };
  const notes: string[] = [];
  const changedRules = deps.after.rules.filter((r) => deps.changedIds.includes(r.id));
  let exam = deps.exam?.cartridgeId === deps.after.id ? deps.exam : undefined;
  let written: CheckItem[] = [];

  if (!deps.cloud) {
    notes.push(
      'No signal: no questions were written for the new rule. Your question was still checked.',
    );
  } else if (changedRules.length > 0) {
    try {
      const questions = await writeQuestionsFor(
        deps.after,
        changedRules,
        deps.cloud,
        opts.questionsPerNewRule,
      );
      if (questions.length === 0)
        notes.push('The cloud wrote no usable question for the new rule.');
      else if (exam) {
        exam = appendToExam(exam, questions, deps.after, config.exam.heldOutShare);
        await deps.onExamUpdated?.(exam);
      } else {
        written = questions.map((q, i) => ({
          id: `new-${i + 1}`,
          question: q.question,
          expectedRuleId: q.expectedRuleId,
          split: 'practice',
          category: categoryOf(q.expectedRuleId, deps.after.rules),
          group: 'new-rule',
        }));
        notes.push(
          'There is no saved exam yet, so the new questions were not saved. Run Exam Day for a full test.',
        );
      }
    } catch (e) {
      const offline = e instanceof CloudError && e.code === 'OFFLINE';
      notes.push(
        offline
          ? 'No signal: no questions were written for the new rule.'
          : `The cloud could not write questions for the new rule: ${(e as Error).message}`,
      );
    }
  }

  const items = [
    ...written,
    ...selectCheckItems({
      after: deps.after,
      changedIds: deps.changedIds,
      exam,
      ...(deps.userQuestion ? { userQuestion: deps.userQuestion } : {}),
      regressionSize: opts.regressionQuestions,
    }),
  ];
  const ctx = {
    cartridge: deps.after,
    index: buildRuleIndex(deps.after),
    source: deps.source,
    prepared: prepareSource(deps.source),
  };
  const results = await runExam(items, ctx, {
    device: deps.device,
    ...(deps.signal ? { signal: deps.signal } : {}),
    onResult: (_r, done, total) => deps.onProgress?.(done, total),
  });
  return summarise(items, results, {
    version: deps.after.version,
    measuredOn: measuredOn(deps.device),
    changedIds: deps.changedIds,
    notes,
    now: (deps.now ?? (() => new Date()))(),
  });
}
