/**
 * One connection model (Gemini Nano with the edge schema) per cartridge
 * version. It is prepared only after this device's Gemini Nano is ready for
 * that version (see deviceSessions), so it never starts a download itself.
 */
import { createEdgeModel } from '@/ai/device';
import type { EdgeDeviceModel } from '@/ai/deviceModel';
import { deviceSessions, sessionKey } from '@/ai/deviceSessions';
import type { Cartridge } from '@/cartridge/types';

const models = new Map<string, Promise<EdgeDeviceModel | undefined>>();

/** The ready connection model for this version, or undefined if Gemini Nano is not ready. */
export function edgeModelFor(c: Cartridge): Promise<EdgeDeviceModel | undefined> {
  if (deviceSessions.state(c).state !== 'ready') return Promise.resolve(undefined);
  const key = sessionKey(c);
  let p = models.get(key);
  if (!p) {
    const model = createEdgeModel(c.rules.map((r) => r.id));
    p = model.prepare(() => {}).then((s) => (s.state === 'ready' ? model : undefined));
    // Try again next time if it did not work.
    void p.then((m) => {
      if (!m) models.delete(key);
    });
    models.set(key, p);
  }
  return p;
}
