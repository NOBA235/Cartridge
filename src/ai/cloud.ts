/**
 * Cloud tasks through Firebase AI Logic (InferenceMode.ONLY_IN_CLOUD).
 *
 * cloudJson(task, prompt, zodSchema):
 * - accepts only Public prompts (checked at compile time and at run time);
 * - one GenerativeModel instance per task type, because model configuration
 *   (here the response schema) is fixed per instance;
 * - JSON output via inCloudParams.generationConfig { responseMimeType, responseSchema };
 * - every attempt is written to the egress log, including failed ones;
 * - output is validated with zod; up to config.cloudMaxRetries retries on
 *   network errors, malformed JSON or validation failures;
 * - failures are classified (classifyCloudFailure): a usage limit (429) or a
 *   server error (5xx) is retried after a wait; a refusal (401, 403, 400, API
 *   not enabled) is not retried, because it cannot succeed; a lost signal ends
 *   the call as OFFLINE so callers can queue or stop.
 */
import { getGenerativeModel, InferenceMode, type ObjectSchema } from 'firebase/ai';
import type { z } from 'zod';
import { config, type CloudTaskName } from '@/config';
import { assertPublic, type Public } from '@/privacy';
import { connectivity } from '@/queue/connectivity';
import { egressLog, utf8Bytes } from '@/telemetry/egress';
import { getFirebase } from './firebase';

export interface CloudTask {
  readonly name: CloudTaskName;
  /** Firebase Schema for the response. Must describe the same shape as the zod schema. */
  readonly responseSchema: ObjectSchema;
  /** Request timeout (RequestOptions.timeout). The SDK default is 180 seconds. */
  readonly timeoutMs?: number;
}

/** The part of GenerativeModel we use. Lets tests inject a fake. */
export interface CloudModelLike {
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: string };
  }>;
}

