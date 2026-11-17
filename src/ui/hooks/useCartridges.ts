import { useEffect, useState } from 'react';
import { loadAskContext, type LoadedCartridge } from '@/cartridge/askSession';
import { cartridgesStore, type CartridgeRecord } from '@/cartridge/store';

/** Cartridges on this device, newest first. Reloads when `refresh` changes. */
export function useCartridges(refresh: unknown = 0) {
  const [records, setRecords] = useState<CartridgeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cartridgesStore.list().then(
      (l) => live && setRecords(l),
      (e: unknown) => {
        if (!live) return;
        setRecords([]);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [refresh]);
  return { records, error };
}

/** The current version of a cartridge with its rulebook. Reloads when `refresh` changes. */
export function useLoadedCartridge(
  id: string | null,
  refresh: unknown = 0,
): LoadedCartridge | null | 'missing' {
  const [loaded, setLoaded] = useState<LoadedCartridge | null | 'missing'>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadAskContext(id).then(
      (l) => live && setLoaded(l ?? 'missing'),
      () => live && setLoaded('missing'),
    );
    return () => {
      live = false;
    };
  }, [id, refresh]);
  return loaded;
}
