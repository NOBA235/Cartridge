/**
 * Cartridge data model. The zod schemas are the source of
 * truth; TypeScript types are inferred from them so the two cannot drift.
 */
import { z } from 'zod';
import { EdgeBenchReportSchema } from '@/canvas/benchTypes';

export const SeveritySchema = z.enum(['critical', 'major', 'minor']);
export type Severity = z.infer<typeof SeveritySchema>;

export const CalcSchema = z.object({
  op: z.enum(['divide', 'multiply']),
  factor: z.number().positive(),
  inputLabel: z.string().min(1),
  inputUnit: z.string(),
  outputLabel: z.string().min(1),
  outputUnit: z.string(),
  rounding: z.enum(['ceil', 'floor', 'round']),
});
export type Calc = z.infer<typeof CalcSchema>;

export const RULE_ID_PATTERN = /^R\d{3,}$/;

export const RuleSchema = z.object({
  id: z.string().regex(RULE_ID_PATTERN),
  title: z.string().min(1),
  when: z.string().min(1),
  notWhen: z.string().optional(),
  then: z.string().min(1),
  exceptions: z.array(z.string()),
  severity: SeveritySchema,
  keywords: z.array(z.string()),
  source: z.object({
    section: z.string(),
    page: z.number().int().positive().optional(),
    quote: z.string().min(1),
  }),
  calc: CalcSchema.optional(),
});
export type Rule = z.infer<typeof RuleSchema>;

/** Fields the tutor must never change. */
export const TUTOR_IMMUTABLE_FIELDS = ['then', 'exceptions', 'severity', 'source', 'calc'] as const;

/** Fields the tutor may change. */
export const TUTOR_PATCHABLE_FIELDS = ['title', 'when', 'keywords', 'notWhen'] as const;

const Tally = z.object({
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/**
 * Exam Day result. Rates:
 * - passRate: practice questions, after the tutor's rounds.
 * - heldOutPassRate: held-out questions, asked once at the end.
 * - criticalPassRate: held-out questions whose expected rule is critical.
 * - outOfScopeRate: held-out out-of-scope questions answered NONE.
 * Optional, so older reports still parse: counts, thresholds, tutor rounds,
 * latency, notes, and the user's override.
 */
export const ExamReportSchema = z.object({
  ranAt: z.string(),
  measuredOn: z.enum(['device', 'mock']),
  passRate: z.number().min(0).max(1),
  criticalPassRate: z.number().min(0).max(1),
  outOfScopeRate: z.number().min(0).max(1),
  heldOutPassRate: z.number().min(0).max(1),
  failures: z.array(
    z.object({
      question: z.string(),
      expected: z.string(),
      predicted: z.string(),
      set: z.enum(['practice', 'held-out']).optional(),
    }),
  ),
  /** Computed against the thresholds. Never changed by an override. */
  ready: z.boolean(),
  counts: z
    .object({
      practiceStart: Tally,
      practice: Tally,
      heldOut: Tally,
      heldOutCritical: Tally,
      heldOutOutOfScope: Tally,
    })
    .optional(),
  thresholds: z.object({ criticalPassRate: z.number(), outOfScopeRate: z.number() }).optional(),
  tutorRounds: z.number().int().nonnegative().optional(),
  medianLatencyMs: z.number().nonnegative().optional(),
  notes: z.array(z.string()).optional(),
  /** The user marked the cartridge ready although it is below the bar. */
  overridden: z.object({ at: z.string() }).optional(),
});
export type ExamReport = z.infer<typeof ExamReportSchema>;

export const CartridgeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    parentVersion: z.number().int().positive().optional(),
    createdAt: z.string(),
    sourceHash: z.string(),
    /** The rulebook's name and licence travel with exported quotes. */
    sourceName: z.string().optional(),
    sourceLicence: z.string().optional(),
    rules: z.array(RuleSchema),
    changelog: z.array(z.string()),
    report: ExamReportSchema.optional(),
    /** The connection test for the Blueprint canvas, run on the device with these rules. */
    edgeBench: EdgeBenchReportSchema.optional(),
  })
  .refine((c) => new Set(c.rules.map((r) => r.id)).size === c.rules.length, {
    message: 'Rule IDs must be unique',
    path: ['rules'],
  });
export type Cartridge = z.infer<typeof CartridgeSchema>;

/** Device model answer meaning 'no candidate clearly answers'. */
export const NONE = 'NONE' as const;
