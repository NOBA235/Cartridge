/**
 * Ask: one question at a time, answered on this device from the cartridge.
 * When the cartridge cannot answer, the question goes to the cloud only if
 * 'Ask the cloud when needed' is on and the user approves exactly what is
 * sent; without signal it waits in 'Waiting for signal'.
 */
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { cloudJson } from '@/ai/cloud';
import { deviceSessions } from '@/ai/deviceSessions';
import { askQuestion, type ApprovalRequest } from '@/cartridge/ask';
import {
  askHistory,
  offlineQueue,
  rememberProposal,
  type LoadedCartridge,
} from '@/cartridge/askSession';
import { config } from '@/config';
import { asPrivate, type Public } from '@/privacy';
import { connectivity } from '@/queue/connectivity';
import type { QueueView } from '@/queue/offlineQueue';
import { questionBytes, receipt } from '@/telemetry/receipt';
import { formatBytes } from '@/telemetry/summary';
import { AnswerCard } from '@/ui/components/AnswerCard';
import { CloudSetting } from '@/ui/components/CloudSetting';
import { DeclassifyDialog, type DeclassifyRequest } from '@/ui/components/DeclassifyDialog';
import { DevicePanel, useDeviceState } from '@/ui/components/DevicePanel';
import { NoSignalSwitch, useConnectivity } from '@/ui/components/NoSignalSwitch';
import { useChosenCartridgeId } from '@/ui/activeCartridge';
import { useCartridges, useLoadedCartridge } from '@/ui/hooks/useCartridges';
import { useEgressLog, useSettings } from '@/ui/hooks/useStores';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { linkHandler, navigate, useLocation } from '@/ui/router';
import { inputClass } from '@/ui/styles';

type Pending = { request: DeclassifyRequest; resolve: (v: Public<string> | null) => void };

function Receipt() {
  const r = useSyncExternalStore(receipt.subscribe, receipt.get);
  const bytes = questionBytes(useEgressLog());
  return (
    <p className="rounded-xl border bg-muted/40 p-4 text-sm">
      {r.onDevice} answer{r.onDevice === 1 ? '' : 's'} on this device, {r.cloud} from the cloud,{' '}
      {r.queued} waited for signal. {formatBytes(bytes)} left this device for questions.
    </p>
  );
}

