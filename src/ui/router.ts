/** Tiny pathname router: no dependency, works with the browser's back button. */
import { useSyncExternalStore, type MouseEvent } from 'react';

export type AppPath = '/' | '/load' | '/dev';

const KNOWN: readonly AppPath[] = ['/', '/load', '/dev'];

function current(): AppPath {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  return (KNOWN as readonly string[]).includes(p) ? (p as AppPath) : '/';
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

export function navigate(path: AppPath): void {
  if (path === current()) return;
  window.history.pushState(null, '', path);
  for (const l of [...listeners]) l();
  window.scrollTo(0, 0);
}

export function usePath(): AppPath {
  return useSyncExternalStore(subscribe, current);
}

/** onClick for <a href> links: client-side navigation, but new tabs still work. */
export function linkHandler(path: AppPath) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    e.preventDefault();
    navigate(path);
  };
}
