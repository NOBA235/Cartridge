/**
 * Rules the cloud suggests when it answers a question the cartridge missed.
 *
 * checkProposal() runs on this device before a suggestion is shown, and again
 * when it is approved. A suggestion is discarded unless:
 * - it has the shape of a rule;
 * - its quote (at most 300 characters) is found in the rulebook on this device;
 * - every number in its instruction appears near that quote;
 * - its quote is not already the evidence of a rule in the cartridge.
 * A calculation whose factor is not in the quote is removed (the rule is kept).
 * It also reports, as warnings for the reviewer, a very similar existing rule
 * and words from the user's question that are not in the rulebook but ended up
 * in the rule (rules are sent to the cloud when an exam is written).
 */
import { z } from 'zod';
import { config } from '@/config';
import { cleanQuote, inventedNumbers, numbersIn } from './compile';
import { RuleDraftSchema, type RuleDraft } from './compilePrompts';
import { normalize } from './normalize';
import { MAX_KEYWORDS, titleSimilarity } from './reduce';
import { STOPWORDS } from './searchTerms';
import type { SourceText } from './source';
import type { Calc, Cartridge, Rule } from './types';
import { prepareSource, verifyQuote, type PreparedSource } from './verifyQuote';
import { nextRuleId, versionWithRule } from './versions';

/** Characters before and after the quote in which the instruction's numbers must appear. */
export const NUMBER_WINDOW = 1500;

export interface CheckedProposal {
  /** The quote is cleaned and verified; a calculation without its factor in the quote is removed. */
  draft: RuleDraft;
  start: number;
  end: number;
  page?: number;
  /** An existing rule with a very similar title or an overlapping quote. */
  similarTo?: string;
  /** Words of the user's question that are not in the rulebook but appear in the rule. */
  questionWords: string[];
  notes: string[];
}

export type ProposalRejectReason =
  | 'NO_SOURCE'
  | 'INVALID'
  | 'QUOTE_TOO_LONG'
  | 'QUOTE_NOT_FOUND'
  | 'NUMBER_NOT_IN_SOURCE'
  | 'DUPLICATE';

export type ProposalCheck =
  | { ok: true; proposal: CheckedProposal }
  | { ok: false; reason: ProposalRejectReason; detail: string };

export interface ProposalContext {
  rules: readonly Rule[];
  source: SourceText | undefined;
  prepared?: PreparedSource;
  /** The question that led to the suggestion. */
  question: string;
}

function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const sourceWords = new WeakMap<object, ReadonlySet<string>>();

function wordsOf(prepared: PreparedSource): ReadonlySet<string> {
  let set = sourceWords.get(prepared);
  if (!set) {
    set = new Set(words(prepared.normalized.text));
    sourceWords.set(prepared, set);
  }
  return set;
}

function ruleText(d: RuleDraft): string {
  return [d.title, d.when, d.then, d.section, ...d.exceptions, ...d.keywords].join(' ');
}

/** Words (4+ letters, not question words) that are in the question and the rule, but not the rulebook. */
export function questionOnlyWords(
  question: string,
  draft: RuleDraft,
  prepared: PreparedSource,
): string[] {
  const inSource = wordsOf(prepared);
  const inRule = new Set(words(ruleText(draft)));
  const out = new Set<string>();
  for (const w of words(question)) {
    if (w.length < 4 || /^\d+$/.test(w) || STOPWORDS.has(w)) continue;
    if (!inSource.has(w) && inRule.has(w)) out.add(w);
  }
  return [...out];
}

/** A quote for comparison: normalised, without punctuation at either end. */
export function quoteKey(quote: string): string {
  return normalize(quote).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function factorInQuote(calc: Calc, quote: string): boolean {
  return numbersIn(quote).some((n) => Number(n.replace(',', '.')) === calc.factor);
}

export function checkProposal(raw: unknown, ctx: ProposalContext): ProposalCheck | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!ctx.source) {
    return {
      ok: false,
      reason: 'NO_SOURCE',
      detail: 'The rulebook is not on this device, so the suggested rule could not be checked.',
    };
  }
  const prepared = ctx.prepared ?? prepareSource(ctx.source);
  const parsed = RuleDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'INVALID', detail: 'The suggested rule was incomplete.' };
  }
  const draft = parsed.data;
  const quote = cleanQuote(draft.quote);
  if (quote.length > config.compile.maxQuoteChars) {
    return {
      ok: false,
      reason: 'QUOTE_TOO_LONG',
      detail: 'Its quote was longer than 300 characters.',
    };
  }
  const v = verifyQuote(quote, prepared);
  if (!v.ok) {
    return {
      ok: false,
      reason: 'QUOTE_NOT_FOUND',
      detail: 'Its quote was not found in the rulebook.',
    };
  }
  const near = ctx.source.text.slice(Math.max(0, v.start - NUMBER_WINDOW), v.end + NUMBER_WINDOW);
  const invented = inventedNumbers(draft.then, near);
  if (invented.length > 0) {
    return {
      ok: false,
      reason: 'NUMBER_NOT_IN_SOURCE',
      detail: `Its instruction contains ${invented.join(', ')}, which does not appear near its quote in the rulebook.`,
    };
  }
  const q = quoteKey(quote);
  const same = ctx.rules.find((r) => quoteKey(r.source.quote) === q);
  if (same) {
    return {
      ok: false,
      reason: 'DUPLICATE',
      detail: `Its quote is already the evidence of ${same.id} ‘${same.title}’.`,
    };
  }

  const notes: string[] = [];
  let calc = draft.calc ?? undefined;
  if (calc && !factorInQuote(calc, quote)) {
    notes.push(`Its calculation was removed: the factor ${calc.factor} is not in the quote.`);
    calc = undefined;
  }
  const similar = ctx.rules.find((r) => {
    const rq = quoteKey(r.source.quote);
    return (
      titleSimilarity(r.title, draft.title) >= config.compile.titleSimilarity ||
      rq.includes(q) ||
      q.includes(rq)
    );
  });
  const checked: RuleDraft = { ...draft, quote, calc: calc ?? null, page: v.page ?? null };
  return {
    ok: true,
    proposal: {
      draft: checked,
      start: v.start,
      end: v.end,
      ...(v.page !== undefined ? { page: v.page } : {}),
      ...(similar ? { similarTo: similar.id } : {}),
      questionWords: questionOnlyWords(ctx.question, checked, prepared),
      notes,
    },
  };
}

