import { describe, expect, it } from 'vitest';
import { describeCalc } from './calc';
import {
  exportCartridgeJson,
  exportFileName,
  importCartridgeJson,
  ImportError,
} from './cartridgeIO';
import type { Cartridge } from './types';

const cartridge: Cartridge = {
  id: 'ctg-a',
  name: 'Field Standards 2026.pdf',
  version: 2,
  parentVersion: 1,
  createdAt: '2026-11-16T00:00:00.000Z',
  sourceHash: 'ab'.repeat(32),
  sourceName: 'Field Standards 2026.pdf',
  sourceLicence: 'CC BY 4.0',
  rules: [
    {
      id: 'R001',
      title: 'Toilets per number of people',
      when: 'Deciding how many toilets a site needs',
      then: 'Provide one toilet for every 20 people.',
      exceptions: [],
      severity: 'major',
      keywords: ['toilets'],
      source: { section: 'Sanitation', page: 2, quote: 'one toilet for every 20 people' },
      calc: {
        op: 'divide',
        factor: 20,
        inputLabel: 'people',
        inputUnit: 'people',
        outputLabel: 'toilets',
        outputUnit: 'toilets',
        rounding: 'ceil',
      },
    },
  ],
  changelog: ['Version 1: made.'],
};

describe('cartridge export and import', () => {
  it('round-trips, with a new id and a changelog line', () => {
    const back = importCartridgeJson(exportCartridgeJson(cartridge), {
      newId: () => 'ctg-b',
      now: new Date('2026-11-17T08:00:00Z'),
    });
    expect(back).toEqual({
      ...cartridge,
      id: 'ctg-b',
      changelog: ['Version 1: made.', 'Imported from a file on 2026-11-17.'],
    });
  });

  it('accepts a bare cartridge object', () => {
    expect(importCartridgeJson(JSON.stringify(cartridge), { newId: () => 'x' }).rules).toHaveLength(
      1,
    );
  });

  it('rejects text that is not JSON', () => {
    expect(() => importCartridgeJson('{nope')).toThrow(ImportError);
  });

  it('rejects JSON that is not a cartridge, saying where', () => {
    const bad = JSON.stringify({
      format: 'cartridge',
      formatVersion: 1,
      cartridge: { ...cartridge, rules: [{ id: 'X1' }] },
    });
    expect(() => importCartridgeJson(bad)).toThrow(/not a cartridge file \(cartridge\.rules/);
  });

  it('rejects duplicate rule IDs', () => {
    const dup = { ...cartridge, rules: [cartridge.rules[0], cartridge.rules[0]] };
    expect(() => importCartridgeJson(JSON.stringify(dup))).toThrow(ImportError);
  });

  it('makes a readable file name', () => {
    expect(exportFileName(cartridge)).toBe('field-standards-2026-v2.cartridge.json');
  });
});

describe('describeCalc', () => {
  it('writes the arithmetic in plain words', () => {
    expect(describeCalc(cartridge.rules[0]?.calc ?? ({} as never))).toBe(
      'toilets = people ÷ 20, rounded up',
    );
    expect(
      describeCalc({
        op: 'multiply',
        factor: 15,
        inputLabel: 'people',
        inputUnit: '',
        outputLabel: 'water per day',
        outputUnit: 'litres',
        rounding: 'round',
      }),
    ).toBe('water per day (litres) = people × 15, rounded to the nearest whole number');
  });
});
