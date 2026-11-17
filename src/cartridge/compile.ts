/**
 * Making a cartridge from a public rulebook ("compile").
 *
 * For each section (chunk) of the source:
 * 1. Ask the cloud for rules with COMPILE_PROMPT. Each rule is checked with zod
 *    on its own, so one malformed rule does not sink the section.
 * 2. Code checks every rule:
 *    - every number in its instruction ('then') must appear in the section;
 *    - its quote must be at most 300 characters and must verify against the
 *      source (verifyQuote, preferring a match inside this section).
 * 3. Rules whose quote failed are sent back once (REPAIR_QUOTE_PROMPT) asking
 *    for an exact passage from the section. What still fails is left out, and
 *    the reason is recorded.
 * Then the reduce step removes duplicates, applies the rule cap and assigns
 * IDs. The page shown for a rule is the page where its quote was found, never
 * the page the model claimed. A rule's calculation is kept only if its factor
 * appears in the verified quote.
 *
 * Every kept rule's quote is verified again at the end; if one ever failed,
 * compile throws instead of returning an unverified cartridge.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import { config } from '@/config';
import { asPublic, fillTemplate, type Public } from '@/privacy';
import { chunkSource, stripPageMarkers, type Chunk } from './chunker';
import {
  COMPILE_PROMPT,
  COMPILE_TASK,
  CompileReply,
  REPAIR_QUOTE_PROMPT,
  REPAIR_QUOTE_TASK,
  RepairReply,
  RuleDraftSchema,
  type RuleDraft,
} from './compilePrompts';
import { applyCap, assignIds, dedupe, type Candidate, type ReduceDropReason } from './reduce';
import type { SourceDoc } from './source';
import { CartridgeSchema, type Calc, type Cartridge } from './types';
import { prepareSource, verifyQuote, type PreparedSource } from './verifyQuote';

export type DropReason =
  'INVALID' | 'NUMBER_NOT_IN_SOURCE' | 'QUOTE_TOO_LONG' | 'QUOTE_NOT_FOUND' | ReduceDropReason;

export interface DroppedRule {
  title: string;
  reason: DropReason;
  /** Plain-language explanation shown in the UI. */
  detail: string;
  /** 1-based section number, when known. */
  section?: number;
  quote?: string;
}

export interface CompileNote {
  title: string;
  message: string;
}

export interface SectionFailure {
  section: number;
  error: string;
}

export type CompileProgress =
  | { step: 'reading'; section: number; sectionCount: number }
  | { step: 'checking'; verified: number; checked: number }
  | { step: 'repairing'; section: number; sectionCount: number; count: number }
  | { step: 'finishing' };

export interface CompileOptions {
  maxRules: number;
  maxChunkChars: number;
  titleSimilarity: number;
  maxQuoteChars: number;
  /** Read only the first N sections (smoke tests and cost control). */
  sectionLimit?: number;
}

export interface CompileStats {
  sections: number;
  sectionsRead: number;
  extracted: number;
  checked: number;
  verified: number;
  repaired: number;
  kept: number;
}

export interface CompileResult {
  cartridge: Cartridge;
  dropped: DroppedRule[];
  notes: CompileNote[];
  failedSections: SectionFailure[];
  stats: CompileStats;
}

export type CompileErrorCode =
  'NOT_PUBLIC' | 'EMPTY_SOURCE' | 'OFFLINE' | 'CLOUD' | 'STOPPED' | 'NO_RULES';

export class CompileError extends Error {
  override readonly name = 'CompileError';
  readonly code: CompileErrorCode;
  readonly partial?: { dropped: DroppedRule[]; failedSections: SectionFailure[] };
  constructor(message: string, code: CompileErrorCode, partial?: CompileError['partial']) {
    super(message);
    this.code = code;
    if (partial) this.partial = partial;
  }
}

