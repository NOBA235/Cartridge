import { describe, expect, it } from 'vitest';
import { SAMPLE_RULES } from '@/dev/sampleRules';
import { asPrivate, asPublic } from '@/privacy';
import { firstNumber, MockDeviceModel, seededRandom } from './mockDevice';

const ask = (text: string) => asPrivate(text, 'user-question');

describe('MockDeviceModel', () => {
  it('labels every result as mock', async () => {
    const m = new MockDeviceModel({ errorRate: 0 });
    expect(m.kind).toBe('mock');
    const sel = await m.selectRule({ question: ask('how much water'), candidates: SAMPLE_RULES });
    expect(sel.source).toBe('mock');
  });

  it('picks the rule with the most keyword overlap', async () => {
    const m = new MockDeviceModel({ errorRate: 0 });
    const cases: Array<[string, string]> = [
      ['How much drinking water do we need?', 'R001'],
      ['How many latrines for the camp?', 'R002'],
      ['Where should the soap and handwashing go?', 'R003'],
    ];
    for (const [q, expected] of cases) {
      expect((await m.selectRule({ question: ask(q), candidates: SAMPLE_RULES })).ruleId).toBe(expected);
    }
  });

  it('answers NONE when nothing overlaps', async () => {
    const m = new MockDeviceModel({ errorRate: 0 });
    const sel = await m.selectRule({ question: ask('What is the radio frequency?'), candidates: SAMPLE_RULES });
    expect(sel).toEqual({ ruleId: 'NONE', quantity: -1, source: 'mock' });
  });

  it('extracts the quantity only when the chosen rule has a calc', async () => {
    const m = new MockDeviceModel({ errorRate: 0 });
    const toilets = await m.selectRule({ question: ask('How many toilets for 1,200 people?'), candidates: SAMPLE_RULES });
    expect(toilets.quantity).toBe(1200);
    const hand = await m.selectRule({ question: ask('handwashing for 3 blocks'), candidates: SAMPLE_RULES });
    expect(hand.quantity).toBe(-1);
  });

  it('accepts Public exam questions too', async () => {
    const m = new MockDeviceModel({ errorRate: 0 });
    const sel = await m.selectRule({ question: asPublic('toilets needed', 'cloud-response'), candidates: SAMPLE_RULES });
    expect(sel.ruleId).toBe('R002');
  });

  it('always answers wrongly at error rate 1', async () => {
    const m = new MockDeviceModel({ errorRate: 1, seed: 7 });
    for (let i = 0; i < 20; i++) {
      const sel = await m.selectRule({ question: ask('how many toilets'), candidates: SAMPLE_RULES });
      expect(sel.ruleId).not.toBe('R002');
    }
  });

  it('injects roughly the configured error rate, reproducibly for a seed', async () => {
    const run = async () => {
      const m = new MockDeviceModel({ errorRate: 0.3, seed: 123 });
      const out: string[] = [];
      for (let i = 0; i < 200; i++) {
        out.push((await m.selectRule({ question: ask('how many toilets'), candidates: SAMPLE_RULES })).ruleId);
      }
      return out;
    };
    const a = await run();
    expect(a).toEqual(await run());
    const wrong = a.filter((id) => id !== 'R002').length / a.length;
    expect(wrong).toBeGreaterThan(0.2);
    expect(wrong).toBeLessThan(0.4);
  });

  it('rejects an invalid error rate', () => {
    expect(() => new MockDeviceModel({ errorRate: 1.5 })).toThrow();
  });

  it('simulates download progress ending at 1', async () => {
    const progress: number[] = [];
    const status = await new MockDeviceModel({ errorRate: 0, progressSteps: 2 }).prepare((p) => progress.push(p));
    expect(status).toEqual({ state: 'ready', kind: 'mock' });
    expect(progress).toEqual([0.5, 1]);
  });
});

describe('helpers', () => {
  it('seededRandom is deterministic and in [0, 1)', () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('firstNumber handles thousands separators and decimals', () => {
    expect(firstNumber('for 2,500 people')).toBe(2500);
    expect(firstNumber('1.5 km')).toBe(1.5);
    expect(firstNumber('none here')).toBe(-1);
  });
});
