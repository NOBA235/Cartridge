import { useId, useSyncExternalStore } from 'react';
import { connectivity } from '@/queue/connectivity';
import { Switch } from '@/ui/primitives/switch';

export function useConnectivity() {
  return useSyncExternalStore(connectivity.subscribe, connectivity.get);
}

/** 'No signal' switch. It blocks every cloud call, and says honestly that it is simulated. */
export function NoSignalSwitch() {
  const id = useId();
  const c = useConnectivity();
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4">
      <Switch
        id={id}
        checked={c.simulatedOffline}
        onCheckedChange={(v) => connectivity.setSimulatedOffline(v)}
        className="data-[size=default]:h-6 data-[size=default]:w-11 [&>span]:group-data-[size=default]/switch:size-5"
      />
      <div>
        <label htmlFor={id} className="flex items-center gap-2 text-base font-medium">
          No signal
          <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs text-warning">
            Simulated
          </span>
        </label>
        <p className="text-xs text-muted-foreground">
          {c.simulatedOffline
            ? 'The cloud is blocked. Answers come from this device only; other questions wait for signal.'
            : c.browserOnline
              ? 'Switch on to see how Cartridge works without a signal.'
              : 'This device is offline.'}
        </p>
      </div>
    </div>
  );
}
