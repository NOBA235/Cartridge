import { buttonVariants } from '@/ui/primitives/button';
import { linkHandler } from '@/ui/router';

/** Placeholder. The full Welcome screen arrives in Phase 6. */
export function Welcome() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Cartridge</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Turns a long rulebook into a small, tested, offline-ready cartridge of numbered rules.
        </p>
      </div>
      <p className="text-xl font-medium">
        Public standards go to the cloud once. Your diagram never does.
      </p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
        <li>
          Public standards and regulations (an openly licensed excerpt, for example from NIST or an
          OWASP project) go to the cloud once, to compile the cartridge.
        </li>
        <li>
          The user&apos;s own material is processed only by the on-device model: their architecture
          diagram, service names, notes and audit results. The Blueprint canvas makes no automatic
          cloud calls at all.
        </li>
        <li>
          Questions typed in the Ask screen go to the cloud only when the cartridge cannot answer
          and the user has left &apos;Ask the cloud when needed&apos; switched on. Every such call
          shows in the &apos;What left this device&apos; panel.
        </li>
      </ul>
      <a
        href="/load"
        onClick={linkHandler('/load')}
        className={buttonVariants({ className: 'self-start' })}
      >
        Load a rulebook
      </a>
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Work in progress. Exam Day, Ask and Report card arrive in later phases.
      </p>
    </section>
  );
}
