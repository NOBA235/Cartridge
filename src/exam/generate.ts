/**
 * generate(): the cloud writes the exam (EXAM_PROMPT), then code checks every
 * question and splits them 70/30 into practice and held-out.
 *
 * - 40 questions by default, about 20% out of scope (expected NONE).
 * - In-scope questions are spread over the rules: critical rules first, then
 *   the others across the rulebook. A small cartridge lists a rule more than
 *   once (at most 4 times) so the exam stays large enough to mean something.
 * - Code drops questions that name a rule ID, copy a rule's quote, expect a rule
 *   that is not in the cartridge, or repeat another question.
 * - The split is stratified (critical, standard, out of scope) and seeded by
 *   the cartridge id, so it is the same every time. The held-out questions are
 *   never shown to the tutor.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import { normalize } from '@/cartridge/normalize';
import { NONE, type Cartridge, type Rule } from '@/cartridge/types';
import { config } from '@/config';
import { hashString, seededRandom, shuffled } from '@/lib/random';
import { asPublic, fillTemplate } from '@/privacy';
import { EXAM_PROMPT, ExamQuestionSchema, ExamReply, examTask } from './prompts';
import { ExamError, type ExamCategory, type ExamItem, type ExamSet } from './types';

export interface GenerateOptions {
  questionCount: number;
  outOfScopeShare: number;
  heldOutShare: number;
  minQuestions: number;
}

export const MAX_QUESTIONS_PER_RULE = 4;

export interface ExamPlan {
  /** One entry per in-scope question to write (a rule may repeat). */
  slots: Rule[];
  outOfScope: number;
}

function spread<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  return Array.from(
    { length: count },
    (_, i) => items[Math.floor((i * items.length) / count)] as T,
  );
}

export function planExam(
  rules: readonly Rule[],
  opts: Pick<GenerateOptions, 'questionCount' | 'outOfScopeShare'>,
): ExamPlan {
  if (rules.length === 0) throw new ExamError('This cartridge has no rules.', 'TOO_SMALL');
  const wantedOut = Math.round(opts.questionCount * opts.outOfScopeShare);
  const wantedIn = Math.min(opts.questionCount - wantedOut, rules.length * MAX_QUESTIONS_PER_RULE);
  const critical = rules.filter((r) => r.severity === 'critical');
  const others = rules.filter((r) => r.severity !== 'critical');
  let slots: Rule[];
  if (rules.length >= wantedIn) {
    const pickedCritical = critical.slice(0, wantedIn);
    const pickedOthers = spread(others, wantedIn - pickedCritical.length);
    const chosen = new Set([...pickedCritical, ...pickedOthers]);
    slots = rules.filter((r) => chosen.has(r));
  } else {
    const order = [...critical, ...others];
    slots = Array.from({ length: wantedIn }, (_, i) => order[i % order.length] as Rule);
  }
  // Keep about the same out-of-scope share when a small cartridge writes fewer questions.
  const outOfScope =
    slots.length === opts.questionCount - wantedOut
      ? wantedOut
      : Math.max(1, Math.round((slots.length * opts.outOfScopeShare) / (1 - opts.outOfScopeShare)));
  return { slots, outOfScope };
}

function ruleForExam(r: Rule) {
  return {
    id: r.id,
    title: r.title,
    when: r.when,
    then: r.then,
    ...(r.exceptions.length > 0 ? { exceptions: r.exceptions } : {}),
    ...(r.calc ? { calc: r.calc } : {}),
  };
}

/** The public prompt. Quotes are left out so the cloud cannot copy them. */
export function buildExamPrompt(cartridge: Cartridge, plan: ExamPlan) {
  return fillTemplate(EXAM_PROMPT, {
    n: asPublic(String(plan.slots.length), 'app'),
    m: asPublic(String(plan.outOfScope), 'app'),
    rulesJson: asPublic(JSON.stringify(plan.slots.map(ruleForExam), null, 1), 'cartridge'),
    allTitles: asPublic(cartridge.rules.map((r) => `${r.id}: ${r.title}`).join('\n'), 'cartridge'),
  });
}

const RULE_ID_MENTION = /\bR\d{3,}\b/i;

export interface CheckedQuestions {
  questions: Array<{ question: string; expectedRuleId: string }>;
  dropped: Array<{ question: string; reason: string }>;
}

