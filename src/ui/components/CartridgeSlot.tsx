/**
 * The header slot. The active cartridge sits in it as a small card with its
 * label ('Field standards, 9 rules, passed 10 of 12'), and slides in (200 ms)
 * when a cartridge or a new version is loaded. With reduced motion it just
 * appears. Next to it, the state of Gemini Nano on this device.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useSyncExternalStore } from 'react';
import { deviceSessions } from '@/ai/deviceSessions';
import { cartridgeLabel, useChosenCartridgeId } from '@/ui/activeCartridge';
import { useCartridges, useCurrentCartridge } from '@/ui/hooks/useCartridges';
import { Button } from '@/ui/primitives/button';
import { href, linkHandler } from '@/ui/router';

function DeviceChip() {
  const s = useSyncExternalStore(deviceSessions.subscribe, deviceSessions.get);

  useEffect(() => {
    deviceSessions.autoPrepare();
  }, []);

  const chip = 'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium';
  if (s.state === 'ready') {
    return (
      <span className={`${chip} border-success/40 bg-success/10 text-success`}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        Gemini Nano ready
      </span>
    );
  }
  if (s.state === 'preparing') {
    return (
      <span className={`${chip} border-border text-muted-foreground`} role="status">
        Preparing Gemini Nano… {Math.round(s.progress * 100)}%
      </span>
    );
  }
  if (s.state === 'unavailable' && s.canRetry) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-8 rounded-full border-warning/50 text-warning"
        title={`Gemini Nano is not ready: ${s.reason}`}
        onClick={() => void deviceSessions.prepare()}
      >
        Cloud mode: try again
        <span className="sr-only">
          {' '}
          to prepare Gemini Nano. Until it is ready, questions need the cloud, after you approve.{' '}
          {s.reason}
        </span>
      </Button>
    );
  }
  if (s.state === 'unavailable') {
    return (
      <span
        className={`${chip} border-warning/50 bg-warning/10 text-warning`}
        title={`Gemini Nano is not available: ${s.reason}`}
      >
        Cloud mode
        <span className="sr-only">
          : Gemini Nano is not available on this device, so questions need the cloud, after you
          approve. {s.reason}
        </span>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 rounded-full"
      title="Downloads Gemini Nano to this device once, so questions can be answered here without a signal"
      onClick={() => void deviceSessions.prepare()}
    >
      Prepare this device
    </Button>
  );
}

export function CartridgeSlot() {
  const { records } = useCartridges();
  const id = useChosenCartridgeId(records, null);
  const shown = useCurrentCartridge(id);
  const label = shown ? cartridgeLabel(shown) : null;
  // MotionConfig skips the animation itself, but the first frame would still
  // be drawn at the start position; with reduced motion, start where it ends.
  const still = useReducedMotion() ?? false;

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-11 w-64 overflow-hidden rounded-lg border bg-muted/70 p-1 shadow-inner max-sm:w-48"
        aria-label="Cartridge slot"
        role="group"
      >
        <AnimatePresence mode="popLayout">
          {shown && label ? (
            <motion.a
              key={`${shown.id}@${shown.version}`}
              href={href('/cartridge', { id: shown.id })}
              onClick={linkHandler('/cartridge', { id: shown.id })}
              initial={still ? false : { y: '-115%' }}
              animate={{ y: 0 }}
              exit={still ? { opacity: 0 } : { y: '115%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              aria-label={`Cartridge in the slot: ${label.full}, version ${shown.version}. Open the cards.`}
              title={`${label.full} (version ${shown.version})`}
              className="flex h-full items-stretch overflow-hidden rounded-md border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span aria-hidden className="w-1.5 shrink-0 bg-primary" />
              <span className="flex min-w-0 flex-col justify-center px-2 leading-tight">
                <span className="truncate text-xs font-semibold">{label.title}</span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {label.rules}, {label.tested}
                </span>
              </span>
            </motion.a>
          ) : (
            <motion.a
              key="empty"
              href="/load"
              onClick={linkHandler('/load')}
              initial={false}
              className="flex h-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {records === null ? 'Loading…' : 'Empty slot: load a rulebook'}
            </motion.a>
          )}
        </AnimatePresence>
      </div>
      <DeviceChip />
    </div>
  );
}
