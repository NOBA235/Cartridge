import { describe, expect, it } from 'vitest';
import { FIELD_CARTRIDGE, FIELD_RULES, FIELD_SOURCE } from '@/testing/fieldFixture';
import {
  approveProposal,
  checkProposal,
  newProposalRecord,
  ProposalError,
  ProposalRecordSchema,
  type ProposalContext,
} from './proposals';
import { prepareSource } from './verifyQuote';

const ctx = (question = 'Can a transit group share toilets for two nights?'): ProposalContext => ({
  rules: FIELD_RULES,
  source: FIELD_SOURCE,
  prepared: prepareSource(FIELD_SOURCE),
  question,
});

const SHORT_STAY = {
  title: 'Shared toilets for short stays',
  when: 'A group stays only a few days',
  then: 'Short stays of under 3 days may use shared facilities.',
  exceptions: [],
  severity: 'minor',
  keywords: ['Short stay', 'short stay', 'transit'],
  section: 'Sanitation',
  page: 7,
  quote: '“Short stays of under 3 days may use [p. 2] shared facilities.”',
};

function ok(raw: unknown, c = ctx()) {
  const r = checkProposal(raw, c);
  if (!r?.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.proposal;
}

describe('checkProposal', () => {
  it('keeps a suggestion whose quote is in the rulebook, with the cleaned quote and the real page', () => {
    const p = ok(SHORT_STAY);
    expect(p.draft.quote).toBe('Short stays of under 3 days may use shared facilities.');
    expect(p.page).toBe(2);
    expect(p.draft.page).toBe(2);
    expect(p.draft.keywords).toEqual(['short stay', 'transit']);
    expect(p.similarTo).toBeUndefined();
    expect(FIELD_SOURCE.text.slice(p.start, p.end)).toBe(
      'Short stays of under 3 days may use shared facilities.',
    );
  });

  it('discards a suggestion whose quote is not in the rulebook, or too long', () => {
    expect(
      checkProposal({ ...SHORT_STAY, quote: 'Groups may always share toilets.' }, ctx()),
    ).toEqual({
      ok: false,
      reason: 'QUOTE_NOT_FOUND',
      detail: 'Its quote was not found in the rulebook.',
    });
    expect(checkProposal({ ...SHORT_STAY, quote: 'x'.repeat(301) }, ctx())).toMatchObject({
      reason: 'QUOTE_TOO_LONG',
    });
  });

  it('discards a suggestion whose instruction has a number that is not near its quote', () => {
    const r = checkProposal(
      { ...SHORT_STAY, then: 'Short stays of under 5 days may use shared facilities.' },
      ctx(),
    );
    expect(r).toMatchObject({ ok: false, reason: 'NUMBER_NOT_IN_SOURCE' });
    expect(r && !r.ok && r.detail).toContain('5');
  });

  it('discards a suggestion whose quote is already the evidence of a rule', () => {
    expect(
      checkProposal({ ...SHORT_STAY, quote: 'provide one toilet for every 20 people' }, ctx()),
    ).toEqual({
      ok: false,
      reason: 'DUPLICATE',
      detail: 'Its quote is already the evidence of R004 ‘Toilets per number of people’.',
    });
  });

  it('removes a calculation whose factor is not in the quote, and keeps one that is', () => {
    const calc = {
      op: 'divide',
      factor: 4,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'toilets',
      outputUnit: 'toilets',
      rounding: 'ceil',
    };
    const removed = ok({ ...SHORT_STAY, calc });
    expect(removed.draft.calc).toBeNull();
    expect(removed.notes).toEqual([
      'Its calculation was removed: the factor 4 is not in the quote.',
    ]);
    const kept = ok({ ...SHORT_STAY, calc: { ...calc, factor: 3 } });
    expect(kept.draft.calc?.factor).toBe(3);
    expect(kept.notes).toEqual([]);
  });

  it('points out a very similar rule, by title or by an overlapping quote', () => {
    expect(ok({ ...SHORT_STAY, title: 'Toilets per number of people' }).similarTo).toBe('R004');
    const overlap = ok({
      ...SHORT_STAY,
      then: 'Provide at least 15 litres of water per person per day.',
      quote:
        'Provide at least 15 litres of water per person per day for drinking, cooking and personal hygiene.',
    });
    expect(overlap.similarTo).toBe('R001');
  });

  it('lists words from the question that are not in the rulebook but ended up in the rule', () => {
    const p = ok(
      { ...SHORT_STAY, when: 'A transit group stays at Kakuma camp for a few days' },
      ctx('How many toilets for the Kakuma transit camp?'),
    );
    expect(p.questionWords.sort()).toEqual(['camp', 'kakuma', 'transit']);
    expect(ok(SHORT_STAY, ctx('How many toilets for the Kakuma camp?')).questionWords).toEqual([]);
  });

  it('returns nothing without a suggestion, and refuses one it cannot check', () => {
    expect(checkProposal(null, ctx())).toBeUndefined();
    expect(checkProposal(undefined, ctx())).toBeUndefined();
    expect(checkProposal(SHORT_STAY, { ...ctx(), source: undefined })).toMatchObject({
      reason: 'NO_SOURCE',
    });
    expect(checkProposal({ title: 'x' }, ctx())).toMatchObject({ reason: 'INVALID' });
  });
});

describe('approveProposal', () => {
  const record = newProposalRecord(ok(SHORT_STAY), {
    cartridgeId: 'ctg-field',
    baseVersion: 1,
    question: 'Can a transit group share toilets for two nights?',
    answer: 'Yes, under 3 days.',
    now: new Date('2026-11-17T08:00:00Z'),
    id: 'p1',
  });

  it('stores a valid record', () => {
    expect(ProposalRecordSchema.parse(record)).toEqual(record);
    expect(record.status).toBe('pending');
  });

  it('creates version N+1 with the rule under the next unused ID', () => {
    const { cartridge, rule } = approveProposal(record, {
      current: FIELD_CARTRIDGE,
      everyRuleId: ['R012'],
      source: FIELD_SOURCE,
      now: new Date('2026-11-17T09:00:00Z'),
    });
    expect(rule).toEqual({
      id: 'R013',
      title: 'Shared toilets for short stays',
      when: 'A group stays only a few days',
      then: 'Short stays of under 3 days may use shared facilities.',
      exceptions: [],
      severity: 'minor',
      keywords: ['short stay', 'transit'],
      source: {
        section: 'Sanitation',
        page: 2,
        quote: 'Short stays of under 3 days may use shared facilities.',
      },
    });
    expect(cartridge).toMatchObject({ version: 2, parentVersion: 1 });
    expect(cartridge.rules.at(-1)).toEqual(rule);
  });

  it('checks again against the current version, which may already have the rule', () => {
    const first = approveProposal(record, {
      current: FIELD_CARTRIDGE,
      everyRuleId: [],
      source: FIELD_SOURCE,
    });
    expect(() =>
      approveProposal(record, { current: first.cartridge, everyRuleId: [], source: FIELD_SOURCE }),
    ).toThrow(ProposalError);
    expect(() =>
      approveProposal(record, { current: FIELD_CARTRIDGE, everyRuleId: [], source: undefined }),
    ).toThrow(/not on this device/);
  });
});
