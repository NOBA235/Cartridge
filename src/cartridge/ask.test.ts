/**
 * The Ask pipeline end to end, with the test-only stand-in device
 * (src/testing/mockDevice.ts, results labelled 'mock') and a fake cloud.
 * These tests check routing and validation, not Gemini Nano's quality.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import { DeviceError, type DeviceModel } from '@/ai/deviceModel';
import type { EscalationReason } from '@/ai/router';
import { asPrivate, declassify, grantApproval, isPublic, type Public } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import { MockDeviceModel } from '@/testing/mockDevice';
import {
  askQuestion,
  type ApprovalRequest,
  type AskContext,
  type AskDeps,
  type QueueInput,
} from './ask';
import type { CloudAnswerReply } from './askPrompts';
import { buildRuleIndex } from './retrieve';
import type { Cartridge } from './types';
import { prepareSource, verifyQuote } from './verifyQuote';

function context(cartridge: Cartridge = FIELD_CARTRIDGE, withSource = true): AskContext {
  return {
    cartridge,
    index: buildRuleIndex(cartridge),
    ...(withSource ? { source: FIELD_SOURCE, prepared: prepareSource(FIELD_SOURCE) } : {}),
  };
}

const NOT_COVERED: CloudAnswerReply = {
  answer: '',
  ruleId: null,
  quote: null,
  quantity: -1,
  covered: false,
};

interface Setup {
  device?: DeviceModel;
  ready?: boolean;
  online?: boolean;
  cloudAllowed?: boolean;
  approve?: boolean;
  reply?: CloudAnswerReply | Error;
}

function setup(opts: Setup = {}) {
  const device = opts.device ?? new MockDeviceModel({ errorRate: 0 });
  const selectSpy = vi.spyOn(device, 'selectRule');
  const cloudCalls: Array<{ task: string; prompt: Public<string> }> = [];
  const cloud: CloudJson = async (task, prompt, schema) => {
    cloudCalls.push({ task: task.name, prompt });
    const reply = opts.reply ?? NOT_COVERED;
    if (reply instanceof Error) throw reply;
    return { data: schema.parse(reply), inferenceSource: 'in_cloud', attempts: 1 };
  };
  const approvals: ApprovalRequest[] = [];
  const queued: QueueInput[] = [];
  const deps: AskDeps = {
    device: { model: device, ready: opts.ready ?? true },
    cloud,
    online: () => opts.online ?? true,
    cloudAllowed: opts.cloudAllowed ?? true,
    approve: async (req) => {
      approvals.push(req);
      if (opts.approve === false) return null;
      // The real privacy path: approval for exactly this text, then declassify.
      return declassify(
        req.question,
        grantApproval(req.question.value, { purpose: 'test', scope: 'ask' }),
      );
    },
    enqueue: async (item) => {
      queued.push(item);
      return { id: `q${queued.length}` };
    },
    now: () => new Date('2026-11-16T12:00:00Z'),
  };
  return { deps, selectSpy, cloudCalls, approvals, queued };
}

const ask = (q: string, s: ReturnType<typeof setup>, ctx = context()) =>
  askQuestion(asPrivate(q, 'user-question'), ctx, s.deps);

beforeEach(() => egressLog._reset());

describe('test fixture', () => {
  it('has a quote that verifies for every rule', () => {
    for (const r of FIELD_CARTRIDGE.rules)
      expect(verifyQuote(r.source.quote, FIELD_SOURCE).ok, r.id).toBe(true);
  });
});

type Expect =
  | { route: 'device'; ruleId: string; calc?: string; hint?: boolean }
  | { route: 'cloud' | 'queue' | 'local-only'; reason: EscalationReason };

/** A device that always answers a fixed rule (for out-of-candidate and error cases). */
class FixedDevice implements DeviceModel {
  readonly kind = 'firebase' as const;
  private readonly ruleId: string | Error;
  constructor(ruleId: string | Error) {
    this.ruleId = ruleId;
  }
  async prepare() {
    return { state: 'ready' as const, kind: this.kind };
  }
  async selectRule() {
    if (this.ruleId instanceof Error) throw this.ruleId;
    return { ruleId: this.ruleId, quantity: -1, source: 'mock' as const };
  }
}

