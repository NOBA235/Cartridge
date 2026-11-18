/**
 * Prompt templates. Cloud templates are Public by nature:
 * they are our own text. Device prompts are built from plain strings because
 * they never leave the device.
 */
import type { Rule } from '@/cartridge/types';
import { asPublic } from '@/privacy';

export const DEVICE_SELECT_SYSTEM =
  'You choose which rule answers a question. Reply only with the JSON requested.';

/** One line per candidate: "R012: title. When: when. Not when: notWhen". */
export function formatCandidateLine(rule: Rule): string {
  const clause = (s: string) => s.trim().replace(/[.\s]+$/, '');
  const parts = [`${rule.id}: ${clause(rule.title)}.`, `When: ${clause(rule.when)}.`];
  if (rule.notWhen && rule.notWhen.trim() !== '') parts.push(`Not when: ${clause(rule.notWhen)}.`);
  return parts.join(' ');
}

export function buildDeviceSelectPrompt(question: string, candidates: readonly Rule[]): string {
  return [
    `Question: ${question}`,
    'Candidate rules:',
    ...candidates.map(formatCandidateLine),
    'Choose the single best rule ID, or NONE if no candidate clearly answers the question.',
    'If the question contains a quantity the rule needs (for example a number of people), put that number in quantity, otherwise -1.',
  ].join('\n');
}

export const DEVICE_EDGE_SYSTEM =
  'You compare one connection in a system diagram with candidate rules. Reply only with the JSON requested.';

/** One line per candidate: "R012: title. When: when. Exceptions: a; b". */
export function formatEdgeCandidateLine(rule: Rule): string {
  const clause = (s: string) => s.trim().replace(/[.\s]+$/, '');
  const exceptions = rule.exceptions.map(clause).filter(Boolean);
  return `${rule.id}: ${clause(rule.title)}. When: ${clause(rule.when)}. Exceptions: ${
    exceptions.length > 0 ? exceptions.join('; ') : 'none'
  }.`;
}

/**
 * DEVICE_EDGE_PROMPT. The model sees one connection and its candidate rules,
 * never the rest of the diagram. 'null' is written as NONE and an empty string,
 * because the response schema uses an enum and plain strings.
 */
export function buildDeviceEdgePrompt(edge: string, candidates: readonly Rule[]): string {
  return [
    `Connection: ${edge}`,
    'Candidate rules:',
    ...candidates.map(formatEdgeCandidateLine),
    'Pick the rule ID this connection relates to, or NONE if none does.',
    "Then report these facts separately: does the connection meet the rule's when-condition (true or false)? Does it match one of the rule's listed exceptions (true or false)? If yes, copy that exception's text exactly into matchedExceptionText, otherwise leave it empty.",
    'If no rule relates to this connection, set outOfScope to true.',
    'Do not decide whether the connection is allowed. Only report the facts.',
  ].join('\n');
}

/** /dev page only: proves a real cloud call works end to end. */
export const DEV_PING_TEMPLATE = asPublic(
  'This is a connectivity test for a developer page. Reply with JSON {"reply": string} where reply briefly answers: {{message}}',
  'app',
);
