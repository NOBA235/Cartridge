/**
 * Egress log: every byte that leaves this device through our code is recorded
 * here, and shown in the 'What left this device' panel.
 *
 * Entry kinds:
 * - 'cloud-call': one attempt to call the cloud model. bytesSent is the UTF-8
 *   size of the prompt. Failed attempts are still counted, because the request
 *   may have reached the network before it failed.
 * - 'declassify': the user approved sending a piece of their own material.
 *   Nothing is sent by this step alone, so bytesSent is 0.
 * - 'unexpected-cloud': a call made for the on-device model reported that it
 *   ran in the cloud. This should never happen; it is logged so it is visible.
 *
 * Phase 0 keeps the log in memory. Phase 1 persists it to IndexedDB.
 */
import { createStore } from '@/lib/store';
import type { DeclassifyScope, PublicOrigin } from '@/privacy';

export type EgressKind = 'cloud-call' | 'declassify' | 'unexpected-cloud';
export type EgressStatus = 'ok' | 'error';

export interface EgressEntry {
  readonly id: number;
  readonly at: string;
  readonly kind: EgressKind;
  /** Cloud task name, or what the approval was for. */
  readonly label: string;
  readonly model?: string;
  readonly attempt?: number;
  readonly bytesSent: number;
  /** Exactly what was sent (prompts) or approved (declassify), truncated for display. */
  readonly preview: string;
  readonly origins: readonly PublicOrigin[];
  readonly scope?: DeclassifyScope;
  readonly status: EgressStatus;
  readonly error?: string;
  readonly inferenceSource?: string;
}

export type NewEgressEntry = Omit<EgressEntry, 'id' | 'at' | 'preview'> & { text: string };

export const PREVIEW_LIMIT = 2000;

const encoder = new TextEncoder();
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

const store = createStore<readonly EgressEntry[]>([]);
let nextId = 1;

export const egressLog = {
  subscribe: store.subscribe,
  entries: (): readonly EgressEntry[] => store.get(),
  record(entry: NewEgressEntry): EgressEntry {
    const { text, ...rest } = entry;
    const full: EgressEntry = Object.freeze({
      ...rest,
      id: nextId++,
      at: new Date().toISOString(),
      preview: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}…` : text,
    });
    store.set((prev) => [...prev, full]);
    return full;
  },
  totalBytesSent(): number {
    return store.get().reduce((sum, e) => sum + e.bytesSent, 0);
  },
  /** Bytes sent whose content included material declassified from the given scope. */
  bytesSentFromScope(scope: DeclassifyScope): number {
    const tag: PublicOrigin = `declassified:${scope}`;
    return store
      .get()
      .filter((e) => e.kind !== 'declassify' && e.origins.includes(tag))
      .reduce((sum, e) => sum + e.bytesSent, 0);
  },
  /** Test helper. */
  _reset(): void {
    nextId = 1;
    store.set([]);
  },
};
