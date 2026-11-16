/**
 * Text normalisation for quote verification. Applied the same way to the
 * source and to the quote, so two texts match when they differ only in
 * typography, line breaks or case.
 *
 * Steps, in order:
 * 1. NFKC per grapheme cluster (a base character plus its combining marks).
 *    This also expands compatibility ligatures (U+FB01 'ﬁ' to 'fi'), turns
 *    no-break and other special spaces into spaces, and full-width digits into
 *    ASCII digits.
 * 2. Join words hyphenated across a line break ("commu-\nnity" to "community").
 *    Only hyphens count (-, U+2010, U+2011, soft hyphen), never dashes.
 * 3. Remove soft hyphens and zero-width characters.
 * 4. Lower case.
 * 5. Expand the remaining ligatures (æ, œ). Unify quotes to ' and ", dashes to -.
 * 6. Collapse every run of whitespace to one space, drop it next to a dash
 *    (so "a - b", "a- b" and "a-b" match), and trim.
 *
 * Every output UTF-16 unit remembers the [start, end) range of the original
 * characters it came from, so a match can be mapped back to the source.
 */

export interface NormalizedText {
  readonly text: string;
  /** starts[i] = original start offset of output unit i. */
  readonly starts: Int32Array;
  /** ends[i] = original end offset (exclusive) of output unit i. */
  readonly ends: Int32Array;
}

const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;

/** A hyphen at the end of a line, between two letters, plus the line break around it. */
const LINE_BREAK_HYPHEN =
  /(?<=\p{L}\p{M}*)[-\u2010\u2011\u00AD][ \t]*(?:\r\n|\r|\n)[ \t]*(?=\p{L})/gu;

const DROP = new Set(['\u00AD', '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);

const CHAR_MAP: Record<string, string> = {
  æ: 'ae',
  œ: 'oe',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u2032': "'",
  '\u00B4': "'",
  '`': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u201F': '"',
  '\u2033': '"',
  '\u00AB': '"',
  '\u00BB': '"',
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
};

const WHITESPACE = /\s/u;

/** Ranges of the original text removed by the line-break hyphen rule. */
function lineBreakJoins(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(LINE_BREAK_HYPHEN)) {
    out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

export function normalizeWithMap(input: string): NormalizedText {
  const joins = lineBreakJoins(input);
  let j = 0;
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  // A whitespace run waiting to be written as one space. It is dropped at the
  // start and end of the text, and next to a dash ("a - b" and "a-b" match).
  let pending: [number, number] | undefined;

  for (const m of input.matchAll(CLUSTER)) {
    const start = m.index;
    const end = start + m[0].length;
    while (j < joins.length && (joins[j] as [number, number])[1] <= start) j++;
    const join = joins[j];
    if (join && start >= join[0] && start < join[1]) continue;

    const piece = m[0].normalize('NFKC').toLowerCase();
    for (const ch of piece) {
      if (DROP.has(ch)) continue;
      if (WHITESPACE.test(ch)) {
        if (chars.length > 0 && !pending) pending = [start, end];
        continue;
      }
      const mapped = CHAR_MAP[ch] ?? ch;
      if (pending) {
        if (mapped[0] !== '-' && chars.at(-1) !== '-') {
          chars.push(' ');
          starts.push(pending[0]);
          ends.push(pending[1]);
        }
        pending = undefined;
      }
      for (let k = 0; k < mapped.length; k++) {
        chars.push(mapped[k] as string);
        starts.push(start);
        ends.push(end);
      }
    }
  }
  return { text: chars.join(''), starts: Int32Array.from(starts), ends: Int32Array.from(ends) };
}

export function normalize(input: string): string {
  return normalizeWithMap(input).text;
}

/**
 * Removes '-' between two letters ("well-known" to "wellknown"). Used as a
 * fallback, on both sides, when a real compound word was split at a line end
 * in the source and step 2 joined it without its hyphen.
 */
export function dropWordHyphens(n: NormalizedText): NormalizedText {
  const keep: number[] = [];
  const t = n.text;
  for (let i = 0; i < t.length; i++) {
    if (
      t[i] === '-' &&
      i > 0 &&
      i < t.length - 1 &&
      /\p{L}/u.test(t[i - 1] as string) &&
      /\p{L}/u.test(t[i + 1] as string)
    ) {
      continue;
    }
    keep.push(i);
  }
  if (keep.length === t.length) return n;
  return {
    text: keep.map((i) => t[i]).join(''),
    starts: Int32Array.from(keep, (i) => n.starts[i] as number),
    ends: Int32Array.from(keep, (i) => n.ends[i] as number),
  };
}
