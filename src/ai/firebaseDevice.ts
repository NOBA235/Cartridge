/**
 * FirebaseDeviceModel: Gemini Nano in Chrome, through Firebase AI Logic only.
 *
 * Uses a small fixed candidate-slot schema (C1..C5 plus NONE), so one shared
 * model instance works across every cartridge and version without rebuilding
 * grammar constraints for up to 120 rule IDs.
 *
 * Privacy guards (see README, "On-device fallback guard"):
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
import { NONE, type Rule } from '@/cartridge/types';
import { config } from '@/config';
import { reveal } from '@/privacy';
import { egressLog, utf8Bytes } from '@/telemetry/egress';
import {
  DeviceError,
  type DeviceEdgeFacts,
  type DeviceModel,
  type DeviceSelection,
  type DeviceStatus,
  type EdgeDeviceModel,
  type EdgeFactsInput,
  type SelectRuleInput,
} from './deviceModel';
import { getFirebase } from './firebase';
import {
  buildDeviceEdgePrompt,
  buildDeviceSelectPrompt,
  CANDIDATE_SLOTS,
  DEVICE_EDGE_SYSTEM,
  DEVICE_SELECT_SYSTEM,
} from './prompts';

/** RFC 2606 reserved TLD: never resolves. */
export const DEVICE_ONLY_BASE_URL = 'https://on-device-only.invalid';

const CHOICE_ENUM = [...CANDIDATE_SLOTS, NONE] as const;
type SlotChoice = (typeof CHOICE_ENUM)[number];

const SelectOutputSchema = z.object({
  choice: z.enum(CHOICE_ENUM),
  quantity: z.number(),
});

const EdgeOutputSchema = z.object({
  choice: z.enum(CHOICE_ENUM),
  triggersWhenCondition: z.boolean(),
  matchesException: z.boolean(),
  matchedExceptionIndex: z.number().int(),
  outOfScope: z.boolean(),
});

/** The part of GenerativeModel we use. Lets tests inject a fake. */
export interface DeviceModelLike {
  initializeDeviceModel(onDownloadProgress?: (progress: number) => void): Promise<void>;
  generateContent(prompt: string): Promise<{
    response: { text(): string; inferenceSource?: string };
  }>;
}

export interface DeviceModelParams {
  /** Omitted only by prepareThisDevice(), which never prompts. */
  responseConstraint?: object;
  systemPrompt: string;
  languages: string[];
}

export type DeviceModelFactory = (params: DeviceModelParams) => DeviceModelLike;

/**
 * Plain JSON schema for on-device rule selection. Fixed at 5 candidate slots
 * (C1..C5) plus NONE, regardless of how many rules the cartridge has.
 */
export function buildSelectSchema() {
  return {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: [...CHOICE_ENUM] },
      quantity: { type: 'number' },
    },
    required: ['choice', 'quantity'],
  } as const;
}

/** Resolves a slot choice ('C1'..'C5' or 'NONE') back to the candidate rule, or rejects out-of-range slots. */
function resolveSlot(choice: SlotChoice, candidates: readonly Rule[]): Rule | null {
  if (choice === NONE) return null;
  const idx = CANDIDATE_SLOTS.indexOf(choice);
  const rule = candidates[idx];
  if (!rule) {
    throw new DeviceError(
      `Device model chose ${choice}, but only ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} were shown.`,
      'BAD_OUTPUT',
    );
  }
  return rule;
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
        ...(params.responseConstraint
          ? { promptOptions: { responseConstraint: params.responseConstraint } }
          : {}),
      },
    },
    { baseUrl: DEVICE_ONLY_BASE_URL },
  );
};

const UNAVAILABLE_REASON =
  'This browser has no on-device model. It needs desktop Chrome 139 or newer with Gemini Nano enabled.';

/** Shared by FirebaseDeviceModel.prepare() and prepareThisDevice(). */
async function initialise(
  model: DeviceModelLike,
  onProgress: (fraction: number) => void,
): Promise<DeviceStatus> {
  if (!hasOnDeviceAdapter(model)) {
    return { state: 'unavailable', kind: 'firebase', reason: UNAVAILABLE_REASON, permanent: true };
  }
  await model.initializeDeviceModel((p) => onProgress(Math.max(0, Math.min(1, p))));
  onProgress(1);
  return { state: 'ready', kind: 'firebase' };
}

/**
 * 'Prepare this device': downloads Gemini Nano if needed and reports progress.
 * The download belongs to the browser, not to a cartridge, so this works before
 * any rulebook is loaded. Must be called from a user gesture.
 */
export async function prepareThisDevice(
  onProgress: (fraction: number) => void,
  factory: DeviceModelFactory = firebaseFactory,
): Promise<DeviceStatus> {
  try {
    const model = factory({
      systemPrompt: DEVICE_SELECT_SYSTEM,
      languages: [...config.deviceLanguages],
    });
    return await initialise(model, onProgress);
  } catch (e) {
    return unavailableFrom(e, 'firebase');
  }
}

/**
 * The SDK throws AIError 'api-not-enabled' when Chrome reports the model
 * 'unavailable' (this device cannot run it). Anything else, such as a failed
 * download, may work on another try.
 */
function unavailableFrom(e: unknown, kind: DeviceModel['kind']): DeviceStatus {
  const reason = e instanceof Error ? e.message : String(e);
  const permanent = (e as { code?: unknown } | null)?.code === 'api-not-enabled';
  return permanent
    ? { state: 'unavailable', kind, reason: `${UNAVAILABLE_REASON} (${reason})`, permanent }
    : { state: 'unavailable', kind, reason };
}