const brokenQuote: Cartridge = {
  ...FIELD_CARTRIDGE,
  id: 'ctg-broken',
  rules: FIELD_CARTRIDGE.rules.map((r) =>
    r.id === 'R002' ? { ...r, source: { ...r.source, quote: 'Water points can be anywhere.' } } : r,
  ),
};

const SCRIPT: Array<{ q: string; setup?: Setup; ctx?: AskContext; expect: Expect }> = [
  {
    q: 'How many toilets do we need for 400 people?',
    expect: { route: 'device', ruleId: 'R004', calc: '400 people ÷ 20 = 20 toilets' },
  },
  {
    q: 'How much drinking water per day for 120 people?',
    expect: { route: 'device', ruleId: 'R001', calc: '120 people × 15 = 1,800 litres' },
  },
  {
    q: 'How far can the water point be from the houses?',
    expect: { route: 'device', ruleId: 'R002' },
  },
  {
    q: 'What chlorine level makes tap water safe to drink?',
    expect: { route: 'device', ruleId: 'R003' },
  },
  {
    q: 'How far from a borehole should we dig the latrines?',
    expect: { route: 'device', ruleId: 'R005' },
  },
  {
    q: 'Do we need handwashing stations at each toilet block?',
    expect: { route: 'device', ruleId: 'R006' },
  },
  {
    q: 'How many grams of bathing soap for 30 people?',
    expect: { route: 'device', ruleId: 'R007', calc: '30 people × 250 = 7,500 grams' },
  },
  {
    q: 'How big should the shelter living space be for 6 people?',
    expect: { route: 'device', ruleId: 'R008', calc: '6 people × 3.5 = 21 square metres' },
  },
  {
    q: 'How many toilets does this camp need?',
    expect: { route: 'device', ruleId: 'R004', hint: true },
  },
  {
    q: 'What is the radio frequency for the base camp?',
    expect: { route: 'cloud', reason: 'LOW_RETRIEVAL' },
  },
  { q: 'How do I treat a snake bite?', expect: { route: 'cloud', reason: 'LOW_RETRIEVAL' } },
  {
    q: 'What is the radio frequency for the base camp?',
    setup: { online: false },
    expect: { route: 'queue', reason: 'LOW_RETRIEVAL' },
  },
  {
    q: 'How do I treat a snake bite?',
    setup: { cloudAllowed: false },
    expect: { route: 'local-only', reason: 'LOW_RETRIEVAL' },
  },
  { q: 'latrnes for 200 ppl', expect: { route: 'cloud', reason: 'NO_MATCH' } },
  {
    q: 'latrnes for 200 ppl',
    setup: { online: false },
    expect: { route: 'queue', reason: 'NO_MATCH' },
  },
  {
    q: 'How many toilets for 50 people?',
    setup: { device: new FixedDevice('R008') },
    expect: { route: 'cloud', reason: 'VALIDATION_FAILED' },
  },
  {
    q: 'How far can the water point be from the houses?',
    ctx: context(brokenQuote),
    expect: { route: 'cloud', reason: 'VALIDATION_FAILED' },
  },
  {
    q: 'How far can the water point be from the houses?',
    ctx: context(FIELD_CARTRIDGE, false),
    expect: { route: 'cloud', reason: 'VALIDATION_FAILED' },
  },
  {
    q: 'How many toilets for 50 people?',
    setup: { device: new FixedDevice(new DeviceError('session crashed', 'FAILED')) },
    expect: { route: 'cloud', reason: 'DEVICE_ERROR' },
  },
  {
    q: 'How many toilets for 50 people?',
    setup: { ready: false },
    expect: { route: 'cloud', reason: 'DEVICE_UNAVAILABLE' },
  },
];

