/** Shown by a screen that needs a cartridge when there is none on this device yet. */
import type { ReactNode } from 'react';
import { StarterButton } from '@/ui/components/StarterButton';
import { buttonVariants } from '@/ui/primitives/button';
import { linkHandler } from '@/ui/router';

export function NoCartridge({ children }: { children?: ReactNode }) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4 py-10">
      {children}
      <p className="text-sm text-muted-foreground">
        There is no cartridge on this device yet. Start immediately with the bundled OWASP ASVS 5.0
        starter standard, or load your own public rulebook.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <StarterButton />
        <a
          href="/load"
          onClick={linkHandler('/load')}
          className={buttonVariants({ variant: 'outline' })}
        >
          Load your own rulebook
        </a>
      </div>
    </section>
  );
}
