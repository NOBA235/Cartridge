/**
 * EDGE_BENCH_PROMPT: the cloud drafts the 30 test connections from the public
 * rules only (title, situation, exceptions, severity). A person then reviews
 * every connection by hand before the test may run.
 * The JSON line is added because the response schema needs an object at the
 * root, and NONE stands for 'no rule' because the schema uses an enum.
 */
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import type { CloudTask } from '@/ai/cloud';
import { NONE } from '@/cartridge/types';
import { asPublic } from '@/privacy';

export const EDGE_BENCH_PROMPT = asPublic(
  `Below are rules from a public standard, each with its when-condition and exceptions. Write 30 test connections between two named components as { from, to, label?, expectedStatus, expectedRuleId, note }. Write 10 clear violations of critical rules, 10 clearly compliant connections that trigger no rule, 5 connections that trigger a rule but match one of its stated exceptions (expectedStatus COMPLIANT_VIA_EXCEPTION), and 5 connections no rule covers (OUT_OF_SCOPE). Use realistic but invented component names, never real company names. Return JSON only.

The JSON has this shape: {"connections": [{"from": string, "to": string, "label": string, "expectedStatus": "VIOLATION" | "COMPLIANT" | "COMPLIANT_VIA_EXCEPTION" | "OUT_OF_SCOPE", "expectedRuleId": string, "note": string}]}. Use "" for no label and "NONE" for expectedRuleId when no rule covers the connection.

Rules:
{{rulesJson}}`,
  'app',
);

export function edgeBenchTask(ruleIds: readonly string[]): CloudTask {
  return {
    name: 'EDGE_BENCH',
    timeoutMs: 240_000,
    responseSchema: Schema.object({
      properties: {
        connections: Schema.array({
          items: Schema.object({
            properties: {
              from: Schema.string(),
              to: Schema.string(),
              label: Schema.string(),
              expectedStatus: Schema.enumString({
                enum: ['VIOLATION', 'COMPLIANT', 'COMPLIANT_VIA_EXCEPTION', 'OUT_OF_SCOPE'],
              }),
              expectedRuleId: Schema.enumString({ enum: [...ruleIds, NONE] }),
              note: Schema.string(),
            },
            optionalProperties: ['label', 'note'],
          }),
        }),
      },
    }),
  };
}

/** Outer shape only; each connection is checked on its own. */
export const EdgeBenchReply = z.object({ connections: z.array(z.unknown()) });

export const DraftConnectionSchema = z.object({
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).optional(),
  expectedStatus: z.enum(['VIOLATION', 'COMPLIANT', 'COMPLIANT_VIA_EXCEPTION', 'OUT_OF_SCOPE']),
  expectedRuleId: z.string().trim(),
  note: z.string().trim().max(500).default(''),
});
