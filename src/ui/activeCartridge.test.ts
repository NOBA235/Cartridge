import { describe, expect, it } from 'vitest';
import type { Cartridge, ExamReport } from '@/cartridge/types';
import { cartridgeLabel } from './activeCartridge';

const rules = (n: number) => Array.from({ length: n }) as Cartridge['rules'];

const report = (over: Partial<ExamReport> = {}): ExamReport => ({
  ranAt: '2026-11-14T00:00:00.000Z',
  measuredOn: 'device',
  passRate: 0.8,
  criticalPassRate: 1,
  outOfScopeRate: 1,
  heldOutPassRate: 10 / 12,
  failures: [],
  ready: true,
  ...over,
});

const tally = (passed: number, total: number) => ({ passed, total });

describe('cartridgeLabel', () => {
  it('names the cartridge without the file extension', () => {
    const l = cartridgeLabel({ name: 'Field standards.pdf', rules: rules(9) });
    expect(l.title).toBe('Field standards');
    expect(l.full).toBe('Field standards, 9 rules, not tested yet');
  });

  it('keeps a name that is only an extension', () => {
    expect(cartridgeLabel({ name: '.pdf', rules: rules(1) }).title).toBe('.pdf');
  });

  it('says one rule, not one rules', () => {
    expect(cartridgeLabel({ name: 'A', rules: rules(1) }).rules).toBe('1 rule');
  });

  it('gives held-out counts when the test ran on this device', () => {
    const counts = {
      practiceStart: tally(5, 20),
      practice: tally(18, 20),
      heldOut: tally(10, 12),
      heldOutCritical: tally(4, 4),
      heldOutOutOfScope: tally(2, 2),
    };
    const l = cartridgeLabel({ name: 'A', rules: rules(9), report: report({ counts }) });
    expect(l.tested).toBe('passed 10 of 12');
  });

  it('gives the test pass rate when there are no counts', () => {
    expect(cartridgeLabel({ name: 'A', rules: rules(9), report: report() }).tested).toBe(
      'test pass rate 83%',
    );
  });

  it('never presents a result from the test double as measured', () => {
    const l = cartridgeLabel({
      name: 'A',
      rules: rules(9),
      report: report({ measuredOn: 'mock' }),
    });
    expect(l.tested).toBe('not measured on a real device');
  });
});
