/**
 * The connection test that gates the Blueprint canvas.
 *
 * - draftBench(): the cloud writes 30 connections from the public rules
 *   (EDGE_BENCH_PROMPT); code drops malformed ones and checks the labels
 *   against the cartridge. A person reviews them by hand before any run.
 * - benchProblems(): the composition the pass bar is defined on: 10 violations
 *   of critical rules, 10 compliant, 5 compliant through a stated exception,
 *   5 not covered.
 * - runBench(): every connection through the device evaluator, three times.
 *   The lowest run counts. Pass: critical recall of at least 90% and overall
 *   accuracy of at least 75%. Missed violations are listed on their own.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import type { EdgeDeviceModel } from '@/ai/deviceModel';
import type { AskContext } from '@/cartridge/ask';
import { NONE, type Cartridge } from '@/cartridge/types';
import { config } from '@/config';
import { asPublic, fillTemplate } from '@/privacy';
import {
  BENCH_COMPOSITION,
  EdgeBenchSchema,
  type BenchItem,
  type BenchRunSummary,
  type EdgeBench,
  type EdgeBenchReport,
  type ExpectedStatus,
} from './benchTypes';
import {
  DraftConnectionSchema,
  EDGE_BENCH_PROMPT,
  EdgeBenchReply,
  edgeBenchTask,
} from './benchPrompts';
import { formatEdge } from './edges';
import { evaluateEdge, type EdgeVerdict } from './evaluate';

/** bench/edges.json: the reviewed connections, as a file people can read and edit. */
export function exportBenchJson(bench: EdgeBench): string {
  return `${JSON.stringify(bench, null, 2)}\n`;
}

export function importBenchJson(text: string): EdgeBench {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BenchError('This file is not valid JSON.', 'NOT_SUITABLE');
  }
  const parsed = EdgeBenchSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BenchError(
      `This is not a connection test file (${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'invalid'}).`,
      'NOT_SUITABLE',
    );
  }
  return parsed.data;
}

export type BenchErrorCode = 'NOT_SUITABLE' | 'OFFLINE' | 'CLOUD' | 'NOT_READY' | 'STOPPED';

export class BenchError extends Error {
  override readonly name = 'BenchError';
  readonly code: BenchErrorCode;
  constructor(message: string, code: BenchErrorCode) {
    super(message);
    this.code = code;
  }
}

/** Why this cartridge cannot have the test as defined, or [] if it can. */
export function cartridgeProblems(c: Pick<Cartridge, 'rules'>): string[] {
  const problems: string[] = [];
  if (!c.rules.some((r) => r.severity === 'critical')) {
    problems.push('The test needs violations of critical rules, and this cartridge has none.');
  }
  if (!c.rules.some((r) => r.exceptions.length > 0)) {
    problems.push(
      'The test needs connections that match a stated exception, and no rule in this cartridge lists one.',
    );
  }
  return problems;
}

/** What is wrong with a set of connections for this cartridge, or [] when it can run. */
export function benchProblems(bench: EdgeBench, c: Cartridge): string[] {
  const problems: string[] = [];
  if (bench.cartridgeId !== c.id)
    problems.push('These connections were written for another cartridge.');
  if (bench.sourceHash !== c.sourceHash)
    problems.push('These connections were written for another rulebook.');
  const byId = new Map(c.rules.map((r) => [r.id, r]));
  const counts: Record<ExpectedStatus, number> = {
    VIOLATION: 0,
    COMPLIANT: 0,
    COMPLIANT_VIA_EXCEPTION: 0,
    OUT_OF_SCOPE: 0,
  };
  const seen = new Set<string>();
  for (const item of bench.items) {
    counts[item.expectedStatus]++;
    const name = `${item.id} (${formatEdge(item)})`;
    const key = formatEdge(item).toLowerCase();
    if (seen.has(key)) problems.push(`${name} appears twice.`);
    seen.add(key);
    const rule = item.expectedRuleId ? byId.get(item.expectedRuleId) : undefined;
    if (item.expectedRuleId && !rule) {
      problems.push(`${name} expects ${item.expectedRuleId}, which is not in this cartridge.`);
      continue;
    }
    if (item.expectedStatus === 'VIOLATION' && rule?.severity !== 'critical') {
      problems.push(`${name} is a violation, so it must name a critical rule.`);
    }
    if (item.expectedStatus === 'COMPLIANT_VIA_EXCEPTION' && !rule?.exceptions.length) {
      problems.push(`${name} must name a rule that lists an exception.`);
    }
    if (item.expectedStatus === 'OUT_OF_SCOPE' && item.expectedRuleId !== null) {
      problems.push(`${name} is not covered, so it must not name a rule.`);
    }
  }
  for (const [status, want] of Object.entries(BENCH_COMPOSITION) as Array<
    [ExpectedStatus, number]
  >) {
    if (counts[status] !== want) {
      problems.push(`The test needs ${want} ${STATUS_WORDS[status]}; there are ${counts[status]}.`);
    }
  }
  return problems;
}

