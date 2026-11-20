/**
 * Prompt templates. Cloud templates are Public by nature:
 * they are our own text. Device prompts are built from plain strings because
 * they never leave the device.
 *
 * Candidates shown to Gemini Nano are labelled C1..C5 rather than by raw
 * cartridge rule IDs, so the on-device JSON schema enum stays fixed at 6 values
 * regardless of cartridge size or version.
 */
import type { Rule } from '@/cartridge/types';
import { asPublic } from '@/privacy';

export const CANDIDATE_SLOTS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type CandidateSlot = (typeof CANDIDATE_SLOTS)[number];

export const DEVICE_SELECT_SYSTEM =
  'You choose which candidate rule answers a question. Reply only with the JSON requested.';

/** One line per candidate: "C1: title. When: when. Not when: notWhen". */
export function formatCandidateLine(rule: Rule, slot: string = rule.id): string {
  const clause = (s: string) => s.trim().replace(/[.\s]+$/, '');
  const parts = [`${slot}: ${clause(rule.title)}.`, `When: ${clause(rule.when)}.`];
  if (rule.notWhen && rule.notWhen.trim() !== '') parts.push(`Not when: ${clause(rule.notWhen)}.`);
  return parts.join(' ');
}

export function buildDeviceSelectPrompt(question: string, candidates: readonly Rule[]): string {
  if (candidates.length > CANDIDATE_SLOTS.length) {
    throw new Error(
      `At most ${CANDIDATE_SLOTS.length} candidate rules can be sent to the device (got ${candidates.length}).`,
    );
  }
  return [
    `Question: ${question}`,
    'Candidate rules:',
    ...candidates.map((r, i) => formatCandidateLine(r, CANDIDATE_SLOTS[i])),
    'Choose the single best candidate ID (C1, C2, ...), or NONE if no candidate clearly answers the question, and put it in choice.',
    'If the question contains a quantity the rule needs (for example a number of people), put that number in quantity, otherwise -1.',
  ].join('\n');
}

export const DEVICE_EDGE_SYSTEM =
  'You compare one connection in a system diagram with candidate rules. Reply only with the JSON requested.';

/** One line per candidate: "C1: title. When: when. Exceptions: [0] a; [1] b." */
export function formatEdgeCandidateLine(rule: Rule, slot: string = rule.id): string {
  const clause = (s: string) => s.trim().replace(/[.\s]+$/, '');
  const exceptions = rule.exceptions
    .map((e, i) => ({ i, text: clause(e) }))
    .filter((e) => e.text !== '');
  const exText =
    exceptions.length > 0 ? exceptions.map((e) => `[${e.i}] ${e.text}`).join('; ') : 'none';
  return `${slot}: ${clause(rule.title)}. When: ${clause(rule.when)}. Exceptions: ${exText}.`;
}

/**
 * DEVICE_EDGE_PROMPT. The model sees one connection and up to 5 candidate rules
 * (labelled C1..C5 with 0-based numbered exceptions), never the rest of the
 * diagram. 'null' is written as NONE and -1 because the response schema uses a
 * small fixed enum and an integer index.
 */
export function buildDeviceEdgePrompt(edge: string, candidates: readonly Rule[]): string {
  if (candidates.length > CANDIDATE_SLOTS.length) {
    throw new Error(
      `At most ${CANDIDATE_SLOTS.length} candidate rules can be sent to the device (got ${candidates.length}).`,
    );
  }
  return [
    `Connection: ${edge}`,
    'Candidate rules:',
    ...candidates.map((r, i) => formatEdgeCandidateLine(r, CANDIDATE_SLOTS[i])),
    'Pick the candidate ID (C1, C2, ...) this connection relates to, or NONE if none does, and put it in choice.',
    "Then report these facts separately: does the connection meet the rule's when-condition (triggersWhenCondition: true or false)? Does it match one of the rule's numbered exceptions (matchesException: true or false)? If yes, put that exception's number (0, 1, ...) in matchedExceptionIndex, otherwise -1.",
    'If no candidate rule relates to this connection, set outOfScope to true and choice to NONE.',
    'Do not decide whether the connection is allowed. Only report the facts.',
  ].join('\n');
}

/** /dev page only: proves a real cloud call works end to end. */
export const DEV_PING_TEMPLATE = asPublic(
  'This is a connectivity test for a developer page. Reply with JSON {"reply": string} where reply briefly answers: {{message}}',
  'app',
);
