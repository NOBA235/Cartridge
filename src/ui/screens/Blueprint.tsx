/**
 * Blueprint canvas: draw a system or a site, and every connection is checked
 * against the cartridge's rules on this device, live and without a signal.
 *
 * - Nothing on the canvas is ever sent anywhere: connections go to Gemini Nano
 *   on this device only, and the diagram is saved in this browser only.
 * - Red and green only in verdict mode (the connection test passed on this
 *   device with these rules); otherwise advisory mode: amber, never green.
 * - Fonts are served by this app (window.EXCALIDRAW_ASSET_PATH, set in
 *   main.tsx), never from a CDN. AI and embeds are switched off.
 *
 * Loaded on demand: Excalidraw is large, and only this screen needs it.
 */
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  FONT_FAMILY,
  MainMenu,
  newElementWith,
  WelcomeScreen,
} from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import '@excalidraw/excalidraw/index.css';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { cloudJson } from '@/ai/cloud';
import { deviceSessions } from '@/ai/deviceSessions';
import { runtimeConfig } from '@/ai/remoteConfig';
import { canvasMode } from '@/canvas/bench';
import { EdgeChecker } from '@/canvas/checker';
import {
  applyPlan,
  isEmptyPlan,
  lookForVerdict,
  planDecorations,
  type CanvasMode,
  type EdgeLook,
  type ElementTools,
} from '@/canvas/decorate';
import { edgeModelFor } from '@/canvas/edgeSessions';
import { matchedException } from '@/canvas/edges';
import { evaluateEdge, type EdgeVerdict } from '@/canvas/evaluate';
import { leakedDiagramTerms } from '@/canvas/generalise';
import { extractGraph, isOurs, type DiagramGraph, type SceneElement } from '@/canvas/scene';
import { buildTemplate, TEMPLATES } from '@/canvas/templates';
import { checkQuote } from '@/cartridge/answer';
import { askCloud, planCloudQuestion, type CloudAnswer, type CloudPlan } from '@/cartridge/ask';
import { rememberProposal, type LoadedCartridge } from '@/cartridge/askSession';
import { cn } from '@/lib/utils';
import { asPrivate, reveal, type Public } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import { receipt } from '@/telemetry/receipt';
import { formatBytes } from '@/telemetry/summary';
import { useChosenCartridgeId } from '@/ui/activeCartridge';
import { AnswerCard } from '@/ui/components/AnswerCard';
import { DeclassifyDialog, type DeclassifyRequest } from '@/ui/components/DeclassifyDialog';
import { useDeviceState } from '@/ui/components/DevicePanel';
import { useConnectivity } from '@/ui/components/NoSignalSwitch';
import { SeverityChip } from '@/ui/components/SeverityChip';
import { SourceContext } from '@/ui/components/SourceContext';
import { StarterButton } from '@/ui/components/StarterButton';
import { useResolvedTheme } from '@/ui/components/ThemeToggle';
import { useCartridges, useLoadedCartridge } from '@/ui/hooks/useCartridges';
import { useEgressLog } from '@/ui/hooks/useStores';
import { Button, buttonVariants } from '@/ui/primitives/button';
import { href, linkHandler, navigate, useLocation } from '@/ui/router';
import { inputClass, textareaClass } from '@/ui/styles';

const SAVE_KEY = 'cartridge.blueprint.v1';

const EXCALIDRAW_TOOLS: ElementTools<ExcalidrawElement> = {
  makeBadges: (specs) =>
    convertToExcalidrawElements(specs as unknown as ExcalidrawElementSkeleton[], {
      regenerateIds: false,
    }),
  update: (e, fields) => newElementWith(e, fields as Partial<ExcalidrawElement>),
};

function loadSaved(): readonly ExcalidrawElement[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const elements = (parsed as { elements?: unknown } | null)?.elements;
    return Array.isArray(elements) ? (elements as ExcalidrawElement[]) : null;
  } catch {
    return null;
  }
}

/** Saves the user's diagram in this browser only (badges are left out). False if storage refused. */
function saveDiagram(elements: readonly ExcalidrawElement[]): boolean {
  try {
    const own = elements.filter((e) => !e.isDeleted && !isOurs(e as unknown as SceneElement));
    globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify({ elements: own }));
    return true;
  } catch {
    return false;
  }
}

