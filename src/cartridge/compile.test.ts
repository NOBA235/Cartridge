/**
 * compileCartridge with a fake cloud (tests cannot call Gemini). The fake
 * validates replies with the same zod schemas the real cloudJson uses.
 */
import { describe, expect, it } from 'vitest';
import { CloudError, type CloudJson } from '@/ai/cloud';
import { isPublic, type Public } from '@/privacy';
import { chunkSource } from './chunker';
import {
  cleanQuote,
  compileCartridge,
  CompileError,
  inventedNumbers,
  numbersIn,
  type CompileProgress,
} from './compile';
import { buildDraftFromPages, confirmSource, type SourceDoc } from './source';
import { CartridgeSchema } from './types';
import { verifyQuote } from './verifyQuote';

const PAGES = [
  'Water supply\n\nProvide at least 15 litres of water per person per day for drinking, cooking and hygiene.\n\nWater points must be no more than 500 metres from any household.',
  'Sanitation\n\nProvide one toilet for every 20 people. Short stays of under 3 days may use shared facilities.\n\nToilets must be at least 30 metres from any groundwater source.',
  'Hygiene\n\nPlace a handwashing station within reach of every toilet block.',
];

async function source(pages = PAGES): Promise<SourceDoc> {
  return confirmSource(
    await buildDraftFromPages('Field standards.pdf', pages),
    'CC BY 4.0',
    new Date('2026-11-16T00:00:00Z'),
  );
}

const OPTIONS = { maxChunkChars: 300 };

type Draft = Record<string, unknown>;
function rule(overrides: Draft = {}): Draft {
  return {
    title: 'Water per person',
    when: 'Planning water for people',
    then: 'Provide at least 15 litres per person per day.',
    exceptions: [],
    severity: 'critical',
    keywords: ['water', 'litres', 'drinking water', 'how much water', 'per person', 'daily'],
    section: 'Water supply',
    page: 9,
    quote: 'Provide at least 15 litres of water per person per day',
    ...overrides,
  };
}

const TOILETS = rule({
  title: 'Toilets per number of people',
  when: 'Deciding how many toilets a site needs',
  then: 'Provide one toilet for every 20 people.',
  exceptions: ['Short stays of under 3 days may use shared facilities.'],
  severity: 'major',
  keywords: ['toilets', 'latrines'],
  section: 'Sanitation',
  quote: 'Provide one toilet for every 20 people.',
  calc: {
    op: 'divide',
    factor: 20,
    inputLabel: 'people',
    inputUnit: 'people',
    outputLabel: 'toilets',
    outputUnit: 'toilets',
    rounding: 'ceil',
  },
});

const HANDWASH = rule({
  title: 'Handwashing near toilets',
  when: 'Setting up toilet blocks',
  then: 'Place a handwashing station within reach of every toilet block.',
  severity: 'minor',
  keywords: ['handwashing', 'soap'],
  section: 'Hygiene',
  quote: 'Place a handwashing station within reach of every toilet block.',
});

interface Call {
  task: string;
  prompt: Public<string>;
}

type Handler = (task: string, prompt: string, call: number) => unknown;

/** Replies by section: the handler sees the prompt and returns the raw JSON (or an Error). */
function fakeCloud(handler: Handler) {
  const calls: Call[] = [];
  const cloud: CloudJson = async (task, prompt, schema) => {
    calls.push({ task: task.name, prompt });
    const raw = handler(task.name, prompt.value, calls.length);
    if (raw instanceof Error) throw raw;
    return { data: schema.parse(raw), inferenceSource: 'in_cloud', attempts: 1 };
  };
  return { cloud, calls };
}

