/**
 * Exam Day cloud tasks: EXAM_PROMPT and TUTOR_PROMPT.
 * The 'Return JSON only' line is there because the response schema needs an
 * object at the root, and one sentence covers repeats, because a rule may be
 * listed more than once in a small cartridge.
 */
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import type { CloudTask } from '@/ai/cloud';
import { NONE } from '@/cartridge/types';
import { asPublic } from '@/privacy';

export const EXAM_PROMPT = asPublic(
  `Below are {{n}} rules from a field reference, and the titles of all rules. Write exam questions a field worker might ask in plain words. For each listed rule write one question whose answer is that rule. If a rule is listed more than once, word each of its questions differently. Vary the wording. Do not mention rule IDs or copy the quote. If a rule has a calc, include a realistic quantity in the question. Also write {{m}} questions that sound related but are NOT answered by any rule in the full title list (expectedRuleId = NONE).

Return JSON only: {"questions": [{"question": string, "expectedRuleId": string}]}.

Rules:
{{rulesJson}}

All titles:
{{allTitles}}`,
  'app',
);

export function examTask(ruleIds: readonly string[]): CloudTask {
  return {
    name: 'EXAM',
    timeoutMs: 240_000,
    responseSchema: Schema.object({
      properties: {
        questions: Schema.array({
          items: Schema.object({
            properties: {
              question: Schema.string(),
              expectedRuleId: Schema.enumString({ enum: [...ruleIds, NONE] }),
            },
          }),
        }),
      },
    }),
  };
}

/** Outer shape only; each question is checked on its own. */
export const ExamReply = z.object({ questions: z.array(z.unknown()) });

export const ExamQuestionSchema = z.object({
  question: z.string().trim().min(5).max(400),
  expectedRuleId: z.string().trim(),
});

export const TUTOR_PROMPT = asPublic(
  `A small on-device model failed these exam questions by choosing the wrong rule or answering NONE. Propose edits that make the right rule easier to select and the wrong rule less likely to be confused with it. You may change only title, when, keywords and notWhen. Never change then, exceptions, severity, source or calc. Do not copy question text into rules; generalise.

Return JSON only: {"patches": [{"ruleId": string, "title"?: string, "when"?: string, "keywords"?: string[], "notWhen"?: string, "why": string}]}.

Current rules:
{{rulesJson}}

Failures:
{{failuresJson}}`,
  'app',
);

export function tutorTask(ruleIds: readonly string[]): CloudTask {
  return {
    name: 'TUTOR',
    timeoutMs: 240_000,
    responseSchema: Schema.object({
      properties: {
        patches: Schema.array({
          items: Schema.object({
            properties: {
              ruleId: Schema.enumString({ enum: [...ruleIds] }),
              title: Schema.string(),
              when: Schema.string(),
              keywords: Schema.array({ items: Schema.string() }),
              notWhen: Schema.string(),
              why: Schema.string(),
            },
            optionalProperties: ['title', 'when', 'keywords', 'notWhen'],
          }),
        }),
      },
    }),
  };
}

export const TutorReply = z.object({ patches: z.array(z.unknown()) });

/**
 * One patch. zod drops every key not listed here, so a 'then', 'exceptions',
 * 'severity', 'source' or 'calc' in the reply can never reach a rule.
 */
export const TutorPatchSchema = z.object({
  ruleId: z.string(),
  title: z.string().optional(),
  when: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  notWhen: z.string().optional(),
  why: z.string().default(''),
});
export type TutorPatch = z.infer<typeof TutorPatchSchema>;
