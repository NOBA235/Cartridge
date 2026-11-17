/** Shown by a screen that needs a cartridge when there is none on this device yet. */
import type { ReactNode } from 'react';
import { buttonVariants } from '@/ui/primitives/button';
import { linkHandler } from '@/ui/router';

export function NoCartridge({ children }: { children?: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
      {children}
      <p className="text-sm">
        There is no cartridge on this device yet. Load a rulebook and make its cartridge first.
      </p>
      <a
        href="/load"
        onClick={linkHandler('/load')}
        className={buttonVariants({ className: 'self-start' })}
      >
        Load a rulebook
      </a>
    </section>
  );
}
