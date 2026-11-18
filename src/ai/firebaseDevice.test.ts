import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RULES } from '@/testing/sampleRules';
import { asPrivate } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import {
  buildEdgeSchema,
  buildSelectSchema,
  FirebaseDeviceModel,
  FirebaseEdgeModel,
  prepareThisDevice,
  type DeviceModelFactory,
  type DeviceModelLike,
  type DeviceModelParams,
} from './firebaseDevice';
import {
  buildDeviceSelectPrompt,
  DEVICE_EDGE_SYSTEM,
  formatCandidateLine,
  formatEdgeCandidateLine,
} from './prompts';

const IDS = ['R001', 'R002', 'R003'];

interface FakeOptions {
  adapter?: boolean;
  initError?: Error;
  reply?: string;
  inferenceSource?: string;
}

function fake(opts: FakeOptions = {}) {
  const generateContent = vi.fn(async (_prompt: string) => ({
    response: {
      text: () => opts.reply ?? '{"ruleId":"R002","quantity":400}',
      inferenceSource: opts.inferenceSource ?? 'on_device',
    },
  }));
  const initializeDeviceModel = vi.fn(async (cb?: (p: number) => void) => {
    if (opts.initError) throw opts.initError;
    cb?.(0.5);
  });
  const model: DeviceModelLike & { chromeAdapter?: object } = {
    generateContent,
    initializeDeviceModel,
  };
  if (opts.adapter !== false) model.chromeAdapter = {};
  let params: DeviceModelParams | undefined;
  const factory: DeviceModelFactory = (p) => {
    params = p;
    return model;
  };
  return { factory, generateContent, initializeDeviceModel, params: () => params };
}

const question = asPrivate('How many toilets for 400 people?', 'user-question');

beforeEach(() => egressLog._reset());

describe('device prompt and schema', () => {
  it('lists only the candidates, one per line, with Not when when present', () => {
    const prompt = buildDeviceSelectPrompt('q?', SAMPLE_RULES.slice(1, 2));
    expect(prompt).toContain(
      'R002: Toilets per number of people. When: Deciding how many toilets a site needs. Not when: Asking about handwashing or water quantity.',
    );
    expect(prompt).not.toContain('R001');
    expect(prompt).not.toContain('R003');
    expect(prompt.startsWith('Question: q?')).toBe(true);
  });

  it('omits Not when if the rule has none and avoids double full stops', () => {
    const [water] = SAMPLE_RULES;
    if (!water) throw new Error('sample rules missing');
    const line = formatCandidateLine({ ...water, title: 'Water.' });
    expect(line).toBe('R001: Water. When: Planning daily drinking water for a group of people.');
  });

  it('allows every rule ID plus NONE', () => {
    const json = buildSelectSchema(IDS);
    expect(json.properties.ruleId.enum).toEqual(['R001', 'R002', 'R003', 'NONE']);
    expect(json.properties.quantity.type).toBe('number');
    expect(json.required).toEqual(['ruleId', 'quantity']);
  });
});

