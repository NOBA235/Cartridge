/**
 * verifyQuote(quote, source): does the quote really appear in the source?
 *
 * Both sides go through normalize() (see ./normalize.ts), then the quote is
 * searched for as one contiguous passage. If that fails, both sides are
 * compared again with hyphens between letters removed, which catches a real
 * compound word ("well-known") that the source split at a line end.
 *
 * On success, start/end are offsets into the ORIGINAL source text, so
 * source.text.slice(start, end) is the passage as written, and page is the
 * page the passage starts on.
 */
import { dropWordHyphens, normalizeWithMap, type NormalizedText } from './normalize';
import { pageAt, type PageSpan, type SourceText } from './source';

export type MatchKind = 'normalized' | 'hyphen-insensitive';

export type VerifyResult =
  | {
      ok: true;
      start: number;
      end: number;
      page?: number;
      matchedBy: MatchKind;
      /** How many times the passage occurs. More than 1 is fine, but worth knowing. */
      occurrences: number;
    }
  | { ok: false; reason: 'EMPTY_QUOTE' | 'NOT_FOUND' };

export interface PreparedSource {
  readonly pages?: readonly PageSpan[];
  readonly normalized: NormalizedText;
  hyphenless(): NormalizedText;
}

const cache = new WeakMap<object, PreparedSource>();

export function prepareSource(source: string | SourceText): PreparedSource {
  const src: SourceText = typeof source === 'string' ? { text: source } : source;
  const cached = typeof source === 'object' ? cache.get(source) : undefined;
  if (cached) return cached;
  const normalized = normalizeWithMap(src.text);
  let hyphenless: NormalizedText | undefined;
  const prepared: PreparedSource = {
    pages: src.pages,
    normalized,
    hyphenless: () => (hyphenless ??= dropWordHyphens(normalized)),
  };
  if (typeof source === 'object') cache.set(source, prepared);
  return prepared;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * A match must not start or end in the middle of a word or number, so
 * "5 litres" does not verify against "15 litres".
 */
function atWordBoundaries(hay: string, at: number, needle: string): boolean {
  const before = hay[at - 1];
  const after = hay[at + needle.length];
  const startsInWord =
    WORD_CHAR.test(needle[0] as string) && before !== undefined && WORD_CHAR.test(before);
  const endsInWord =
    WORD_CHAR.test(needle.at(-1) as string) && after !== undefined && WORD_CHAR.test(after);
  return !startsInWord && !endsInWord;
}

function indexOfAtBoundaries(hay: string, needle: string, from: number): number {
  for (let at = hay.indexOf(needle, from); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (atWordBoundaries(hay, at, needle)) return at;
  }
  return -1;
}

export interface VerifyOptions {
  /**
   * If the passage occurs more than once, prefer an occurrence that starts in
   * this [start, end) range of the original text (for example the section the
   * rule came from). Falls back to the first occurrence.
   */
  preferRange?: { start: number; end: number };
}

function find(
  hay: NormalizedText,
  needle: string,
  pages: readonly PageSpan[] | undefined,
  matchedBy: MatchKind,
  options: VerifyOptions,
): VerifyResult | undefined {
  const first = indexOfAtBoundaries(hay.text, needle, 0);
  if (first === -1) return undefined;
  let at = first;
  let occurrences = 0;
  let preferred: number | undefined;
  for (let i = first; i !== -1; i = indexOfAtBoundaries(hay.text, needle, i + 1)) {
    occurrences++;
    const r = options.preferRange;
    const s = hay.starts[i] as number;
    if (preferred === undefined && r && s >= r.start && s < r.end) preferred = i;
  }
  if (preferred !== undefined) at = preferred;
  const start = hay.starts[at] as number;
  const end = hay.ends[at + needle.length - 1] as number;
  const page = pageAt(pages, start);
  return {
    ok: true,
    start,
    end,
    ...(page !== undefined ? { page } : {}),
    matchedBy,
    occurrences,
  };
}

export function verifyQuote(
  quote: string,
  source: string | SourceText | PreparedSource,
  options: VerifyOptions = {},
): VerifyResult {
  const prepared = isPrepared(source) ? source : prepareSource(source);
  const q = normalizeWithMap(quote);
  if (q.text === '') return { ok: false, reason: 'EMPTY_QUOTE' };

  const direct = find(prepared.normalized, q.text, prepared.pages, 'normalized', options);
  if (direct) return direct;

  // The fallback is only for quotes that contain a hyphenated word.
  const qh = dropWordHyphens(q).text;
  if (qh !== q.text && qh !== '') {
    const loose = find(prepared.hyphenless(), qh, prepared.pages, 'hyphen-insensitive', options);
    if (loose) return loose;
  }
  return { ok: false, reason: 'NOT_FOUND' };
}

function isPrepared(x: unknown): x is PreparedSource {
  return typeof x === 'object' && x !== null && 'normalized' in x && 'hyphenless' in x;
}
