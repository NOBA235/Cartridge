/**
 * Reduce step of making a cartridge: remove duplicates, apply the rule cap,
 * and assign IDs R001, R002, ... in source order.
 */
import { normalize } from './normalize';
import type { Calc, Rule, Severity } from './types';

/** The rule fields the reduce step needs (a subset of the cloud's rule draft). */
export interface RuleDraftLike {
  title: string;
  when: string;
  then: string;
  exceptions: string[];
  severity: Severity;
  keywords: string[];
}

/** A rule whose quote has been verified against the source. */
export interface Candidate {
  draft: RuleDraftLike;
  /** Cleaned quote that verifies against the source. */
  quote: string;
  /** Verified passage, as offsets into the source text. */
  start: number;
  end: number;
  page?: number;
  section: string;
  chunkIndex: number;
  calc?: Calc;
}

export type ReduceDropReason = 'DUPLICATE' | 'OVER_CAP';

export interface ReduceDrop {
  title: string;
  reason: ReduceDropReason;
  detail: string;
  quote: string;
}

const STOPWORDS = new Set(
  'a an and the of to in on for or per at by with from is are be as its their this that'.split(' '),
);

export function titleTokens(title: string): Set<string> {
  return new Set(
    normalize(title)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t !== '' && !STOPWORDS.has(t)),
  );
}

/** Jaccard similarity of title words, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let both = 0;
  for (const t of ta) if (tb.has(t)) both++;
  return both / (ta.size + tb.size - both);
}

export const MAX_KEYWORDS = 10;

function mergeKeywords(into: Candidate, from: Candidate): Candidate {
  const merged = [...new Set([...into.draft.keywords, ...from.draft.keywords])].slice(
    0,
    MAX_KEYWORDS,
  );
  return { ...into, draft: { ...into.draft, keywords: merged } };
}

/**
 * Keeps the first of each group of duplicates, in source order. Two rules are
 * duplicates when their quotes are the same after normalisation, or their
 * titles have a word similarity of at least `titleThreshold`. The kept rule
 * takes over the duplicate's keywords (up to MAX_KEYWORDS).
 */
export function dedupe(
  candidates: readonly Candidate[],
  titleThreshold: number,
): { kept: Candidate[]; dropped: ReduceDrop[] } {
  const sorted = [...candidates].sort((a, b) => a.start - b.start || a.chunkIndex - b.chunkIndex);
  const kept: Candidate[] = [];
  const quoteIndex = new Map<string, number>();
  const dropped: ReduceDrop[] = [];

  for (const c of sorted) {
    const key = normalize(c.quote);
    let dupOf = quoteIndex.get(key);
    let why = 'same quote';
    if (dupOf === undefined) {
      dupOf = kept.findIndex(
        (k) => titleSimilarity(k.draft.title, c.draft.title) >= titleThreshold,
      );
      why = 'very similar title';
      if (dupOf === -1) dupOf = undefined;
    }
    if (dupOf !== undefined) {
      const original = kept[dupOf] as Candidate;
      kept[dupOf] = mergeKeywords(original, c);
      dropped.push({
        title: c.draft.title,
        reason: 'DUPLICATE',
        detail: `Same rule as '${original.draft.title}' (${why}).`,
        quote: c.quote,
      });
      continue;
    }
    quoteIndex.set(key, kept.length);
    kept.push(c);
  }
  return { kept, dropped };
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

/**
 * Keeps at most `max` rules: critical first, then major, then minor, each in
 * source order. The result is returned in source order.
 */
export function applyCap(
  candidates: readonly Candidate[],
  max: number,
): { kept: Candidate[]; dropped: ReduceDrop[] } {
  if (candidates.length <= max) return { kept: [...candidates], dropped: [] };
  const ranked = [...candidates].sort(
    (a, b) =>
      SEVERITY_ORDER[a.draft.severity] - SEVERITY_ORDER[b.draft.severity] || a.start - b.start,
  );
  const keep = new Set(ranked.slice(0, max));
  return {
    kept: candidates.filter((c) => keep.has(c)),
    dropped: ranked.slice(max).map((c) => ({
      title: c.draft.title,
      reason: 'OVER_CAP',
      detail: `The cartridge is limited to ${max} rules; ${c.draft.severity} rules after the first ${max} are left out.`,
      quote: c.quote,
    })),
  };
}

/** 'R001' ... 'R120'; widens past 999 so IDs stay sortable as strings. */
export function ruleId(index: number, total: number): string {
  const width = Math.max(3, String(total).length);
  return `R${String(index + 1).padStart(width, '0')}`;
}

export function assignIds(candidates: readonly Candidate[]): Rule[] {
  const ordered = [...candidates].sort((a, b) => a.start - b.start);
  return ordered.map((c, i) => {
    const rule: Rule = {
      id: ruleId(i, ordered.length),
      title: c.draft.title,
      when: c.draft.when,
      then: c.draft.then,
      exceptions: [...c.draft.exceptions],
      severity: c.draft.severity,
      keywords: c.draft.keywords.slice(0, MAX_KEYWORDS),
      source: {
        section: c.section,
        ...(c.page !== undefined ? { page: c.page } : {}),
        quote: c.quote,
      },
      ...(c.calc ? { calc: c.calc } : {}),
    };
    return rule;
  });
}
