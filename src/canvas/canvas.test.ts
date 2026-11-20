/**
 * The Blueprint canvas logic, without a browser: reading connections from a
 * scene, decorations per mode, the live loop, bound arrows and templates.
 * Excalidraw itself needs a browser; its converter is replaced by a small fake
 * here, and the real one is checked in Chrome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { EdgeDeviceModel } from '@/ai/deviceModel';
import { buildRuleIndex } from '@/cartridge/retrieve';
import { prepareSource } from '@/cartridge/verifyQuote';
import { asPrivate, isPrivate, reveal, type Private } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import { addBoundArrow, arrowGeometry, memoryScene, type Convert } from './arrows';
import { EdgeChecker } from './checker';
import {
  applyPlan,
  badgeId,
  COLOURS,
  isEmptyPlan,
  lookFor,
  planDecorations,
  type EdgeLook,
} from './decorate';
import { evaluateEdge, type EdgeVerdict } from './evaluate';
import { CARTRIDGE_TAG, extractGraph, type SceneElement } from './scene';
import { buildTemplate, TEMPLATES } from './templates';

const el = (o: Partial<SceneElement> & Pick<SceneElement, 'id' | 'type'>): SceneElement => ({
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  ...o,
});

const box = (id: string, label?: string, x = 0): SceneElement[] => [
  el({ id, type: 'rectangle', x }),
  ...(label ? [el({ id: `${id}-t`, type: 'text', text: label, containerId: id })] : []),
];

const arrow = (
  id: string,
  from?: string,
  to?: string,
  extra: Partial<SceneElement> = {},
): SceneElement =>
  el({
    id,
    type: 'arrow',
    x: 100,
    y: 25,
    width: 200,
    height: 0,
    points: [
      [0, 0],
      [200, 0],
    ],
    startBinding: from ? { elementId: from } : null,
    endBinding: to ? { elementId: to } : null,
    strokeColor: '#1e1e1e',
    strokeStyle: 'solid',
    ...extra,
  });

describe('reading connections', () => {
  it('turns arrows bound at both ends into one Private line each, with the arrow label', () => {
    const g = extractGraph([
      ...box('a', 'Public  Webhook'),
      ...box('b', 'Core Ledger DB (Prod)', 300),
      arrow('r', 'a', 'b'),
      el({ id: 'r-t', type: 'text', text: 'no auth', containerId: 'r' }),
    ]);
    expect(g.looseArrows).toBe(0);
    expect(g.edges).toHaveLength(1);
    const [e] = g.edges;
    expect(e && isPrivate(e.text)).toBe(true);
    expect(e && reveal(e.text)).toBe('Public Webhook --> Core Ledger DB (Prod) (no auth)');
  });

  it('counts arrows that are loose or end at an unnamed box, and ignores deleted ones and badges', () => {
    const g = extractGraph([
      ...box('a', 'A'),
      ...box('b'),
      ...box('c', 'C', 300),
      arrow('r1', 'a'),
      arrow('r2', 'a', 'b'),
      arrow('r3', 'a', 'c', { isDeleted: true }),
      el({
        id: 'badge',
        type: 'text',
        text: 'Not covered',
        customData: { [CARTRIDGE_TAG]: { kind: 'badge', arrowId: 'r3' } },
      }),
      arrow('r4', 'a', 'badge'),
    ]);
    expect(g.edges).toEqual([]);
    expect(g.looseArrows).toBe(3);
  });

  it('accepts free-standing text as a node', () => {
    const g = extractGraph([
      el({ id: 'x', type: 'text', text: 'Partner' }),
      ...box('b', 'Lake', 300),
      arrow('r', 'x', 'b'),
    ]);
    expect(g.edges.map((e) => reveal(e.text))).toEqual(['Partner --> Lake']);
  });
});

describe('looks', () => {
  it('uses red and green only in verdict mode', () => {
    expect(lookFor('VIOLATION', 'R005', 'critical', 'verdict')).toMatchObject({
      strokeColor: COLOURS.red,
      badge: '[R005 CRITICAL]',
    });
    expect(lookFor('COMPLIANT_VIA_EXCEPTION', 'R004', 'major', 'verdict')).toMatchObject({
      strokeColor: COLOURS.green,
      badge: '[R004 exception]',
    });
    const advisory = (
      ['VIOLATION', 'COMPLIANT', 'COMPLIANT_VIA_EXCEPTION', 'OUT_OF_SCOPE', 'UNCERTAIN'] as const
    ).map((s) => lookFor(s, 'R005', 'critical', 'advisory'));
    for (const l of advisory) {
      expect(l.strokeColor).not.toBe(COLOURS.green);
      expect(l.strokeColor).not.toBe(COLOURS.red);
    }
    expect(advisory.map((l) => l.badge)).toEqual([
      'Possible violation, review R005',
      'Not checked',
      'Not checked',
      'Not covered',
      'Review R005',
    ]);
  });

  it('never shows uncertain as red or green, and not-covered as dashed grey', () => {
    for (const mode of ['verdict', 'advisory'] as const) {
      expect(lookFor('UNCERTAIN', undefined, undefined, mode)).toMatchObject({
        strokeColor: COLOURS.amber,
        badge: 'Review',
      });
      expect(lookFor('OUT_OF_SCOPE', undefined, undefined, mode)).toMatchObject({
        strokeColor: COLOURS.grey,
        strokeStyle: 'dashed',
      });
    }
  });
});

describe('decoration plan', () => {
  const look: EdgeLook = {
    strokeColor: COLOURS.amber,
    strokeStyle: 'solid',
    badge: 'Review R005',
    tone: 'review',
  };
  const scene = [...box('a', 'A'), ...box('b', 'B', 300), arrow('r', 'a', 'b')];

  it('recolours the arrow, keeps its own style, and adds a badge at its middle', () => {
    const p = planDecorations(scene, new Map([['r', look]]));
    expect(p.arrows).toEqual([
      {
        id: 'r',
        strokeColor: COLOURS.amber,
        strokeStyle: 'solid',
        customData: {
          [CARTRIDGE_TAG]: { kind: 'arrow', strokeColor: '#1e1e1e', strokeStyle: 'solid' },
        },
      },
    ]);
    expect(p.badges).toEqual([
      {
        id: badgeId('r'),
        arrowId: 'r',
        text: 'Review R005',
        strokeColor: COLOURS.amber,
        x: 200,
        y: 39,
      },
    ]);
  });

  it('is empty once the scene matches, so applying it cannot loop', () => {
    const decorated: SceneElement[] = [
      ...box('a', 'A'),
      ...box('b', 'B', 300),
      arrow('r', 'a', 'b', {
        strokeColor: COLOURS.amber,
        customData: {
          [CARTRIDGE_TAG]: { kind: 'arrow', strokeColor: '#1e1e1e', strokeStyle: 'solid' },
        },
      }),
      el({
        id: badgeId('r'),
        type: 'text',
        text: 'Review R005',
        strokeColor: COLOURS.amber,
        x: 200,
        y: 39,
        customData: { [CARTRIDGE_TAG]: { kind: 'badge', arrowId: 'r' } },
      }),
    ];
    expect(isEmptyPlan(planDecorations(decorated, new Map([['r', look]])))).toBe(true);

    // The arrow is no longer checked: its own colour comes back and the badge goes.
    const p = planDecorations(decorated, new Map());
    expect(p.arrows).toEqual([
      { id: 'r', strokeColor: '#1e1e1e', strokeStyle: 'solid', customData: {} },
    ]);
    expect(p.removeBadges).toEqual([badgeId('r')]);
  });
});

describe('applying the plan', () => {
  type E = { id: string; [k: string]: unknown };
  const tools = {
    makeBadges: (specs: ReadonlyArray<Record<string, unknown>>) =>
      specs.map((s): E => ({ id: String(s['id']), ...s, made: true })),
    update: (e: E, fields: Record<string, unknown>) => ({ ...e, ...fields, version: 2 }),
  };

  it('recolours arrows, deletes stale badges, replaces changed ones and adds new ones', () => {
    const elements: E[] = [
      { id: 'r' },
      { id: badgeId('old') },
      { id: badgeId('r'), text: 'stale' },
      { id: 'other' },
    ];
    const next = applyPlan(
      elements,
      {
        arrows: [{ id: 'r', strokeColor: COLOURS.red, strokeStyle: 'solid', customData: { x: 1 } }],
        badges: [
          {
            id: badgeId('r'),
            arrowId: 'r',
            text: '[R005 CRITICAL]',
            strokeColor: COLOURS.red,
            x: 1,
            y: 2,
          },
          {
            id: badgeId('s'),
            arrowId: 's',
            text: 'Not covered',
            strokeColor: COLOURS.grey,
            x: 3,
            y: 4,
          },
        ],
        removeBadges: [badgeId('old')],
      },
      tools,
      6,
    );
    expect(next.map((e) => e.id)).toEqual([
      'r',
      badgeId('old'),
      badgeId('r'),
      'other',
      badgeId('s'),
    ]);
    expect(next[0]).toMatchObject({ strokeColor: COLOURS.red, customData: { x: 1 }, version: 2 });
    expect(next[1]).toMatchObject({ isDeleted: true });
    expect(next[2]).toMatchObject({
      made: true,
      text: '[R005 CRITICAL]',
      locked: true,
      roughness: 0,
      fontFamily: 6,
      customData: { [CARTRIDGE_TAG]: { kind: 'badge', arrowId: 'r' } },
    });
    expect(next[3]).toBe(elements[3]);
  });
});

describe('live loop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const edge = (s: string) => ({
    arrowId: s,
    fromId: 'a',
    toId: 'b',
    text: asPrivate(s, 'diagram-label'),
  });
  const verdict = (): EdgeVerdict => ({ status: 'OUT_OF_SCOPE', candidates: [], detail: '' });

  it('waits 600 ms after the last change, checks each new text once, and caches it', async () => {
    const evaluate = vi.fn(async (_text: Private<string>) => verdict());
    const onResult = vi.fn();
    const c = new EdgeChecker({ evaluate, onResult });
    c.schedule([edge('A --> B')]);
    await vi.advanceTimersByTimeAsync(400);
    c.schedule([edge('A --> B'), edge('B --> C')]);
    await vi.advanceTimersByTimeAsync(599);
    expect(evaluate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(evaluate.mock.calls.map(([t]) => reveal(t))).toEqual(['A --> B', 'B --> C']);
    expect(onResult).toHaveBeenCalledTimes(2);

    c.schedule([edge('B --> C'), edge('A --> B')]);
    await vi.advanceTimersByTimeAsync(600);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(c.get(asPrivate('A --> B', 'diagram-label'))?.status).toBe('OUT_OF_SCOPE');
  });

  it('drops the rest of a stale run when the diagram changes, and checks the new list', async () => {
    const resolvers: Array<() => void> = [];
    const evaluate = vi.fn(
      (_t: unknown) =>
        new Promise<EdgeVerdict>((resolve) => {
          resolvers.push(() => resolve(verdict()));
        }),
    );
    const c = new EdgeChecker({ evaluate, onResult: () => {} });
    c.schedule([edge('one'), edge('two'), edge('three')]);
    await vi.advanceTimersByTimeAsync(600);
    expect(evaluate).toHaveBeenCalledTimes(1);
    c.schedule([edge('four')]);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(evaluate).toHaveBeenCalledTimes(1); // 'two' and 'three' are dropped
    await vi.advanceTimersByTimeAsync(600);
    expect(evaluate.mock.calls.map(([t]) => reveal(t as never))).toEqual(['one', 'four']);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    c.stop();
  });
});

describe('the canvas never sends diagram text anywhere', () => {
  it('evaluates connections on the device only: the egress log stays empty', async () => {
    egressLog._reset();
    const model: EdgeDeviceModel = {
      kind: 'mock',
      prepare: vi.fn(),
      reportFacts: async () => ({
        matchedRuleId: 'R005',
        triggersWhenCondition: true,
        matchesException: false,
        matchedExceptionIndex: null,
        outOfScope: false,
        source: 'mock',
      }),
    };
    const ctx = {
      cartridge: FIELD_CARTRIDGE,
      index: buildRuleIndex(FIELD_CARTRIDGE),
      source: FIELD_SOURCE,
      prepared: prepareSource(FIELD_SOURCE),
    };
    const g = extractGraph([
      ...box('a', 'Latrine block'),
      ...box('b', 'Borehole (groundwater)', 300),
      arrow('r', 'a', 'b'),
    ]);
    const verdicts = await Promise.all(g.edges.map((e) => evaluateEdge(e.text, ctx, model)));
    expect(verdicts[0]).toMatchObject({ status: 'VIOLATION', rule: { id: 'R005' } });
    expect(egressLog.entries()).toEqual([]);
  });
});

/** A stand-in for Excalidraw's converter: keeps ids, binds arrows to boxes passed in the same call. */
const fakeConvert: Convert = (skeletons: ExcalidrawElementSkeleton[]) => {
  const out = skeletons.map(
    (s) => ({ boundElements: null, isDeleted: false, ...s }) as unknown as Record<string, unknown>,
  );
  const extra: Record<string, unknown>[] = [];
  for (const e of out) {
    const label = e['label'] as { text: string } | undefined;
    if (label) {
      extra.push({
        id: `${String(e['id'])}-label`,
        type: 'text',
        text: label.text,
        containerId: e['id'],
        isDeleted: false,
      });
      delete e['label'];
    }
    if (e['type'] === 'arrow') {
      const start = e['start'] as { id: string };
      const end = e['end'] as { id: string };
      for (const id of [start.id, end.id]) {
        const target = out.find((x) => x['id'] === id);
        if (!target) throw new Error(`No element for binding with id ${id} found`);
        target['boundElements'] = [
          ...((target['boundElements'] as unknown[]) ?? []),
          { id: e['id'], type: 'arrow' },
        ];
      }
      e['startBinding'] = { elementId: start.id };
      e['endBinding'] = { elementId: end.id };
      delete e['start'];
      delete e['end'];
    }
  }
  return [...out, ...extra] as unknown as ExcalidrawElement[];
};