describe('FirebaseDeviceModel', () => {
  it('passes a plain JSON schema and a system prompt to the factory', async () => {
    const f = fake();
    await new FirebaseDeviceModel(IDS, f.factory).prepare(() => {});
    const p = f.params();
    expect(p?.systemPrompt).toMatch(/choose which rule/);
    expect(p?.languages).toEqual(['en']);
    expect(Object.getPrototypeOf(p?.responseConstraint)).toBe(Object.prototype);
  });

  it('is unavailable when the SDK built no on-device adapter, and never initialises', async () => {
    const f = fake({ adapter: false });
    const status = await new FirebaseDeviceModel(IDS, f.factory).prepare(() => {});
    expect(status.state).toBe('unavailable');
    expect(f.initializeDeviceModel).not.toHaveBeenCalled();
  });

  it('is unavailable when initializeDeviceModel throws', async () => {
    const f = fake({ initError: new Error('Local LanguageModel API not available') });
    const status = await new FirebaseDeviceModel(IDS, f.factory).prepare(() => {});
    expect(status).toMatchObject({
      state: 'unavailable',
      reason: 'Local LanguageModel API not available',
    });
    expect(status).not.toHaveProperty('permanent');
  });

  it('marks it permanent when Chrome reports the model unavailable on this device', async () => {
    const initError = Object.assign(new Error('Local LanguageModel API not available'), {
      code: 'api-not-enabled',
    });
    const status = await new FirebaseDeviceModel(IDS, fake({ initError }).factory).prepare(
      () => {},
    );
    expect(status).toMatchObject({ state: 'unavailable', permanent: true });
  });

  it('reports progress and ends at 1', async () => {
    const f = fake();
    const progress: number[] = [];
    const status = await new FirebaseDeviceModel(IDS, f.factory).prepare((p) => progress.push(p));
    expect(status.state).toBe('ready');
    expect(progress).toEqual([0.5, 1]);
  });

  it('refuses to answer before prepare()', async () => {
    const f = fake();
    await expect(
      new FirebaseDeviceModel(IDS, f.factory).selectRule({ question, candidates: SAMPLE_RULES }),
    ).rejects.toMatchObject({ code: 'NOT_PREPARED' });
    expect(f.generateContent).not.toHaveBeenCalled();
  });

  it('returns the validated selection with source ON_DEVICE', async () => {
    const f = fake();
    const m = new FirebaseDeviceModel(IDS, f.factory);
    await m.prepare(() => {});
    const sel = await m.selectRule({ question, candidates: SAMPLE_RULES });
    expect(sel).toEqual({ ruleId: 'R002', quantity: 400, source: 'ON_DEVICE' });
    expect(egressLog.entries()).toHaveLength(0);
  });

  it('rejects and logs a response that ran in the cloud', async () => {
    const f = fake({ inferenceSource: 'in_cloud' });
    const m = new FirebaseDeviceModel(IDS, f.factory);
    await m.prepare(() => {});
    await expect(m.selectRule({ question, candidates: SAMPLE_RULES })).rejects.toMatchObject({
      code: 'RAN_IN_CLOUD',
    });
    expect(egressLog.entries()[0]?.kind).toBe('unexpected-cloud');
  });

  it('rejects malformed JSON and rule IDs outside the cartridge', async () => {
    for (const reply of ['nope', '{"ruleId":"R999","quantity":-1}', '{"ruleId":"R001"}']) {
      const f = fake({ reply });
      const m = new FirebaseDeviceModel(IDS, f.factory);
      await m.prepare(() => {});
      await expect(m.selectRule({ question, candidates: SAMPLE_RULES })).rejects.toMatchObject({
        code: 'BAD_OUTPUT',
      });
    }
  });

  it('accepts NONE', async () => {
    const f = fake({ reply: '{"ruleId":"NONE","quantity":-1}' });
    const m = new FirebaseDeviceModel(IDS, f.factory);
    await m.prepare(() => {});
    expect((await m.selectRule({ question, candidates: SAMPLE_RULES })).ruleId).toBe('NONE');
  });

  it('refuses an oversized prompt instead of sending it', async () => {
    const f = fake();
    const m = new FirebaseDeviceModel(IDS, f.factory);
    await m.prepare(() => {});
    const huge = asPrivate('x'.repeat(20_000), 'user-question');
    await expect(m.selectRule({ question: huge, candidates: SAMPLE_RULES })).rejects.toMatchObject({
      code: 'PROMPT_TOO_LONG',
    });
    expect(f.generateContent).not.toHaveBeenCalled();
  });
});

