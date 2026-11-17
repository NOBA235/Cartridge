/** One dot per rule: green when all its exam questions passed, red when one failed, hollow when untested. */
import type { Rule } from '@/cartridge/types';
import type { ExamResult } from '@/exam/types';
import { cn } from '@/lib/utils';

export type DotState = 'passed' | 'failed' | 'untested';

export function ruleDotStates(
  rules: readonly Rule[],
  results: readonly ExamResult[],
): Map<string, { state: DotState; passed: number; total: number }> {
  const out = new Map<string, { state: DotState; passed: number; total: number }>();
  for (const r of rules) {
    const mine = results.filter((x) => x.expected === r.id);
    const passed = mine.filter((x) => x.pass).length;
    out.set(r.id, {
      state: mine.length === 0 ? 'untested' : passed === mine.length ? 'passed' : 'failed',
      passed,
      total: mine.length,
    });
  }
  return out;
}

const STYLE: Record<DotState, string> = {
  passed: 'bg-success border-success',
  failed: 'bg-destructive border-destructive',
  untested: 'bg-transparent border-muted-foreground/50',
};

export function RuleDots({
  rules,
  results,
}: {
  rules: readonly Rule[];
  results: readonly ExamResult[];
}) {
  const states = ruleDotStates(rules, results);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Rules">
        {rules.map((r) => {
          const s = states.get(r.id);
          const label =
            !s || s.state === 'untested'
              ? `${r.id} ${r.title}: not tested yet`
              : `${r.id} ${r.title}: passed ${s.passed} of ${s.total}`;
          return (
            <li
              key={r.id}
              title={label}
              aria-label={label}
              className={cn('size-3.5 rounded-full border-2', STYLE[s?.state ?? 'untested'])}
            />
          );
        })}
      </ul>
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className={cn('size-2.5 rounded-full border-2', STYLE.passed)} /> passed
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('size-2.5 rounded-full border-2', STYLE.failed)} /> a question failed
        </span>
        <span className="flex items-center gap-1">
          <span className={cn('size-2.5 rounded-full border-2', STYLE.untested)} /> not tested
        </span>
      </p>
    </div>
  );
}