/** Standard replies: one good rule per page. */
const bySection =
  (
    map: { water?: Draft[]; sanitation?: Draft[]; hygiene?: Draft[] },
    repair?: (prompt: string) => unknown,
  ): Handler =>
  (task, prompt) => {
    if (task === 'REPAIR_QUOTE') return repair ? repair(prompt) : { repairs: [] };
    if (prompt.includes('Water supply')) return { rules: map.water ?? [] };
    if (prompt.includes('Sanitation')) return { rules: map.sanitation ?? [] };
    if (prompt.includes('Hygiene')) return { rules: map.hygiene ?? [] };
    return { rules: [] };
  };

describe('helpers', () => {
  it('finds numbers, ignoring thousands separators', () => {
    expect(numbersIn('1,000 people, 2.5 km, 15 litres and 3/4')).toEqual([
      '1000',
      '2.5',
      '15',
      '3',
      '4',
    ]);
    expect(
      inventedNumbers('Provide 16 litres for 1,000 people', 'Provide 15 litres for 1000 people'),
    ).toEqual(['16']);
    expect(inventedNumbers('No numbers here', 'x')).toEqual([]);
  });

  it('cleans quotes copied from the prompt', () => {
    expect(cleanQuote('  “Provide at least [p. 2]\n 15 litres…”  ')).toBe(
      'Provide at least 15 litres',
    );
    expect(cleanQuote('...per person per day')).toBe('per person per day');
  });
});

