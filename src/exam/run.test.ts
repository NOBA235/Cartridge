import { describe, expect, it } from 'vitest';
import type { DeviceModel, DeviceSelection } from '@/ai/deviceModel';
import { DeviceError } from '@/ai/deviceModel';
import type { AskContext } from '@/cartridge/ask';
import { buildRuleIndex } from '@/cartridge/retrieve';
import { prepareSource } from '@/cartridge/verifyQuote';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import { MockDeviceModel } from '@/testing/mockDevice';
import { measuredOn, runExam } from './run';
import type { ExamItem } from './types';

const ctx = (withSource = true): AskContext => ({
  cartridge: FIELD_CARTRIDGE,
  index: buildRuleIndex(FIELD_CARTRIDGE),
  ...(withSource ? { source: FIELD_SOURCE, prepared: prepareSource(FIELD_SOURCE) } : {}),
});

const item = (id: string, question: string, expectedRuleId: string): ExamItem => ({
  id,
  question,
  expectedRuleId,
  split: 'practice',
  category: expectedRuleId === 'NONE' ? 'out-of-scope' : 'standard',
});

/** Answers from a script: a rule ID, or an Error to throw. */
class ScriptedDevice implements DeviceModel {
  readonly kind = 'firebase' as const;
  calls: string[] = [];
  private readonly answers: Array<string | Error>;
  constructor(answers: Array<string | Error>) {
    this.answers = answers;
  }
  async prepare() {
    return { state: 'ready' as const, kind: this.kind };
  }
  async selectRule(input: { question: { value: string } }): Promise<DeviceSelection> {
    this.calls.push(input.question.value);
    const next = this.answers.shift() ?? 'NONE';
    if (next instanceof Error) throw next;
    return { ruleId: next, quantity: -1, source: 'ON_DEVICE' };
  }
}

describe('runExam', () => {
  it('grades with the same pipeline as Ask and records candidates and latency', async () => {
    let t = 0;
    const device = new ScriptedDevice(['R004']);
    const results = await runExam(
      [
        item('e1', 'How many toilets for 400 people?', 'R004'),
        item('e2', 'What is the radio frequency?', 'NONE'),
      ],
      ctx(),
      { device: { model: device, ready: true }, clock: () => (t += 50) },
    );
    expect(results[0]).toMatchObject({
      predicted: 'R004',
      verified: true,
      pass: true,
      latencyMs: 50,
    });
    expect(results[0]?.candidates[0]).toBe('R004');
    // Off-topic: no rule is close, so the device is not asked and NONE passes.
    expect(results[1]).toMatchObject({ predicted: 'NONE', pass: true, reason: 'LOW_RETRIEVAL' });
    expect(device.calls).toEqual(['How many toilets for 400 people?']);
  });

  it('fails a wrong rule, a NONE for an in-scope question, and a rule for an out-of-scope one', async () => {
    const device = new ScriptedDevice(['R001', 'NONE', 'R002']);
    const results = await runExam(
      [
        item('e1', 'How many toilets for 400 people?', 'R004'),
        item('e2', 'How far can the water point be from the houses?', 'R002'),
        item('e3', 'How far is the nearest hospital from the houses?', 'NONE'),
      ],
      ctx(),
      { device: { model: device, ready: true } },
    );
    expect(results.map((r) => [r.predicted, r.pass])).toEqual([
      ['R001', false],
      ['NONE', false],
      ['R002', false],
    ]);
  });

  it('fails the right rule when its answer could not be checked against the rulebook', async () => {
    const device = new ScriptedDevice(['R004']);
    const [r] = await runExam(
      [item('e1', 'How many toilets for 400 people?', 'R004')],
      ctx(false),
      {
        device: { model: device, ready: true },
      },
    );
    expect(r).toMatchObject({
      predicted: 'R004',
      verified: false,
      pass: false,
      reason: 'VALIDATION_FAILED',
    });
  });

  it('records a device error as ERROR, and stops after too many in a row', async () => {
    const err = () => new DeviceError('session crashed', 'FAILED');
    const ok = await runExam([item('e1', 'How many toilets for 400 people?', 'R004')], ctx(), {
      device: { model: new ScriptedDevice([err()]), ready: true },
    });
    expect(ok[0]).toMatchObject({ predicted: 'ERROR', pass: false, reason: 'DEVICE_ERROR' });

    const many = Array.from({ length: 6 }, (_, i) =>
      item(`e${i}`, 'How many toilets for 400 people?', 'R004'),
    );
    await expect(
      runExam(many, ctx(), {
        device: { model: new ScriptedDevice(many.map(err)), ready: true },
        maxConsecutiveDeviceErrors: 3,
      }),
    ).rejects.toMatchObject({ code: 'DEVICE_FAILING' });
  });

  it('refuses to run without a ready device, and can be stopped', async () => {
    const device = { model: new ScriptedDevice([]), ready: false };
    await expect(runExam([item('e1', 'q?', 'R001')], ctx(), { device })).rejects.toMatchObject({
      code: 'DEVICE_UNAVAILABLE',
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      runExam([item('e1', 'q?', 'R001')], ctx(), {
        device: { model: new ScriptedDevice([]), ready: true },
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ code: 'STOPPED' });
  });

  it('says mock for the test stand-in and device for Gemini Nano', () => {
    expect(measuredOn({ model: new MockDeviceModel({ errorRate: 0 }), ready: true })).toBe('mock');
    expect(measuredOn({ model: new ScriptedDevice([]), ready: true })).toBe('device');
  });
});
