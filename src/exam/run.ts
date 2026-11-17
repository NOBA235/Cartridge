/**
 * run(): the device answers each exam question through the same pipeline as
 * the Ask screen (retrieval, the on-device model, the checks), with the cloud
 * never involved, so the device is what gets measured.
 *
 * Grading:
 * - predicted: NONE when no rule was close (LOW_RETRIEVAL) or the device said
 *   NONE; the rule the device chose otherwise; ERROR when the device failed.
 * - pass: predicted equals expected, and for an in-scope question the answer
 *   also passed the checks (it was one of the candidates and its quote
 *   verified), because only then would the Ask screen show it.
 */
import type { AskContext, DeviceHandle } from '@/cartridge/ask';
import { answerOnDevice } from '@/cartridge/ask';
import { NONE } from '@/cartridge/types';
import { config } from '@/config';
import { asPublic } from '@/privacy';
import { ExamError, type ExamItem, type ExamResult } from './types';

export interface RunDeps {
  device: DeviceHandle;
  /** Milliseconds, for latency. Defaults to performance.now(). */
  clock?: () => number;
  signal?: AbortSignal;
  onResult?: (result: ExamResult, done: number, total: number) => void;
  maxConsecutiveDeviceErrors?: number;
}

export async function runExam(
  items: readonly ExamItem[],
  ctx: AskContext,
  deps: RunDeps,
): Promise<ExamResult[]> {
  if (!deps.device.ready) {
    throw new ExamError(
      'Gemini Nano is not ready on this device. Prepare this device first.',
      'DEVICE_UNAVAILABLE',
    );
  }
  const clock = deps.clock ?? (() => performance.now());
  const maxErrors = deps.maxConsecutiveDeviceErrors ?? config.exam.maxConsecutiveDeviceErrors;
  const results: ExamResult[] = [];
  let errorsInARow = 0;

  for (const item of items) {
    if (deps.signal?.aborted) throw new ExamError('Stopped.', 'STOPPED');
    const started = clock();
    // Exam questions were written by the cloud from public rules.
    const step = await answerOnDevice(asPublic(item.question, 'cloud-response'), ctx, deps.device);
    const latencyMs = Math.max(0, clock() - started);

    let predicted: string;
    let verified = false;
    let reason: string | undefined;
    if (step.kind === 'answered') {
      predicted = step.answer.ruleId ?? NONE;
      verified = true;
    } else {
      reason = step.reason;
      if (step.reason === 'DEVICE_UNAVAILABLE') {
        throw new ExamError(
          'Gemini Nano stopped being available during the exam.',
          'DEVICE_UNAVAILABLE',
        );
      }
      if (step.reason === 'DEVICE_ERROR') predicted = 'ERROR';
      else if (step.reason === 'VALIDATION_FAILED') predicted = step.trace.chosen ?? 'ERROR';
      else predicted = NONE; // LOW_RETRIEVAL or NO_MATCH
    }

    errorsInARow = predicted === 'ERROR' ? errorsInARow + 1 : 0;
    const pass = predicted === item.expectedRuleId && (item.expectedRuleId === NONE || verified);
    const result: ExamResult = {
      itemId: item.id,
      question: item.question,
      expected: item.expectedRuleId,
      predicted,
      verified,
      pass,
      latencyMs,
      candidates: step.trace.candidates,
      ...(reason ? { reason } : {}),
    };
    results.push(result);
    deps.onResult?.(result, results.length, items.length);

    if (errorsInARow >= maxErrors) {
      const detail = step.kind === 'escalate' ? step.detail : '';
      throw new ExamError(
        `Gemini Nano failed ${errorsInARow} questions in a row. ${detail}`,
        'DEVICE_FAILING',
      );
    }
  }
  return results;
}

/** 'device' only for Gemini Nano through Firebase AI Logic. */
export function measuredOn(device: DeviceHandle): 'device' | 'mock' {
  return device.model.kind === 'firebase' ? 'device' : 'mock';
}
