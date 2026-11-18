/**
 * The connection test (the Blueprint canvas gate): 30 labelled connections,
 * run three times through the device evaluator; the lowest run counts.
 */
import { z } from 'zod';
import { EdgeStatusSchema } from './edges';

/** Every status a connection can be expected to have (UNCERTAIN is never the right answer). */
export const ExpectedStatusSchema = z.enum([
  'VIOLATION',
  'COMPLIANT',
  'COMPLIANT_VIA_EXCEPTION',
  'OUT_OF_SCOPE',
]);
export type ExpectedStatus = z.infer<typeof ExpectedStatusSchema>;

export const BenchItemSchema = z.object({
  id: z.string().min(1),
  from: z.string().trim().min(1).max(200),
  to: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).optional(),
  expectedStatus: ExpectedStatusSchema,
  /** The rule the connection is about; null when no rule covers it. */
  expectedRuleId: z.string().nullable(),
  note: z.string().default(''),
});
export type BenchItem = z.infer<typeof BenchItemSchema>;

/** The set of connections for one cartridge version; also the bench/edges.json file format. */
export const EdgeBenchSchema = z.object({
  format: z.literal('cartridge-edge-bench'),
  formatVersion: z.literal(1),
  cartridgeId: z.string(),
  cartridgeVersion: z.number().int().positive(),
  sourceHash: z.string(),
  createdAt: z.string(),
  /** The person running the test confirmed every connection and its label by hand. */
  reviewed: z.boolean(),
  items: z.array(BenchItemSchema),
});
export type EdgeBench = z.infer<typeof EdgeBenchSchema>;

/** The composition the pass bar is defined on. */
export const BENCH_COMPOSITION: Record<ExpectedStatus, number> = {
  VIOLATION: 10,
  COMPLIANT: 10,
  COMPLIANT_VIA_EXCEPTION: 5,
  OUT_OF_SCOPE: 5,
};

export const MissedViolationSchema = z.object({
  id: z.string(),
  edge: z.string(),
  expectedRuleId: z.string().nullable(),
  got: EdgeStatusSchema,
  gotRuleId: z.string().nullable(),
});

export const BenchRunSummarySchema = z.object({
  criticalRecall: z.number().min(0).max(1),
  overallAccuracy: z.number().min(0).max(1),
  violationsFlagged: z.number().int().nonnegative(),
  violations: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type BenchRunSummary = z.infer<typeof BenchRunSummarySchema>;

/** Saved on the cartridge version that was tested. */
export const EdgeBenchReportSchema = z.object({
  measuredOn: z.enum(['device', 'mock']),
  /** Of the lowest run. */
  criticalRecall: z.number().min(0).max(1),
  overallAccuracy: z.number().min(0).max(1),
  missedViolations: z.array(MissedViolationSchema),
  ranAt: z.string(),
  passed: z.boolean(),
  /** Every run, in order; the report's numbers come from the lowest. */
  runs: z.array(BenchRunSummarySchema),
  lowestRun: z.number().int().nonnegative(),
  thresholds: z.object({ criticalRecall: z.number(), overallAccuracy: z.number() }),
  /** Violations flagged with another rule than the one expected (status still counts). */
  wrongRule: z.array(z.string()).default([]),
  medianLatencyMs: z.number().nonnegative().optional(),
});
export type EdgeBenchReport = z.infer<typeof EdgeBenchReportSchema>;