export interface CloudDeps {
  getModel(task: CloudTask): CloudModelLike;
  isOnline(): boolean;
  maxRetries: number;
  /** Waits before retry N (1-based). Defaults to config.cloudBackoffMs. */
  backoffMs?: readonly number[];
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CloudResult<T> {
  data: T;
  inferenceSource: string | undefined;
  attempts: number;
}

/**
 * NOT_CONFIGURED: no Firebase config. OFFLINE: no signal, nothing more was sent.
 * QUOTA: the usage limit was reached. REFUSED: the request cannot succeed as it
 * is (App Check, permissions, API not enabled, bad request). FAILED: anything else.
 */
export type CloudErrorCode = 'NOT_CONFIGURED' | 'OFFLINE' | 'QUOTA' | 'REFUSED' | 'FAILED';

export class CloudError extends Error {
  override readonly name = 'CloudError';
  readonly code: CloudErrorCode;
  readonly attempts: number;
  readonly causes: readonly string[];
  constructor(
    message: string,
    code: CloudErrorCode,
    attempts: number,
    causes: readonly string[] = [],
  ) {
    super(message);
    this.code = code;
    this.attempts = attempts;
    this.causes = causes;
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** A reply we could not use: not JSON, or not the expected shape. Retried at once. */
class BadReplyError extends Error {}

export type CloudFailure =
  | { kind: 'quota'; retryAfterMs?: number }
  | { kind: 'server' }
  | { kind: 'refused'; reason: string }
  | { kind: 'bad-reply' }
  | { kind: 'network' };

/** The HTTP status, from AIError.customErrorData or the SDK's '[429 Too Many Requests]' text. */
function httpStatus(e: unknown): number | undefined {
  const data = (e as { customErrorData?: { status?: unknown } } | null)?.customErrorData;
  if (typeof data?.status === 'number') return data.status;
  const m = /\[(\d{3})\b/.exec(describe(e));
  return m ? Number(m[1]) : undefined;
}

/** google.rpc.RetryInfo's retryDelay ('30s', '1.5s'), if the server sent one. */
function retryAfterMs(e: unknown): number | undefined {
  const details = (e as { customErrorData?: { errorDetails?: unknown } } | null)?.customErrorData
    ?.errorDetails;
  if (!Array.isArray(details)) return undefined;
  for (const d of details as Array<Record<string, unknown>>) {
    const delay = d['retryDelay'];
    if (typeof delay === 'string') {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(delay);
      if (m) return Math.round(Number(m[1]) * 1000);
    }
  }
  return undefined;
}

/** Sorts a failed attempt into what to do next. Exported for tests. */
export function classifyCloudFailure(e: unknown): CloudFailure {
  if (e instanceof BadReplyError) return { kind: 'bad-reply' };
  const code = (e as { code?: unknown } | null)?.code;
  const text = describe(e);
  if (code === 'api-not-enabled') {
    return {
      kind: 'refused',
      reason: 'Firebase AI Logic is not enabled for this Firebase project.',
    };
  }
  const status = httpStatus(e);
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(text)) {
    const wait = retryAfterMs(e);
    return wait === undefined ? { kind: 'quota' } : { kind: 'quota', retryAfterMs: wait };
  }
  if (status === 401 || /App Check/i.test(text)) {
    return {
      kind: 'refused',
      reason:
        'The cloud did not accept this app (App Check). In development, register the debug token printed in the browser console.',
    };
  }
  if (status === 403) return { kind: 'refused', reason: 'The cloud refused the request (403).' };
  if (status === 400) {
    return { kind: 'refused', reason: 'The cloud rejected the request as invalid (400).' };
  }
  if (status !== undefined && status >= 500) return { kind: 'server' };
  return { kind: 'network' };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The cloud entry point. Only Public prompts are accepted. */
export type CloudJson = <T>(
  task: CloudTask,
  prompt: Public<string>,
  zodSchema: z.ZodType<T>,
) => Promise<CloudResult<T>>;

export function createCloudClient(deps: CloudDeps): CloudJson {
  return async function cloudJson<T>(
    task: CloudTask,
    prompt: Public<string>,
    zodSchema: z.ZodType<T>,
  ): Promise<CloudResult<T>> {
    // Run-time privacy gate: the type system already forbids Private here,
    // this catches casts and plain strings.
    assertPublic(prompt, `cloudJson(${task.name})`);

    if (!deps.isOnline()) {
      throw new CloudError('No signal. The cloud cannot be reached.', 'OFFLINE', 0);
    }

    const model = deps.getModel(task);
    const text = prompt.value;
    const bytes = utf8Bytes(text);
    const causes: string[] = [];
    const maxAttempts = deps.maxRetries + 1;
    const backoff = deps.backoffMs ?? config.cloudBackoffMs;
    const maxWait = deps.maxWaitMs ?? config.cloudMaxWaitMs;
    const sleep = deps.sleep ?? defaultSleep;
    let last: CloudFailure = { kind: 'network' };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let inferenceSource: string | undefined;
      try {
        const result = await model.generateContent(text);
        inferenceSource = result.response.inferenceSource;
        const raw = result.response.text();
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          throw new BadReplyError(`Malformed JSON from the cloud: ${raw.slice(0, 120)}`);
        }
        const parsed = zodSchema.safeParse(json);
        if (!parsed.success) {
          throw new BadReplyError(
            `Cloud reply did not match the expected shape: ${parsed.error.message}`,
          );
        }
        egressLog.record({
          kind: 'cloud-call',
          label: task.name,
          model: config.cloudModels[task.name],
          attempt,
          bytesSent: bytes,
          text,
          origins: prompt.origins,
          status: 'ok',
          inferenceSource,
        });
        return { data: parsed.data, inferenceSource, attempts: attempt };
      } catch (e) {
        const message = describe(e);
        causes.push(message);
        egressLog.record({
          kind: 'cloud-call',
          label: task.name,
          model: config.cloudModels[task.name],
          attempt,
          bytesSent: bytes,
          text,
          origins: prompt.origins,
          status: 'error',
          error: message,
          inferenceSource,
        });
        last = classifyCloudFailure(e);
        if (last.kind === 'refused') {
          throw new CloudError(`${last.reason} ${message}`, 'REFUSED', attempt, causes);
        }
        if (last.kind === 'network' && !deps.isOnline()) {
          throw new CloudError(
            'No signal. The cloud cannot be reached.',
            'OFFLINE',
            attempt,
            causes,
          );
        }
        if (attempt === maxAttempts) break;
        if (last.kind === 'quota' || last.kind === 'server') {
          const wait =
            last.kind === 'quota' && last.retryAfterMs !== undefined
              ? last.retryAfterMs
              : (backoff[attempt - 1] ?? backoff.at(-1) ?? 0);
          if (wait > maxWait) break;
          await sleep(wait);
          if (!deps.isOnline()) {
            throw new CloudError(
              'No signal. The cloud cannot be reached.',
              'OFFLINE',
              attempt,
              causes,
            );
          }
        }
      }
    }
    if (last.kind === 'quota') {
      throw new CloudError(
        "The cloud's usage limit was reached. Try again in a few minutes.",
        'QUOTA',
        causes.length,
        causes,
      );
    }
    throw new CloudError(
      `Cloud task ${task.name} failed after ${causes.length} attempts: ${causes.at(-1) ?? 'unknown error'}`,
      'FAILED',
      causes.length,
      causes,
    );
  };
}

const modelCache = new Map<CloudTaskName, CloudModelLike>();

function firebaseCloudModel(task: CloudTask): CloudModelLike {
  const cached = modelCache.get(task.name);
  if (cached) return cached;
  const fb = getFirebase();
  if (!fb.ok) throw new CloudError(fb.reason, 'NOT_CONFIGURED', 0);
  const model = getGenerativeModel(
    fb.ai,
    {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: config.cloudModels[task.name],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: task.responseSchema,
        },
      },
    },
    task.timeoutMs ? { timeout: task.timeoutMs } : undefined,
  );
  modelCache.set(task.name, model);
  return model;
}

/**
 * Default client: real Firebase AI Logic. Refuses while the browser is offline
 * or 'Simulated no signal' is on (see src/queue/connectivity.ts).
 */
export const cloudJson = createCloudClient({
  getModel: firebaseCloudModel,
  isOnline: () => connectivity.online(),
  maxRetries: config.cloudMaxRetries,
});
