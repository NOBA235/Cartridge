/**
 * Welcome: what Cartridge is, the privacy promise in the exact agreed words,
 * and the steps with where this device is in them. One clear next action.
 */
import { useSyncExternalStore } from 'react';
import { STARTER_STANDARD } from '@/cartridge/starter';
import { receipt } from '@/telemetry/receipt';
import { cartridgeLabel, useChosenCartridgeId } from '@/ui/activeCartridge';
import { ReadyBadge } from '@/ui/components/ExamReportCard';
import { StarterButton } from '@/ui/components/StarterButton';
import { useCartridges, useCurrentCartridge, useSourceCount } from '@/ui/hooks/useCartridges';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, type AppPath } from '@/ui/router';

interface Step {
  title: string;
  text: string;
  path: AppPath;
  done: boolean;
  status: string;
  action: string;
}

export function Welcome() {
  const sources = useSourceCount();
  const { records } = useCartridges();
  const id = useChosenCartridgeId(records, null);
  const cartridge = useCurrentCartridge(id);
  const r = useSyncExternalStore(receipt.subscribe, receipt.get);
  const loading = sources === null || records === null;
  const answered = r.onDevice + r.cloud;
  const askedParts = [
    `${r.onDevice} answered on this device`,
    `${r.cloud} from the cloud`,
    ...(r.queued > 0 ? [`${r.queued} waited for signal`] : []),
    ...(r.unanswered > 0 ? [`${r.unanswered} not answered`] : []),
  ];

  const steps: Step[] = [
    {
      title: 'Load a rulebook',
      text: 'A public, openly licensed standard. It is read and kept on this device.',
      path: '/load',
      done: (sources ?? 0) > 0,
      status: sources
        ? `${sources} rulebook${sources === 1 ? '' : 's'} on this device`
        : 'Not done yet',
      action: 'Load a rulebook',
    },
    {
      title: 'Make the cartridge',
      text: 'The cloud reads the rulebook once and writes numbered rules. Every rule’s quote is checked against the rulebook.',
      path: '/load',
      done: (records?.length ?? 0) > 0,
      status: cartridge ? cartridgeLabel(cartridge).full : 'Not done yet',
      action: 'Make the cartridge',
    },
    {
      title: 'Exam Day',
      text: 'The cloud writes a test, Gemini Nano takes it on this device, and a held-out set checks the result is real.',
      path: '/exam',
      done: cartridge?.report !== undefined,
      status: cartridge?.report ? 'Tested on this device' : 'Not tested yet',
      action: 'Go to Exam Day',
    },
    {
      title: 'Ask',
      text: 'Engineering and compliance questions are answered on this device from the rules, without a signal.',
      path: '/ask',
      done: answered > 0,
      status: answered + r.queued + r.unanswered > 0 ? askedParts.join(', ') : 'No question yet',
      action: 'Ask a question',
    },
    {
      title: 'Blueprint canvas',
      text: 'Draw or load a system architecture diagram. Every connection is audited live on this device — zero bytes leave your laptop.',
      path: '/blueprint',
      done: cartridge?.edgeBench !== undefined,
      status: cartridge?.edgeBench
        ? `Connection test ${cartridge.edgeBench.passed ? 'passed' : 'below the bar'}`
        : 'Runs locally on Gemini Nano',
      action: 'Open Blueprint',
    },
    {
      title: 'Report card',
      text: 'How the cartridge did on this device, and exactly what left it.',
      path: '/report',
      done: false,
      status: '',
      action: 'Open the report card',
    },
  ];
  const next = loading
    ? undefined
    : (steps.find((s) => !s.done && s.path !== '/report' && s.path !== '/blueprint') ?? steps[4]);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 py-12">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Cartridge</h1>
        <p className="text-lg text-muted-foreground">
          Turns a public security or compliance standard into a small, tested, offline-ready
          cartridge of numbered rules — so teams can audit system architectures and engineering
          questions on their own device.
        </p>
        <p className="text-xl font-medium">
          Public standards go to the cloud once. Your diagram never does.
        </p>
      </div>

      {!loading && records.length === 0 && (
        <section
          aria-labelledby="starter-title"
          className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-5"
        >
          <div className="flex flex-col gap-1">
            <h2 id="starter-title" className="text-base font-semibold">
              Try it now in one click
            </h2>
            <p className="text-sm text-muted-foreground">
              Load our pre-compiled <strong>{STARTER_STANDARD.shortName}</strong> cartridge (
              {STARTER_STANDARD.ruleCount} rules across {STARTER_STANDARD.chapters};{' '}
              {STARTER_STANDARD.licence}). Every rule quote verifies live on this device against the
              bundled standard — no cloud call needed.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <StarterButton />
            <a
              href="/load"
              onClick={linkHandler('/load')}
              className={buttonVariants({ variant: 'outline' })}
            >
              Or load your own rulebook
            </a>
          </div>
        </section>
      )}

      {!loading && cartridge && (
        <section
          aria-label="Quick actions"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{cartridgeLabel(cartridge).full}</p>
            <p className="text-xs text-muted-foreground">
              Ready on this device. Jump straight into auditing a diagram or asking questions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={href('/blueprint', { id: cartridge.id })}
              onClick={linkHandler('/blueprint', { id: cartridge.id })}
              className={buttonVariants({ size: 'sm' })}
            >
              Open Blueprint
            </a>
            <a
              href={href('/ask', { id: cartridge.id })}
              onClick={linkHandler('/ask', { id: cartridge.id })}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              Ask
            </a>
            <a
              href={href('/cartridge', { id: cartridge.id })}
              onClick={linkHandler('/cartridge', { id: cartridge.id })}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              Browse {cartridge.rules.length} cards
            </a>
          </div>
        </section>
      )}

      <ol className="flex flex-col gap-2" aria-label="Steps">
        {steps.map((s, i) => {
          const isNext = next === s;
          return (
            <li
              key={s.title}
              className={cn(
                'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between',
                isNext && 'border-primary/50 bg-primary/5',
              )}
            >
              <div className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium',
                    s.done
                      ? 'border-success/50 bg-success/15 text-success'
                      : 'text-muted-foreground',
                  )}
                >
                  {s.done ? '✓' : i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.title}
                    <span className="sr-only">
                      {s.done ? ' (done)' : isNext ? ' (next step)' : ''}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{s.text}</p>
                  {s.status && !loading && (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {s.path === '/exam' && cartridge?.report && (
                        <ReadyBadge report={cartridge.report} />
                      )}
                      {s.status}
                    </p>
                  )}
                </div>
              </div>
              <a
                href={id && s.path !== '/load' ? href(s.path, { id }) : s.path}
                onClick={linkHandler(s.path, id && s.path !== '/load' ? { id } : undefined)}
                className={buttonVariants({
                  size: 'sm',
                  variant: isNext ? 'default' : 'outline',
                  className: 'shrink-0 self-start',
                })}
              >
                {s.action}
              </a>
            </li>
          );
        })}
      </ol>

      <section aria-labelledby="privacy-title" className="flex flex-col gap-2">
        <h2 id="privacy-title" className="text-lg font-semibold">
          What leaves this device
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
          <li>
            Public standards and regulations (an openly licensed excerpt, for example from NIST or
            an OWASP project) go to the cloud once, to compile the cartridge.
          </li>
          <li>
            The user&apos;s own material is processed only by the on-device model: their
            architecture diagram, service names, notes and audit results. The Blueprint canvas makes
            no automatic cloud calls at all.
          </li>
          <li>
            Questions typed in the Ask screen go to the cloud only when the cartridge cannot answer
            and the user has left &apos;Ask the cloud when needed&apos; switched on. Every such call
            shows in the &apos;What left this device&apos; panel.
          </li>
        </ul>
      </section>
    </section>
  );
}