export interface CompileDeps {
  cloud: CloudJson;
  onProgress?: (p: CompileProgress) => void;
  signal?: AbortSignal;
  options?: Partial<CompileOptions>;
  now?: () => Date;
  newId?: () => string;
}

// ---------- checks (exported for tests) ----------

/** Numbers as written, with thousands separators removed ("1,000" -> "1000"). */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize('NFKC').matchAll(/\d+(?:[.,]\d+)*/g)) {
    const s = m[0];
    out.push(/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s);
  }
  return out;
}

/** Numbers in `text` that do not appear anywhere in `source`. */
export function inventedNumbers(text: string, source: string): string[] {
  const known = new Set(numbersIn(source));
  return [...new Set(numbersIn(text))].filter((n) => !known.has(n));
}

/** Removes page markers, wrapping quotation marks, edge ellipses and extra whitespace. */
export function cleanQuote(quote: string): string {
  return stripPageMarkers(quote)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .replace(/^(?:\.\.\.|…)\s*|\s*(?:\.\.\.|…)$/g, '')
    .trim();
}

/** The factor as it would be written in the text, e.g. 20 -> "20", 0.5 -> "0.5". */
function factorAppears(calc: Calc, quote: string): boolean {
  return numbersIn(quote).some((n) => Number(n.replace(',', '.')) === calc.factor);
}

type QuoteCheck =
  | { ok: true; quote: string; start: number; end: number; page?: number }
  | { ok: false; reason: 'QUOTE_TOO_LONG' | 'QUOTE_NOT_FOUND'; quote: string };

function checkQuote(
  rawQuote: string,
  chunk: Chunk,
  prepared: PreparedSource,
  maxQuoteChars: number,
): QuoteCheck {
  const quote = cleanQuote(rawQuote);
  if (quote.length > maxQuoteChars) return { ok: false, reason: 'QUOTE_TOO_LONG', quote };
  const v = verifyQuote(quote, prepared, { preferRange: { start: chunk.start, end: chunk.end } });
  if (!v.ok) return { ok: false, reason: 'QUOTE_NOT_FOUND', quote };
  return {
    ok: true,
    quote,
    start: v.start,
    end: v.end,
    ...(v.page !== undefined ? { page: v.page } : {}),
  };
}

const DETAIL: Record<'QUOTE_TOO_LONG' | 'QUOTE_NOT_FOUND', string> = {
  QUOTE_TOO_LONG: 'Its quote was longer than 300 characters, also when asked again.',
  QUOTE_NOT_FOUND: 'Its quote could not be found in the rulebook, also when asked again.',
};

// ---------- compile ----------

function defaults(o: Partial<CompileOptions> | undefined): CompileOptions {
  return { ...config.compile, ...o };
}

function rawTitle(x: unknown): string {
  const t = (x as { title?: unknown } | null)?.title;
  return typeof t === 'string' && t.trim() !== '' ? t.trim() : '(untitled rule)';
}

