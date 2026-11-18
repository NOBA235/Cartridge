/**
 * Cartridge versions. Every change makes a new version N+1 whose parent is N;
 * nothing is ever overwritten or deleted, so any version can be restored.
 *
 * - diffRules(): what changed between two versions, rule by rule and field by field.
 * - nextRuleId(): IDs are never reused across versions, so R009 always means one rule.
 * - versionWithRule(): adds an approved rule as version N+1.
 * - restoreVersion(): version N+1 with the rules (and the report) of an older version.
 */
import { describeCalc } from './calc';
import { CartridgeSchema, type Cartridge, type Rule } from './types';

export type RuleField =
  | 'title'
  | 'when'
  | 'notWhen'
  | 'then'
  | 'exceptions'
  | 'severity'
  | 'keywords'
  | 'source'
  | 'calc';

export const RULE_FIELDS: readonly RuleField[] = [
  'title',
  'when',
  'notWhen',
  'then',
  'exceptions',
  'severity',
  'keywords',
  'source',
  'calc',
];

export interface FieldChange {
  field: RuleField;
  before: string;
  after: string;
}

export interface RuleChange {
  id: string;
  title: string;
  fields: FieldChange[];
}

export interface RuleDiff {
  added: Rule[];
  removed: Rule[];
  changed: RuleChange[];
  unchanged: number;
}

/** A field as plain text, for showing a change. */
export function formatField(rule: Rule, field: RuleField): string {
  switch (field) {
    case 'exceptions':
      return rule.exceptions.join('; ');
    case 'keywords':
      return rule.keywords.join(', ');
    case 'source': {
      const where = [
        rule.source.section,
        rule.source.page !== undefined ? `p. ${rule.source.page}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `${where ? `${where}: ` : ''}“${rule.source.quote}”`;
    }
    case 'calc':
      return rule.calc ? describeCalc(rule.calc) : '';
    default:
      return rule[field] ?? '';
  }
}

/** Stable comparison value: key order does not matter, values do. */
function comparable(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return JSON.stringify(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]]),
    );
  }
  return String(value);
}

function idNumber(id: string): number {
  return Number(id.slice(1));
}

function byId(a: Rule, b: Rule): number {
  return idNumber(a.id) - idNumber(b.id);
}

export function diffRules(before: readonly Rule[], after: readonly Rule[]): RuleDiff {
  const old = new Map(before.map((r) => [r.id, r]));
  const now = new Map(after.map((r) => [r.id, r]));
  const added = after.filter((r) => !old.has(r.id)).sort(byId);
  const removed = before.filter((r) => !now.has(r.id)).sort(byId);
  const changed: RuleChange[] = [];
  let unchanged = 0;
  for (const r of [...after].sort(byId)) {
    const prev = old.get(r.id);
    if (!prev) continue;
    const fields = RULE_FIELDS.filter((f) => comparable(prev[f]) !== comparable(r[f])).map((f) => ({
      field: f,
      before: formatField(prev, f),
      after: formatField(r, f),
    }));
    if (fields.length === 0) unchanged++;
    else changed.push({ id: r.id, title: r.title, fields });
  }
  return { added, removed, changed, unchanged };
}

export function isEmptyDiff(d: RuleDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

/** The next free rule ID, counting every rule ID ever used by any version of the cartridge. */
export function nextRuleId(everyId: Iterable<string>): string {
  let max = 0;
  let width = 3;
  for (const id of everyId) {
    const n = idNumber(id);
    if (Number.isFinite(n)) max = Math.max(max, n);
    width = Math.max(width, id.length - 1);
  }
  return `R${String(max + 1).padStart(width, '0')}`;
}

export class VersionError extends Error {
  override readonly name = 'VersionError';
}

/** Version N+1 based on `current`, without its test results (they described other rules). */
function nextVersion(
  current: Cartridge,
  rules: Rule[],
  changelogLine: string,
  now: Date,
): Cartridge {
  const rest: Cartridge = { ...current };
  delete rest.report;
  delete rest.edgeBench;
  const version = current.version + 1;
  return CartridgeSchema.parse({
    ...rest,
    version,
    parentVersion: current.version,
    createdAt: now.toISOString(),
    rules,
    changelog: [...current.changelog, `Version ${version}: ${changelogLine}`],
  });
}

export function versionWithRule(current: Cartridge, rule: Rule, now: Date = new Date()): Cartridge {
  if (current.rules.some((r) => r.id === rule.id)) {
    throw new VersionError(`${rule.id} is already in this cartridge.`);
  }
  return nextVersion(
    current,
    [...current.rules, rule],
    `added ${rule.id} ‘${rule.title}’, suggested by the cloud and approved by you.`,
    now,
  );
}

export function restoreVersion(
  current: Cartridge,
  target: Cartridge,
  now: Date = new Date(),
): Cartridge {
  if (target.id !== current.id)
    throw new VersionError('That version belongs to another cartridge.');
  if (target.version === current.version)
    throw new VersionError('This is already the current version.');
  if (target.sourceHash !== current.sourceHash) {
    throw new VersionError('That version was made from a different rulebook.');
  }
  const restored = nextVersion(
    current,
    [...target.rules],
    `restored the rules of version ${target.version}.`,
    now,
  );
  // The rules are exactly the ones version k was tested with, so its results still describe them.
  return CartridgeSchema.parse({
    ...restored,
    ...(target.report ? { report: target.report } : {}),
    ...(target.edgeBench ? { edgeBench: target.edgeBench } : {}),
  });
}
