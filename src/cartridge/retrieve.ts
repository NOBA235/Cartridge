/**
 * retrieve(): MiniSearch over the rules of one cartridge version.
 * Fields: title, when, keywords, then. Keywords are boosted x3 and the title
 * x2, with prefix and light fuzzy matching. Returns the top K rules (default 5).
 * If the best score is under the threshold, the question is treated as not
 * covered and no model is asked (LOW_RETRIEVAL).
 */
import MiniSearch from 'minisearch';
import { config } from '@/config';
import { fuzzyFor, prefixFor, processTerm } from './searchTerms';
import type { Cartridge, Rule } from './types';

export interface RetrievalHit {
  rule: Rule;
  score: number;
}

export interface Retrieval {
  hits: RetrievalHit[];
  bestScore: number;
  /** True when the best score reaches the threshold. */
  confident: boolean;
}

export interface RuleIndex {
  readonly key: string;
  search(question: string, options?: { topK?: number; minScore?: number }): Retrieval;
}

const FIELDS = ['title', 'when', 'keywords', 'then'] as const;

export function buildRuleIndex(cartridge: Pick<Cartridge, 'id' | 'version' | 'rules'>): RuleIndex {
  const byId = new Map(cartridge.rules.map((r) => [r.id, r]));
  const mini = new MiniSearch<Rule>({
    fields: [...FIELDS],
    idField: 'id',
    extractField: (doc, field) => {
      const v = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(v) ? v.join(' ') : v;
    },
    processTerm,
    searchOptions: {
      boost: { keywords: 3, title: 2 },
      prefix: prefixFor,
      fuzzy: fuzzyFor,
      combineWith: 'OR',
    },
  });
  mini.addAll(cartridge.rules);

  return {
    key: `${cartridge.id}@${cartridge.version}`,
    search(question, options = {}) {
      const topK = options.topK ?? config.ask.topK;
      const minScore = options.minScore ?? config.ask.minScore;
      const hits = mini
        .search(question)
        .slice(0, topK)
        .flatMap((res) => {
          const rule = byId.get(String(res.id));
          return rule ? [{ rule, score: res.score }] : [];
        });
      const bestScore = hits[0]?.score ?? 0;
      return { hits, bestScore, confident: hits.length > 0 && bestScore >= minScore };
    },
  };
}

const cache = new Map<string, RuleIndex>();

/** One index per cartridge version, kept for the session. */
export function ruleIndexFor(cartridge: Cartridge): RuleIndex {
  const key = `${cartridge.id}@${cartridge.version}`;
  let index = cache.get(key);
  if (!index) {
    index = buildRuleIndex(cartridge);
    cache.set(key, index);
  }
  return index;
}
