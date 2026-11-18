/** 'What left this device', grouped by purpose, for the Report card. */
import type { EgressEntry } from './egress';

export type Purpose =
  | 'making'
  | 'exam-questions'
  | 'tutor'
  | 'connection-tests'
  | 'questions'
  | 'signal-checks'
  | 'developer'
  | 'unexpected';

export const PURPOSE_LABEL: Record<Purpose, string> = {
  making: 'Making cartridges (public rulebook text)',
  'exam-questions': 'Writing test questions (public rules)',
  tutor: 'Exam Day tutor (public rules, practice questions)',
  'connection-tests': 'Writing connection tests (public rules)',
  questions: 'Questions you approved sending',
  'signal-checks': 'Signal checks (no content)',
  developer: 'Developer page tests',
  unexpected: 'Unexpected: a device call reported the cloud',
};

function purposeOf(e: EgressEntry): Purpose | undefined {
  if (e.kind === 'probe') return 'signal-checks';
  if (e.kind === 'unexpected-cloud') return 'unexpected';
  if (e.kind !== 'cloud-call') return undefined;
  switch (e.label) {
    case 'COMPILE':
    case 'REPAIR_QUOTE':
      return 'making';
    case 'EXAM':
      return 'exam-questions';
    case 'TUTOR':
      return 'tutor';
    case 'EDGE_BENCH':
      return 'connection-tests';
    case 'ANSWER':
      return 'questions';
    default:
      return 'developer';
  }
}

export interface PurposeTotal {
  purpose: Purpose;
  label: string;
  /** Requests, counting retries. */
  requests: number;
  bytes: number;
}

export interface EgressSummary {
  rows: PurposeTotal[];
  totalBytes: number;
  totalRequests: number;
  /** Times the user approved sending their own text. */
  approvals: number;
}

export function summariseEgress(entries: readonly EgressEntry[]): EgressSummary {
  const rows = new Map<Purpose, PurposeTotal>();
  let approvals = 0;
  for (const e of entries) {
    if (e.kind === 'declassify') {
      approvals++;
      continue;
    }
    const p = purposeOf(e);
    if (!p) continue;
    const row = rows.get(p) ?? { purpose: p, label: PURPOSE_LABEL[p], requests: 0, bytes: 0 };
    row.requests++;
    row.bytes += e.bytesSent;
    rows.set(p, row);
  }
  const order = Object.keys(PURPOSE_LABEL) as Purpose[];
  const sorted = order.flatMap((p) => {
    const r = rows.get(p);
    return r ? [r] : [];
  });
  return {
    rows: sorted,
    totalBytes: sorted.reduce((s, r) => s + r.bytes, 0),
    totalRequests: sorted.reduce((s, r) => s + r.requests, 0),
    approvals,
  };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
