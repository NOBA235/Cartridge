/**
 * FirebaseDeviceModel: Gemini Nano in Chrome, through Firebase AI Logic only.
 *
 * One instance per cartridge version: the response schema (an enum of every
 * rule ID plus NONE) is fixed when the GenerativeModel is created.
 *
 * Privacy guards (see docs/STATUS.md, "On-device fallback finding"):
 * In @firebase/ai 13.3.0, if the browser has no Prompt API, getGenerativeModel()
 * creates no on-device adapter, initializeDeviceModel() resolves without error,
 * and generateContent() in ONLY_ON_DEVICE mode sends the request to the CLOUD.
 * So we:
 * 1. check that the SDK created an on-device adapter before marking the model
 *    ready (reads the SDK's private `chromeAdapter` field; if the SDK renames
 *    it, this check fails closed and reports the device as unavailable);
 * 2. point the model's cloud baseUrl at a reserved '.invalid' host, so any
 *    accidental cloud fallback cannot reach a server;
 * 3. reject any response whose inferenceSource is not on_device, and log it.
 */
import { getGenerativeModel, InferenceMode, InferenceSource } from 'firebase/ai';
import { z } from 'zod';
import { NONE } from '@/cartridge/types';
import { config } from '@/config';
import { reveal } from '@/privacy';
import { egressLog, utf8Bytes } from '@/telemetry/egress';
import {
  DeviceError,
  type DeviceModel,
  type DeviceSelection,
  type DeviceStatus,
  type SelectRuleInput,
} from './deviceModel';
import { getFirebase } from './firebase';
import { buildDeviceSelectPrompt, DEVICE_SELECT_SYSTEM } from './prompts';

/** RFC 2606 reserved TLD: never resolves. */
export const DEVICE_ONLY_BASE_URL = 'https://on-device-only.invalid';

/** The part of GenerativeModel we use. Lets tests inject a fake. */
export interface DeviceModelLike {
  initializeDeviceModel(onDownloadProgress?: (progress: number) => void): Promise<void>;
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: string };
  }>;
}

export interface DeviceModelParams {
  responseConstraint: object;
  systemPrompt: string;
  languages: string[];
}

export type DeviceModelFactory = (params: DeviceModelParams) => DeviceModelLike;

/**
 * Plain JSON schema for the on-device responseConstraint (the docs allow either
 * Schema helpers or plain JSON schema; Schema.toJSON() is internal to the SDK,
 * so we write the plain form).
 */
export function buildSelectSchema(ruleIds: readonly string[]) {
  return {
    type: 'object',
    properties: {
      ruleId: { type: 'string', enum: [...ruleIds, NONE] },
      quantity: { type: 'number' },
    },
    required: ['ruleId', 'quantity'],
  } as const;
}

/** True if the SDK built an on-device adapter for this model. Fails closed. */
export function hasOnDeviceAdapter(model: DeviceModelLike): boolean {
  const adapter = (model as unknown as { chromeAdapter?: unknown }).chromeAdapter;
  return adapter !== undefined && adapter !== null;
}

const firebaseFactory: DeviceModelFactory = (params) => {
  const fb = getFirebase();
  if (!fb.ok) throw new DeviceError(fb.reason, 'UNAVAILABLE');
  return getGenerativeModel(
    fb.ai,
    {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: 'text', languages: params.languages }],
          expectedOutputs: [{ type: 'text', languages: params.languages }],
          initialPrompts: [
            { role: 'system', content: [{ type: 'text', value: params.systemPrompt }] },
          ],
        },
        promptOptions: { responseConstraint: params.responseConstraint },
      },
    },
    { baseUrl: DEVICE_ONLY_BASE_URL },
  );
};

export class FirebaseDeviceModel implements DeviceModel {
  readonly kind = 'firebase' as const;
  private model: DeviceModelLike | undefined;
  private ready = false;
  private readonly ruleIds: readonly string[];
  private readonly factory: DeviceModelFactory;
  private readonly outputSchema: z.ZodType<{ ruleId: string; quantity: number }>;

  constructor(ruleIds: readonly string[], factory: DeviceModelFactory = firebaseFactory) {
    if (ruleIds.length === 0) throw new Error('FirebaseDeviceModel needs at least one rule ID');
    this.ruleIds = ruleIds;
    this.factory = factory;
    const [first, ...rest] = [...ruleIds, NONE];
    this.outputSchema = z.object({
      ruleId: z.enum([first as string, ...rest]),
      quantity: z.number(),
    });
  }

  async prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus> {
    try {
      this.model ??= this.factory({
        responseConstraint: buildSelectSchema(this.ruleIds),
        systemPrompt: DEVICE_SELECT_SYSTEM,
        languages: [...config.deviceLanguages],
      });
      if (!hasOnDeviceAdapter(this.model)) {
        return {
          state: 'unavailable',
          kind: this.kind,
          reason:
            'This browser has no on-device model. It needs desktop Chrome 139 or newer with Gemini Nano enabled.',
        };
      }
      await this.model.initializeDeviceModel((p) => onProgress(Math.max(0, Math.min(1, p))));
      this.ready = true;
      onProgress(1);
      return { state: 'ready', kind: this.kind };
    } catch (e) {
      this.ready = false;
      return { state: 'unavailable', kind: this.kind, reason: (e as Error).message };
    }
  }

  async selectRule({ question, candidates }: SelectRuleInput): Promise<DeviceSelection> {
    if (!this.model || !this.ready) {
      throw new DeviceError('Prepare this device first.', 'NOT_PREPARED');
    }
    const prompt = buildDeviceSelectPrompt(reveal(question), candidates);
    if (prompt.length > config.deviceMaxPromptChars) {
      throw new DeviceError(
        `Device prompt is ${prompt.length} characters, over the ${config.deviceMaxPromptChars} limit.`,
        'PROMPT_TOO_LONG',
      );
    }

    let result: Awaited<ReturnType<DeviceModelLike['generateContent']>>;
    try {
      result = await this.model.generateContent(prompt);
    } catch (e) {
      throw new DeviceError((e as Error).message, 'FAILED');
    }

    if (result.response.inferenceSource !== InferenceSource.ON_DEVICE) {
      egressLog.record({
        kind: 'unexpected-cloud',
        label: 'Device model reported a non-device route',
        bytesSent: utf8Bytes(prompt),
        text: prompt,
        origins: [],
        status: 'error',
        inferenceSource: result.response.inferenceSource ?? 'unknown',
      });
      throw new DeviceError(
        `Expected on-device inference, got ${result.response.inferenceSource ?? 'unknown'}.`,
        'RAN_IN_CLOUD',
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(result.response.text());
    } catch {
      throw new DeviceError('Device model returned malformed JSON.', 'BAD_OUTPUT');
    }
    const parsed = this.outputSchema.safeParse(json);
    if (!parsed.success) {
      throw new DeviceError(
        `Device output failed validation: ${parsed.error.message}`,
        'BAD_OUTPUT',
      );
    }
    return { ...parsed.data, source: 'ON_DEVICE' };
  }
}
