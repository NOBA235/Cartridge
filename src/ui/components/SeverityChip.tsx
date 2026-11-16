import type { Severity } from '@/cartridge/types';
import { cn } from '@/lib/utils';

const STYLE: Record<Severity, string> = {
  critical: 'border-destructive/50 bg-destructive/10 text-destructive',
  major: 'border-warning/50 bg-warning/10 text-warning',
  minor: 'border-border bg-muted text-muted-foreground',
};

const LABEL: Record<Severity, string> = { critical: 'Critical', major: 'Major', minor: 'Minor' };

export function SeverityChip({
  severity,
  count,
  className,
}: {
  severity: Severity;
  count?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        STYLE[severity],
        className,
      )}
    >
      {LABEL[severity]}
      {count !== undefined && <span className="tabular-nums opacity-80">{count}</span>}
    </span>
  );
}

export const SEVERITIES: readonly Severity[] = ['critical', 'major', 'minor'];
