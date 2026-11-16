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
 *   network errors, malformed JSON or validation failures.
 */
import { getGenerativeModel, InferenceMode, type ObjectSchema } from 'firebase/ai';
import type { z } from 'zod';
import { config, type CloudTaskName } from '@/config';
import { assertPublic, type Public } from '@/privacy';
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
}

export interface CloudResult<T> {
  data: T;
  inferenceSource: string | undefined;
  attempts: number;
}

export type CloudErrorCode = 'NOT_CONFIGURED' | 'OFFLINE' | 'FAILED';

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
          throw new Error(`Malformed JSON from the cloud: ${raw.slice(0, 120)}`);
        }
        const parsed = zodSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error(`Cloud reply did not match the expected shape: ${parsed.error.message}`);
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
      }
    }
    throw new CloudError(
      `Cloud task ${task.name} failed after ${maxAttempts} attempts: ${causes.at(-1) ?? 'unknown error'}`,
      'FAILED',
      maxAttempts,
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

/** Default client: real Firebase AI Logic, browser online state. */
export const cloudJson = createCloudClient({
  getModel: firebaseCloudModel,
  // Node 21+ has a navigator without onLine; treat only an explicit false as offline.
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  maxRetries: config.cloudMaxRetries,
});
