/**
 * Privacy helper for Blueprint's manual 'Ask the cloud (generalised)' flow.
 *
 * The input starts empty and never copies diagram labels automatically. Before
 * the user opens DeclassifyDialog, leakedDiagramTerms() checks locally whether
 * they accidentally typed one of their diagram's box names into the question,
 * so they can replace real service names with generic ones first.
 */

const MIN_TERM_LENGTH = 4;

/** Extracts the distinct box names from a formatted edge ('From --> To (label)'). */
export function diagramNodeNames(edgeText: string): string[] {
  const [left, rightWithLabel] = edgeText.split('-->');
  if (!left || !rightWithLabel) return [];
  const from = left.trim();
  // Strip trailing optional ' (arrow label)' only if it wraps the very end after a space.
  const rightTrim = rightWithLabel.trim();
  const to = rightTrim.replace(/\s+\([^()]+\)$/, '').trim();
  return [...new Set([from, to].filter((s) => s.length >= MIN_TERM_LENGTH))];
}

/** Returns any box names from the selected edge that appear verbatim (case-insensitive) in `draft`. */
export function leakedDiagramTerms(draft: string, edgeText: string): string[] {
  const hay = draft.toLowerCase();
  if (hay.trim() === '') return [];
  return diagramNodeNames(edgeText).filter((name) => hay.includes(name.toLowerCase()));
}
