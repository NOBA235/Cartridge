/**
 * Cloud task for a question the cartridge could not answer (CLOUD_ANSWER_PROMPT).
 * Besides the answer, the cloud returns two fields so code can check it:
 * 'quote' (the exact passage relied on) and 'quantity' (the number from the
 * question a rule's calculation needs, or -1).
 */
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import type { CloudTask } from '@/ai/cloud';
import { asPublic } from '@/privacy';
import { ruleDraftSchema } from './compilePrompts';

export const CLOUD_ANSWER_PROMPT = asPublic(
  `Answer a practitioner's question using only the rules and source passages below. If a rule answers it, return its ruleId and a short answer. If no rule does but the passages support an answer, give the answer, cite the passage by copying the exact sentence you relied on into quote, and propose a new rule (same fields as the compile output, with an exact quote from the passages). If neither, set covered to false. If the question contains a quantity the rule needs, put that number in quantity, otherwise -1.

Return JSON only: {"answer": string, "ruleId": string | null, "quote": string | null, "quantity": number, "covered": boolean, "proposedRule": object | null}.

Rules:
{{rulesJson}}

Passages:
{{passages}}

Question: {{question}}`,
  'app',
);

export const CLOUD_ANSWER_TASK: CloudTask = {
  name: 'ANSWER',
  timeoutMs: 120_000,
  responseSchema: Schema.object({
    properties: {
      answer: Schema.string(),
      ruleId: Schema.string({ nullable: true }),
      quote: Schema.string({ nullable: true }),
      quantity: Schema.number(),
      covered: Schema.boolean(),
      proposedRule: ruleDraftSchema({ nullable: true }),
    },
    optionalProperties: ['proposedRule'],
  }),
};

export const CloudAnswerReply = z.object({
  answer: z.string(),
  ruleId: z.string().nullish(),
  quote: z.string().nullish(),
  quantity: z.number().default(-1),
  covered: z.boolean(),
  /** Checked separately (see proposals.ts); a bad proposal never sinks the answer. */
  proposedRule: z.unknown().nullish(),
});
export type CloudAnswerReply = z.infer<typeof CloudAnswerReply>;