const busyDrawing = (a: AppState) =>
  Boolean(
    a.newElement ||
    a.multiElement ||
    a.resizingElement ||
    a.editingTextElement ||
    a.selectedElementsAreBeingDragged ||
    a.isResizing ||
    a.isRotating,
  );

const sameGraph = (a: DiagramGraph, b: DiagramGraph) =>
  a.looseArrows === b.looseArrows &&
  a.edges.length === b.edges.length &&
  a.edges.every(
    (e, i) =>
      e.arrowId === b.edges[i]?.arrowId && reveal(e.text) === reveal(b.edges[i]?.text ?? e.text),
  );

const TONE_CLASS: Record<EdgeLook['tone'], string> = {
  violation: 'border-destructive/50 bg-destructive/10 text-destructive',
  ok: 'border-success/40 bg-success/10 text-success',
  review: 'border-warning/50 bg-warning/10 text-warning',
  none: 'border-border bg-muted text-muted-foreground',
};

function GeneralisedCloudAsk({ ctx, edgeText }: { ctx: LoadedCartridge; edgeText: string }) {
  const inputId = useId();
  const online = useConnectivity();
  const canCallCloud = online.browserOnline && !online.simulatedOffline;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CloudAnswer | null>(null);
  const [pending, setPending] = useState<{
    request: DeclassifyRequest;
    plan: CloudPlan;
  } | null>(null);

  const leaked = useMemo(() => leakedDiagramTerms(draft, edgeText), [draft, edgeText]);
  const rulesById = useMemo(
    () => new Map(ctx.cartridge.rules.map((r) => [r.id, r])),
    [ctx.cartridge.rules],
  );

  const review = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    const plan = planCloudQuestion(text, ctx);
    setPending({
      plan,
      request: {
        value: asPrivate(text, 'user-question'),
        purpose: 'Ask the cloud about a generalised architecture pattern',
        scope: 'canvas',
        destination: `the cloud model (${runtimeConfig.cloudModel('ANSWER')}) through Firebase AI Logic`,
        fullRequest: plan.preview,
        context:
          'You wrote this generalised wording yourself. Nothing from your diagram is added automatically.',
        approveLabel: 'Approve and ask cloud',
      },
    });
  };

  const sendApproved = async (approved: Public<string>) => {
    const plan = pending?.plan;
    setPending(null);
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const raw = await askCloud(approved, plan, ctx, cloudJson, 'USER_REQUESTED');
      const saved = await rememberProposal(raw, ctx.cartridge.id, ctx.cartridge.version);
      receipt.count(saved);
      setAnswer(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {!open ? (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
          Ask the cloud (generalised)…
        </Button>
      ) : (
        <form onSubmit={review} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={inputId} className="text-xs font-medium">
              Ask the cloud about a generalised pattern
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setOpen(false)}
            >
              Hide
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your diagram labels are never pre-filled. Rewrite the pattern without private service
            names; you will approve exact bytes before anything leaves.
          </p>
          <textarea
            id={inputId}
            className={`${textareaClass} min-h-20 text-xs`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="For example: Can an external webhook write directly to an internal database without authentication?"
            disabled={busy}
          />
          {leaked.length > 0 && (
            <p
              role="status"
              className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-warning"
            >
              Heads up: this includes diagram name{leaked.length === 1 ? '' : 's'}{' '}
              {leaked.map((t) => `‘${t}’`).join(', ')}. Replace private names before sending.
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={busy || !draft.trim() || !canCallCloud}
          >
            {busy ? 'Asking the cloud…' : 'Review & ask cloud'}
          </Button>
          {!canCallCloud && (
            <p className="text-xs text-muted-foreground">
              No signal. Asking the cloud needs a connection.
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
      {answer && (
        <AnswerCard
          answer={answer}
          rule={answer.ruleId ? rulesById.get(answer.ruleId) : undefined}
          source={ctx.source}
          cartridgeId={ctx.cartridge.id}
        />
      )}
      <DeclassifyDialog
        request={pending?.request ?? null}
        onApproved={(v) => void sendApproved(v)}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function LocalCandidatePreview({ ctx, edgeText }: { ctx: LoadedCartridge; edgeText: string }) {
  const hits = useMemo(
    () => ctx.index.search(edgeText, { topK: 3, minScore: 0 }).hits,
    [ctx, edgeText],
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Gemini Nano is not active on this browser, so automated red/green verdicts are off. Showing
        the closest rules found locally on this device (0 bytes sent):
      </p>
      {hits.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No rule in this cartridge shares keywords with this connection.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {hits.map(({ rule }) => {
            const q = checkQuote(rule.source.quote, ctx.prepared);
            return (
              <li key={rule.id} className="flex flex-col gap-1.5 rounded-lg border p-2.5 text-xs">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">{rule.id}</span>
                  <span className="font-medium">{rule.title}</span>
                  <SeverityChip severity={rule.severity} />
                </p>
                <p className="text-muted-foreground">{rule.then}</p>
                {q.ok && q.start !== undefined && q.end !== undefined && ctx.source && (
                  <p className="font-medium text-success">
                    Verified against the source{q.page !== undefined && `, page ${q.page}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Inspector({
  ctx,
  mode,
  graph,
  verdicts,
  selected,
  onSelect,
  checking,
}: {
  /** True when connections are being checked on this device (Gemini Nano ready). */
  checking: boolean;
  ctx: LoadedCartridge | null;
  mode: CanvasMode;
  graph: DiagramGraph;
  verdicts: ReadonlyMap<string, EdgeVerdict>;
  selected: string | null;
  onSelect: (arrowId: string) => void;
}) {
  const edge = graph.edges.find((e) => e.arrowId === selected);
  const v = edge ? verdicts.get(edge.arrowId) : undefined;
  const report = ctx?.cartridge.report;

  return (
    <div className="flex flex-col gap-4 text-sm">
      {edge ? (
        <section aria-labelledby="inspector-title" className="flex flex-col gap-3">
          <h2 id="inspector-title" className="text-base font-semibold">
            Connection
          </h2>
          <p className="break-words">{reveal(edge.text)}</p>
          {!v ? (
            checking ? (
              <p className="text-muted-foreground">Checking on this device…</p>
            ) : ctx ? (
              <LocalCandidatePreview ctx={ctx} edgeText={reveal(edge.text)} />
            ) : (
              <p className="text-muted-foreground">Load a cartridge to check connections.</p>
            )
          ) : (
            <>
              <EdgeStatusChip look={lookForVerdict(v, mode)} />
              {v.rule && (
                <div className="flex flex-col gap-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">
                      {v.rule.id}
                    </span>
                    <span className="font-medium">{v.rule.title}</span>
                    <SeverityChip severity={v.rule.severity} />
                  </p>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase">
                      What to do
                    </p>
                    <p>{v.rule.then}</p>
                  </div>
                  {v.status === 'COMPLIANT_VIA_EXCEPTION' && v.facts && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        Exception that applies
                      </p>
                      <p>{matchedException(v.facts, v.rule)}</p>
                    </div>
                  )}
                  {v.quoteCheck?.ok &&
                  v.quoteCheck.start !== undefined &&
                  v.quoteCheck.end !== undefined &&
                  ctx?.source ? (
                    <div className="flex flex-col gap-1">
                      <p
                        className={cn(
                          'text-xs font-medium',
                          mode === 'verdict' ? 'text-success' : 'text-foreground',
                        )}
                      >
                        Verified against the source
                        {v.quoteCheck.page !== undefined && `, page ${v.quoteCheck.page}`}
                      </p>
                      <SourceContext
                        text={ctx.source.text}
                        start={v.quoteCheck.start}
                        end={v.quoteCheck.end}
                        radius={100}
                      />
                    </div>
                  ) : (
                    <p className="text-warning">
                      The quote of this rule could not be checked here.
                    </p>
                  )}
                </div>
              )}
              <p className="text-muted-foreground">{v.detail}</p>
              {v.source === 'ON_DEVICE' && (
                <span className="inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-0.5 text-xs font-medium">
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  On this device
                </span>
              )}
            </>
          )}
          {ctx && <GeneralisedCloudAsk key={edge.arrowId} ctx={ctx} edgeText={reveal(edge.text)} />}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onSelect('')}>
            Back to all connections
          </Button>
        </section>
      ) : (
        <section aria-labelledby="list-title" className="flex flex-col gap-2">
          <h2 id="list-title" className="text-base font-semibold">
            Connections ({graph.edges.length})
          </h2>
          {graph.edges.length === 0 ? (
            <p className="text-muted-foreground">
              Draw two boxes, name them, and connect them with an arrow. Or start from a template.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {graph.edges.map((e) => {
                const ev = verdicts.get(e.arrowId);
                const look = ev ? lookForVerdict(ev, mode) : undefined;
                return (
                  <li key={e.arrowId}>
                    <button
                      type="button"
                      onClick={() => onSelect(e.arrowId)}
                      className="flex w-full flex-col gap-1 rounded-lg border p-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <span className="break-words">{reveal(e.text)}</span>
                      {look ? (
                        <EdgeStatusChip look={look} />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {checking ? 'Checking…' : 'Not checked'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {ctx && (
        <section className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
          <p>
            Cartridge: {ctx.cartridge.name}, version {ctx.cartridge.version}.
          </p>
          <p>
            {report
              ? `Exam Day test pass rate ${Math.round(report.heldOutPassRate * 100)}% on held-out questions${report.measuredOn === 'device' ? ', tested on this device' : ', not measured on a real device'}.`
              : 'Not tested on this device yet (Exam Day).'}
          </p>
          <p>
            {ctx.cartridge.edgeBench
              ? `Connection test: ${Math.round(ctx.cartridge.edgeBench.criticalRecall * 100)}% of violations caught, test pass rate ${Math.round(ctx.cartridge.edgeBench.overallAccuracy * 100)}%.`
              : 'Connection test: not run yet.'}
          </p>
        </section>
      )}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        These are advisory checks against the loaded rules, not a security or legal audit.
      </p>
    </div>
  );
}

function EdgeStatusChip({ look }: { look: EdgeLook }) {
  return (
    <span
      className={cn(
        'inline-flex items-center self-start rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[look.tone],
      )}
    >
      {look.badge}
    </span>
  );
}

function Canvas({ ctx }: { ctx: LoadedCartridge | null }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [graph, setGraph] = useState<DiagramGraph>({ edges: [], looseArrows: 0 });
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const graphRef = useRef(graph);
  const checkerRef = useRef<EdgeChecker | null>(null);
  const decorateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initial = useMemo(() => loadSaved(), []);

  const device = useDeviceState();
  const resolvedTheme = useResolvedTheme();
  const ready = ctx !== null && device.state === 'ready';
  const mode: CanvasMode = ctx ? canvasMode(ctx.cartridge) : 'advisory';
  const versionKey = ctx ? `${ctx.cartridge.id}@${ctx.cartridge.version}` : '';

  // Results for the connections now on the canvas.
  const verdicts = useMemo(() => {
    void tick;
    const m = new Map<string, EdgeVerdict>();
    const checker = checkerRef.current;
    if (!checker) return m;
    for (const e of graph.edges) {
      const v = checker.get(e.text);
      if (v) m.set(e.arrowId, v);
    }
    return m;
    // tick changes whenever the checker or one of its results changes.
  }, [graph, tick]);

  const decorate = useCallback(() => {
    clearTimeout(decorateTimer.current);
    decorateTimer.current = setTimeout(function apply() {
      if (!api) return;
      if (busyDrawing(api.getAppState())) {
        decorateTimer.current = setTimeout(apply, 300);
        return;
      }
      const elements = api.getSceneElementsIncludingDeleted();
      const looks = new Map<string, EdgeLook>();
      const checker = checkerRef.current;
      for (const e of graphRef.current.edges) {
        const v = checker?.get(e.text);
        if (v) looks.set(e.arrowId, lookForVerdict(v, mode));
      }
      const plan = planDecorations(elements as unknown as SceneElement[], looks);
      if (isEmptyPlan(plan)) return;
      api.updateScene({
        elements: applyPlan(elements, plan, EXCALIDRAW_TOOLS, FONT_FAMILY.Nunito),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }, 150);
  }, [api, mode]);

  // One checker per cartridge version, only while Gemini Nano is ready.
  useEffect(() => {
    if (!ctx || !ready) {
      checkerRef.current = null;
      setTick((t) => t + 1);
      return;
    }
    let live = true;
    const checker = new EdgeChecker({
      evaluate: async (text) => {
        const model = await edgeModelFor();
        if (!model) {
          return {
            status: 'UNCERTAIN',
            candidates: [],
            detail: 'Gemini Nano is not ready on this device.',
          };
        }
        return evaluateEdge(text, ctx, model);
      },
      onResult: () => {
        if (live) setTick((t) => t + 1);
      },
    });
    checkerRef.current = checker;
    checker.schedule(graphRef.current.edges);
    setTick((t) => t + 1);
    return () => {
      live = false;
      checker.stop();
    };
    // versionKey identifies ctx's cartridge version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey, ready]);

  useEffect(() => {
    decorate();
  }, [decorate, tick, graph]);

  useEffect(
    () => () => {
      clearTimeout(decorateTimer.current);
      clearTimeout(saveTimer.current);
    },
    [],
  );

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      const g = extractGraph(elements as unknown as SceneElement[]);
      if (!sameGraph(g, graphRef.current)) {
        graphRef.current = g;
        setGraph(g);
        checkerRef.current?.schedule(g.edges);
      }
      const ids = Object.keys(appState.selectedElementIds).filter(
        (id) => appState.selectedElementIds[id],
      );
      const arrow = ids.length === 1 ? g.edges.find((e) => e.arrowId === ids[0]) : undefined;
      if (arrow) setSelected(arrow.arrowId);
      decorate();
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveFailed(!saveDiagram(elements)), 1000);
    },
    [decorate],
  );

  const startFrom = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!api || !t) return;
    const own = api.getSceneElements().filter((e) => !isOurs(e as unknown as SceneElement));
    if (
      own.length > 0 &&
      !globalThis.confirm('Replace the diagram on the canvas with this template?')
    )
      return;
    api.updateScene({
      elements: buildTemplate(t, convertToExcalidrawElements),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setSelected(null);
    requestAnimationFrame(() => api.scrollToContent(undefined, { fitToContent: true }));
  };

  const select = (arrowId: string) => {
    setSelected(arrowId || null);
    if (api && arrowId) {
      api.updateScene({
        appState: { selectedElementIds: { [arrowId]: true } },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  };

  const banner = !ctx
    ? 'Load the OWASP ASVS 5.0 starter or your own rulebook to audit connections. You can draw already.'
    : device.state === 'unavailable'
      ? 'Gemini Nano is unavailable in this browser (needs desktop Chrome 139+). Click any connection to see local matching rules or ask the cloud about a generalised pattern.'
      : device.state !== 'ready'
        ? 'Prepare Gemini Nano on this device for live on-device connection checks (0 bytes sent). Click any connection meanwhile to preview local matching rules.'
        : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
        <span className="text-xs text-muted-foreground">Start from:</span>
        {TEMPLATES.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant="outline"
            disabled={!api}
            onClick={() => startFrom(t.id)}
          >
            {t.name}
          </Button>
        ))}
        {graph.looseArrows > 0 && (
          <span role="status" className="text-xs text-muted-foreground">
            {graph.looseArrows} arrow{graph.looseArrows === 1 ? ' is' : 's are'} not checked: attach
            both ends of the arrow to named boxes.
          </span>
        )}
        {saveFailed && (
          <span role="alert" className="text-xs text-destructive">
            This browser's storage is full, so the diagram is not saved.
          </span>
        )}
      </div>
      {banner && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-6 py-2 text-sm"
        >
          <span>{banner}</span>
          {ctx &&
            device.state !== 'ready' &&
            device.state !== 'preparing' &&
            (device.state !== 'unavailable' || device.canRetry) && (
              <Button size="sm" variant="outline" onClick={() => void deviceSessions.prepare()}>
                {device.state === 'unavailable' ? 'Try again' : 'Prepare this device'}
              </Button>
            )}
          {!ctx && (
            <>
              <StarterButton size="sm" />
              <a
                href="/load"
                onClick={linkHandler('/load')}
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                Load a rulebook
              </a>
            </>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          className="relative h-[60svh] min-w-0 flex-1 lg:h-auto"
          role="region"
          aria-label="Blueprint canvas"
        >
          <Excalidraw
            excalidrawAPI={setApi}
            theme={resolvedTheme}
            gridModeEnabled
            aiEnabled={false}
            validateEmbeddable={() => false}
            initialData={{
              elements: initial ?? [],
              appState: {
                currentItemRoughness: 0,
                currentItemStrokeWidth: 2,
                currentItemFontFamily: FONT_FAMILY.Nunito,
                currentItemRoundness: 'sharp',
              },
              scrollToContent: true,
            }}
            onChange={onChange}
            UIOptions={{
              canvasActions: {
                changeViewBackgroundColor: false,
                clearCanvas: true,
                export: false,
                loadScene: false,
                saveToActiveFile: false,
                toggleTheme: false,
                saveAsImage: true,
              },
              tools: { image: false },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
            <WelcomeScreen>
              <WelcomeScreen.Hints.ToolbarHint />
              <WelcomeScreen.Center>
                <WelcomeScreen.Center.Heading>
                  Draw boxes, name them, and connect them with arrows. Each connection is checked
                  against your cartridge on this device.
                </WelcomeScreen.Center.Heading>
              </WelcomeScreen.Center>
            </WelcomeScreen>
          </Excalidraw>
        </div>
        <aside
          aria-label="Inspector"
          className="max-h-full w-full shrink-0 overflow-y-auto border-t p-4 lg:w-80 lg:border-t-0 lg:border-l"
        >
          <Inspector
            ctx={ctx}
            mode={mode}
            graph={graph}
            verdicts={verdicts}
            selected={selected}
            onSelect={select}
            checking={ready}
          />
        </aside>
      </div>
    </>
  );
}

export default function Blueprint() {
  const { params } = useLocation();
  const selectId = useId();
  const { records } = useCartridges();
  const id = useChosenCartridgeId(records, params.get('id'));
  const loaded = useLoadedCartridge(id);
  const entries = useEgressLog();
  void entries;
  const diagramBytes = egressLog.bytesSentFromScope('canvas');
  const ctx = loaded !== null && loaded !== 'missing' && loaded.cartridge.id === id ? loaded : null;
  const mode: CanvasMode = ctx ? canvasMode(ctx.cartridge) : 'advisory';

  return (
    <section className="-mx-6 flex h-[calc(100svh-7.5rem)] min-h-[560px] flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Blueprint</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs">Standards: cloud, once</span>
          <span className="rounded-full border px-2.5 py-0.5 text-xs">
            Your diagram: never leaves this device
          </span>
          <span
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs font-medium',
              diagramBytes === 0
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-border bg-muted text-muted-foreground',
            )}
            aria-live="polite"
          >
            {diagramBytes === 0
              ? 'Diagram bytes sent: 0'
              : `Canvas bytes sent (approved): ${formatBytes(diagramBytes)}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'advisory' ? (
            <a
              href={ctx ? href('/connections', { id: ctx.cartridge.id }) : '/connections'}
              onClick={linkHandler('/connections', ctx ? { id: ctx.cartridge.id } : undefined)}
              className="rounded-full border border-warning/50 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              title="The connection test has not passed on this device with these rules, so the canvas only advises. Open the connection test."
            >
              Advisory mode
            </a>
          ) : (
            <span className="rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
              Verdict mode
            </span>
          )}
          {records && records.length > 1 && (
            <>
              <label htmlFor={selectId} className="sr-only">
                Cartridge
              </label>
              <select
                id={selectId}
                className={`${inputClass} h-8 w-auto max-w-56 py-0 text-xs`}
                value={id ?? ''}
                onChange={(e) => navigate('/blueprint', { id: e.target.value })}
              >
                {records.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (v{r.currentVersion})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </header>
      <Canvas key={ctx ? `${ctx.cartridge.id}@${ctx.cartridge.version}` : 'none'} ctx={ctx} />
    </section>
  );
}