export async function compileCartridge(
  source: SourceDoc,
  deps: CompileDeps,
): Promise<CompileResult> {
  // Run-time privacy gate: only sources the user confirmed as public may go to the cloud.
  if ((source as { publicConfirmed?: unknown }).publicConfirmed !== true) {
    throw new CompileError(
      'This rulebook has not been confirmed as a public document.',
      'NOT_PUBLIC',
    );
  }
  const opts = defaults(deps.options);
  const now = deps.now ?? (() => new Date());
  const progress = deps.onProgress ?? (() => {});
  const stopped = () => deps.signal?.aborted === true;

  const allChunks = chunkSource(source, { maxChars: opts.maxChunkChars });
  if (allChunks.length === 0) throw new CompileError('The rulebook has no text.', 'EMPTY_SOURCE');
  const chunks = allChunks.slice(0, opts.sectionLimit ?? allChunks.length);
  const prepared = prepareSource(source);

  const candidates: Candidate[] = [];
  const dropped: DroppedRule[] = [];
  const notes: CompileNote[] = [];
  const failedSections: SectionFailure[] = [];
  const stats: CompileStats = {
    sections: chunks.length,
    sectionsRead: 0,
    extracted: 0,
    checked: 0,
    verified: 0,
    repaired: 0,
    kept: 0,
  };

  const fail = (code: CompileErrorCode, message: string): never => {
    throw new CompileError(message, code, { dropped, failedSections });
  };

  const accept = (draft: RuleDraft, chunk: Chunk, q: Extract<QuoteCheck, { ok: true }>) => {
    let calc = draft.calc ?? undefined;
    if (calc && !factorAppears(calc, q.quote)) {
      notes.push({
        title: draft.title,
        message: `Calculation removed: its factor ${calc.factor} does not appear in the quote.`,
      });
      calc = undefined;
    }
    candidates.push({
      draft,
      quote: q.quote,
      start: q.start,
      end: q.end,
      ...(q.page !== undefined ? { page: q.page } : {}),
      section: draft.section || chunk.heading || '',
      chunkIndex: chunk.index,
      ...(calc ? { calc } : {}),
    });
  };

  for (const chunk of chunks) {
    if (stopped()) fail('STOPPED', 'Stopped.');
    const sectionNo = chunk.index + 1;
    progress({ step: 'reading', section: sectionNo, sectionCount: chunks.length });

    const chunkText = source.text.slice(chunk.start, chunk.end);
    const chunkPublic = asPublic(chunk.text, 'source-document');
    let rawRules: unknown[];
    try {
      const reply = await deps.cloud(
        COMPILE_TASK,
        fillTemplate(COMPILE_PROMPT, { chunk: chunkPublic }),
        CompileReply,
      );
      rawRules = reply.data.rules;
    } catch (e) {
      if (e instanceof CloudError && e.code === 'OFFLINE')
        fail('OFFLINE', 'No signal. The cartridge was not finished.');
      // These would fail the same way for every remaining section.
      if (e instanceof CloudError && e.code === 'NOT_CONFIGURED') fail('CLOUD', e.message);
      if (e instanceof CloudError && (e.code === 'QUOTA' || e.code === 'REFUSED'))
        fail('CLOUD', `Stopped at section ${sectionNo} of ${chunks.length}: ${e.message}`);
      const message = (e as Error).message;
      // If nothing has worked yet, this is most likely a setup problem: stop instead of
      // repeating a failing call for every section.
      if (stats.sectionsRead === 0)
        fail('CLOUD', `The cloud could not read the rulebook: ${message}`);
      failedSections.push({ section: sectionNo, error: message });
      continue;
    }
    if (stopped()) fail('STOPPED', 'Stopped.');
    stats.sectionsRead++;

    const toRepair: Array<{ draft: RuleDraft; reason: 'QUOTE_TOO_LONG' | 'QUOTE_NOT_FOUND' }> = [];
    for (const raw of rawRules) {
      stats.extracted++;
      const parsed = RuleDraftSchema.safeParse(raw);
      if (!parsed.success) {
        dropped.push({
          title: rawTitle(raw),
          reason: 'INVALID',
          detail: 'The cloud returned this rule incomplete or in the wrong shape.',
          section: sectionNo,
        });
        continue;
      }
      const draft = parsed.data;
      const invented = inventedNumbers(draft.then, chunkText);
      if (invented.length > 0) {
        dropped.push({
          title: draft.title,
          reason: 'NUMBER_NOT_IN_SOURCE',
          detail: `Its instruction contains ${invented.join(', ')}, which does not appear in this part of the rulebook.`,
          section: sectionNo,
          quote: draft.quote,
        });
        continue;
      }
      stats.checked++;
      const q = checkQuote(draft.quote, chunk, prepared, opts.maxQuoteChars);
      if (q.ok) {
        stats.verified++;
        accept(draft, chunk, q);
      } else {
        toRepair.push({ draft, reason: q.reason });
      }
    }
    progress({ step: 'checking', verified: stats.verified, checked: stats.checked });

    if (toRepair.length === 0) continue;
    progress({
      step: 'repairing',
      section: sectionNo,
      sectionCount: chunks.length,
      count: toRepair.length,
    });
    const rulesJson: Public<string> = asPublic(
      JSON.stringify(
        toRepair.map((f, index) => ({
          index,
          title: f.draft.title,
          then: f.draft.then,
          quote: f.draft.quote,
        })),
        null,
        1,
      ),
      'cloud-response',
    );
    let repairs = new Map<number, string | null>();
    let repairError: string | undefined;
    try {
      const reply = await deps.cloud(
        REPAIR_QUOTE_TASK,
        fillTemplate(REPAIR_QUOTE_PROMPT, { chunk: chunkPublic, rulesJson }),
        RepairReply,
      );
      repairs = new Map(reply.data.repairs.map((r) => [r.index, r.quote]));
    } catch (e) {
      if (e instanceof CloudError && e.code === 'OFFLINE')
        fail('OFFLINE', 'No signal. The cartridge was not finished.');
      if (e instanceof CloudError && (e.code === 'QUOTA' || e.code === 'REFUSED'))
        fail('CLOUD', `Stopped at section ${sectionNo} of ${chunks.length}: ${e.message}`);
      repairError = (e as Error).message;
    }
    if (stopped()) fail('STOPPED', 'Stopped.');

    toRepair.forEach((f, index) => {
      const repaired = repairs.get(index);
      if (typeof repaired === 'string' && repaired.trim() !== '') {
        const q = checkQuote(repaired, chunk, prepared, opts.maxQuoteChars);
        if (q.ok) {
          stats.verified++;
          stats.repaired++;
          accept({ ...f.draft, quote: q.quote }, chunk, q);
          return;
        }
        dropped.push({
          title: f.draft.title,
          reason: q.reason,
          detail: DETAIL[q.reason],
          section: sectionNo,
          quote: q.quote,
        });
        return;
      }
      dropped.push({
        title: f.draft.title,
        reason: f.reason,
        detail: repairError
          ? `${DETAIL[f.reason].replace(', also when asked again', '')} Asking again failed: ${repairError}`
          : f.reason === 'QUOTE_NOT_FOUND'
            ? 'Its quote could not be found in the rulebook, and no exact passage was found when asked again.'
            : DETAIL[f.reason],
        section: sectionNo,
        quote: cleanQuote(f.draft.quote),
      });
    });
    progress({ step: 'checking', verified: stats.verified, checked: stats.checked });
  }

  progress({ step: 'finishing' });
  const deduped = dedupe(candidates, opts.titleSimilarity);
  const capped = applyCap(deduped.kept, opts.maxRules);
  dropped.push(...deduped.dropped, ...capped.dropped);
  const rules = assignIds(capped.kept);

  if (rules.length === 0) {
    fail('NO_RULES', 'No rule could be checked against the rulebook, so no cartridge was made.');
  }

  // Verified by construction; checked again so an unverified rule can never be returned.
  for (const r of rules) {
    if (!verifyQuote(r.source.quote, prepared).ok) {
      throw new Error(`Internal error: the quote of ${r.id} does not verify.`);
    }
  }

  stats.kept = rules.length;
  const cartridge = CartridgeSchema.parse({
    id: deps.newId?.() ?? `ctg-${crypto.randomUUID()}`,
    name: source.name,
    version: 1,
    createdAt: now().toISOString(),
    sourceHash: source.hash,
    sourceName: source.name,
    sourceLicence: source.licence,
    rules,
    changelog: [
      `Version 1: made from '${source.name}'. ${rules.length} rules kept, ${dropped.length} left out.`,
    ],
  });
  return { cartridge, dropped, notes, failedSections, stats };
}
