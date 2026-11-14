/**
 * Cartridge data model (brief section 6). The zod schemas are the source of
 * truth; TypeScript types are inferred from them so the two cannot drift.
 */
import { z } from 'zod';

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

export const ExamReportSchema = z.object({
  ranAt: z.string(),
  measuredOn: z.enum(['device', 'mock']),
  passRate: z.number().min(0).max(1),
  criticalPassRate: z.number().min(0).max(1),
  outOfScopeRate: z.number().min(0).max(1),
  heldOutPassRate: z.number().min(0).max(1),
  failures: z.array(z.object({ question: z.string(), expected: z.string(), predicted: z.string() })),
  ready: z.boolean(),
});
export type ExamReport = z.infer<typeof ExamReportSchema>;

export const CartridgeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  parentVersion: z.number().int().positive().optional(),
  createdAt: z.string(),
  sourceHash: z.string(),
  rules: z.array(RuleSchema),
  changelog: z.array(z.string()),
  report: ExamReportSchema.optional(),
});
export type Cartridge = z.infer<typeof CartridgeSchema>;

/** Device model answer meaning 'no candidate clearly answers'. */
export const NONE = 'NONE' as const;
