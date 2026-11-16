/**
 * Turns pdf.js text items for one page into plain text.
 * - A new line where pdf.js reports hasEOL, or where the baseline moves.
 * - A blank line (paragraph break) when the gap to the next line is larger
 *   than PARAGRAPH_GAP times the line height.
 * Pure, so it is unit-tested without pdf.js.
 */

/** The fields of a pdf.js TextItem we use. */
export interface TextItemLike {
  str: string;
  hasEOL: boolean;
  /** [a, b, c, d, e, f]; f is the baseline y (larger is higher on the page). */
  transform: number[];
  height: number;
}

export const PARAGRAPH_GAP = 1.6;

function isTextItem(x: unknown): x is TextItemLike {
  return typeof x === 'object' && x !== null && 'str' in x && 'transform' in x;
}

export function assemblePageText(items: readonly unknown[]): string {
  let out = '';
  let lineY: number | undefined;
  let lineH = 0;
  let atLineStart = true;

  for (const raw of items) {
    if (!isTextItem(raw)) continue; // marked-content items
    const y = Number(raw.transform[5]);
    const h = Math.abs(raw.height) || Math.abs(Number(raw.transform[3])) || 0;
    const visible = raw.str.trim() !== '';

    if (visible && lineY !== undefined) {
      const lineHeight = Math.max(lineH, h);
      const moved = Math.abs(lineY - y) > lineHeight * 0.5;
      if (!atLineStart && moved) {
        out += '\n';
        atLineStart = true;
      }
      if (
        atLineStart &&
        lineHeight > 0 &&
        lineY - y > PARAGRAPH_GAP * lineHeight &&
        !out.endsWith('\n\n')
      ) {
        out += '\n';
      }
    }

    out += raw.str;
    if (visible) {
      lineY = y;
      lineH = h;
      atLineStart = false;
    }
    // Several EOLs in a row are one line break; blank lines come only from gaps.
    if (raw.hasEOL && !atLineStart) {
      out += '\n';
      atLineStart = true;
    }
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