describe('prepareThisDevice', () => {
  it('downloads without a cartridge: no response schema, progress ends at 1', async () => {
    const f = fake();
    const progress: number[] = [];
    const status = await prepareThisDevice((p) => progress.push(p), f.factory);
    expect(status).toEqual({ state: 'ready', kind: 'firebase' });
    expect(progress).toEqual([0.5, 1]);
    expect(f.params()?.responseConstraint).toBeUndefined();
    expect(f.generateContent).not.toHaveBeenCalled();
  });

  it('reports unavailable when the browser has no on-device model', async () => {
    const f = fake({ adapter: false });
    expect((await prepareThisDevice(() => {}, f.factory)).state).toBe('unavailable');
    expect(f.initializeDeviceModel).not.toHaveBeenCalled();
  });

  it('reports unavailable when the download fails', async () => {
    const f = fake({ initError: new Error('Download interrupted') });
    expect(await prepareThisDevice(() => {}, f.factory)).toMatchObject({
      state: 'unavailable',
      reason: 'Download interrupted',
    });
  });
});

describe('FirebaseEdgeModel', () => {
  const edge = asPrivate('Latrine pit --> Borehole (12 metres)', 'diagram-label');
  const facts = (o: Record<string, unknown> = {}) =>
    JSON.stringify({
      matchedRuleId: 'R002',
      triggersWhenCondition: true,
      matchesException: false,
      matchedExceptionText: '',
      outOfScope: false,
      ...o,
    });

  it('uses the edge prompt and a schema of every rule ID plus NONE', async () => {
    const f = fake({ reply: facts() });
    const m = new FirebaseEdgeModel(IDS, f.factory);
    await m.prepare(() => {});
    expect(f.params()?.systemPrompt).toBe(DEVICE_EDGE_SYSTEM);
    expect(f.params()?.responseConstraint).toEqual(buildEdgeSchema(IDS));
    expect(buildEdgeSchema(IDS).properties.matchedRuleId.enum).toEqual([...IDS, 'NONE']);
    const shown = SAMPLE_RULES.slice(1, 2);
    await m.reportFacts({ edge, candidates: shown });
    const prompt = f.generateContent.mock.calls[0]?.[0] ?? '';
    expect(prompt.startsWith('Connection: Latrine pit --> Borehole (12 metres)')).toBe(true);
    for (const r of shown) expect(prompt).toContain(formatEdgeCandidateLine(r));
    expect(prompt).not.toContain('R001:');
    expect(prompt).toContain('Only report the facts.');
  });

  it('reads NONE and an empty exception as null', async () => {
    const f = fake({ reply: facts({ matchedRuleId: 'NONE', outOfScope: true }) });
    const m = new FirebaseEdgeModel(IDS, f.factory);
    await m.prepare(() => {});
    expect(await m.reportFacts({ edge, candidates: SAMPLE_RULES.slice(0, 2) })).toEqual({
      matchedRuleId: null,
      triggersWhenCondition: true,
      matchesException: false,
      matchedExceptionText: null,
      outOfScope: true,
      source: 'ON_DEVICE',
    });
  });

  it('rejects a reply that came from the cloud, and logs it', async () => {
    const f = fake({ reply: facts(), inferenceSource: 'in_cloud' });
    const m = new FirebaseEdgeModel(IDS, f.factory);
    await m.prepare(() => {});
    await expect(m.reportFacts({ edge, candidates: SAMPLE_RULES })).rejects.toMatchObject({
      code: 'RAN_IN_CLOUD',
    });
    expect(egressLog.entries().map((e) => e.kind)).toEqual(['unexpected-cloud']);
  });

  it('rejects malformed or invalid output, and refuses before prepare', async () => {
    const m0 = new FirebaseEdgeModel(IDS, fake().factory);
    await expect(m0.reportFacts({ edge, candidates: SAMPLE_RULES })).rejects.toMatchObject({
      code: 'NOT_PREPARED',
    });
    for (const reply of ['not json', facts({ matchedRuleId: 'R999' }), '{"outOfScope":true}']) {
      const m = new FirebaseEdgeModel(IDS, fake({ reply }).factory);
      await m.prepare(() => {});
      await expect(m.reportFacts({ edge, candidates: SAMPLE_RULES })).rejects.toMatchObject({
        code: 'BAD_OUTPUT',
      });
    }
  });
});
