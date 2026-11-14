/**
 * Prompt templates (brief section 8). Cloud templates are Public by nature:
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

/** /dev page only: proves a real cloud call works end to end. */
export const DEV_PING_TEMPLATE = asPublic(
  'This is a connectivity test for a developer page. Reply with JSON {"reply": string} where reply briefly answers: {{message}}',
  'app',
);
