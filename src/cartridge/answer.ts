/**
 * The answer shown to the user. When a rule answers, code writes the answer
 * from the rule: decision, exceptions and quote are copied from the rule, and
 * code does any arithmetic. A model never writes those fields.
 */
import type { EscalationReason } from '@/ai/router';
import { computeCalc } from './calc';
import { numbersIn } from './compile';
import type { Rule } from './types';
import { verifyQuote, type PreparedSource } from './verifyQuote';

/**
 * - verified: the answer comes from a rule (or a cited passage) whose quote
 *   was found in the rulebook on this device.
 * - escalated: the cloud answered, but its answer could not be checked
 *   against the rulebook, or the rulebook does not cover the question.
 * - queued: waiting for signal.
 * - unanswered: the cartridge could not answer and nothing was sent
 *   (the cloud is switched off, or the user kept the question on this device).
 */
export type AnswerStatus = 'verified' | 'escalated' | 'queued' | 'unanswered';

export type AnswerRoute = 'ON_DEVICE' | 'IN_CLOUD' | 'QUEUED';

export interface QuoteCheckResult {
  ok: boolean;
  start?: number;
  end?: number;
  page?: number;
}

export interface Answer {
  question: string;
  route: AnswerRoute;
  status: AnswerStatus;
  ruleId?: string;
  title?: string;
  /** From the rule's 'then', or the cloud's words when no rule applies (wordingFrom says which). */
  decision?: string;
  wordingFrom?: 'rule' | 'cloud';
  exceptions: string[];
  quote?: string;
  quoteCheck?: QuoteCheckResult;
  section?: string;
  page?: number;
  calcLine?: string;
  /** Shown when the rule has a calculation but the question had no usable number. */
  calcHint?: string;
  /** Why the question left the device (or would have). */
  reason?: EscalationReason;
  detail?: string;
  /** Not covered by the rulebook, according to the cloud. */
  notCovered?: boolean;
  /** For device answers: 'ON_DEVICE' for Gemini Nano, 'mock' only in automated tests. */
  deviceSource?: 'ON_DEVICE' | 'mock';
  /** For queued questions: the offline queue item. */
  queueId?: string;
  at: string;
}

export function checkQuote(quote: string, prepared: PreparedSource | undefined): QuoteCheckResult {
  if (!prepared) return { ok: false };
  const v = verifyQuote(quote, prepared);
  return v.ok
    ? { ok: true, start: v.start, end: v.end, ...(v.page !== undefined ? { page: v.page } : {}) }
    : { ok: false };
}

/** A quantity counts only if that number is written in the question. */
export function quantityInQuestion(quantity: number, question: string): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return numbersIn(question).some((n) => Number(n.replace(',', '.')) === quantity);
}

export function answerFromRule(
  rule: Rule,
  input: {
    question: string;
    quantity: number;
    route: AnswerRoute;
    quoteCheck: QuoteCheckResult;
    reason?: EscalationReason;
    now?: Date;
  },
): Answer {
  let calcLine: string | undefined;
  let calcHint: string | undefined;
  if (rule.calc) {
    const usable = quantityInQuestion(input.quantity, input.question);
    const result = usable ? computeCalc(rule.calc, input.quantity) : undefined;
    if (result) calcLine = result.line;
    else
      calcHint = `Add the number of ${rule.calc.inputLabel} to your question to get the calculation.`;
  }
  return {
    question: input.question,
    route: input.route,
    status: input.quoteCheck.ok ? 'verified' : 'escalated',
    ruleId: rule.id,
    title: rule.title,
    decision: rule.then,
    wordingFrom: 'rule',
    exceptions: [...rule.exceptions],
    quote: rule.source.quote,
    quoteCheck: input.quoteCheck,
    section: rule.source.section,
    ...(input.quoteCheck.page !== undefined
      ? { page: input.quoteCheck.page }
      : rule.source.page !== undefined
        ? { page: rule.source.page }
        : {}),
    ...(calcLine ? { calcLine } : {}),
    ...(calcHint ? { calcHint } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    at: (input.now ?? new Date()).toISOString(),
  };
}