describe('20 scripted questions give the expected routes', () => {
  it.each(SCRIPT.map((s, i) => [i + 1, s] as const))('%i. %s', async (_n, s) => {
    const env = setup(s.setup);
    const a = await ask(s.q, env, s.ctx);
    const e = s.expect;
    if (e.route === 'device') {
      expect(a).toMatchObject({
        route: 'ON_DEVICE',
        status: 'verified',
        ruleId: e.ruleId,
        wordingFrom: 'rule',
        deviceSource: 'mock',
      });
      expect(a.quoteCheck?.ok).toBe(true);
      expect(env.cloudCalls).toHaveLength(0);
      expect(env.approvals).toHaveLength(0);
      if (e.calc) expect(a.calcLine).toContain(e.calc);
      if (e.hint) expect(a.calcHint).toMatch(/number of people/);
      return;
    }
    expect(a.reason).toBe(e.reason);
    if (e.reason === 'LOW_RETRIEVAL') expect(env.selectSpy).not.toHaveBeenCalled();
    if (e.route === 'cloud') {
      expect(env.approvals).toEqual([expect.objectContaining({ when: 'now', reason: e.reason })]);
      expect(env.cloudCalls.map((c) => c.task)).toEqual(['ANSWER']);
      expect(a.route).toBe('IN_CLOUD');
    }
    if (e.route === 'queue') {
      expect(env.approvals).toEqual([expect.objectContaining({ when: 'later' })]);
      expect(env.cloudCalls).toHaveLength(0);
      expect(env.queued).toHaveLength(1);
      expect(a).toMatchObject({ route: 'QUEUED', status: 'queued', queueId: 'q1' });
    }
    if (e.route === 'local-only') {
      expect(env.approvals).toHaveLength(0);
      expect(env.cloudCalls).toHaveLength(0);
      expect(env.queued).toHaveLength(0);
      expect(a.status).toBe('unanswered');
      expect(a.detail).toMatch(/is off, so nothing was sent/);
    }
  });
});