/**
 * Sends one prompt to Gemini Nano and returns the parsed JSON. Rejects (and
 * logs as unexpected) any reply that did not come from the device.
 */
async function promptOnDevice(model: DeviceModelLike, prompt: string): Promise<unknown> {
  let result: Awaited<ReturnType<DeviceModelLike['generateContent']>>;
  try {
    result = await model.generateContent(prompt);
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

  try {
    return JSON.parse(result.response.text());
  } catch {
    throw new DeviceError('Device model returned malformed JSON.', 'BAD_OUTPUT');
  }
}

/**
 * Plain JSON schema for edge facts. Uses fixed candidate slots (C1..C5 + NONE)
 * and a 0-based integer exception index (-1 when no exception applies) so the
 * on-device model never has to copy exception prose verbatim.
 */
export function buildEdgeSchema() {
  return {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: [...CHOICE_ENUM] },
      triggersWhenCondition: { type: 'boolean' },
      matchesException: { type: 'boolean' },
      matchedExceptionIndex: { type: 'integer' },
      outOfScope: { type: 'boolean' },
    },
    required: [
      'choice',
      'triggersWhenCondition',
      'matchesException',
      'matchedExceptionIndex',
      'outOfScope',
    ],
  } as const;
}

/** Gemini Nano for connections, with the same guards as FirebaseDeviceModel. Shared across cartridges. */
export class FirebaseEdgeModel implements EdgeDeviceModel {
  readonly kind = 'firebase' as const;
  private model: DeviceModelLike | undefined;
  private ready = false;
  private readonly factory: DeviceModelFactory;

  constructor(factory: DeviceModelFactory = firebaseFactory) {
    this.factory = factory;
  }

  async prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus> {
    try {
      this.model ??= this.factory({
        responseConstraint: buildEdgeSchema(),
        systemPrompt: DEVICE_EDGE_SYSTEM,
        languages: [...config.deviceLanguages],
      });
      const status = await initialise(this.model, onProgress);
      this.ready = status.state === 'ready';
      return status;
    } catch (e) {
      this.ready = false;
      return unavailableFrom(e, this.kind);
    }
  }

  async reportFacts({ edge, candidates }: EdgeFactsInput): Promise<DeviceEdgeFacts> {
    if (!this.model || !this.ready) {
      throw new DeviceError('Prepare this device first.', 'NOT_PREPARED');
    }
    if (candidates.length > CANDIDATE_SLOTS.length) {
      throw new DeviceError(
        `Too many candidate rules for the device (${candidates.length}, max ${CANDIDATE_SLOTS.length}).`,
        'PROMPT_TOO_LONG',
      );
    }
    const prompt = buildDeviceEdgePrompt(reveal(edge), candidates);
    if (prompt.length > config.deviceMaxPromptChars) {
      throw new DeviceError(
        `Device prompt is ${prompt.length} characters, over the ${config.deviceMaxPromptChars} limit.`,
        'PROMPT_TOO_LONG',
      );
    }
    const parsed = EdgeOutputSchema.safeParse(await promptOnDevice(this.model, prompt));
    if (!parsed.success) {
      throw new DeviceError(
        `Device output failed validation: ${parsed.error.message}`,
        'BAD_OUTPUT',
      );
    }
    const f = parsed.data;
    const matched = resolveSlot(f.choice, candidates);
    return {
      matchedRuleId: matched ? matched.id : null,
      triggersWhenCondition: f.triggersWhenCondition,
      matchesException: f.matchesException,
      matchedExceptionIndex: f.matchedExceptionIndex >= 0 ? f.matchedExceptionIndex : null,
      outOfScope: f.outOfScope,
      source: 'ON_DEVICE',
    };
  }
}

export class FirebaseDeviceModel implements DeviceModel {
  readonly kind = 'firebase' as const;
  private model: DeviceModelLike | undefined;
  private ready = false;
  private readonly factory: DeviceModelFactory;

  constructor(factory: DeviceModelFactory = firebaseFactory) {
    this.factory = factory;
  }

  async prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus> {
    try {
      this.model ??= this.factory({
        responseConstraint: buildSelectSchema(),
        systemPrompt: DEVICE_SELECT_SYSTEM,
        languages: [...config.deviceLanguages],
      });
      const status = await initialise(this.model, onProgress);
      this.ready = status.state === 'ready';
      return status;
    } catch (e) {
      this.ready = false;
      return unavailableFrom(e, this.kind);
    }
  }

  async selectRule({ question, candidates }: SelectRuleInput): Promise<DeviceSelection> {
    if (!this.model || !this.ready) {
      throw new DeviceError('Prepare this device first.', 'NOT_PREPARED');
    }
    if (candidates.length > CANDIDATE_SLOTS.length) {
      throw new DeviceError(
        `Too many candidate rules for the device (${candidates.length}, max ${CANDIDATE_SLOTS.length}).`,
        'PROMPT_TOO_LONG',
      );
    }
    const prompt = buildDeviceSelectPrompt(reveal(question), candidates);
    if (prompt.length > config.deviceMaxPromptChars) {
      throw new DeviceError(
        `Device prompt is ${prompt.length} characters, over the ${config.deviceMaxPromptChars} limit.`,
        'PROMPT_TOO_LONG',
      );
    }

    const json = await promptOnDevice(this.model, prompt);
    const parsed = SelectOutputSchema.safeParse(json);
    if (!parsed.success) {
      throw new DeviceError(
        `Device output failed validation: ${parsed.error.message}`,
        'BAD_OUTPUT',
      );
    }
    const matched = resolveSlot(parsed.data.choice, candidates);
    return {
      ruleId: matched ? matched.id : NONE,
      quantity: parsed.data.quantity,
      source: 'ON_DEVICE',
    };
  }
}
