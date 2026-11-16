/**
 * Validators for the device model's choice (brief section 5, step 4).
 * The rule ID must be one of the candidates it was shown, and the rule's quote
 * must verify against the rulebook on this device. Anything else escalates.
 */
import type { DeviceSelection } from '@/ai/deviceModel';
import { checkQuote, type QuoteCheckResult } from './answer';
import { NONE, type Rule } from './types';
import type { PreparedSource } from './verifyQuote';

export type Validation =
  | { ok: true; rule: Rule; quoteCheck: QuoteCheckResult }
  | { ok: false; reason: 'NO_MATCH' | 'VALIDATION_FAILED'; detail: string };

export function validateSelection(
  selection: DeviceSelection,
  candidates: readonly Rule[],
  prepared: PreparedSource | undefined,
): Validation {
  if (selection.ruleId === NONE) {
    return {
      ok: false,
      reason: 'NO_MATCH',
      detail: 'The device found no rule that clearly answers this question.',
    };
  }
  const rule = candidates.find((r) => r.id === selection.ruleId);
  if (!rule) {
    return {
      ok: false,
      reason: 'VALIDATION_FAILED',
      detail: `The device chose ${selection.ruleId}, which was not one of the rules it was shown.`,
    };
  }
  if (!prepared) {
    return {
      ok: false,
      reason: 'VALIDATION_FAILED',
      detail: `The rulebook is not on this device, so the quote of ${rule.id} cannot be checked.`,
    };
  }
  const quoteCheck = checkQuote(rule.source.quote, prepared);
  if (!quoteCheck.ok) {
    return {
      ok: false,
      reason: 'VALIDATION_FAILED',
      detail: `The quote of ${rule.id} was not found in the rulebook.`,
    };
  }
  return { ok: true, rule, quoteCheck };
}
