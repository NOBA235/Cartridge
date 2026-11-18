/**
 * The device model only selects which rule answers a question. Code writes the
 * answer from the rule.
 * - FirebaseDeviceModel (./firebaseDevice.ts): Gemini Nano through Firebase AI
 *   Logic. The only implementation the app uses.
 * - src/testing/mockDevice.ts: a stand-in for automated tests only. Every result
 *   it produces carries source 'mock'.
 */
import type { Rule } from '@/cartridge/types';
import type { Classified } from '@/privacy';

/** 'ON_DEVICE' = Gemini Nano reported inferenceSource on_device. 'mock' = MockDeviceModel. */
export type DeviceSource = 'ON_DEVICE' | 'mock';

export interface DeviceSelection {
  /** One of the rule IDs in the cartridge, or 'NONE'. Validators check it is a candidate. */
  ruleId: string;
  /** Quantity extracted from the question, or -1. */
  quantity: number;
  source: DeviceSource;
}

export type DeviceStatus =
  | { state: 'ready'; kind: DeviceModel['kind'] }
  | {
      state: 'unavailable';
      kind: DeviceModel['kind'];
      reason: string;
      /** True when trying again cannot help (no on-device model in this browser or on this hardware). */
      permanent?: boolean;
    };

export interface SelectRuleInput {
  /** The user's question (Private) or an exam question (Public). Never leaves the device here. */
  question: Classified<string>;
  candidates: readonly Rule[];
}

export interface DeviceModel {
  readonly kind: 'firebase' | 'mock';
  /** Must be called from a user gesture. Reports download progress between 0 and 1. */
  prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus>;
  selectRule(input: SelectRuleInput): Promise<DeviceSelection>;
}

export interface EdgeFactsInput {
  /** One connection as plain text. Diagram labels are Private; it never leaves the device here. */
  edge: Classified<string>;
  candidates: readonly Rule[];
}

/** Facts about one connection, as reported by the device. matchedRuleId is null for none. */
export interface DeviceEdgeFacts {
  matchedRuleId: string | null;
  triggersWhenCondition: boolean;
  matchesException: boolean;
  matchedExceptionText: string | null;
  outOfScope: boolean;
  source: DeviceSource;
}

/** The device model for connections: reports facts, never a verdict. */
export interface EdgeDeviceModel {
  readonly kind: 'firebase' | 'mock';
  prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus>;
  reportFacts(input: EdgeFactsInput): Promise<DeviceEdgeFacts>;
}

export type DeviceErrorCode =
  'UNAVAILABLE' | 'NOT_PREPARED' | 'BAD_OUTPUT' | 'PROMPT_TOO_LONG' | 'RAN_IN_CLOUD' | 'FAILED';

export class DeviceError extends Error {
  override readonly name = 'DeviceError';
  readonly code: DeviceErrorCode;
  constructor(message: string, code: DeviceErrorCode) {
    super(message);
    this.code = code;
  }
}
