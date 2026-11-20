/**
 * Connections between two components, and how one is judged against a rule.
 *
 * Gemini Nano reports atomic facts only (EdgeFacts), including a 0-based
 * exception index rather than verbatim exception prose. Plain code resolves
 * the exact exception text from the rule and decides the status (decide).
 * The text, quote and severity the user sees always come from the rule, never
 * from the model.
 */
import { z } from 'zod';
import type { Rule } from '@/cartridge/types';

export const EDGE_STATUSES = [
  'VIOLATION',
  'COMPLIANT',
  'COMPLIANT_VIA_EXCEPTION',
  'OUT_OF_SCOPE',
  'UNCERTAIN',
] as const;
export const EdgeStatusSchema = z.enum(EDGE_STATUSES);
export type EdgeStatus = z.infer<typeof EdgeStatusSchema>;

/** What the device reports about one connection. Never a verdict. */
export interface EdgeFacts {
  matchedRuleId: string | null;
  triggersWhenCondition: boolean;
  matchesException: boolean;
  /** 0-based index into rule.exceptions, or null when no exception applies. */
  matchedExceptionIndex: number | null;
  outOfScope: boolean;
}

/** One connection, as plain text: 'A --> B (label)'. */
export interface EdgeText {
  from: string;
  to: string;
  label?: string;
}

export function formatEdge(e: EdgeText): string {
  const label = e.label?.trim();
  return `${e.from.trim()} --> ${e.to.trim()}${label ? ` (${label})` : ''}`;
}

/** Exact exception text from the rule when matchedExceptionIndex is valid, else undefined. */
export function matchedException(f: EdgeFacts, rule?: Rule): string | undefined {
  if (!rule || f.matchedExceptionIndex === null) return undefined;
  if (!Number.isInteger(f.matchedExceptionIndex) || f.matchedExceptionIndex < 0) return undefined;
  return rule.exceptions[f.matchedExceptionIndex];
}

export function decide(f: EdgeFacts, rule?: Rule): EdgeStatus {
  if (f.outOfScope || f.matchedRuleId === null || !rule) return 'OUT_OF_SCOPE';
  if (f.matchesException && matchedException(f, rule) === undefined) {
    return 'UNCERTAIN';
  }
  if (f.triggersWhenCondition && f.matchesException) return 'COMPLIANT_VIA_EXCEPTION';
  if (f.triggersWhenCondition) return 'VIOLATION';
  return 'COMPLIANT';
}