export const STATUS_WORDS: Record<ExpectedStatus, string> = {
  VIOLATION: 'violations',
  COMPLIANT: 'compliant connections',
  COMPLIANT_VIA_EXCEPTION: 'connections allowed by an exception',
  OUT_OF_SCOPE: 'connections no rule covers',
};

/** The public rule fields the cloud sees (no quotes). */
function rulesForBench(c: Cartridge): string {
  return JSON.stringify(
    c.rules.map((r) => ({
      id: r.id,
      title: r.title,
      when: r.when,
      exceptions: r.exceptions,
      severity: r.severity,
    })),
    null,
    1,
  );
}

export async function draftBench(
  c: Cartridge,
  deps: { cloud: CloudJson; now?: () => Date },
): Promise<{ bench: EdgeBench; dropped: number }> {
  const unsuitable = cartridgeProblems(c);
  if (unsuitable.length > 0) throw new BenchError(unsuitable.join(' '), 'NOT_SUITABLE');
  let raw: unknown[];
  try {
    const reply = await deps.cloud(
      edgeBenchTask(c.rules.map((r) => r.id)),
      fillTemplate(EDGE_BENCH_PROMPT, { rulesJson: asPublic(rulesForBench(c), 'cartridge') }),
      EdgeBenchReply,
    );
    raw = reply.data.connections;
  } catch (e) {
    if (e instanceof CloudError && e.code === 'OFFLINE') {
      throw new BenchError('No signal. Drafting the connections needs the cloud once.', 'OFFLINE');
    }
    throw new BenchError(
      `The cloud could not draft the connections: ${(e as Error).message}`,
      'CLOUD',
    );
  }
  const ids = new Set(c.rules.map((r) => r.id));
  const items: BenchItem[] = [];
  let dropped = 0;
  for (const r of raw) {
    const p = DraftConnectionSchema.safeParse(r);
    if (!p.success) {
      dropped++;
      continue;
    }
    const ruleId =
      p.data.expectedRuleId === NONE || p.data.expectedRuleId === '' ? null : p.data.expectedRuleId;
    if (ruleId !== null && !ids.has(ruleId)) {
      dropped++;
      continue;
    }
    const label = p.data.label?.trim();
    items.push({
      id: `c${items.length + 1}`,
      from: p.data.from,
      to: p.data.to,
      ...(label ? { label } : {}),
      expectedStatus: p.data.expectedStatus,
      expectedRuleId: p.data.expectedStatus === 'OUT_OF_SCOPE' ? null : ruleId,
      note: p.data.note,
    });
  }
  return {
    bench: {
      format: 'cartridge-edge-bench',
      formatVersion: 1,
      cartridgeId: c.id,
      cartridgeVersion: c.version,
      sourceHash: c.sourceHash,
      createdAt: (deps.now ?? (() => new Date()))().toISOString(),
      reviewed: false,
      items,
    },
    dropped,
  };
}

export interface BenchItemResult {
  id: string;
  expected: ExpectedStatus;
  expectedRuleId: string | null;
  verdict: EdgeVerdict;
  correct: boolean;
}

export function summariseRun(results: readonly BenchItemResult[]): BenchRunSummary {
  const violations = results.filter((r) => r.expected === 'VIOLATION');
  const flagged = violations.filter((r) => r.verdict.status === 'VIOLATION').length;
  const correct = results.filter((r) => r.correct).length;
  return {
    criticalRecall: violations.length === 0 ? 0 : flagged / violations.length,
    overallAccuracy: results.length === 0 ? 0 : correct / results.length,
    violationsFlagged: flagged,
    violations: violations.length,
    correct,
    total: results.length,
  };
}