export function checkQuestions(raw: readonly unknown[], cartridge: Cartridge): CheckedQuestions {
  const byId = new Map(cartridge.rules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const questions: CheckedQuestions['questions'] = [];
  const dropped: CheckedQuestions['dropped'] = [];
  for (const item of raw) {
    const parsed = ExamQuestionSchema.safeParse(item);
    const text =
      typeof (item as { question?: unknown })?.question === 'string'
        ? (item as { question: string }).question
        : '';
    if (!parsed.success) {
      dropped.push({ question: text, reason: 'Incomplete or in the wrong shape.' });
      continue;
    }
    const { question, expectedRuleId } = parsed.data;
    const rule = byId.get(expectedRuleId);
    if (expectedRuleId !== NONE && !rule) {
      dropped.push({
        question,
        reason: `Expects ${expectedRuleId}, which is not in this cartridge.`,
      });
      continue;
    }
    if (RULE_ID_MENTION.test(question)) {
      dropped.push({ question, reason: 'It names a rule ID.' });
      continue;
    }
    const q = normalize(question);
    if (
      rule &&
      normalize(rule.source.quote).length >= 20 &&
      q.includes(normalize(rule.source.quote))
    ) {
      dropped.push({ question, reason: 'It copies the rule’s quote.' });
      continue;
    }
    if (seen.has(q)) {
      dropped.push({ question, reason: 'It repeats another question.' });
      continue;
    }
    seen.add(q);
    questions.push({ question, expectedRuleId });
  }
  return { questions, dropped };
}

function categoryOf(expectedRuleId: string, byId: ReadonlyMap<string, Rule>): ExamCategory {
  if (expectedRuleId === NONE) return 'out-of-scope';
  return byId.get(expectedRuleId)?.severity === 'critical' ? 'critical' : 'standard';
}

/** Stratified, seeded split. Each group of 2 or more puts at least one question in held-out. */
export function splitExam(
  questions: ReadonlyArray<{ question: string; expectedRuleId: string }>,
  cartridge: Cartridge,
  heldOutShare: number,
): ExamItem[] {
  const byId = new Map(cartridge.rules.map((r) => [r.id, r]));
  const items = questions.map((q, i) => ({
    id: `e${i + 1}`,
    question: q.question,
    expectedRuleId: q.expectedRuleId,
    category: categoryOf(q.expectedRuleId, byId),
  }));
  const random = seededRandom(hashString(cartridge.id));
  const heldOut = new Set<string>();
  for (const category of ['critical', 'standard', 'out-of-scope'] as const) {
    const group = items.filter((i) => i.category === category);
    const count = group.length >= 2 ? Math.max(1, Math.round(group.length * heldOutShare)) : 0;
    for (const i of shuffled(group, random).slice(0, count)) heldOut.add(i.id);
  }
  return items.map((i) => ({ ...i, split: heldOut.has(i.id) ? 'held-out' : 'practice' }));
}

export async function generateExam(
  cartridge: Cartridge,
  deps: { cloud: CloudJson; now?: () => Date },
  options: Partial<GenerateOptions> = {},
): Promise<ExamSet> {
  const opts: GenerateOptions = { ...config.exam, ...options };
  const plan = planExam(cartridge.rules, opts);
  if (plan.slots.length + plan.outOfScope < opts.minQuestions) {
    throw new ExamError(
      `This cartridge is too small for Exam Day: it would have ${plan.slots.length + plan.outOfScope} questions, and at least ${opts.minQuestions} are needed.`,
      'TOO_SMALL',
    );
  }
  let raw: unknown[];
  try {
    const reply = await deps.cloud(
      examTask(cartridge.rules.map((r) => r.id)),
      buildExamPrompt(cartridge, plan),
      ExamReply,
    );
    raw = reply.data.questions;
  } catch (e) {
    if (e instanceof CloudError && e.code === 'OFFLINE') {
      throw new ExamError('No signal. Writing the exam needs the cloud once.', 'OFFLINE');
    }
    throw new ExamError(`The cloud could not write the exam: ${(e as Error).message}`, 'CLOUD');
  }
  const checked = checkQuestions(raw, cartridge);
  if (checked.questions.length < opts.minQuestions) {
    throw new ExamError(
      `The cloud wrote only ${checked.questions.length} usable questions; at least ${opts.minQuestions} are needed. Try again.`,
      'TOO_FEW',
    );
  }
  return {
    cartridgeId: cartridge.id,
    createdAt: (deps.now ?? (() => new Date()))().toISOString(),
    ruleIds: cartridge.rules.map((r) => r.id),
    items: splitExam(checked.questions, cartridge, opts.heldOutShare),
    dropped: checked.dropped,
  };
}

/** A saved exam, minus questions whose rule is no longer in the cartridge. */
export function usableExam(
  exam: ExamSet | undefined,
  cartridge: Cartridge,
  minQuestions: number,
): ExamSet | undefined {
  if (!exam || exam.cartridgeId !== cartridge.id) return undefined;
  const ids = new Set(cartridge.rules.map((r) => r.id));
  const items = exam.items.filter((i) => i.expectedRuleId === NONE || ids.has(i.expectedRuleId));
  const practice = items.filter((i) => i.split === 'practice').length;
  if (items.length < minQuestions || practice === 0 || practice === items.length) return undefined;
  return { ...exam, items };
}