function WaitingList({ onApprove }: { onApprove: (item: QueueView) => void }) {
  const items = useSyncExternalStore(offlineQueue.subscribe, offlineQueue.get);
  const online = useConnectivity();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="waiting-title" className="flex flex-col gap-2 rounded-xl border p-4">
      <h2 id="waiting-title" className="text-sm font-semibold">
        Waiting for signal ({items.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {i.question}
              <span className="block text-xs text-muted-foreground">
                {i.sending
                  ? 'Sending…'
                  : i.needsApproval
                    ? 'Saved earlier. Approve again to send it.'
                    : i.lastError
                      ? `Not sent yet (${i.attempts} tries): ${i.lastError}`
                      : online.simulatedOffline
                        ? 'Will be sent when the simulated no-signal switch is off.'
                        : 'Will be sent when there is signal.'}
              </span>
            </span>
            <span className="flex gap-2">
              {i.needsApproval && (
                <Button size="sm" variant="outline" onClick={() => onApprove(i)}>
                  Approve and send
                </Button>
              )}
              {!i.needsApproval && i.lastError && !i.sending && (
                <Button size="sm" variant="outline" onClick={() => void offlineQueue.drain()}>
                  Try again
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void offlineQueue.remove(i.id)}
                disabled={i.sending}
              >
                Remove
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AskWith({ loaded }: { loaded: LoadedCartridge }) {
  const inputId = useId();
  const settings = useSettings();
  const device = useDeviceState(loaded.cartridge);
  const history = useSyncExternalStore(askHistory.subscribe, askHistory.get);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rulesById = useMemo(() => new Map(loaded.cartridge.rules.map((r) => [r.id, r])), [loaded]);
  const mine = history.filter((h) => h.cartridgeId === loaded.cartridge.id);

  const approve = useCallback(
    (req: ApprovalRequest) =>
      new Promise<Public<string> | null>((resolve) => {
        setPending({
          resolve,
          request: {
            value: req.question,
            purpose:
              req.when === 'now'
                ? 'Ask the cloud a question the cartridge could not answer'
                : 'Send when there is signal',
            scope: 'ask',
            destination:
              req.when === 'now'
                ? `the cloud model (${config.cloudModels.ANSWER}) through Firebase AI Logic`
                : `the cloud model (${config.cloudModels.ANSWER}) through Firebase AI Logic as soon as there is signal`,
            fullRequest: req.plan.preview,
            context: req.detail,
            approveLabel:
              req.when === 'now' ? 'Approve and send' : 'Approve, send when there is signal',
          },
        });
      }),
    [],
  );

  const settle = (v: Public<string> | null) => {
    pending?.resolve(v);
    setPending(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const answer = await askQuestion(asPrivate(text, 'user-question'), loaded, {
        device: deviceSessions.handle(loaded.cartridge),
        cloud: cloudJson,
        online: () => connectivity.online(),
        cloudAllowed: settings.cloudWhenNeeded.ask,
        approve,
        enqueue: (item) => offlineQueue.enqueue(item),
      });
      askHistory.add(
        await rememberProposal(answer, loaded.cartridge.id, loaded.cartridge.version),
        loaded.cartridge.id,
      );
      setQuestion('');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const approveQueued = (item: QueueView) => {
    setPending({
      resolve: (v) => {
        if (v) void offlineQueue.approve(item.id, v);
      },
      request: {
        value: asPrivate(item.question, 'user-question'),
        purpose: 'Send a question saved while there was no signal',
        scope: 'ask',
        destination: `the cloud model (${config.cloudModels.ANSWER}) through Firebase AI Logic`,
        approveLabel: 'Approve and send',
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {!loaded.source && (
        <p
          role="status"
          className="rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
        >
          The rulebook for this cartridge is not on this device, so no answer can be verified
          against the source. Load the same rulebook on &lsquo;Load a rulebook&rsquo; to fix this.
        </p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Your question
        </label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            id={inputId}
            className={`${inputClass} h-11 text-base`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="For example: how many toilets for 400 people?"
            autoComplete="off"
            disabled={busy}
          />
          <Button type="submit" className="h-11" disabled={busy || !question.trim()}>
            {busy ? 'Asking…' : 'Ask'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {device.state === 'ready'
            ? 'Answered on this device when the cartridge covers it.'
            : 'Gemini Nano is not ready yet; see below.'}{' '}
          Your question stays on this device unless you approve sending it.
        </p>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {mine.map((h) => (
          <AnswerCard
            key={h.id}
            answer={h.answer}
            rule={h.answer.ruleId ? rulesById.get(h.answer.ruleId) : undefined}
            source={loaded.source}
            cartridgeId={h.cartridgeId}
          />
        ))}
      </div>

      <WaitingList onApprove={approveQueued} />
      <NoSignalSwitch />
      <div className="rounded-xl border p-4">
        <CloudSetting screen="ask" />
      </div>
      <DevicePanel cartridge={loaded.cartridge} />
      <Receipt />

      <DeclassifyDialog
        request={pending?.request ?? null}
        onApproved={(v) => settle(v)}
        onCancel={() => settle(null)}
      />
    </div>
  );
}

export function Ask() {
  const { params } = useLocation();
  const selectId = useId();
  const { records, error } = useCartridges();
  const id = useChosenCartridgeId(records, params.get('id'));
  const loaded = useLoadedCartridge(id);

  const header = (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Answers come from the rules in your cartridge, checked against the rulebook.
      </p>
    </header>
  );

  if (records === null) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
        {header}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }
  if (records.length === 0) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
        {header}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Cartridges are not available: {error}
          </p>
        )}
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

  const current =
    loaded !== null && loaded !== 'missing' && loaded.cartridge.id === id ? loaded : null;
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 py-10">
      {header}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-sm text-muted-foreground">
          Cartridge
        </label>
        <select
          id={selectId}
          className={`${inputClass} w-auto max-w-full`}
          value={id ?? ''}
          onChange={(e) => navigate('/ask', { id: e.target.value })}
        >
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} (v{r.currentVersion}, {r.ruleCount} rules)
            </option>
          ))}
        </select>
      </div>
      {loaded === 'missing' && (
        <p role="alert" className="text-sm">
          This cartridge is not on this device.
        </p>
      )}
      {current ? (
        <AskWith key={`${current.cartridge.id}@${current.cartridge.version}`} loaded={current} />
      ) : (
        loaded !== 'missing' && <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
  );
}
