/**
 * The tutor (TUTOR_PROMPT): the cloud proposes edits to rules the device got
 * wrong on PRACTICE questions. Code applies only title, when, keywords and
 * notWhen; then, exceptions, severity, source and calc can never change.
 *
 * - askTutor() refuses to send a held-out question.
 * - Only the rules involved in the failures are sent (the expected rule, the
 *   rule the device chose, and the candidates it was shown): only those can
 *   change the outcome.
 * - A proposed field that copies question text (any run of 6 words, or a whole
 *   short question) is rejected: the tutor must generalise.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import { normalize } from '@/cartridge/normalize';
import type { Rule } from '@/cartridge/types';
import { asPublic, fillTemplate } from '@/privacy';
import { TUTOR_PROMPT, TutorPatchSchema, TutorReply, tutorTask } from './prompts';
import type { ExamItem, ExamResult, TutorChange } from './types';

export const MAX_KEYWORDS = 10;
const MAX_TITLE = 120;
const MAX_TEXT = 400;
const COPY_RUN = 6;

export function involvedRuleIds(failures: readonly ExamResult[], rules: readonly Rule[]): string[] {
  const known = new Set(rules.map((r) => r.id));
  const ids = new Set<string>();
  for (const f of failures) {
    for (const id of [f.expected, f.predicted, ...f.candidates]) if (known.has(id)) ids.add(id);
  }
  return rules.map((r) => r.id).filter((id) => ids.has(id));
}

export function buildTutorPrompt(failures: readonly ExamResult[], rules: readonly Rule[]) {
  const ids = new Set(involvedRuleIds(failures, rules));
  const rulesJson = rules
    .filter((r) => ids.has(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title,
      when: r.when,
      ...(r.notWhen ? { notWhen: r.notWhen } : {}),
      keywords: r.keywords,
      then: r.then,
    }));
  const failuresJson = failures.map((f) => ({
    question: f.question,
    expectedRuleId: f.expected,
    deviceChose: f.predicted === 'ERROR' ? 'no answer (device error)' : f.predicted,
    rulesShown: f.candidates,
  }));
  return {
    ruleIds: [...ids],
    prompt: fillTemplate(TUTOR_PROMPT, {
      rulesJson: asPublic(JSON.stringify(rulesJson, null, 1), 'cartridge'),
      failuresJson: asPublic(JSON.stringify(failuresJson, null, 1), 'cloud-response'),
    }),
  };
}

export class TutorError extends Error {
  override readonly name = 'TutorError';
  readonly offline: boolean;
  constructor(message: string, offline: boolean) {
    super(message);
    this.offline = offline;
  }
}

/** Sends practice failures to the tutor. Throws if any failure is a held-out question. */
export async function askTutor(
  failures: readonly ExamResult[],
  items: readonly ExamItem[],
  rules: readonly Rule[],
  cloud: CloudJson,
): Promise<unknown[]> {
  const split = new Map(items.map((i) => [i.id, i.split]));
  if (failures.some((f) => split.get(f.itemId) !== 'practice')) {
    throw new Error('Internal error: a held-out question was about to be sent to the tutor.');
  }
  const { ruleIds, prompt } = buildTutorPrompt(failures, rules);
  if (ruleIds.length === 0) return [];
  try {
    const reply = await cloud(tutorTask(ruleIds), prompt, TutorReply);
    return reply.data.patches;
  } catch (e) {
    const offline = e instanceof CloudError && e.code === 'OFFLINE';
    throw new TutorError(
      offline ? 'No signal for the tutor.' : `The tutor failed: ${(e as Error).message}`,
      offline,
    );
  }
}

function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** True if `text` contains a whole short question, or any run of 6 words from a question. */
export function copiesQuestion(text: string, questions: readonly string[]): boolean {
  const t = ` ${words(text).join(' ')} `;
  for (const q of questions) {
    const w = words(q);
    if (w.length === 0) continue;
    if (w.length < COPY_RUN) {
      if (w.length >= 3 && t.includes(` ${w.join(' ')} `)) return true;
      continue;
    }
    for (let i = 0; i + COPY_RUN <= w.length; i++) {
      if (t.includes(` ${w.slice(i, i + COPY_RUN).join(' ')} `)) return true;
    }
  }
  return false;
}

export interface Rejection {
  ruleId: string;
  field?: string;
  reason: string;
}

export interface PatchResult {
  rules: Rule[];
  changes: TutorChange[];
  rejected: Rejection[];
}

export function applyPatches(
  rules: readonly Rule[],
  rawPatches: readonly unknown[],
  ctx: { round: number; questions: readonly string[] },
): PatchResult {
  const byId = new Map(rules.map((r) => [r.id, { ...r }]));
  const changes: TutorChange[] = [];
  const rejected: Rejection[] = [];

  for (const raw of rawPatches) {
    const parsed = TutorPatchSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({
        ruleId: String((raw as { ruleId?: unknown })?.ruleId ?? '?'),
        reason: 'In the wrong shape.',
      });
      continue;
    }
    const p = parsed.data;
    const rule = byId.get(p.ruleId);
    if (!rule) {
      rejected.push({ ruleId: p.ruleId, reason: 'Not a rule in this cartridge.' });
      continue;
    }
    const why = p.why.trim();
    const record = (field: TutorChange['field'], before: string, after: string) =>
      changes.push({
        round: ctx.round,
        ruleId: rule.id,
        field,
        before,
        after,
        why,
        reverted: false,
      });

    for (const field of ['title', 'when', 'notWhen'] as const) {
      const value = p[field]?.trim().replace(/\s+/g, ' ');
      if (value === undefined || value === '') continue;
      const limit = field === 'title' ? MAX_TITLE : MAX_TEXT;
      if (value.length > limit) {
        rejected.push({ ruleId: rule.id, field, reason: `Longer than ${limit} characters.` });
        continue;
      }
      if (copiesQuestion(value, ctx.questions)) {
        rejected.push({
          ruleId: rule.id,
          field,
          reason: 'It copies exam question text instead of generalising.',
        });
        continue;
      }
      const before = rule[field] ?? '';
      if (value === before) continue;
      rule[field] = value;
      record(field, before, value);
    }

    if (p.keywords) {
      const kept: string[] = [];
      for (const k of p.keywords) {
        const word = k.trim().toLowerCase().replace(/\s+/g, ' ');
        if (word === '' || word.length > 60 || kept.includes(word)) continue;
        if (copiesQuestion(word, ctx.questions)) {
          rejected.push({
            ruleId: rule.id,
            field: 'keywords',
            reason: `'${word}' copies exam question text.`,
          });
          continue;
        }
        kept.push(word);
      }
      const next = kept.slice(0, MAX_KEYWORDS);
      const before = rule.keywords.join(', ');
      if (next.length > 0 && next.join(', ') !== before) {
        rule.keywords = next;
        record('keywords', before, next.join(', '));
      }
    }
  }

  return { rules: rules.map((r) => byId.get(r.id) as Rule), changes, rejected };
}
