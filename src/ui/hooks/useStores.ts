import { useSyncExternalStore } from 'react';
import { settings, type Settings } from '@/settings';
import { egressLog, type EgressEntry } from '@/telemetry/egress';

export function useEgressLog(): readonly EgressEntry[] {
  return useSyncExternalStore(egressLog.subscribe, egressLog.entries);
}

export function useSettings(): Settings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}
