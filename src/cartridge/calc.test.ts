import { describe, expect, it } from 'vitest';
import { quantityInQuestion } from './answer';
import { computeCalc } from './calc';
import type { Calc } from './types';

const toilets: Calc = {
  op: 'divide',
  factor: 20,
  inputLabel: 'people',
  inputUnit: 'people',
  outputLabel: 'toilets',
  outputUnit: 'toilets',
  rounding: 'ceil',
};
const water: Calc = {
  op: 'multiply',
  factor: 15,
  inputLabel: 'people',
  inputUnit: 'people',
  outputLabel: 'water per day',
  outputUnit: 'litres',
  rounding: 'ceil',
};
const space: Calc = {
  op: 'multiply',
  factor: 3.5,
  inputLabel: 'people',
  inputUnit: '',
  outputLabel: 'covered space',
  outputUnit: 'square metres',
  rounding: 'round',
};

describe('computeCalc', () => {
  it('divides and rounds up', () => {
    expect(computeCalc(toilets, 400)).toMatchObject({
      result: 20,
      line: '400 people ÷ 20 = 20 toilets',
    });
    expect(computeCalc(toilets, 401)).toMatchObject({
      result: 21,
      line: '401 people ÷ 20 = 21 toilets (20.05, rounded up)',
    });
  });

  it('multiplies, with thousands separators in the line', () => {
    expect(computeCalc(water, 120)?.line).toBe('120 people × 15 = 1,800 litres');
  });

  it('rounds to the nearest whole number and handles decimal factors', () => {
    expect(computeCalc(space, 5)).toMatchObject({ raw: 17.5, result: 18 });
    expect(computeCalc(space, 6)?.line).toBe('6 people × 3.5 = 21 square metres');
  });

  it('rounds down when the rule says so', () => {
    expect(computeCalc({ ...toilets, rounding: 'floor' }, 39)?.result).toBe(1);
  });

  it('removes floating-point noise before rounding up', () => {
    // 0.1 * 3 is 0.30000000000000004 in floating point; ceil must not turn 30 into 31.
    expect(computeCalc({ ...water, factor: 0.1 }, 300)?.result).toBe(30);
  });

  it('refuses a missing, zero, negative or non-finite quantity', () => {
    for (const q of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(computeCalc(toilets, q)).toBeUndefined();
  });
});

describe('quantityInQuestion', () => {
  it('accepts only a number written in the question', () => {
    expect(quantityInQuestion(400, 'toilets for 400 people')).toBe(true);
    expect(quantityInQuestion(1200, 'for 1,200 people')).toBe(true);
    expect(quantityInQuestion(2.5, 'a 2.5 km walk')).toBe(true);
    expect(quantityInQuestion(500, 'toilets for 400 people')).toBe(false);
    expect(quantityInQuestion(-1, 'toilets for 400 people')).toBe(false);
  });
});
