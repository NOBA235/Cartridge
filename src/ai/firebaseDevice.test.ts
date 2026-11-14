import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_RULES } from '@/dev/sampleRules';
import { asPrivate } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import {
  buildSelectSchema,
  FirebaseDeviceModel,
  type DeviceModelFactory,
  type DeviceModelLike,
  type DeviceModelParams,
} from './firebaseDevice';
import { buildDeviceSelectPrompt, formatCandidateLine } from './prompts';

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
