import { cn } from '@/lib/utils';

/**
 * Where an answer came from. Drawn from inferenceSource for real calls:
 * - ON_DEVICE: Gemini Nano reported on_device.
 * - IN_CLOUD: the cloud model through Firebase AI Logic.
 * - MOCK: the mock device model. Never presented as on-device.
 * - QUEUED: waiting for signal.
 */
export type Route = 'ON_DEVICE' | 'IN_CLOUD' | 'MOCK' | 'QUEUED';

const LABELS: Record<Route, string> = {
  ON_DEVICE: 'On this device',
  IN_CLOUD: 'Cloud',
  MOCK: 'Mock device (not Gemini Nano)',
  QUEUED: 'Waiting for signal',
};

const STYLES: Record<Route, string> = {
  ON_DEVICE: 'border-success/40 bg-success/10 text-success',
  IN_CLOUD: 'border-primary/40 bg-primary/10 text-primary',
  MOCK: 'border-warning/50 bg-warning/10 text-warning',
  QUEUED: 'border-border bg-muted text-muted-foreground',
};

/** Maps SDK inferenceSource values ('on_device' / 'in_cloud') to a route. */
export function routeFromInferenceSource(source: string | undefined): Route | undefined {
  if (source === 'on_device') return 'ON_DEVICE';
  if (source === 'in_cloud') return 'IN_CLOUD';
  return undefined;
}

export function RouteBadge({ route, className }: { route: Route; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        STYLES[route],
        className,
      )}
      data-route={route}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABELS[route]}
    </span>
  );
}
