/** What changed between two versions: added, removed and changed rules, field by field. */
import type { Rule } from '@/cartridge/types';
import { formatField, RULE_FIELDS, type RuleDiff, type RuleField } from '@/cartridge/versions';
import { SeverityChip } from '@/ui/components/SeverityChip';

export const FIELD_LABEL: Record<RuleField, string> = {
  title: 'Title',
  when: 'When',
  notWhen: 'Not when',
  then: 'What to do',
  exceptions: 'Exceptions',
  severity: 'Severity',
  keywords: 'Asked as',
  source: 'Source',
  calc: 'Calculation',
};

function RuleFields({ rule, tone }: { rule: Rule; tone: 'added' | 'removed' }) {
  return (
    <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
      {RULE_FIELDS.filter(
        (f) => f !== 'title' && f !== 'severity' && formatField(rule, f) !== '',
      ).map((f) => (
        <div key={f} className="contents">
          <dt className="text-muted-foreground">{FIELD_LABEL[f]}</dt>
          <dd className={tone === 'removed' ? 'text-muted-foreground line-through' : ''}>
            {formatField(rule, f)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function DiffView({
  diff,
  emptyText = 'No rule changed.',
}: {
  diff: RuleDiff;
  emptyText?: string;
}) {
  const empty = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
  if (empty) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {diff.added.map((r) => (
        <li key={`a-${r.id}`} className="rounded-lg border border-success/40 bg-success/5 p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="text-xs text-success uppercase">Added</span>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">{r.id}</span>
            {r.title}
            <SeverityChip severity={r.severity} />
          </p>
          <RuleFields rule={r} tone="added" />
        </li>
      ))}
      {diff.removed.map((r) => (
        <li
          key={`r-${r.id}`}
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="text-xs text-destructive uppercase">Removed</span>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">{r.id}</span>
            {r.title}
          </p>
          <RuleFields rule={r} tone="removed" />
        </li>
      ))}
      {diff.changed.map((c) => (
        <li key={`c-${c.id}`} className="rounded-lg border p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="text-xs text-warning uppercase">Changed</span>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">{c.id}</span>
            {c.title}
          </p>
          <dl className="mt-2 flex flex-col gap-2 text-sm">
            {c.fields.map((f) => (
              <div key={f.field}>
                <dt className="text-xs text-muted-foreground">{FIELD_LABEL[f.field]}</dt>
                <dd>
                  <span className="block text-muted-foreground line-through">
                    {f.before || '(empty)'}
                  </span>
                  <span className="block">{f.after || '(empty)'}</span>
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
      {diff.unchanged > 0 && (
        <li className="text-xs text-muted-foreground">
          {diff.unchanged} other rule{diff.unchanged === 1 ? '' : 's'} unchanged.
        </li>
      )}
    </ul>
  );
}
