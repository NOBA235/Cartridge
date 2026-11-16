/**
 * Rulebook passages for cloud questions: MiniSearch over the paragraphs of the
 * public rulebook. Only public rulebook text is ever returned.
 */
import MiniSearch from 'minisearch';
import { config } from '@/config';
import { paragraphs } from './chunker';
import { fuzzyFor, prefixFor, processTerm } from './searchTerms';
import { pageAt, type SourceText } from './source';

export interface Passage {
  text: string;
  page?: number;
  start: number;
  end: number;
}

interface Doc {
  id: number;
  text: string;
}

export interface PassageIndex {
  search(question: string, limit?: number): Passage[];
}

export function buildPassageIndex(
  source: SourceText,
  maxChars: number = config.ask.passageMaxChars,
): PassageIndex {
  const paras = paragraphs(source.text).map((p, id) => {
    const end = Math.min(p.end, p.start + maxChars);
    return { id, start: p.start, end, text: source.text.slice(p.start, end) };
  });
  const mini = new MiniSearch<Doc>({
    fields: ['text'],
    processTerm,
    searchOptions: { prefix: prefixFor, fuzzy: fuzzyFor, combineWith: 'OR' },
  });
  mini.addAll(paras.map(({ id, text }) => ({ id, text })));
  return {
    search(question, limit = config.ask.cloudPassages) {
      return mini
        .search(question)
        .slice(0, limit)
        .flatMap((r) => {
          const p = paras[r.id as number];
          if (!p) return [];
          const page = pageAt(source.pages, p.start);
          return [
            { text: p.text, start: p.start, end: p.end, ...(page !== undefined ? { page } : {}) },
          ];
        });
    },
  };
}

const cache = new WeakMap<object, PassageIndex>();

export function passageIndexFor(source: SourceText): PassageIndex {
  let idx = cache.get(source);
  if (!idx) {
    idx = buildPassageIndex(source);
    cache.set(source, idx);
  }
  return idx;
}

export function formatPassages(passages: readonly Passage[]): string {
  if (passages.length === 0) return '(none)';
  return passages
    .map((p) => `${p.page !== undefined ? `[p. ${p.page}] ` : ''}${p.text}`)
    .join('\n---\n');
}