/** The worst run: lowest critical recall, then lowest overall accuracy. */
export function lowestRun(runs: readonly BenchRunSummary[]): number {
  let worst = 0;
  runs.forEach((r, i) => {
    const w = runs[worst];
    if (!w) return;
    if (
      r.criticalRecall < w.criticalRecall ||
      (r.criticalRecall === w.criticalRecall && r.overallAccuracy < w.overallAccuracy)
    ) {
      worst = i;
    }
  });
  return worst;
}

export interface BenchProgress {
  run: number;
  runs: number;
  item: number;
  items: number;
}

export interface BenchOutcome {
  report: EdgeBenchReport;
  /** Per connection, for the lowest run. */
  results: BenchItemResult[];
}

export async function runBench(
  bench: EdgeBench,
  ctx: AskContext,
  model: EdgeDeviceModel,
  options: {
    onProgress?: (p: BenchProgress) => void;
    signal?: AbortSignal;
    runs?: number;
    now?: () => Date;
  } = {},
): Promise<BenchOutcome> {
  const problems = benchProblems(bench, ctx.cartridge);
  if (problems.length > 0) throw new BenchError(problems.join(' '), 'NOT_SUITABLE');
  if (!bench.reviewed) {
    throw new BenchError(
      'Review every connection by hand before running the test.',
      'NOT_SUITABLE',
    );
  }
  if (!ctx.prepared) {
    throw new BenchError(
      'The rulebook for this cartridge is not on this device, so no quote can be checked.',
      'NOT_SUITABLE',
    );
  }
  const runs = options.runs ?? config.edgeBench.runs;
  const all: BenchItemResult[][] = [];
  const latencies: number[] = [];
  for (let run = 1; run <= runs; run++) {
    const results: BenchItemResult[] = [];
    for (const [i, item] of bench.items.entries()) {
      if (options.signal?.aborted) throw new BenchError('Stopped.', 'STOPPED');
      options.onProgress?.({ run, runs, item: i + 1, items: bench.items.length });
      // Written by the cloud from public rules, so Public; it is never sent anywhere here.
      const verdict = await evaluateEdge(asPublic(formatEdge(item), 'cloud-response'), ctx, model);
      if (verdict.latencyMs !== undefined) latencies.push(verdict.latencyMs);
      results.push({
        id: item.id,
        expected: item.expectedStatus,
        expectedRuleId: item.expectedRuleId,
        verdict,
        correct: verdict.status === item.expectedStatus,
      });
    }
    all.push(results);
  }
  const summaries = all.map(summariseRun);
  const worst = lowestRun(summaries);
  const results = all[worst] ?? [];
  const summary = summaries[worst] ?? summariseRun([]);
  const byId = new Map(bench.items.map((i) => [i.id, i]));
  const missed = results
    .filter((r) => r.expected === 'VIOLATION' && r.verdict.status !== 'VIOLATION')
    .map((r) => {
      const item = byId.get(r.id);
      return {
        id: r.id,
        edge: item ? formatEdge(item) : r.id,
        expectedRuleId: r.expectedRuleId,
        got: r.verdict.status,
        gotRuleId: r.verdict.rule?.id ?? null,
      };
    });
  const wrongRule = results
    .filter(
      (r) =>
        r.expected === 'VIOLATION' &&
        r.verdict.status === 'VIOLATION' &&
        r.verdict.rule?.id !== r.expectedRuleId,
    )
    .map((r) => r.id);
  const t = config.edgeBench;
  const report: EdgeBenchReport = {
    measuredOn: model.kind === 'firebase' ? 'device' : 'mock',
    criticalRecall: summary.criticalRecall,
    overallAccuracy: summary.overallAccuracy,
    missedViolations: missed,
    ranAt: (options.now ?? (() => new Date()))().toISOString(),
    passed:
      summary.criticalRecall >= t.minCriticalRecall &&
      summary.overallAccuracy >= t.minOverallAccuracy,
    runs: summaries,
    lowestRun: worst,
    thresholds: { criticalRecall: t.minCriticalRecall, overallAccuracy: t.minOverallAccuracy },
    wrongRule,
    ...(latencies.length > 0 ? { medianLatencyMs: median(latencies) } : {}),
  };
  return { report, results };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/**
 * How the canvas may show results for this cartridge. Verdict mode (red and
 * green) only after the test passed on a real device with these rules;
 * otherwise advisory mode: amber, no green.
 */
export function canvasMode(c: Pick<Cartridge, 'edgeBench'>): 'verdict' | 'advisory' {
  const r = c.edgeBench;
  return r && r.measuredOn === 'device' && r.passed ? 'verdict' : 'advisory';
}
