/**
 * Two-state header color-scheme toggle backed by src/theme.ts.
 * Switches between light and dark mode without fighting the OS preference:
 * toggling back to the current OS scheme clears the stored override so the
 * app resumes following system changes automatically.
 */
import { useSyncExternalStore } from 'react';
import { theme, type Scheme } from '@/theme';
import { Button } from '@/ui/primitives/button';

export function useResolvedTheme(): Scheme {
  return useSyncExternalStore(theme.subscribe, theme.get).resolved;
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function ThemeToggle() {
  const snap = useSyncExternalStore(theme.subscribe, theme.get);
  const next: Scheme = snap.resolved === 'dark' ? 'light' : 'dark';
  const modeNote =
    snap.stored === null ? `following system (${snap.resolved})` : `${snap.resolved}`;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => theme.toggle()}
      aria-label={`Switch to ${next} theme`}
      title={`Theme: ${modeNote}. Click to switch to ${next}.`}
      className="gap-1.5"
    >
      {snap.resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
      <span className="hidden sm:inline">{next === 'light' ? 'Light' : 'Dark'}</span>
    </Button>
  );
}