describe('cloud answers', () => {
  it('sends only a Public prompt that is exactly the approved preview', async () => {
    const env = setup({ ready: false });
    await ask('How many toilets for 50 people?', env);
    const call = env.cloudCalls[0];
    expect(call && isPublic(call.prompt)).toBe(true);
    expect(call?.prompt.value).toBe(env.approvals[0]?.plan.preview);
    expect(call?.prompt.origins).toEqual(
      expect.arrayContaining(['app', 'cartridge', 'source-document', 'declassified:ask']),
    );
    expect(call?.prompt.value).toContain('Question: How many toilets for 50 people?');
    expect(call?.prompt.value).toContain('Provide one toilet for every 20 people.');
  });

  it('builds the answer from the cited rule, and is verified when its quote is found', async () => {
    const env = setup({
      ready: false,
      reply: { answer: 'You need 10.', ruleId: 'R004', quote: null, quantity: 200, covered: true },
    });
    const a = await ask('latrines for 200 people', env);
    expect(a).toMatchObject({
      route: 'IN_CLOUD',
      status: 'verified',
      ruleId: 'R004',
      decision: 'Provide one toilet for every 20 people.',
      wordingFrom: 'rule',
    });
    expect(a.calcLine).toContain('200 people ÷ 20 = 10 toilets');
  });

  it('ignores a quantity the cloud did not take from the question', async () => {
    const env = setup({
      ready: false,
      reply: { answer: 'x', ruleId: 'R004', quote: null, quantity: 999, covered: true },
    });
    const a = await ask('How many toilets for 50 people?', env);
    expect(a.calcLine).toBeUndefined();
    expect(a.calcHint).toBeDefined();
  });

  it('marks a cloud answer verified only if its quote is found in the rulebook', async () => {
    const good = setup({
      ready: false,
      reply: {
        answer: 'At least 0.5 mg/l.',
        ruleId: null,
        quote: 'Free residual chlorine must be at least 0.5 mg per litre at the tap.',
        quantity: -1,
        covered: true,
      },
    });
    expect(await ask('What is the radio frequency?', good)).toMatchObject({
      status: 'verified',
      wordingFrom: 'cloud',
      quoteCheck: { ok: true, page: 1 },
    });

    const bad = setup({
      ready: false,
      reply: {
        answer: 'Boil for 10 minutes.',
        ruleId: null,
        quote: 'Boil all water for ten minutes.',
        quantity: -1,
        covered: true,
      },
    });
    expect(await ask('What is the radio frequency?', bad)).toMatchObject({
      status: 'escalated',
      wordingFrom: 'cloud',
      quoteCheck: { ok: false },
    });

    const none = setup({
      ready: false,
      reply: { answer: 'Boil it.', ruleId: null, quote: null, quantity: -1, covered: true },
    });
    expect((await ask('What is the radio frequency?', none)).status).toBe('escalated');
  });

  it('treats a rule ID that is not in the cartridge as no rule', async () => {
    const env = setup({
      ready: false,
      reply: { answer: 'x', ruleId: 'R999', quote: null, quantity: -1, covered: true },
    });
    const a = await ask('How many toilets for 50 people?', env);
    expect(a.ruleId).toBeUndefined();
    expect(a.status).toBe('escalated');
  });

  it('says when the rulebook does not cover the question, without the cloud’s own text', async () => {
    const env = setup({
      ready: false,
      reply: { answer: 'General advice', ruleId: null, quote: null, quantity: -1, covered: false },
    });
    const a = await ask('How do I treat a snake bite?', env);
    expect(a).toMatchObject({ status: 'escalated', notCovered: true });
    expect(a.decision).toBeUndefined();
  });

  it('keeps a proposed rule only if it passes the checks, and says why one was discarded', async () => {
    const proposal = {
      title: 'Shared toilets for short stays',
      when: 'A group stays only a few days',
      then: 'Short stays of under 3 days may use shared facilities.',
      exceptions: [],
      severity: 'minor',
      keywords: ['short stay'],
      section: 'Sanitation',
      quote: 'Short stays of under 3 days may use shared facilities.',
    };
    const reply = (proposedRule: unknown) =>
      setup({ ready: false, reply: { ...NOT_COVERED, covered: true, answer: 'a', proposedRule } });

    const yes = await ask('soap?', reply(proposal));
    expect(yes.proposal?.draft.title).toBe('Shared toilets for short stays');
    expect(yes.proposal?.page).toBe(2);
    expect(yes.proposalDiscarded).toBeUndefined();

    const invented = await ask('soap?', reply({ ...proposal, quote: 'invented' }));
    expect(invented.proposal).toBeUndefined();
    expect(invented.proposalDiscarded).toBe('Its quote was not found in the rulebook.');

    const duplicate = await ask(
      'soap?',
      reply({ ...proposal, quote: 'Provide 250 grams of bathing soap per person per month.' }),
    );
    expect(duplicate.proposalDiscarded).toMatch(/already the evidence of R007/);

    const noRulebook = await askQuestion(
      asPrivate('soap?', 'user-question'),
      context(FIELD_CARTRIDGE, false),
      reply(proposal).deps,
    );
    expect(noRulebook.proposalDiscarded).toMatch(/not on this device/);
  });
});

describe('user control', () => {
  it('sends nothing when the user keeps the question on this device', async () => {
    const env = setup({ ready: false, approve: false });
    const a = await ask('How many toilets for 50 people?', env);
    expect(a).toMatchObject({ status: 'unanswered', route: 'ON_DEVICE' });
    expect(a.detail).toMatch(/kept the question on this device/);
    expect(env.cloudCalls).toHaveLength(0);
    expect(env.queued).toHaveLength(0);
  });

  it('queues the approved question when the signal drops during the cloud call', async () => {
    const env = setup({ ready: false, reply: new CloudError('No signal', 'OFFLINE', 0) });
    const a = await ask('How many toilets for 50 people?', env);
    expect(a).toMatchObject({ route: 'QUEUED', status: 'queued' });
    expect(env.queued[0]?.question).toBe('How many toilets for 50 people?');
  });

  it('reports a cloud failure without pretending to answer', async () => {
    const env = setup({ ready: false, reply: new CloudError('quota exceeded', 'FAILED', 3) });
    const a = await ask('How many toilets for 50 people?', env);
    expect(a).toMatchObject({ route: 'IN_CLOUD', status: 'unanswered' });
    expect(a.detail).toMatch(/quota exceeded/);
  });
});
