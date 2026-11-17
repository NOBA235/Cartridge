/**
 * What Exam Day saves. If the tutor's changes were kept, the result is a new
 * version (N+1, parent N) with a changelog line and the report. Otherwise the
 * report is attached to the version that was tested.
 */
import { CartridgeSchema, type Cartridge, type ExamReport, type Rule } from '@/cartridge/types';
import type { TutorChange } from './types';

const FIELD_NAMES: Record<TutorChange['field'], string> = {
  title: 'titles',
  when: 'situations',
  keywords: 'keywords',
  notWhen: 'not-when hints',
};

export function cartridgeAfterExam(
  c: Cartridge,
  result: { rules: readonly Rule[]; changes: readonly TutorChange[]; report: ExamReport },
  now: Date = new Date(),
): { cartridge: Cartridge; newVersion: boolean } {
  const kept = result.changes.filter((ch) => !ch.reverted);
  if (kept.length === 0) {
    return { cartridge: CartridgeSchema.parse({ ...c, report: result.report }), newVersion: false };
  }
  const ids = [...new Set(kept.map((k) => k.ruleId))];
  const fields = [...new Set(kept.map((k) => FIELD_NAMES[k.field]))];
  const version = c.version + 1;
  const next: Cartridge = {
    ...c,
    version,
    parentVersion: c.version,
    createdAt: now.toISOString(),
    rules: [...result.rules],
    report: result.report,
    changelog: [
      ...c.changelog,
      `Version ${version}: the Exam Day tutor changed ${ids.length} rule${ids.length === 1 ? '' : 's'} (${ids.join(', ')}): ${fields.join(', ')} only.`,
    ],
  };
  return { cartridge: CartridgeSchema.parse(next), newVersion: true };
}

/** The user marks a cartridge ready although its report is below the bar. */
export function overrideReady(c: Cartridge, now: Date = new Date()): Cartridge {
  if (!c.report) throw new Error('This version has no Exam Day report.');
  if (c.report.ready || c.report.overridden) return c;
  return CartridgeSchema.parse({
    ...c,
    report: { ...c.report, overridden: { at: now.toISOString() } },
  });
}

/** Ready for use: passed the bar, or marked ready by the user. */
export function isMarkedReady(report: ExamReport | undefined): boolean {
  return report !== undefined && (report.ready || report.overridden !== undefined);
}
