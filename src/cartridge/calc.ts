/**
 * Rule calculations. The device model only extracts the quantity from the
 * question; code does the arithmetic (Phase 3 adds compute()).
 */
import type { Calc } from './types';

const ROUNDING: Record<Calc['rounding'], string> = {
  ceil: 'rounded up',
  floor: 'rounded down',
  round: 'rounded to the nearest whole number',
};

function label(name: string, unit: string): string {
  const u = unit.trim();
  return u === '' || u.toLowerCase() === name.trim().toLowerCase() ? name : `${name} (${u})`;
}

/** For example: "toilets = people ÷ 20, rounded up". */
export function describeCalc(calc: Calc): string {
  const sign = calc.op === 'divide' ? '÷' : '×';
  return `${label(calc.outputLabel, calc.outputUnit)} = ${label(calc.inputLabel, calc.inputUnit)} ${sign} ${calc.factor}, ${ROUNDING[calc.rounding]}`;
}