describe('compileCartridge', () => {
  it('reads every section once (the test source makes 3)', async () => {
    expect(chunkSource(await source(), { maxChars: OPTIONS.maxChunkChars })).toHaveLength(3);
  });

  it('keeps verified rules, numbers them in source order and uses the verified page', async () => {
    const src = await source();
    const { cloud } = fakeCloud(
      bySection({ water: [rule()], sanitation: [TOILETS], hygiene: [HANDWASH] }),
    );
    const res = await compileCartridge(src, {
      cloud,
      options: OPTIONS,
      newId: () => 'ctg-1',
      now: () => new Date('2026-11-16T10:00:00Z'),
    });

    expect(res.cartridge.rules.map((r) => [r.id, r.title, r.source.page])).toEqual([
      ['R001', 'Water per person', 1],
      ['R002', 'Toilets per number of people', 2],
      ['R003', 'Handwashing near toilets', 3],
    ]);
    expect(res.cartridge).toMatchObject({
      id: 'ctg-1',
      name: 'Field standards.pdf',
      version: 1,
      sourceHash: src.hash,
      sourceLicence: 'CC BY 4.0',
      createdAt: '2026-11-16T10:00:00.000Z',
    });
    expect(res.cartridge.changelog[0]).toMatch(/3 rules kept, 0 left out/);
    expect(CartridgeSchema.safeParse(res.cartridge).success).toBe(true);
    for (const r of res.cartridge.rules) expect(verifyQuote(r.source.quote, src).ok).toBe(true);
    expect(res.stats).toMatchObject({
      sections: 3,
      sectionsRead: 3,
      extracted: 3,
      checked: 3,
      verified: 3,
      kept: 3,
    });
    expect(res.cartridge.rules[1]?.calc?.factor).toBe(20);
    expect(res.cartridge.rules[1]?.exceptions).toEqual([
      'Short stays of under 3 days may use shared facilities.',
    ]);
  });

  it('sends only Public prompts made from the source, with page markers', async () => {
    const { cloud, calls } = fakeCloud(bySection({ water: [rule()] }));
    await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(calls.map((c) => c.task)).toEqual(['COMPILE', 'COMPILE', 'COMPILE']);
    for (const c of calls) {
      expect(isPublic(c.prompt)).toBe(true);
      expect(c.prompt.origins).toEqual(expect.arrayContaining(['app', 'source-document']));
    }
    expect(calls[1]?.prompt.value).toContain('[p. 2]\nSanitation');
  });

  it('cleans a quote that carries a page marker, line breaks and quotation marks', async () => {
    const { cloud, calls } = fakeCloud(
      bySection({
        water: [
          rule({ quote: '"Provide at least\n15 litres [p. 1] of water per person per day"' }),
        ],
      }),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules[0]?.source.quote).toBe(
      'Provide at least 15 litres of water per person per day',
    );
    expect(calls.some((c) => c.task === 'REPAIR_QUOTE')).toBe(false);
  });

  it('asks once more for a wrong quote and keeps the rule if the new quote verifies', async () => {
    let repairPrompt = '';
    const { cloud, calls } = fakeCloud(
      bySection({ water: [rule({ quote: 'Give every person 15 litres a day' })] }, (prompt) => {
        repairPrompt = prompt;
        return { repairs: [{ index: 0, quote: 'at least 15 litres of water per person per day' }] };
      }),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(calls.filter((c) => c.task === 'REPAIR_QUOTE')).toHaveLength(1);
    expect(repairPrompt).toContain('Give every person 15 litres a day');
    expect(repairPrompt).toContain('Provide at least 15 litres of water per person per day');
    expect(res.cartridge.rules[0]?.source.quote).toBe(
      'at least 15 litres of water per person per day',
    );
    expect(res.stats.repaired).toBe(1);
    expect(res.dropped).toEqual([]);
  });

  it('leaves out a rule whose quote still fails, with the reason', async () => {
    const { cloud } = fakeCloud(
      bySection(
        { water: [rule({ quote: 'Give every person 15 litres a day' })], sanitation: [TOILETS] },
        () => ({ repairs: [{ index: 0, quote: null }] }),
      ),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules.map((r) => r.title)).toEqual(['Toilets per number of people']);
    expect(res.dropped).toEqual([
      expect.objectContaining({ title: 'Water per person', reason: 'QUOTE_NOT_FOUND', section: 1 }),
    ]);
    expect(res.dropped[0]?.detail).toMatch(/could not be found/);
  });

  it('leaves out a rule whose repaired quote is still not in the source', async () => {
    const { cloud } = fakeCloud(
      bySection(
        {
          water: [
            rule({ quote: 'wrong' }),
            rule({
              title: 'Distance to water',
              quote: 'Water points must be no more than 500 metres from any household.',
              then: 'Keep water points within 500 metres.',
            }),
          ],
        },
        () => ({
          repairs: [{ index: 0, quote: 'still not a real passage' }],
        }),
      ),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules.map((r) => r.title)).toEqual(['Distance to water']);
    expect(res.dropped[0]).toMatchObject({
      reason: 'QUOTE_NOT_FOUND',
      quote: 'still not a real passage',
    });
  });

  it('asks again for a quote over the configured max quote length', async () => {
    const long = `${PAGES[0] ?? ''} ${'x'.repeat(500)}`;
    const { cloud } = fakeCloud(
      bySection({ water: [rule({ quote: long })] }, () => ({
        repairs: [{ index: 0, quote: long }],
      })),
    );
    await expect(
      compileCartridge(await source(), { cloud, options: OPTIONS }),
    ).rejects.toMatchObject({
      code: 'NO_RULES',
      partial: { dropped: [expect.objectContaining({ reason: 'QUOTE_TOO_LONG' })] },
    });
  });

  it('leaves out a rule whose instruction has a number that is not in the section', async () => {
    const { cloud, calls } = fakeCloud(
      bySection({
        water: [
          rule({ then: 'Provide at least 16 litres per person per day.' }),
          rule({
            title: 'Distance to water',
            then: 'Keep water points within 500 metres.',
            quote: 'Water points must be no more than 500 metres from any household.',
          }),
        ],
      }),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.dropped[0]).toMatchObject({
      reason: 'NUMBER_NOT_IN_SOURCE',
      title: 'Water per person',
    });
    expect(res.dropped[0]?.detail).toContain('16');
    expect(calls.some((c) => c.task === 'REPAIR_QUOTE')).toBe(false);
  });

  it('removes a calculation whose factor is not in the quote, but keeps the rule', async () => {
    const calc = {
      op: 'multiply',
      factor: 12,
      inputLabel: 'people',
      inputUnit: 'people',
      outputLabel: 'water',
      outputUnit: 'litres',
      rounding: 'ceil',
    };
    const { cloud } = fakeCloud(bySection({ water: [rule({ calc })] }));
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules[0]?.calc).toBeUndefined();
    expect(res.notes[0]?.message).toMatch(/factor 12/);
  });

  it('leaves out a rule in the wrong shape and keeps the others', async () => {
    const { cloud } = fakeCloud(
      bySection({ water: [{ title: 'Broken rule', severity: 'urgent' }, rule()] }),
    );
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules).toHaveLength(1);
    expect(res.dropped[0]).toMatchObject({ title: 'Broken rule', reason: 'INVALID' });
  });

  it('removes a duplicate read twice through the section overlap and merges its keywords', async () => {
    // The last paragraph of section 2 is repeated at the start of section 3.
    const ground = rule({
      title: 'Toilet distance from groundwater',
      then: 'Keep toilets at least 30 metres from any groundwater source.',
      severity: 'critical',
      keywords: ['toilet distance', 'groundwater'],
      quote: 'Toilets must be at least 30 metres from any groundwater source.',
    });
    const again = {
      ...ground,
      title: 'Latrines away from groundwater',
      keywords: ['latrine', 'well'],
    };
    const { cloud } = fakeCloud((task, prompt) => {
      if (task === 'REPAIR_QUOTE') return { repairs: [] };
      if (prompt.includes('Sanitation')) return { rules: [ground] };
      if (prompt.includes('Hygiene')) return { rules: [again] };
      return { rules: [] };
    });
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.cartridge.rules.map((r) => r.title)).toEqual(['Toilet distance from groundwater']);
    expect(res.cartridge.rules[0]?.keywords).toEqual([
      'toilet distance',
      'groundwater',
      'latrine',
      'well',
    ]);
    expect(res.dropped).toEqual([
      expect.objectContaining({ title: 'Latrines away from groundwater', reason: 'DUPLICATE' }),
    ]);
  });

  it('checks numbers against the section the rule came from', async () => {
    const { cloud } = fakeCloud((task, prompt) => {
      if (task === 'REPAIR_QUOTE') return { repairs: [] };
      if (prompt.includes('Sanitation')) return { rules: [TOILETS] };
      if (prompt.includes('Hygiene'))
        return { rules: [{ ...TOILETS, title: 'Toilet ratio again' }] };
      return { rules: [] };
    });
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.dropped).toEqual([
      expect.objectContaining({
        title: 'Toilet ratio again',
        reason: 'NUMBER_NOT_IN_SOURCE',
        section: 3,
      }),
    ]);
  });

  it('caps the number of rules, keeping more severe rules first', async () => {
    const { cloud } = fakeCloud(
      bySection({ water: [rule()], sanitation: [TOILETS], hygiene: [HANDWASH] }),
    );
    const res = await compileCartridge(await source(), {
      cloud,
      options: { ...OPTIONS, maxRules: 2 },
    });
    expect(res.cartridge.rules.map((r) => [r.id, r.severity])).toEqual([
      ['R001', 'critical'],
      ['R002', 'major'],
    ]);
    expect(res.dropped).toEqual([
      expect.objectContaining({ title: 'Handwashing near toilets', reason: 'OVER_CAP' }),
    ]);
  });

  it('stops on a usage limit or a refusal after a section succeeded, with nothing kept', async () => {
    for (const code of ['QUOTA', 'REFUSED'] as const) {
      const { cloud, calls } = fakeCloud((task, prompt) => {
        if (prompt.includes('Sanitation')) return new CloudError('Limit reached.', code, 3);
        return bySection({ water: [rule()], hygiene: [HANDWASH] })(task, prompt, 0);
      });
      await expect(
        compileCartridge(await source(), { cloud, options: OPTIONS }),
      ).rejects.toMatchObject({
        code: 'CLOUD',
        message: expect.stringMatching(/^Stopped at section 2 of \d+: Limit reached\.$/),
      });
      expect(calls.some((c) => c.prompt.value.includes('Hygiene'))).toBe(false);
    }
  });

  it('records a section that fails after another succeeded, and carries on', async () => {
    const { cloud } = fakeCloud((task, prompt) => {
      if (prompt.includes('Sanitation')) return new CloudError('quota exceeded', 'FAILED', 3);
      return bySection({ water: [rule()], hygiene: [HANDWASH] })(task, prompt, 0);
    });
    const res = await compileCartridge(await source(), { cloud, options: OPTIONS });
    expect(res.failedSections).toEqual([{ section: 2, error: 'quota exceeded' }]);
    expect(res.cartridge.rules).toHaveLength(2);
  });

  it('stops at once when the first section fails, instead of repeating a failing call', async () => {
    const { cloud, calls } = fakeCloud(
      () => new CloudError('App Check token is invalid', 'FAILED', 3),
    );
    await expect(
      compileCartridge(await source(), { cloud, options: OPTIONS }),
    ).rejects.toMatchObject({
      code: 'CLOUD',
      message: expect.stringContaining('App Check token is invalid'),
    });
    expect(calls).toHaveLength(1);
  });

  it('stops with OFFLINE when the signal is lost', async () => {
    const { cloud } = fakeCloud((task, prompt) =>
      prompt.includes('Sanitation')
        ? new CloudError('No signal', 'OFFLINE', 0)
        : bySection({ water: [rule()] })(task, prompt, 0),
    );
    await expect(
      compileCartridge(await source(), { cloud, options: OPTIONS }),
    ).rejects.toMatchObject({ code: 'OFFLINE' });
  });

  it('refuses a rulebook that was not confirmed as public, before any cloud call', async () => {
    const { cloud, calls } = fakeCloud(() => ({ rules: [] }));
    const unconfirmed = { ...(await source()), publicConfirmed: false } as unknown as SourceDoc;
    await expect(compileCartridge(unconfirmed, { cloud })).rejects.toMatchObject({
      code: 'NOT_PUBLIC',
    });
    expect(calls).toHaveLength(0);
  });

  it('fails with NO_RULES when nothing verifies', async () => {
    const { cloud } = fakeCloud(bySection({}));
    await expect(
      compileCartridge(await source(), { cloud, options: OPTIONS }),
    ).rejects.toBeInstanceOf(CompileError);
  });

  it('reports progress section by section', async () => {
    const events: CompileProgress[] = [];
    const { cloud } = fakeCloud(bySection({ water: [rule()], sanitation: [TOILETS] }));
    await compileCartridge(await source(), {
      cloud,
      options: OPTIONS,
      onProgress: (p) => events.push(p),
    });
    expect(events).toEqual([
      { step: 'reading', section: 1, sectionCount: 3 },
      { step: 'checking', verified: 1, checked: 1 },
      { step: 'reading', section: 2, sectionCount: 3 },
      { step: 'checking', verified: 2, checked: 2 },
      { step: 'reading', section: 3, sectionCount: 3 },
      { step: 'checking', verified: 2, checked: 2 },
      { step: 'finishing' },
    ]);
  });

  it('can be stopped between sections', async () => {
    const ctrl = new AbortController();
    const { cloud, calls } = fakeCloud((task, prompt) => {
      ctrl.abort();
      return bySection({ water: [rule()] })(task, prompt, 0);
    });
    await expect(
      compileCartridge(await source(), { cloud, options: OPTIONS, signal: ctrl.signal }),
    ).rejects.toMatchObject({
      code: 'STOPPED',
    });
    expect(calls).toHaveLength(1);
  });

  it('reads only the first sections when a limit is set', async () => {
    const { cloud, calls } = fakeCloud(bySection({ water: [rule()] }));
    const res = await compileCartridge(await source(), {
      cloud,
      options: { ...OPTIONS, sectionLimit: 1 },
    });
    expect(calls).toHaveLength(1);
    expect(res.stats.sections).toBe(1);
  });
});
