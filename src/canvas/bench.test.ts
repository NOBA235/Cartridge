/**
 * The connection test, with a scripted device (labelled 'mock'; this checks the
 * evaluator and the scoring, not Gemini Nano) and a fake cloud.
 */
import { describe, expect, it, vi } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import type { DeviceEdgeFacts, EdgeDeviceModel, EdgeFactsInput } from '@/ai/deviceModel';
import type { AskContext } from '@/cartridge/ask';
import { buildRuleIndex } from '@/cartridge/retrieve';
import type { Cartridge } from '@/cartridge/types';
import { prepareSource } from '@/cartridge/verifyQuote';
import { asPrivate, isPublic, reveal, type Public } from '@/privacy';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import {
  benchProblems,
  canvasMode,
  cartridgeProblems,
  draftBench,
  exportBenchJson,
  importBenchJson,
  lowestRun,
  runBench,
} from './bench';
import type { BenchItem, EdgeBench, ExpectedStatus } from './benchTypes';
import { evaluateEdge } from './evaluate';

const C = FIELD_CARTRIDGE;
const ctx = (over: Partial<AskContext> = {}): AskContext => ({
  cartridge: C,
  index: buildRuleIndex(C),
  source: FIELD_SOURCE,
  prepared: prepareSource(FIELD_SOURCE),
  ...over,
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const item = (
  id: string,
  expectedStatus: ExpectedStatus,
  expectedRuleId: string | null,
  from: string,
  to: string,
): BenchItem => ({ id, from, to, expectedStatus, expectedRuleId, note: '' });

const ITEMS: BenchItem[] = [
  ...range(10).map((i) =>
    item(`v${i}`, 'VIOLATION', 'R005', `Latrine ${i}`, `Groundwater well ${i}`),
  ),
  ...range(10).map((i) =>
    item(`c${i}`, 'COMPLIANT', 'R005', `Toilet block ${i}`, `Groundwater spring ${i}`),
  ),
  ...range(5).map((i) =>
    item(`x${i}`, 'COMPLIANT_VIA_EXCEPTION', 'R004', `Short stay camp ${i}`, `Shared toilets ${i}`),
  ),
  ...range(5).map((i) =>
    item(`o${i}`, 'OUT_OF_SCOPE', null, `Radio mast ${i}`, `Water truck ${i}`),
  ),
];

const bench = (over: Partial<EdgeBench> = {}): EdgeBench => ({
  format: 'cartridge-edge-bench',
  formatVersion: 1,
  cartridgeId: C.id,
  cartridgeVersion: C.version,
  sourceHash: C.sourceHash,
  createdAt: '2026-11-18T00:00:00.000Z',
  reviewed: true,
  items: ITEMS,
  ...over,
});

const truth = (edge: string): Omit<DeviceEdgeFacts, 'source'> => {
  const none = { matchesException: false, matchedExceptionText: null, outOfScope: false };
  if (edge.startsWith('Latrine'))
    return { ...none, matchedRuleId: 'R005', triggersWhenCondition: true };
  if (edge.startsWith('Toilet block'))
    return { ...none, matchedRuleId: 'R005', triggersWhenCondition: false };
  if (edge.startsWith('Short stay'))
    return {
      matchedRuleId: 'R004',
      triggersWhenCondition: true,
      matchesException: true,
      matchedExceptionText: 'Short stays of under 3 days may use shared facilities.',
      outOfScope: false,
    };
  return { ...none, matchedRuleId: null, triggersWhenCondition: false, outOfScope: true };
};

/** A device that answers from a script. `twist` may change a reply (run number, edge text). */
function scripted(
  twist: (
    run: number,
    edge: string,
    f: Omit<DeviceEdgeFacts, 'source'>,
  ) => Omit<DeviceEdgeFacts, 'source'> = (_r, _e, f) => f,
  kind: 'firebase' | 'mock' = 'mock',
) {
  let calls = 0;
  const seen: EdgeFactsInput[] = [];
  const model: EdgeDeviceModel = {
    kind,
    prepare: async () => ({ state: 'ready', kind }),
    reportFacts: async (input) => {
      seen.push(input);
      const run = Math.floor(calls++ / ITEMS.length) + 1;
      const edge = reveal(input.edge);
      return {
        ...twist(run, edge, truth(edge)),
        source: kind === 'firebase' ? 'ON_DEVICE' : 'mock',
      };
    },
  };
  return { model, seen };
}

describe('evaluateEdge', () => {
  it('shows the device only the connection and at most 5 candidates, and builds on the rule', async () => {
    const { model, seen } = scripted();
    const v = await evaluateEdge(
      asPrivate('Latrine 1 --> Groundwater well 1', 'diagram-label'),
      ctx(),
      model,
    );
    expect(v).toMatchObject({
      status: 'VIOLATION',
      rule: { id: 'R005' },
      quoteCheck: { ok: true },
    });
    expect(seen[0]?.candidates.length).toBeLessThanOrEqual(5);
    expect(seen[0]?.candidates.map((r) => r.id)).toContain('R005');
  });

  it('asks no model when no rule shares a word with the connection', async () => {
    const { model, seen } = scripted();
    const v = await evaluateEdge(asPrivate('Zzyx --> Qwop', 'diagram-label'), ctx(), model);
    expect(v.status).toBe('OUT_OF_SCOPE');
    expect(seen).toHaveLength(0);
  });

  it('is uncertain when the device picks a rule it was not shown, or the quote cannot be checked', async () => {
    const wrong = scripted((_r, _e, f) => ({ ...f, matchedRuleId: 'R008' }));
    const edge = asPrivate('Latrine 1 --> Groundwater well 1', 'diagram-label');
    expect((await evaluateEdge(edge, ctx(), wrong.model)).status).toBe('UNCERTAIN');
    const noBook = await evaluateEdge(edge, ctx({ prepared: undefined }), scripted().model);
    expect(noBook).toMatchObject({
      status: 'UNCERTAIN',
      detail: expect.stringMatching(/not on this device/),
    });
  });

  it('is uncertain, never red or green, when the device fails', async () => {
    const model: EdgeDeviceModel = {
      kind: 'mock',
      prepare: vi.fn(),
      reportFacts: async () => {
        throw new Error('boom');
      },
    };
    const v = await evaluateEdge(
      asPrivate('Latrine 1 --> Groundwater well 1', 'diagram-label'),
      ctx(),
      model,
    );
    expect(v).toMatchObject({ status: 'UNCERTAIN', detail: 'The on-device model failed: boom' });
  });
});

describe('the set of connections', () => {
  it('passes the composition check as built', () => {
    expect(benchProblems(bench(), C)).toEqual([]);
  });

  it('names what is wrong', () => {
    const items = ITEMS.slice(1).map((i) => (i.id === 'v1' ? { ...i, expectedRuleId: 'R004' } : i));
    const problems = benchProblems(bench({ items, sourceHash: 'other' }), C);
    expect(problems).toEqual(
      expect.arrayContaining([
        'These connections were written for another rulebook.',
        'v1 (Latrine 1 --> Groundwater well 1) is a violation, so it must name a critical rule.',
        'The test needs 10 violations; there are 9.',
      ]),
    );
  });

  it('needs critical rules and a rule with an exception', () => {
    expect(
      cartridgeProblems({ rules: C.rules.filter((r) => r.exceptions.length === 0) }),
    ).toHaveLength(1);
    expect(cartridgeProblems(C)).toEqual([]);
  });

  it('round-trips as a file, and explains a bad one', () => {
    expect(importBenchJson(exportBenchJson(bench()))).toEqual(bench());
    expect(() => importBenchJson('{')).toThrow('This file is not valid JSON.');
    expect(() => importBenchJson('{"format":"x"}')).toThrow(/not a connection test file/);
  });
});

describe('draftBench', () => {
  it('sends only public rule fields, never quotes, and keeps usable connections', async () => {
    const prompts: Public<string>[] = [];
    const cloud: CloudJson = async (_task, prompt, schema) => {
      prompts.push(prompt);
      return {
        data: schema.parse({
          connections: [
            {
              from: 'Latrine',
              to: 'Well',
              label: '',
              expectedStatus: 'VIOLATION',
              expectedRuleId: 'R005',
              note: 'n',
            },
            { from: 'Radio', to: 'Truck', expectedStatus: 'OUT_OF_SCOPE', expectedRuleId: 'NONE' },
            { from: 'X', to: 'Y', expectedStatus: 'VIOLATION', expectedRuleId: 'R999' },
            { from: '', to: 'Y', expectedStatus: 'COMPLIANT', expectedRuleId: 'NONE' },
          ],
        }),
        inferenceSource: 'in_cloud',
        attempts: 1,
      };
    };
    const { bench: b, dropped } = await draftBench(C, { cloud });
    const [sent] = prompts;
    if (!sent) throw new Error('no prompt sent');
    expect(isPublic(sent)).toBe(true);
    for (const r of C.rules) expect(sent.value).not.toContain(r.source.quote);
    expect(sent.value).toContain('Write 30 test connections');
    expect(dropped).toBe(2);
    expect(b.items).toEqual([
      {
        id: 'c1',
        from: 'Latrine',
        to: 'Well',
        expectedStatus: 'VIOLATION',
        expectedRuleId: 'R005',
        note: 'n',
      },
      {
        id: 'c2',
        from: 'Radio',
        to: 'Truck',
        expectedStatus: 'OUT_OF_SCOPE',
        expectedRuleId: null,
        note: '',
      },
    ]);
    expect(b.reviewed).toBe(false);
  });

  it('refuses without signal and for an unsuitable cartridge', async () => {
    const offline: CloudJson = async () => {
      throw new CloudError('No signal', 'OFFLINE', 0);
    };
    await expect(draftBench(C, { cloud: offline })).rejects.toMatchObject({ code: 'OFFLINE' });
    const noExceptions: Cartridge = { ...C, rules: C.rules.map((r) => ({ ...r, exceptions: [] })) };
    await expect(draftBench(noExceptions, { cloud: offline })).rejects.toMatchObject({
      code: 'NOT_SUITABLE',
    });
  });
});

describe('runBench', () => {
  it('scores a perfect device as passing, labelled by what ran it', async () => {
    const res = await runBench(bench(), ctx(), scripted().model);
    expect(res.report).toMatchObject({
      measuredOn: 'mock',
      criticalRecall: 1,
      overallAccuracy: 1,
      passed: true,
      missedViolations: [],
    });
    expect(res.report.runs).toHaveLength(3);
    const device = await runBench(bench(), ctx(), scripted(undefined, 'firebase').model);
    expect(device.report.measuredOn).toBe('device');
  });

  it('uses the lowest of three runs and lists missed violations on their own', async () => {
    const { model } = scripted((run, edge, f) =>
      run === 2 && (edge.startsWith('Latrine 3') || edge.startsWith('Latrine 7'))
        ? { ...f, triggersWhenCondition: false }
        : f,
    );
    const { report } = await runBench(bench(), ctx(), model);
    expect(report.lowestRun).toBe(1);
    expect(report.criticalRecall).toBe(0.8);
    expect(report.overallAccuracy).toBeCloseTo(28 / 30);
    expect(report.passed).toBe(false);
    expect(report.missedViolations.map((m) => [m.id, m.got])).toEqual([
      ['v3', 'COMPLIANT'],
      ['v7', 'COMPLIANT'],
    ]);
  });

  it('fails on accuracy alone below 75%', async () => {
    const { model } = scripted((_run, edge, f) =>
      edge.startsWith('Toilet block') ? { ...f, triggersWhenCondition: true } : f,
    );
    const { report } = await runBench(bench(), ctx(), model, { runs: 1 });
    expect(report).toMatchObject({ criticalRecall: 1, passed: false });
    expect(report.overallAccuracy).toBeCloseTo(20 / 30);
  });

  it('refuses an unreviewed or wrong set, or a missing rulebook', async () => {
    const { model } = scripted();
    await expect(runBench(bench({ reviewed: false }), ctx(), model)).rejects.toThrow(
      /Review every connection/,
    );
    await expect(runBench(bench({ items: ITEMS.slice(1) }), ctx(), model)).rejects.toMatchObject({
      code: 'NOT_SUITABLE',
    });
    await expect(runBench(bench(), ctx({ prepared: undefined }), model)).rejects.toThrow(
      /rulebook/,
    );
  });

  it('picks the run with the lowest recall, then the lowest accuracy', () => {
    const s = (criticalRecall: number, overallAccuracy: number) => ({
      criticalRecall,
      overallAccuracy,
      violationsFlagged: 0,
      violations: 10,
      correct: 0,
      total: 30,
    });
    expect(lowestRun([s(1, 0.9), s(0.9, 1), s(0.9, 0.8)])).toBe(2);
  });
});

describe('canvas mode', () => {
  const report = (o: Partial<NonNullable<Cartridge['edgeBench']>>) => ({
    measuredOn: 'device' as const,
    criticalRecall: 1,
    overallAccuracy: 1,
    missedViolations: [],
    ranAt: '',
    passed: true,
    runs: [],
    lowestRun: 0,
    thresholds: { criticalRecall: 0.9, overallAccuracy: 0.75 },
    wrongRule: [],
    ...o,
  });
  it('gives red and green only after a passing run on a real device', () => {
    expect(canvasMode({ edgeBench: report({}) })).toBe('verdict');
    expect(canvasMode({ edgeBench: report({ passed: false }) })).toBe('advisory');
    expect(canvasMode({ edgeBench: report({ measuredOn: 'mock' }) })).toBe('advisory');
    expect(canvasMode({})).toBe('advisory');
  });
});
