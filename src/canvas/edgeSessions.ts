/**
 * One shared connection model (Gemini Nano with the fixed C1..C5 edge schema)
 * for the whole app. It is prepared only after this device's Gemini Nano is
 * ready (see deviceSessions), so it never starts a download itself.
 */
import { createEdgeModel } from '@/ai/device';
import type { EdgeDeviceModel } from '@/ai/deviceModel';
import { deviceSessions } from '@/ai/deviceSessions';

let pending: Promise<EdgeDeviceModel | undefined> | undefined;

/** The ready connection model, or undefined if Gemini Nano is not ready. */
export function edgeModelFor(): Promise<EdgeDeviceModel | undefined> {
  if (deviceSessions.state().state !== 'ready') return Promise.resolve(undefined);
  if (!pending) {
    const model = createEdgeModel();
    pending = model.prepare(() => {}).then((s) => (s.state === 'ready' ? model : undefined));
    // Try again next time if it did not work.
    void pending.then((m) => {
      if (!m) pending = undefined;
    });
  }
  return pending;
}
