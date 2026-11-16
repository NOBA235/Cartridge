/** Gemini Nano readiness for the current cartridge, with 'Prepare this device'. */
import { useEffect, useSyncExternalStore } from 'react';
import { deviceSessions, sessionKey, type DeviceState } from '@/ai/deviceSessions';
import type { Cartridge } from '@/cartridge/types';
import { Button } from '@/ui/primitives/button';

export function useDeviceState(c: Cartridge): DeviceState {
  const all = useSyncExternalStore(deviceSessions.subscribe, deviceSessions.get);
  return all[sessionKey(c)] ?? { state: 'idle' };
}

export function DevicePanel({ cartridge }: { cartridge: Cartridge }) {
  const s = useDeviceState(cartridge);

  useEffect(() => {
    deviceSessions.autoPrepare(cartridge);
  }, [cartridge]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4" aria-live="polite">
      {s.state === 'ready' && (
        <p className="text-sm font-medium text-success">Gemini Nano is ready on this device.</p>
      )}
      {s.state === 'idle' && (
        <p className="text-sm">
          Gemini Nano is not prepared on this device yet. Until it is, questions go to the cloud
          (after you approve).
        </p>
      )}
      {s.state === 'preparing' && (
        <>
          <p className="text-sm">
            Preparing Gemini Nano on this device… The first download can take several minutes.
          </p>
          <progress
            className="h-2 w-full accent-primary"
            value={s.progress}
            max={1}
            aria-label="Download progress"
          />
          <p className="text-xs text-muted-foreground">{Math.round(s.progress * 100)}%</p>
        </>
      )}
      {s.state === 'unavailable' && (
        <p className="text-sm text-warning">
          Gemini Nano is not available: {s.reason} Questions go to the cloud (after you approve).
        </p>
      )}
      {(s.state === 'idle' || s.state === 'unavailable') && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => void deviceSessions.prepare(cartridge)}
        >
          {s.state === 'idle' ? 'Prepare this device' : 'Try again'}
        </Button>
      )}
    </div>
  );
}
