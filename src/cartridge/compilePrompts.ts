/**
 * Cloud tasks for making a cartridge: COMPILE (one call per section) and
 * REPAIR_QUOTE (at most one call per section, only for rules whose quote failed).
 * The prompts ask for a JSON object at the root, because the response schema
 * has an object at the root.
 */
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import type { CloudTask } from '@/ai/cloud';
import { asPublic } from '@/privacy';
import { CalcSchema, SeveritySchema } from './types';

export const COMPILE_PROMPT = asPublic(
  `You convert one section of a public standard or rulebook into numbered rules for an offline reference and architecture audit tool. Source section (page markers look like [p. 12]):
{{chunk}}

Extract every distinct, actionable rule, standard, threshold or exception the text states. For each return: title (max 10 words); when (plain-language situation where it applies); then (what must be done, as stated, keeping numbers exact); exceptions (array of explicit exceptions or carve-outs stated in the text, empty if none); severity ('critical' for baseline Level 1 or mandatory controls that prevent direct security breaches, unauthorized access, unencrypted transport, sensitive-data exposure, credential leaks, or safety/legal harm; 'major' for defense-in-depth, Level 2/3, or documentation controls; 'minor' for operational or best-practice guidance); keywords (6 to 10 words or short phrases a practitioner might use when asking or naming components); section; page (if known); quote (one contiguous passage copied exactly from the source, at most 500 characters, containing the key requirement); calc (only if the rule defines a quantity per unit, otherwise omit).

Use only what the text says. Never invent numbers, thresholds or exceptions. Copy quotes character for character. If a rule is unclear, skip it.

Return JSON only: {"rules": [ ... ]}.`,
  'app',
);

export const REPAIR_QUOTE_PROMPT = asPublic(
  `The rules below were taken from the source section further down, but their quote is not an exact copy of the section's text. For each rule, copy one contiguous passage from the section, character for character, at most 500 characters, that contains the rule's key requirement. Do not change, shorten inside, or fix the wording of the passage. If the section has no such passage, return null for that rule.

Return JSON only: {"repairs": [{"index": number, "quote": string | null}]}.

Rules:
{{rulesJson}}

Source section:
{{chunk}}`,
  'app',
);

const calcSchema = Schema.object({
  properties: {
    op: Schema.enumString({ enum: ['divide', 'multiply'] }),
    factor: Schema.number(),
    inputLabel: Schema.string(),
    inputUnit: Schema.string(),
    outputLabel: Schema.string(),
    outputUnit: Schema.string(),
    rounding: Schema.enumString({ enum: ['ceil', 'floor', 'round'] }),
  },
});

/** One rule in the compile output's shape. Also used for rules the cloud suggests. */
export function ruleDraftSchema(params: { nullable?: boolean } = {}) {
  return Schema.object({
    properties: {
      title: Schema.string(),
      when: Schema.string(),
      then: Schema.string(),
      exceptions: Schema.array({ items: Schema.string() }),
      severity: Schema.enumString({ enum: ['critical', 'major', 'minor'] }),
      keywords: Schema.array({ items: Schema.string() }),
      section: Schema.string(),
      page: Schema.integer(),
      quote: Schema.string(),
      calc: calcSchema,
    },
    optionalProperties: ['page', 'calc'],
    ...params,
  });
}

export const COMPILE_TASK: CloudTask = {
  name: 'COMPILE',
  timeoutMs: 300_000,
  responseSchema: Schema.object({
    properties: {
      rules: Schema.array({ items: ruleDraftSchema() }),
    },
  }),
};

export const REPAIR_QUOTE_TASK: CloudTask = {
  name: 'REPAIR_QUOTE',
  timeoutMs: 180_000,
  responseSchema: Schema.object({
    properties: {
      repairs: Schema.array({
        items: Schema.object({
          properties: {
            index: Schema.integer(),
            quote: Schema.string({ nullable: true }),
          },
        }),
      }),
    },
  }),
};

/** Outer shape only; each rule is checked on its own so one bad rule does not sink a section. */
export const CompileReply = z.object({ rules: z.array(z.unknown()) });

const text = z.string().trim().min(1);

/** One rule as the cloud returns it, before quote checks, dedupe and IDs. */
export const RuleDraftSchema = z.object({
  title: text,
  when: text,
  then: text,
  exceptions: z
    .array(z.string().trim())
    .default([])
    .transform((a) => a.filter((s) => s !== '')),
  severity: SeveritySchema,
  keywords: z
    .array(z.string().trim())
    .default([])
    .transform((a) =>
      [...new Set(a.filter((s) => s !== '').map((s) => s.toLowerCase()))].slice(0, 12),
    ),
  section: z.string().trim().default(''),
  page: z.number().int().positive().nullish(),
  quote: text,
  calc: CalcSchema.nullish(),
});
export type RuleDraft = z.infer<typeof RuleDraftSchema>;

export const RepairReply = z.object({
  repairs: z.array(
    z.object({ index: z.number().int().nonnegative(), quote: z.string().nullable() }),
  ),
});
