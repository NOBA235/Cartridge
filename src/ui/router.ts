/** Tiny pathname router: no dependency, works with the browser's back button. */
import { useMemo, useSyncExternalStore, type MouseEvent } from 'react';

export type AppPath =
  | '/'
  | '/load'
  | '/cartridge'
  | '/versions'
  | '/exam'
  | '/ask'
  | '/report'
  | '/connections'
  | '/blueprint'
  | '/dev';

const KNOWN: readonly AppPath[] = [
  '/',
  '/load',
  '/cartridge',
  '/versions',
  '/exam',
  '/ask',
  '/report',
  '/connections',
  '/blueprint',
  '/dev',
];

function toPath(pathname: string): AppPath {
  const p = pathname.replace(/\/+$/, '') || '/';
  return (KNOWN as readonly string[]).includes(p) ? (p as AppPath) : '/';
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', cb);
  };
}

export function href(path: AppPath, params?: Record<string, string>): string {
  const q = params ? new URLSearchParams(params).toString() : '';
  return q ? `${path}?${q}` : path;
}

export function navigate(path: AppPath, params?: Record<string, string>): void {
  const target = href(path, params);
  if (target === snapshot()) return;
  window.history.pushState(null, '', target);
  for (const l of [...listeners]) l();
  window.scrollTo(0, 0);
}

export function useLocation(): { path: AppPath; params: URLSearchParams } {
  const snap = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    const url = new URL(snap, 'http://local');
    return { path: toPath(url.pathname), params: url.searchParams };
  }, [snap]);
}

export function usePath(): AppPath {
  return useLocation().path;
}

/** onClick for <a href> links: client-side navigation, but new tabs still work. */
export function linkHandler(path: AppPath, params?: Record<string, string>) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    navigate(path, params);
  };
}
