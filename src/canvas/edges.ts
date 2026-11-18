/**
 * Connections between two components, and how one is judged against a rule.
 *
 * Gemini Nano reports atomic facts only (EdgeFacts). Plain code decides the
 * status (decide). The text, quote and severity the user sees always come from
 * the rule, never from the model.
 */
import { z } from 'zod';
import { normalize } from '@/cartridge/normalize';
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
  matchedExceptionText: string | null;
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

/** Same exception text, ignoring case, spacing, quote style and end punctuation. */
export function sameText(a: string, b: string | null): boolean {
  if (b === null) return false;
  const clean = (s: string) => normalize(s).replace(/[\s.;:,!]+$/, '');
  const x = clean(a);
  return x !== '' && x === clean(b);
}

export function decide(f: EdgeFacts, rule?: Rule): EdgeStatus {
  if (f.outOfScope || f.matchedRuleId === null || !rule) return 'OUT_OF_SCOPE';
  if (f.matchesException && !rule.exceptions.some((e) => sameText(e, f.matchedExceptionText))) {
    return 'UNCERTAIN';
  }
  if (f.triggersWhenCondition && f.matchesException) return 'COMPLIANT_VIA_EXCEPTION';
  if (f.triggersWhenCondition) return 'VIOLATION';
  return 'COMPLIANT';
}