// ---------- stored suggestions ----------

export const CheckSummarySchema = z.object({
  ranAt: z.string(),
  version: z.number().int().positive(),
  measuredOn: z.enum(['device', 'mock']),
  groups: z.array(
    z.object({
      group: z.enum(['new-rule', 'your-question', 'affected', 'regression']),
      passed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  ),
  failures: z.array(
    z.object({
      question: z.string(),
      expected: z.string(),
      predicted: z.string(),
      group: z.string(),
    }),
  ),
  /** Out-of-scope exam questions the device now answers with the new rule. */
  maybeCovered: z.array(z.string()),
  notes: z.array(z.string()),
});
export type CheckSummary = z.infer<typeof CheckSummarySchema>;

export const ProposalRecordSchema = z.object({
  id: z.string(),
  cartridgeId: z.string(),
  /** The cartridge version the question was asked against. */
  baseVersion: z.number().int().positive(),
  createdAt: z.string(),
  /** Stored on this device only. */
  question: z.string(),
  answer: z.string(),
  draft: RuleDraftSchema,
  similarTo: z.string().optional(),
  questionWords: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  status: z.enum(['pending', 'approved', 'rejected']),
  decidedAt: z.string().optional(),
  approvedVersion: z.number().int().positive().optional(),
  ruleId: z.string().optional(),
  check: CheckSummarySchema.optional(),
});
export type ProposalRecord = z.infer<typeof ProposalRecordSchema>;

export function newProposalRecord(
  p: CheckedProposal,
  meta: {
    cartridgeId: string;
    baseVersion: number;
    question: string;
    answer: string;
    now?: Date;
    id?: string;
  },
): ProposalRecord {
  return {
    id: meta.id ?? `p-${crypto.randomUUID()}`,
    cartridgeId: meta.cartridgeId,
    baseVersion: meta.baseVersion,
    createdAt: (meta.now ?? new Date()).toISOString(),
    question: meta.question,
    answer: meta.answer,
    draft: p.draft,
    ...(p.similarTo ? { similarTo: p.similarTo } : {}),
    questionWords: p.questionWords,
    notes: p.notes,
    status: 'pending',
  };
}

// ---------- approval ----------

export class ProposalError extends Error {
  override readonly name = 'ProposalError';
}

export function ruleFromDraft(id: string, d: RuleDraft): Rule {
  return {
    id,
    title: d.title,
    when: d.when,
    then: d.then,
    exceptions: [...d.exceptions],
    severity: d.severity,
    keywords: d.keywords.slice(0, MAX_KEYWORDS),
    source: { section: d.section, ...(d.page ? { page: d.page } : {}), quote: d.quote },
    ...(d.calc ? { calc: d.calc } : {}),
  };
}

/**
 * Checks the suggestion again against the CURRENT version (it may have changed
 * since the question was asked) and returns version N+1 with the new rule.
 */
export function approveProposal(
  record: Pick<ProposalRecord, 'draft' | 'question'>,
  ctx: {
    current: Cartridge;
    /** Every rule ID used by any version, so IDs are never reused. */
    everyRuleId: Iterable<string>;
    source: SourceText | undefined;
    prepared?: PreparedSource;
    now?: Date;
  },
): { cartridge: Cartridge; rule: Rule; proposal: CheckedProposal } {
  const check = checkProposal(record.draft, {
    rules: ctx.current.rules,
    source: ctx.source,
    ...(ctx.prepared ? { prepared: ctx.prepared } : {}),
    question: record.question,
  });
  if (!check) throw new ProposalError('There is no suggested rule.');
  if (!check.ok) throw new ProposalError(`This rule cannot be added: ${check.detail}`);
  const id = nextRuleId([...ctx.everyRuleId, ...ctx.current.rules.map((r) => r.id)]);
  const rule = ruleFromDraft(id, check.proposal.draft);
  return { cartridge: versionWithRule(ctx.current, rule, ctx.now), rule, proposal: check.proposal };
}
