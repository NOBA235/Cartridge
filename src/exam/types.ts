/** Exam Day data. Questions are written by the cloud from public rules, so they are public. */
import { z } from 'zod';

export type ExamSplit = 'practice' | 'held-out';
export type ExamCategory = 'critical' | 'standard' | 'out-of-scope';

export const ExamItemSchema = z.object({
  id: z.string(),
  question: z.string(),
  /** A rule ID, or NONE for an out-of-scope question. */
  expectedRuleId: z.string(),
  split: z.enum(['practice', 'held-out']),
  category: z.enum(['critical', 'standard', 'out-of-scope']),
});
export type ExamItem = z.infer<typeof ExamItemSchema>;

export const ExamSetSchema = z.object({
  cartridgeId: z.string(),
  createdAt: z.string(),
  /** Rule IDs the cartridge had when the exam was written. */
  ruleIds: z.array(z.string()),
  items: z.array(ExamItemSchema),
  /** Why some questions from the cloud were not used. */
  dropped: z.array(z.object({ question: z.string(), reason: z.string() })).default([]),
});
export type ExamSet = z.infer<typeof ExamSetSchema>;

export interface ExamResult {
  itemId: string;
  question: string;
  expected: string;
  /** The rule ID the device chose, NONE, or ERROR when the device failed. */
  predicted: string;
  /** The device's answer passed the checks (candidate and verified quote). */
  verified: boolean;
  pass: boolean;
  latencyMs: number;
  /** Rule IDs the device was shown. */
  candidates: string[];
  /** Why the pipeline did not answer, when it did not. */
  reason?: string;
}

export interface TutorChange {
  round: number;
  ruleId: string;
  field: 'title' | 'when' | 'keywords' | 'notWhen';
  before: string;
  after: string;
  why: string;
  /** True when the round was undone because the practice score went down. */
  reverted: boolean;
}

export type ExamErrorCode =
  | 'TOO_SMALL'
  | 'TOO_FEW'
  | 'NO_SOURCE'
  | 'DEVICE_UNAVAILABLE'
  | 'DEVICE_FAILING'
  | 'OFFLINE'
  | 'CLOUD'
  | 'STOPPED';

export class ExamError extends Error {
  override readonly name = 'ExamError';
  readonly code: ExamErrorCode;
  constructor(message: string, code: ExamErrorCode) {
    super(message);
    this.code = code;
  }
}
