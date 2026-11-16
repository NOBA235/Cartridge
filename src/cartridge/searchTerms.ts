/** Shared term handling for the rule and passage search indexes. */

/**
 * Words that carry no meaning for finding a rule: function words, and the
 * question words people use when asking ("how many", "do we need").
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its
  just may me might much must my need needed needs of on or our per please shall should so some such than that the
  their them then there these they this those to us was we were what when where which who whom why will with would
  you your many any get got give tell about also`
    .split(/\s+/)
    .filter(Boolean),
);

/** Lower-cases and drops stopwords and single letters (single digits are kept). */
export function processTerm(term: string): string | null {
  const t = term.normalize('NFKC').toLowerCase();
  if (t.length < 2 && !/\d/.test(t)) return null;
  return STOPWORDS.has(t) ? null : t;
}

/** Prefix matching for terms of 4+ characters, fuzzy (20% of length) for 5+. */
export const prefixFor = (term: string): boolean => term.length >= 4;
export const fuzzyFor = (term: string): number | false => (term.length >= 5 ? 0.2 : false);