describe('addBoundArrow', () => {
  const shapes = fakeConvert([
    { type: 'rectangle', id: 'a', x: 0, y: 0, width: 100, height: 50, label: { text: 'A' } },
    { type: 'rectangle', id: 'b', x: 300, y: 100, width: 100, height: 50, label: { text: 'B' } },
  ] as ExcalidrawElementSkeleton[]);

  it('passes both shapes with the arrow to the converter, keeping ids, and binds both ends', () => {
    const convert = vi.fn(fakeConvert);
    const scene = memoryScene(shapes);
    const id = addBoundArrow(scene, convert, 'a', 'b', 'nightly');
    const [batch, opts] = convert.mock.calls[0] ?? [];
    expect(batch?.map((s) => s.id)).toEqual(['a', 'b', id]);
    expect(opts).toEqual({ regenerateIds: false });
    const arrowEl = scene.elements.find((e) => e.id === id) as unknown as SceneElement;
    expect(arrowEl.startBinding?.elementId).toBe('a');
    expect(arrowEl.endBinding?.elementId).toBe('b');
    expect(scene.elements.find((e) => e.id === 'a')?.boundElements).toEqual([
      { id, type: 'arrow' },
    ]);
    expect(scene.elements.filter((e) => e.id === 'a')).toHaveLength(1);
    expect(
      extractGraph(scene.elements as unknown as SceneElement[]).edges.map((e) => reveal(e.text)),
    ).toEqual(['A --> B (nightly)']);
  });

  it('refuses a missing or identical shape', () => {
    const scene = memoryScene(shapes);
    expect(() => addBoundArrow(scene, fakeConvert, 'a', 'zz')).toThrow(/Both ends/);
    expect(() => addBoundArrow(scene, fakeConvert, 'a', 'a')).toThrow(/two different shapes/);
  });

  it('starts and ends the arrow at the box borders', () => {
    expect(
      arrowGeometry(
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 300, y: 0, width: 100, height: 50 },
      ),
    ).toEqual({
      x: 100,
      y: 25,
      width: 200,
      height: 0,
    });
  });
});

describe('templates', () => {
  it('each has real connections between named boxes', () => {
    expect(TEMPLATES).toHaveLength(3);
    for (const t of TEMPLATES) {
      const g = extractGraph(buildTemplate(t, fakeConvert) as unknown as SceneElement[]);
      expect(g.looseArrows).toBe(0);
      expect(g.edges).toHaveLength(t.edges.length);
    }
  });

  it('every template extracts private architecture connections with no loose arrows', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(['web-service', 'data-pipeline', 'auth-flow']);
    const auth = TEMPLATES.find((x) => x.id === 'auth-flow');
    if (!auth) throw new Error('auth-flow template missing');
    const g = extractGraph(buildTemplate(auth, fakeConvert) as unknown as SceneElement[]);
    expect(g.edges.map((e) => reveal(e.text))).toContain(
      'Browser client --> Authentication service (HTTP plaintext login)',
    );
    expect(g.edges.every((e) => isPrivate(e.text))).toBe(true);
  });
});
