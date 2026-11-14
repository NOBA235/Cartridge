/**
 * Public and Private values.
 *
 * Every cloud function accepts only Public<T>. Anything the user types or draws
 * (questions, diagram labels, notes, audit results) is created as Private<T>.
 * `declassify()` in ./declassify.ts is the only way to turn a Private value into
 * a Public one.
 *
 * Enforcement has two layers:
 * 1. Compile time: the brand property makes Public and Private incompatible
 *    with each other and with plain values.
 * 2. Run time: values are minted into module-private WeakSets. `isPublic()`
 *    only accepts objects this module created, so a hand-built
 *    `{ value: 'x' }` cast to Public is rejected.
 *
 * This is a guard against our own mistakes, not against hostile code running
 * in the same page.
 */

declare const classification: unique symbol;

/** Where a public value came from. 'declassified' can only be set by declassify(). */
export type PublicOrigin =
  | 'app' // constants and prompt templates written by us
  | 'source-document' // openly licensed rulebook text loaded for compiling
  | 'cartridge' // rules compiled from a public source
  | 'cloud-response' // text returned by the cloud model
  | `declassified:${DeclassifyScope}`;

export type MintableOrigin = Exclude<PublicOrigin, `declassified:${string}`>;

export type PrivateOrigin = 'user-question' | 'diagram-label' | 'user-note' | 'audit-result';

export type DeclassifyScope = 'ask' | 'canvas' | 'dev';

export interface Public<T> {
  readonly [classification]: 'public';
  readonly value: T;
  /** Every origin that contributed to this value (more than one after composition). */
  readonly origins: readonly PublicOrigin[];
}

export interface Private<T> {
  readonly [classification]: 'private';
  readonly value: T;
  readonly origin: PrivateOrigin;
}

export type Classified<T> = Public<T> | Private<T>;

const publicValues = new WeakSet<object>();
const privateValues = new WeakSet<object>();

export class PrivacyError extends Error {
  override readonly name = 'PrivacyError';
}

function mintPublic<T>(value: T, origins: readonly PublicOrigin[]): Public<T> {
  const obj = Object.freeze({ value, origins: Object.freeze([...new Set(origins)]) });
  publicValues.add(obj);
  return obj as unknown as Public<T>;
}

/**
 * Marks a value as public. Only for data that is public by nature: our own
 * constants, openly licensed source text, rules compiled from it, and cloud
 * responses. Never call this on anything the user typed or drew.
 */
export function asPublic<T>(value: T, origin: MintableOrigin): Public<T> {
  return mintPublic(value, [origin]);
}

/** Marks user material as private. It may go to the on-device model, never to the cloud. */
export function asPrivate<T>(value: T, origin: PrivateOrigin): Private<T> {
  const obj = Object.freeze({ value, origin });
  privateValues.add(obj);
  return obj as unknown as Private<T>;
}

export function isPublic(x: unknown): x is Public<unknown> {
  return typeof x === 'object' && x !== null && publicValues.has(x);
}

export function isPrivate(x: unknown): x is Private<unknown> {
  return typeof x === 'object' && x !== null && privateValues.has(x);
}

/** Run-time gate used by every cloud entry point. */
export function assertPublic(x: unknown, where: string): asserts x is Public<unknown> {
  if (isPrivate(x)) {
    throw new PrivacyError(
      `${where}: refused a Private value. Use declassify() with user approval.`,
    );
  }
  if (!isPublic(x)) {
    throw new PrivacyError(
      `${where}: refused an unclassified value. Only Public values may leave.`,
    );
  }
}

/** Reads the value for local use (on-device model, rendering). */
export function reveal<T>(x: Classified<T>): T {
  return x.value;
}

/**
 * Fills {{name}} placeholders in a public template with public values.
 * The result is public, and its origins include every part's origins.
 * Throws if a placeholder has no value or a value is not Public.
 */
export function fillTemplate(
  template: Public<string>,
  vars: Readonly<Record<string, Public<string>>>,
): Public<string> {
  assertPublic(template, 'fillTemplate(template)');
  const origins: PublicOrigin[] = [...template.origins];
  for (const [key, v] of Object.entries(vars)) {
    assertPublic(v, `fillTemplate(${key})`);
    origins.push(...v.origins);
  }
  const text = template.value.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new PrivacyError(`fillTemplate: no value for {{${key}}}`);
    return v.value;
  });
  return mintPublic(text, origins);
}

/** Internal: used only by declassify(). Not re-exported from the package index. */
export function _mintDeclassified(value: string, scope: DeclassifyScope): Public<string> {
  return mintPublic(value, [`declassified:${scope}`]);
}
