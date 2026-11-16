/**
 * Rule calculations. The device model only extracts the quantity from the
 * question; code does the arithmetic.
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

/** Removes floating-point noise such as 45.00000000000001 before rounding. */
function clean(n: number): number {
  return Number(n.toPrecision(12));
}

export interface CalcResult {
  input: number;
  raw: number;
  result: number;
  /** For example: "400 people ÷ 20 = 20 toilets (rounded up)". */
  line: string;
}

function unitOf(name: string, unit: string): string {
  return unit.trim() || name;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** Returns undefined for a missing or unusable quantity (negative, zero, not finite). */
export function computeCalc(calc: Calc, quantity: number): CalcResult | undefined {
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  const raw = clean(calc.op === 'divide' ? quantity / calc.factor : quantity * calc.factor);
  const result =
    calc.rounding === 'ceil'
      ? Math.ceil(raw)
      : calc.rounding === 'floor'
        ? Math.floor(raw)
        : Math.round(raw);
  const sign = calc.op === 'divide' ? '÷' : '×';
  const rounded = result === raw ? '' : ` (${fmt(raw)}, ${ROUNDING[calc.rounding]})`;
  const line = `${fmt(quantity)} ${unitOf(calc.inputLabel, calc.inputUnit)} ${sign} ${fmt(calc.factor)} = ${fmt(result)} ${unitOf(calc.outputLabel, calc.outputUnit)}${rounded}`;
  return { input: quantity, raw, result, line };
}
