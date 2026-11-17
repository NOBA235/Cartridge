import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadAskContext, type LoadedCartridge } from '@/cartridge/askSession';
import {
  cartridgesStore,
  dataChanges,
  sourcesStore,
  type CartridgeRecord,
} from '@/cartridge/store';
import type { Cartridge } from '@/cartridge/types';

/** Bumps whenever a rulebook or cartridge is saved or deleted on this device. */
export function useDataVersion(): number {
  return useSyncExternalStore(dataChanges.subscribe, dataChanges.get);
}

/** Cartridges on this device, newest first. Reloads after every change, and when `refresh` changes. */
export function useCartridges(refresh: unknown = 0) {
  const data = useDataVersion();
  const [records, setRecords] = useState<CartridgeRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    cartridgesStore.list().then(
      (l) => {
        if (!live) return;
        setRecords(l);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setRecords([]);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [refresh, data]);
  return { records, error };
}

/** The current version of a cartridge with its rulebook. Reloads after every change. */
export function useLoadedCartridge(
  id: string | null,
  refresh: unknown = 0,
): LoadedCartridge | null | 'missing' {
  const data = useDataVersion();
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
  }, [id, refresh, data]);
  return loaded;
}

/** The current version of a cartridge, without its rulebook (light). */
export function useCurrentCartridge(id: string | null): Cartridge | null {
  const data = useDataVersion();
  const [cartridge, setCartridge] = useState<Cartridge | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    cartridgesStore.current(id).then(
      (cur) => live && setCartridge(cur?.cartridge ?? null),
      () => live && setCartridge(null),
    );
    return () => {
      live = false;
    };
  }, [id, data]);
  return cartridge && cartridge.id === id ? cartridge : null;
}

/** How many rulebooks are saved on this device (null while loading). */
export function useSourceCount(): number | null {
  const data = useDataVersion();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    sourcesStore.list().then(
      (l) => live && setCount(l.length),
      () => live && setCount(0),
    );
    return () => {
      live = false;
    };
  }, [data]);
  return count;
}
